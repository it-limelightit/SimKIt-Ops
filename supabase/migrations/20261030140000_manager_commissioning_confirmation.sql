BEGIN;

-- A manager's explicit Commissioned action is also a valid completion confirmation.
-- Keep this evidence separate from associate approval requests and from payment approval.
CREATE TABLE IF NOT EXISTS public.field_manager_commissionings (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  associate_id uuid,
  confirmed_by uuid NOT NULL,
  commissioned_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.field_manager_commissionings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_manager_commissionings FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.field_ops_confirm_manager_commissioning(
  _site public.sites,_actor uuid,_stamp timestamptz,_historical boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE worker uuid; earning field_earnings; rate numeric; workers uuid[];
BEGIN
  IF NOT public.is_staff(_actor) OR _stamp IS NULL THEN RETURN; END IF;
  SELECT * INTO earning FROM field_earnings WHERE site_id=_site.id AND phase='commissioning';
  workers:=public.field_ops_worker_ids(_site);
  worker:=earning.associate_id;
  IF worker IS NULL THEN
    SELECT c.worker_id INTO worker FROM commissioning c
    WHERE c.site_id=_site.id AND c.worker_id=ANY(workers) AND public.field_ops_associate(c.worker_id);
  END IF;
  IF worker IS NULL AND public.field_ops_associate(_site.assigned_worker_id) THEN
    worker:=_site.assigned_worker_id;
  END IF;
  IF worker IS NULL THEN
    SELECT min(w::text)::uuid INTO worker FROM unnest(workers) w
    WHERE public.field_ops_associate(w) HAVING count(*)=1;
  END IF;
  INSERT INTO field_manager_commissionings(site_id,associate_id,confirmed_by,commissioned_at,active)
  VALUES(_site.id,worker,_actor,_stamp,true)
  ON CONFLICT(site_id) DO UPDATE SET associate_id=excluded.associate_id,
    confirmed_by=excluded.confirmed_by,commissioned_at=excluded.commissioned_at,active=true;
  IF worker IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(worker::text,19));
  SELECT * INTO earning FROM field_earnings WHERE site_id=_site.id AND phase='commissioning' FOR UPDATE;
  IF earning.id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=earning.id) THEN
      UPDATE field_earnings SET eligible=true WHERE id=earning.id;
    END IF;
    RETURN;
  END IF;
  IF NOT _historical THEN
    SELECT commissioning INTO rate FROM field_work_rates WHERE associate_id=worker;
  END IF;
  INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,
    phase,completed_at,earning_date,amount,eligible)
  SELECT _site.id,coalesce(_site.company_name,_site.name),worker,coalesce(p.name,p.email,'Field associate'),
    p.created_at,'commissioning',_stamp,(_stamp AT TIME ZONE 'Asia/Kolkata')::date,rate,true
  FROM profiles p WHERE p.id=worker
  ON CONFLICT(site_id,phase) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.field_ops_confirm_manager_commissioning(public.sites,uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;

-- Extend the existing phase checks rather than weaken the normal associate approval path.
DO $readiness$
DECLARE definition text; original text; changed text;
BEGIN
  SELECT pg_get_functiondef(oid),prosrc INTO definition,original
  FROM pg_proc WHERE oid='public.field_ops_phase_ready(uuid,text)'::regprocedure;
  IF position('field_manager_commissionings' IN original)=0 THEN
    changed:=replace(original, E'ELSIF _phase = ''commissioning'' THEN', E'ELSIF _phase = ''commissioning'' THEN\n    IF EXISTS(SELECT 1 FROM public.field_manager_commissionings m WHERE m.site_id=_site AND m.active) THEN RETURN true; END IF;');
    IF changed=original THEN RAISE EXCEPTION 'Commissioning readiness definition changed; review before applying'; END IF;
    EXECUTE replace(definition,original,changed);
  END IF;
END $readiness$;

CREATE OR REPLACE FUNCTION public.field_ops_capture_manager_commissioning() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE previous_status text; status text; confirmation field_manager_commissionings;
BEGIN
  -- An associate writing status_source or activity-log JSON cannot confirm their own payroll.
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RETURN NEW; END IF;
  status:=public.field_ops_site_metadata(NEW.task_notes)->>'status';
  IF TG_OP='UPDATE' THEN previous_status:=public.field_ops_site_metadata(OLD.task_notes)->>'status'; END IF;
  SELECT * INTO confirmation FROM field_manager_commissionings WHERE site_id=NEW.id;
  IF status='Commissioned' AND (previous_status IS DISTINCT FROM status OR confirmation.site_id IS NULL OR NOT confirmation.active) THEN
    PERFORM public.field_ops_confirm_manager_commissioning(NEW,auth.uid(),now(),false);
  ELSIF status IN ('Commissioned','Submitted','Certification Pending') AND confirmation.active AND confirmation.associate_id IS NULL THEN
    -- Assignment after confirmation retains the original commissioning date and confirming manager.
    PERFORM public.field_ops_confirm_manager_commissioning(NEW,confirmation.confirmed_by,confirmation.commissioned_at,false);
  ELSIF status IS DISTINCT FROM previous_status AND coalesce(status,'') NOT IN ('Commissioned','Submitted','Certification Pending') AND confirmation.active THEN
    UPDATE field_manager_commissionings SET active=false WHERE site_id=NEW.id;
    UPDATE field_earnings e SET eligible=public.field_ops_phase_ready(NEW.id,'commissioning')
    WHERE e.site_id=NEW.id AND e.phase='commissioning'
      AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.field_ops_capture_manager_commissioning() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS field_ops_manager_commissioning ON public.sites;
CREATE TRIGGER field_ops_manager_commissioning
AFTER INSERT OR UPDATE OF task_notes,consultant_stage,assigned_worker_id ON public.sites
FOR EACH ROW EXECUTE FUNCTION public.field_ops_capture_manager_commissioning();

-- Recover historical manager Commissioned actions from their audit dates. A Submitted
-- label by itself is insufficient. Existing ledger dates/prices and paid items stay intact.
DO $history$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT s AS site,log.actor,log.stamp FROM public.sites s
    CROSS JOIN LATERAL (
      SELECT e.actor_id AS actor,e.created_at AS stamp
      FROM public.activity_logs e
      WHERE e.site_id=s.id AND e.action='status_change' AND e.to_value='Commissioned'
        AND public.is_staff(e.actor_id)
      ORDER BY e.created_at DESC LIMIT 1
    ) log
    WHERE public.field_ops_company_status(s) IN ('Commissioned','Submitted','Certification Pending')
      AND NOT EXISTS(SELECT 1 FROM public.field_manager_commissionings m WHERE m.site_id=s.id)
  LOOP
    PERFORM public.field_ops_confirm_manager_commissioning(item.site,item.actor,item.stamp,true);
  END LOOP;
END $history$;

NOTIFY pgrst,'reload schema';
COMMIT;
