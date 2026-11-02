-- Field Associate Extra Inventory: expose the confirmation date, a clean list
-- of source companies, AND a per-company quantity breakdown so managers can see
-- exactly which company each sensor came from and how many, plus when it was
-- sent/confirmed.
-- Adds to each item group:
--   last_confirmed_at : latest confirmation date in the group
--   company_list      : distinct source companies (array)
--   company_breakdown : [{ company, quantity, total_value, last_confirmed_at }]
-- `companies` (comma-joined string) is kept for backward compatibility/search.
BEGIN;
CREATE OR REPLACE FUNCTION public.field_associate_extra_inventory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE manager boolean;
BEGIN
  manager:=public.field_inventory_manager();
  IF NOT manager AND NOT public.field_ops_associate(auth.uid()) THEN RAISE EXCEPTION 'Field inventory access required' USING ERRCODE='42501'; END IF;
  RETURN (
    WITH base AS (
      SELECT c.associate_id,
        coalesce(nullif(p.name,''),'Field associate') AS associate_name,
        x->>'group_key' AS group_key, x->>'label' AS label, x->>'model' AS model,
        coalesce(s.company_name,s.name) AS company,
        (x->>'unit_price') AS unit_price_text,
        c.confirmed_at
      FROM public.installation_order_confirmations c
      JOIN public.profiles p ON p.id=c.associate_id
      JOIN public.sites s ON s.id=c.site_id
      CROSS JOIN LATERAL jsonb_array_elements(c.items) x
      WHERE (manager OR c.associate_id=auth.uid())
        AND x->>'received'='true' AND x->>'used'='false'
    ),
    per_company AS (
      SELECT associate_id, associate_name, group_key, label, model, company,
        count(*)::integer AS quantity,
        bool_and(unit_price_text IS NOT NULL) AS price_known,
        CASE WHEN bool_and(unit_price_text IS NOT NULL) THEN round(sum(unit_price_text::numeric),2) END AS total_value,
        max(confirmed_at) AS last_confirmed_at
      FROM base
      GROUP BY associate_id, associate_name, group_key, label, model, company
    ),
    grouped AS (
      SELECT associate_id, associate_name, group_key, label, model,
        'Nos'::text AS unit,
        sum(quantity)::integer AS quantity,
        bool_and(price_known) AS price_known,
        CASE WHEN bool_and(price_known) THEN round(sum(total_value),2) END AS total_value,
        CASE WHEN bool_and(price_known) THEN round(sum(total_value)/nullif(sum(quantity),0),4) END AS unit_price,
        string_agg(DISTINCT company,', ') AS companies,
        to_jsonb(array_agg(DISTINCT company)) AS company_list,
        max(last_confirmed_at) AS last_confirmed_at,
        jsonb_agg(jsonb_build_object(
          'company',company,'quantity',quantity,
          'total_value',total_value,'last_confirmed_at',last_confirmed_at
        ) ORDER BY company) AS company_breakdown
      FROM per_company
      GROUP BY associate_id, associate_name, group_key, label, model
    )
    SELECT coalesce(
      jsonb_agg(to_jsonb(g) - 'price_known'
        ORDER BY g.last_confirmed_at DESC NULLS LAST, g.associate_name, g.label, g.model),
      '[]')
    FROM grouped g
  );
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
