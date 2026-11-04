-- Extra stock choices that no longer match the order (e.g. Proxy Sensor chosen,
-- then the order's hardware changed to "Proxy: None") blocked In Packing with
-- "Extra stock choice for X no longer matches the order" — and the stale choice
-- was invisible in the picker (it only lists items the order still needs), so
-- it could not be fixed from the screen.
-- Now, at In Packing: a stale choice (item no longer needed or model changed) is
-- removed, and a choice for more units than needed is reduced to the need.
-- Real stock shortfalls (associate no longer has the units) still block.
BEGIN;

CREATE TABLE IF NOT EXISTS public.associate_extra_usage_cleanups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  group_key text NOT NULL,
  label text,
  model text,
  quantity integer,
  action text NOT NULL CHECK (action IN ('removed','reduced')),
  reason text NOT NULL,
  cleaned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.associate_extra_usage_cleanups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.associate_extra_usage_cleanups FROM anon, authenticated;

-- Remove / reduce planned choices that no longer fit the order's current needs.
CREATE OR REPLACE FUNCTION public.associate_extra_prune(_order public.inventory_materials) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u public.associate_extra_usage; need record; changed integer := 0;
BEGIN
  FOR u IN SELECT * FROM public.associate_extra_usage WHERE order_id=_order.id AND status='planned' FOR UPDATE LOOP
    SELECT * INTO need FROM public.associate_extra_order_needs(_order) n WHERE n.group_key=u.group_key;
    IF need.group_key IS NULL OR lower(btrim(coalesce(need.model,'')))<>lower(btrim(coalesce(u.model,''))) THEN
      INSERT INTO public.associate_extra_usage_cleanups(order_id,group_key,label,model,quantity,action,reason)
        VALUES(u.order_id,u.group_key,u.label,u.model,u.quantity,'removed',
          CASE WHEN need.group_key IS NULL THEN 'Order no longer needs this item' ELSE 'Order now needs model '||coalesce(need.model,'-') END);
      DELETE FROM public.associate_extra_usage WHERE id=u.id;
      changed := changed + 1;
    ELSIF u.quantity > need.quantity THEN
      INSERT INTO public.associate_extra_usage_cleanups(order_id,group_key,label,model,quantity,action,reason)
        VALUES(u.order_id,u.group_key,u.label,u.model,u.quantity,'reduced','Order now needs only '||need.quantity||' unit(s)');
      UPDATE public.associate_extra_usage SET quantity=need.quantity WHERE id=u.id;
      changed := changed + 1;
    END IF;
    need := NULL;
  END LOOP;
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.associate_extra_prune(public.inventory_materials) FROM PUBLIC, anon, authenticated;

-- Apply: prune stale choices first, then continue as before.
DO $$ DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.associate_extra_apply(public.inventory_materials,jsonb)'::regprocedure); o := d;
  IF position('associate_extra_prune(_order)' IN d) = 0 THEN
    d := replace(d,
      'PERFORM pg_advisory_xact_lock(hashtextextended(''associate-extra:''||_order.created_by::text,0));',
      'PERFORM pg_advisory_xact_lock(hashtextextended(''associate-extra:''||_order.created_by::text,0));'
      || E'\n  PERFORM public.associate_extra_prune(_order);'
      || E'\n  IF NOT EXISTS(SELECT 1 FROM public.associate_extra_usage WHERE order_id=_order.id AND status=''planned'') THEN RETURN result; END IF;');
    IF d = o THEN RAISE EXCEPTION 'Unexpected associate_extra_apply definition'; END IF;
    EXECUTE d;
  END IF;
END $$;

-- Clean existing stale choices on orders not yet packed (today: M/S KERTAKE HEALTHCARE, Proxy Sensor).
SELECT public.associate_extra_prune(m) FROM public.inventory_materials m
WHERE EXISTS(SELECT 1 FROM public.associate_extra_usage u WHERE u.order_id=m.id AND u.status='planned')
  AND NOT EXISTS(SELECT 1 FROM public.inventory_dispatch_deductions d WHERE d.order_id=m.id);

NOTIFY pgrst, 'reload schema';
COMMIT;
