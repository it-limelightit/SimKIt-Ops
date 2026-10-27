-- Each entry into Monitoring starts a new calendar-day cycle. Keep previous
-- results for audit, but exclude them from the active monitoring-day table.
BEGIN;

CREATE TABLE IF NOT EXISTS public.company_tracker_monitoring_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id UUID NOT NULL REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  days JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS company_tracker_monitoring_archives_tracker_idx
  ON public.company_tracker_monitoring_archives(tracker_id, archived_at DESC);
ALTER TABLE public.company_tracker_monitoring_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_tracker_monitoring_archives FROM anon, authenticated;
GRANT SELECT ON public.company_tracker_monitoring_archives TO authenticated;
DROP POLICY IF EXISTS "Tracker monitoring archive read access" ON public.company_tracker_monitoring_archives;
CREATE POLICY "Tracker monitoring archive read access"
  ON public.company_tracker_monitoring_archives FOR SELECT TO authenticated
  USING (public.can_access_company_tracker(tracker_id));

CREATE OR REPLACE FUNCTION public.company_tracker_restart_monitoring_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE previous_days JSONB;
BEGIN
  IF NEW.stage = 'Monitoring' AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day_number) INTO previous_days
    FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = NEW.id;
    IF previous_days IS NOT NULL THEN
      INSERT INTO public.company_tracker_monitoring_archives(tracker_id, archived_by, days)
      VALUES (NEW.id, auth.uid(), previous_days);
      DELETE FROM public.company_tracker_monitoring_days WHERE tracker_id = NEW.id;
    END IF;
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.company_tracker_restart_monitoring_cycle() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS company_tracker_restart_monitoring_cycle ON public.company_tracker_assignments;
CREATE TRIGGER company_tracker_restart_monitoring_cycle
  BEFORE UPDATE OF stage ON public.company_tracker_assignments
  FOR EACH ROW EXECUTE FUNCTION public.company_tracker_restart_monitoring_cycle();

NOTIFY pgrst, 'reload schema';
COMMIT;
