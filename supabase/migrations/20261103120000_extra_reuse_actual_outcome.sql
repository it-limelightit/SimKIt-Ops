-- Extra stock reuse: count what actually happened at the receiving company.
--
-- A unit logistics takes from an associate's extra stock for a new order is:
--   * pending   - order not yet confirmed in Installation: held for that order
--   * installed - confirmed as Used there: it leaves extra stock
--   * returned  - confirmed as not used there: it stays in extra stock
-- A returned unit keeps its original source company (where it first arrived)
-- instead of being counted again as a new extra at the receiving company.
BEGIN;

CREATE OR REPLACE FUNCTION public.associate_extra_usage_outcome()
RETURNS TABLE(id uuid,order_id uuid,associate_id uuid,group_key text,model_key text,quantity integer,status text,
  applied_at timestamptz,selected_by uuid,confirmed boolean,installed integer,returned integer,consumed integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT u.id,u.order_id,u.associate_id,u.group_key,lower(btrim(u.model)),u.quantity,u.status,u.applied_at,u.selected_by,
    c.order_id IS NOT NULL,
    least(coalesce(x.installed,0),u.quantity),
    CASE WHEN c.order_id IS NULL THEN 0 ELSE u.quantity-least(coalesce(x.installed,0),u.quantity) END,
    CASE WHEN c.order_id IS NULL THEN u.quantity ELSE least(coalesce(x.installed,0),u.quantity) END
  FROM public.associate_extra_usage u
  LEFT JOIN public.installation_order_confirmations c ON c.order_id=u.order_id
  LEFT JOIN LATERAL (SELECT count(*)::integer installed FROM jsonb_array_elements(c.items) i
    WHERE i->>'group_key'=u.group_key AND i->>'from_extra'='true' AND i->>'used'='true') x ON true
$$;

-- Balance: original extras (not re-counted returns) less units installed or
-- still held for an unconfirmed order. Planned units on other orders are reserved.
CREATE OR REPLACE FUNCTION public.associate_extra_balance(_associate uuid,_exclude_order uuid DEFAULT NULL)
RETURNS TABLE(group_key text,model_key text,gross integer,applied integer,reserved integer,available integer,unit_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH stock AS (
    SELECT x->>'group_key' group_key,lower(btrim(coalesce(x->>'model',''))) model_key,count(*)::integer gross,
      CASE WHEN bool_and(x->>'unit_price' IS NOT NULL) THEN round(avg((x->>'unit_price')::numeric),4) END unit_price
    FROM public.installation_order_confirmations c CROSS JOIN LATERAL jsonb_array_elements(c.items) x
    WHERE c.associate_id=_associate AND x->>'received'='true' AND x->>'used'='false'
      AND coalesce(x->>'from_extra','false')<>'true'
    GROUP BY 1,2
  ), used AS (
    SELECT o.group_key,o.model_key,
      coalesce(sum(o.consumed) FILTER (WHERE o.status='applied'),0)::integer applied,
      coalesce(sum(o.quantity) FILTER (WHERE o.status='planned' AND o.order_id IS DISTINCT FROM _exclude_order),0)::integer reserved
    FROM public.associate_extra_usage_outcome() o WHERE o.associate_id=_associate GROUP BY 1,2
  )
  SELECT s.group_key,s.model_key,s.gross,coalesce(u.applied,0),coalesce(u.reserved,0),
    greatest(s.gross-coalesce(u.applied,0)-coalesce(u.reserved,0),0),s.unit_price
  FROM stock s LEFT JOIN used u ON u.group_key=s.group_key AND u.model_key=s.model_key
$$;

CREATE OR REPLACE FUNCTION public.field_associate_extra_inventory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE manager boolean;
BEGIN
  manager:=public.field_inventory_manager();
  IF NOT manager AND NOT public.field_inventory_worker(auth.uid()) THEN RAISE EXCEPTION 'Field inventory access required' USING ERRCODE='42501'; END IF;
  RETURN (
    WITH base AS (
      SELECT c.associate_id,coalesce(nullif(p.name,''),'Field associate') AS associate_name,
        x->>'group_key' AS group_key,x->>'label' AS label,coalesce(x->>'model','') AS model,
        lower(btrim(coalesce(x->>'model',''))) AS model_key,
        coalesce(s.company_name,s.name) AS company,(x->>'unit_price') AS unit_price_text,c.confirmed_at
      FROM public.installation_order_confirmations c
      JOIN public.profiles p ON p.id=c.associate_id
      JOIN public.sites s ON s.id=c.site_id
      CROSS JOIN LATERAL jsonb_array_elements(c.items) x
      WHERE (manager OR c.associate_id=auth.uid()) AND x->>'received'='true' AND x->>'used'='false'
        AND coalesce(x->>'from_extra','false')<>'true'
    ),
    used_rows AS (
      SELECT o.associate_id,o.group_key,o.model_key,sum(o.consumed)::integer AS used_quantity,
        jsonb_agg(jsonb_build_object('order_id',o.order_id,'company',m.material_name,'device_id',m.device_id,
          'quantity',o.quantity,'installed',o.installed,'returned',o.returned,'used_at',o.applied_at,
          'outcome',CASE WHEN NOT o.confirmed THEN 'pending' WHEN o.returned=0 THEN 'installed'
            WHEN o.installed=0 THEN 'returned' ELSE 'partial' END,
          'selected_by',coalesce((SELECT nullif(name,'') FROM public.profiles WHERE id=o.selected_by),'Logistics'))
          ORDER BY o.applied_at DESC) AS usage_history
      FROM public.associate_extra_usage_outcome() o JOIN public.inventory_materials m ON m.id=o.order_id
      WHERE o.status='applied' AND (manager OR o.associate_id=auth.uid())
      GROUP BY 1,2,3
    ),
    per_company AS (
      SELECT associate_id,associate_name,group_key,label,model_key,min(model) AS model,company,
        count(*)::integer AS quantity,bool_and(unit_price_text IS NOT NULL) AS price_known,
        CASE WHEN bool_and(unit_price_text IS NOT NULL) THEN sum(unit_price_text::numeric) END AS gross_value,
        max(confirmed_at) AS last_confirmed_at
      FROM base GROUP BY associate_id,associate_name,group_key,label,model_key,company
    ),
    netted AS (
      SELECT pc.*,
        pc.quantity-greatest(0,least(pc.quantity,coalesce(u.used_quantity,0)-(sum(pc.quantity) OVER w-pc.quantity))) AS net_quantity
      FROM per_company pc LEFT JOIN used_rows u ON u.associate_id=pc.associate_id AND u.group_key=pc.group_key AND u.model_key=pc.model_key
      WINDOW w AS (PARTITION BY pc.associate_id,pc.group_key,pc.model_key ORDER BY pc.last_confirmed_at,pc.company
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ),
    grouped AS (
      SELECT n.associate_id,n.associate_name,n.group_key,min(n.label) AS label,min(n.model) AS model,n.model_key,
        'Nos'::text AS unit,
        sum(n.net_quantity)::integer AS quantity,
        sum(n.quantity)::integer AS received_quantity,
        bool_and(n.price_known) AS price_known,
        CASE WHEN bool_and(n.price_known) THEN round(sum(n.gross_value*n.net_quantity/n.quantity),2) END AS total_value,
        CASE WHEN bool_and(n.price_known) THEN round(sum(n.gross_value)/nullif(sum(n.quantity),0),4) END AS unit_price,
        string_agg(DISTINCT n.company,', ') FILTER (WHERE n.net_quantity>0) AS companies,
        coalesce(to_jsonb(array_agg(DISTINCT n.company) FILTER (WHERE n.net_quantity>0)),'[]') AS company_list,
        max(n.last_confirmed_at) AS last_confirmed_at,
        coalesce(jsonb_agg(jsonb_build_object('company',n.company,'quantity',n.net_quantity,
          'total_value',CASE WHEN n.price_known THEN round(n.gross_value*n.net_quantity/n.quantity,2) END,
          'last_confirmed_at',n.last_confirmed_at) ORDER BY n.company) FILTER (WHERE n.net_quantity>0),'[]') AS company_breakdown
      FROM netted n GROUP BY n.associate_id,n.associate_name,n.group_key,n.model_key
    )
    SELECT coalesce(jsonb_agg((to_jsonb(g)-'price_known'-'model_key')
        ||jsonb_build_object('used_quantity',coalesce(u.used_quantity,0),'usage_history',coalesce(u.usage_history,'[]'::jsonb))
      ORDER BY g.last_confirmed_at DESC NULLS LAST,g.associate_name,g.label,g.model),'[]')
    FROM grouped g LEFT JOIN used_rows u ON u.associate_id=g.associate_id AND u.group_key=g.group_key AND u.model_key=g.model_key
  );
END $$;

REVOKE ALL ON FUNCTION public.associate_extra_usage_outcome() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
