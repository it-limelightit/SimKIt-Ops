BEGIN;

-- A converted tracker owns its Upscale order and device rows. Remove these
-- together only while no device has shipped or consumed inventory.
CREATE OR REPLACE FUNCTION public.company_tracker_delete(_tracker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  upscale_id uuid;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN
    RAISE EXCEPTION 'Only commissioning managers can delete tracker records' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker record was not found'; END IF;

  SELECT id INTO upscale_id FROM public.upscale_company_orders
    WHERE tracker_id = _tracker_id FOR UPDATE;

  IF upscale_id IS NOT NULL THEN
    -- Serialize against a concurrent logistics update before checking status.
    PERFORM 1 FROM public.inventory_materials
      WHERE upscale_order_id = upscale_id ORDER BY id FOR UPDATE;

    IF EXISTS (
      SELECT 1 FROM public.inventory_materials m
      WHERE m.upscale_order_id = upscale_id
        AND (
          lower(btrim(coalesce(public.inventory_dispatch_notes(m.notes)->>'logistics_status', m.state, '')))
            IN ('shipped', 'transit', 'in transit', 'delivered', 'dispatched')
          OR EXISTS (SELECT 1 FROM public.inventory_dispatch_deductions d WHERE d.order_id = m.id)
          OR EXISTS (
            SELECT 1 FROM public.inventory_logs l
            WHERE l.order_id = m.id::text
              AND (l.change_type <> 'INVENTORY_SERVER_MANAGED' OR l.quantity_changed <> 0)
          )
        )
    ) THEN
      RAISE EXCEPTION 'This company has shipped devices or inventory deductions and cannot be deleted';
    END IF;

    DELETE FROM public.inventory_logs l
      USING public.inventory_materials m
      WHERE m.upscale_order_id = upscale_id AND l.order_id = m.id::text
        AND l.change_type = 'INVENTORY_SERVER_MANAGED' AND l.quantity_changed = 0;
    DELETE FROM public.inventory_dispatch_excluded_orders e
      USING public.inventory_materials m
      WHERE m.upscale_order_id = upscale_id AND e.order_id = m.id;
    DELETE FROM public.inventory_materials WHERE upscale_order_id = upscale_id;
    DELETE FROM public.upscale_company_orders WHERE id = upscale_id;
  END IF;

  DELETE FROM public.company_tracker_assignments WHERE id = _tracker_id;
END $$;

REVOKE ALL ON FUNCTION public.company_tracker_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_tracker_delete(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
