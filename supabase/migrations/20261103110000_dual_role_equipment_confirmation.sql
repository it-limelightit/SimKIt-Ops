-- Let a dual-role manager (supervisor/owner + worker) confirm installation
-- equipment and hold extra inventory like a field associate.
-- field_ops_associate() excludes staff, which blocked dual-role managers with
-- "Only an assigned active field associate can confirm equipment".
-- Pure managers (no worker role) remain unable to confirm equipment.
BEGIN;

CREATE OR REPLACE FUNCTION public.field_inventory_worker(_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT _id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=_id AND p.is_active)
    AND public.has_role(_id,'worker')
$$;

CREATE OR REPLACE FUNCTION public.installation_confirm_order(_site uuid,_order uuid,_revision integer,_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.inventory_materials; existing public.installation_order_confirmations;
  template jsonb; item jsonb; choice jsonb; received boolean; used boolean; result jsonb:='[]'; next_revision integer;
BEGIN
  PERFORM public.field_inventory_assert_site(_site);
  IF NOT public.field_inventory_worker(auth.uid()) THEN
    RAISE EXCEPTION 'Only an active field associate (or a manager with the field associate role) can confirm equipment';
  END IF;
  IF EXISTS(SELECT 1 FROM public.installation_inventory_legacy_sites WHERE site_id=_site) THEN RAISE EXCEPTION 'Historical installation is unchanged'; END IF;
  PERFORM public.field_inventory_assert_legacy_link(_site);
  SELECT * INTO m FROM public.inventory_materials WHERE id=_order FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.field_inventory_site_orders(_site) WHERE id=_order)
    OR NOT public.field_inventory_dispatched(m) THEN RAISE EXCEPTION 'Dispatched order not found for this company'; END IF;
  SELECT * INTO existing FROM public.installation_order_confirmations WHERE order_id=_order FOR UPDATE;
  IF existing.order_id IS NOT NULL AND (existing.site_id<>_site OR existing.associate_id<>auth.uid()) THEN
    RAISE EXCEPTION 'This order is already confirmed by another field associate';
  END IF;
  IF _revision IS DISTINCT FROM coalesce(existing.revision,0) THEN RAISE EXCEPTION 'Equipment confirmation changed. Refresh before saving'; END IF;
  template:=public.field_inventory_order_items(_order);
  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Confirm every dispatched device and sensor'; END IF;
  IF jsonb_array_length(_items)<>jsonb_array_length(template) OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(_items) x GROUP BY x->>'key' HAVING count(*)<>1
  ) THEN RAISE EXCEPTION 'Confirm every dispatched device and sensor exactly once'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(template) LOOP
    SELECT value INTO choice FROM jsonb_array_elements(_items) WHERE value->>'key'=item->>'key';
    IF choice IS NULL OR jsonb_typeof(choice->'received') IS DISTINCT FROM 'boolean' OR jsonb_typeof(choice->'used') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Received and Used confirmations are required for every item'; END IF;
    received:=(choice->>'received')::boolean; used:=(choice->>'used')::boolean;
    IF coalesce((item->>'from_extra')::boolean,false) AND NOT received THEN
      RAISE EXCEPTION '% came from your extra stock and is already with you; keep it marked received',item->>'label';
    END IF;
    IF used AND NOT received THEN RAISE EXCEPTION 'An item cannot be used before it is received'; END IF;
    result:=result||jsonb_build_array(item||jsonb_build_object('received',received,'used',used));
  END LOOP;
  next_revision:=coalesce(existing.revision,0)+1;
  INSERT INTO public.installation_order_confirmations(order_id,site_id,associate_id,revision,items)
    VALUES(_order,_site,auth.uid(),next_revision,result)
  ON CONFLICT(order_id) DO UPDATE SET items=excluded.items,revision=excluded.revision,updated_at=now();
  RETURN jsonb_build_object('revision',next_revision,'items',result);
END $$;

-- Orders placed by a dual-role manager can also reuse their extra stock.
CREATE OR REPLACE FUNCTION public.associate_extra_order_reason(_order public.inventory_materials) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE cutoff timestamptz;
BEGIN
  IF coalesce(_order.order_source,'simkit')='upscale' THEN RETURN 'Upscale orders do not use field associate extra stock.'; END IF;
  IF _order.submitted IS DISTINCT FROM true THEN RETURN 'Order is not submitted.'; END IF;
  IF NOT public.field_inventory_worker(_order.created_by) THEN RETURN 'This order was not placed by an active field associate.'; END IF;
  SELECT activated_at INTO cutoff FROM public.inventory_dispatch_settings WHERE id=true;
  IF cutoff IS NULL OR _order.created_at IS NULL OR _order.created_at<cutoff
    OR EXISTS(SELECT 1 FROM public.inventory_dispatch_excluded_orders WHERE order_id=_order.id) THEN
    RETURN 'This older order is outside automatic stock deduction.';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.field_inventory_worker(uuid) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
