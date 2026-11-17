BEGIN;
-- A pending internal audit request is not a manager-approval task. Only the
-- authenticated backend verifier may decide requests enrolled in automatic verification.
CREATE FUNCTION public.guard_automatic_commissioning_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected')
    AND EXISTS(SELECT 1 FROM commissioning_verification_jobs WHERE request_id=NEW.id)
    AND coalesce(auth.role(),'')<>'service_role' THEN
    RAISE EXCEPTION 'Automatic commissioning requires the completed server verification';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_automatic_commissioning_decision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_automatic_commissioning_decision BEFORE UPDATE OF status ON public.commissioning_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_automatic_commissioning_decision();
NOTIFY pgrst,'reload schema';
COMMIT;
