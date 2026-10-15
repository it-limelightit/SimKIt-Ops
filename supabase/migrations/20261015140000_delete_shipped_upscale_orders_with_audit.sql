BEGIN;

-- Preserve the company and device context for stock deductions after a manager
-- removes an Upscale order from the tracker and logistics screens.
CREATE TABLE public.upscale_deleted_order_audit (
  order_id uuid PRIMARY KEY,
  tracker_id uuid NOT NULL,
  company_name text NOT NULL,
  order_snapshot jsonb NOT NULL,
  device_snapshots jsonb NOT NULL,
  deleted_by uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.upscale_deleted_order_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upscale_deleted_order_audit FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.company_tracker_delete(_tracker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  upscale_order public.upscale_company_orders;
  device_snapshots jsonb;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN
    RAISE EXCEPTION 'Only commissioning managers can delete tracker records' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker record was not found'; END IF;

  SELECT * INTO upscale_order FROM public.upscale_company_orders
    WHERE tracker_id = _tracker_id FOR UPDATE;

  IF FOUND THEN
    -- Serialize with logistics updates and stock deduction before taking the snapshot.
    PERFORM 1 FROM public.inventory_materials
      WHERE upscale_order_id = upscale_order.id ORDER BY id FOR UPDATE;
    SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.upscale_device_sequence), '[]'::jsonb)
      INTO device_snapshots
      FROM public.inventory_materials m WHERE m.upscale_order_id = upscale_order.id;

    INSERT INTO public.upscale_deleted_order_audit (
      order_id, tracker_id, company_name, order_snapshot, device_snapshots, deleted_by
    ) VALUES (
      upscale_order.id, _tracker_id, upscale_order.company_name,
      to_jsonb(upscale_order), device_snapshots, auth.uid()
    );

    -- Zero-change markers are only used while the order exists. Keep actual
    -- deduction logs and receipts so shipped stock remains deducted and auditable.
    DELETE FROM public.inventory_logs l
      USING public.inventory_materials m
      WHERE m.upscale_order_id = upscale_order.id AND l.order_id = m.id::text
        AND l.change_type = 'INVENTORY_SERVER_MANAGED' AND l.quantity_changed = 0;
    DELETE FROM public.inventory_dispatch_excluded_orders e
      USING public.inventory_materials m
      WHERE m.upscale_order_id = upscale_order.id AND e.order_id = m.id;
    DELETE FROM public.inventory_materials WHERE upscale_order_id = upscale_order.id;
    DELETE FROM public.upscale_company_orders WHERE id = upscale_order.id;
  END IF;

  DELETE FROM public.company_tracker_assignments WHERE id = _tracker_id;
END $$;

REVOKE ALL ON FUNCTION public.company_tracker_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_tracker_delete(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
