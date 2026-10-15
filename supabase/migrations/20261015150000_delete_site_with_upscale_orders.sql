BEGIN;

-- Used only by the authorized tracker and site delete RPCs. Keep dispatch
-- deductions and nonzero stock logs after removing the visible order rows.
CREATE OR REPLACE FUNCTION public.upscale_archive_delete_order(_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  upscale_order public.upscale_company_orders;
  device_snapshots jsonb;
BEGIN
  SELECT * INTO upscale_order FROM public.upscale_company_orders
    WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM 1 FROM public.inventory_materials
    WHERE upscale_order_id = _order_id ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.upscale_device_sequence), '[]'::jsonb)
    INTO device_snapshots
    FROM public.inventory_materials m WHERE m.upscale_order_id = _order_id;

  INSERT INTO public.upscale_deleted_order_audit (
    order_id, tracker_id, company_name, order_snapshot, device_snapshots, deleted_by
  ) VALUES (
    upscale_order.id, upscale_order.tracker_id, upscale_order.company_name,
    to_jsonb(upscale_order), device_snapshots, auth.uid()
  );

  DELETE FROM public.inventory_logs l
    USING public.inventory_materials m
    WHERE m.upscale_order_id = _order_id AND l.order_id = m.id::text
      AND l.change_type = 'INVENTORY_SERVER_MANAGED' AND l.quantity_changed = 0;
  DELETE FROM public.inventory_dispatch_excluded_orders e
    USING public.inventory_materials m
    WHERE m.upscale_order_id = _order_id AND e.order_id = m.id;
  DELETE FROM public.inventory_materials WHERE upscale_order_id = _order_id;
  DELETE FROM public.upscale_company_orders WHERE id = _order_id;
END $$;
REVOKE ALL ON FUNCTION public.upscale_archive_delete_order(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.company_tracker_delete(_tracker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE order_id uuid;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN
    RAISE EXCEPTION 'Only commissioning managers can delete tracker records' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker record was not found'; END IF;

  SELECT id INTO order_id FROM public.upscale_company_orders
    WHERE tracker_id = _tracker_id;
  IF order_id IS NOT NULL THEN
    PERFORM public.upscale_archive_delete_order(order_id);
  END IF;
  DELETE FROM public.company_tracker_assignments WHERE id = _tracker_id;
END $$;

-- Sites are staff-managed. This also handles orders from earlier tracker
-- assignments that still point to the same site.
CREATE OR REPLACE FUNCTION public.site_delete_with_upscale(_site_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE order_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can delete sites' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.sites WHERE id = _site_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Site was not found'; END IF;

  FOR order_id IN SELECT id FROM public.upscale_company_orders
    WHERE site_id = _site_id ORDER BY id LOOP
    PERFORM public.upscale_archive_delete_order(order_id);
  END LOOP;

  -- Existing site foreign keys cascade or set null. The restricted Upscale
  -- references have been removed above, so this remains one transaction.
  DELETE FROM public.sites WHERE id = _site_id;
END $$;

REVOKE ALL ON FUNCTION public.site_delete_with_upscale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_delete_with_upscale(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
