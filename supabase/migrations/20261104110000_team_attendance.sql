-- Team leads can see their own team members' attendance (e.g. Hitesh bhai ->
-- Aryan; Kuldeep -> Mayank, Suraj, Vikas). Membership lives in a small table so
-- teams can change without code. Read-only: leads cannot edit attendance.
BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_team_members (
  lead_email text NOT NULL CHECK (lead_email = lower(btrim(lead_email)) AND lead_email LIKE '%@%'),
  member_employee_id uuid NOT NULL REFERENCES public.attendance_employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_email, member_employee_id)
);
ALTER TABLE public.attendance_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_team_members FROM anon, authenticated;

INSERT INTO public.attendance_team_members(lead_email, member_employee_id)
SELECT t.lead, e.id FROM (VALUES
  ('associatelimelight@gmail.com','aryankadiya2005@gmail.com'),
  ('kuldeepshrimali.limelight@gmail.com','mayankk.limelightit@gmail.com'),
  ('kuldeepshrimali.limelight@gmail.com','surajbiswas.limelight@gmail.com'),
  ('kuldeepshrimali.limelight@gmail.com','vikashkumavat.limelight@gmail.com')
) t(lead, member)
JOIN public.attendance_employees e ON lower(e.email)=t.member AND e.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Calendar for any employee (internal; same rules as attendance_my_calendar).
-- Built from the live attendance_my_calendar_before_time_guard body so the day
-- classification stays identical, with the caller lookup replaced by _employee.
DO $$ DECLARE definition text; patched text;
BEGIN
  definition := pg_get_functiondef('public.attendance_my_calendar_before_time_guard(date)'::regprocedure);
  patched := replace(definition, 'public.attendance_my_calendar_before_time_guard(_month date)',
    'public.attendance_calendar_for(_employee uuid, _month date)');
  patched := regexp_replace(patched,
    'PERFORM public\.assert_manager_module_access\(''attendance''\);.*?Active office account is not linked''; END IF;',
    'SELECT * INTO employee FROM attendance_employees WHERE id=_employee AND deleted_at IS NULL;'
    || E'\n IF employee.id IS NULL THEN RAISE EXCEPTION ''Employee not found''; END IF;', 's');
  IF patched = definition OR position('attendance_calendar_for(_employee uuid, _month date)' IN patched)=0
     OR position('Active office account is not linked' IN patched)>0 THEN
    RAISE EXCEPTION 'Unexpected attendance_my_calendar_before_time_guard definition';
  END IF;
  EXECUTE patched;
END $$;
REVOKE ALL ON FUNCTION public.attendance_calendar_for(uuid,date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.attendance_caller_email() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT lower(btrim(email)) FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.attendance_caller_email() FROM PUBLIC, anon;

-- The caller's team (empty for non-leads).
CREATE OR REPLACE FUNCTION public.attendance_my_team() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'email',e.email,
      'department',e.department,'enroll_id',e.enroll_id,'active',e.active) ORDER BY e.name),'[]'::jsonb)
  FROM attendance_team_members t JOIN attendance_employees e ON e.id=t.member_employee_id AND e.deleted_at IS NULL
  WHERE t.lead_email=attendance_caller_email()
$$;
REVOKE ALL ON FUNCTION public.attendance_my_team() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_my_team() TO authenticated;

-- A team member's monthly calendar, for their lead (or attendance managers).
CREATE OR REPLACE FUNCTION public.attendance_team_calendar(_employee uuid, _month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; days jsonb; caller text:=attendance_caller_email(); member attendance_employees;
BEGIN
  IF caller IS NULL OR NOT (
    EXISTS(SELECT 1 FROM attendance_team_members WHERE lead_email=caller AND member_employee_id=_employee)
    OR caller IN ('nitsanghani1@gmail.com','admin@limelightit.io','tarun@limelightit.io','tarun@limelight.io')
  ) THEN
    RAISE EXCEPTION 'You can only view attendance for your own team' USING ERRCODE='42501';
  END IF;
  SELECT * INTO member FROM attendance_employees WHERE id=_employee AND deleted_at IS NULL;
  result := attendance_calendar_for(_employee, _month);
  SELECT coalesce(jsonb_agg(attendance_apply_site_visit(attendance_apply_approved_arrival(attendance_apply_tracking_start(
    CASE WHEN attendance_time_review_required(_employee,(r->>'date')::date)
    THEN r||jsonb_build_object('status','needs_review','entry_at',NULL,'late_minutes',NULL) ELSE r END
    || attendance_adjustment_details(_employee,(r->>'date')::date),(r->>'date')::date),_employee,(r->>'date')::date))
    || attendance_late_justification_info(_employee,(r->>'date')::date) ORDER BY n),'[]')
    INTO days FROM jsonb_array_elements(result->'days') WITH ORDINALITY a(r,n);
  RETURN jsonb_set(result,'{days}',days)||jsonb_build_object('tracking_start',attendance_tracking_start(),
    'employee',jsonb_build_object('id',member.id,'name',member.name,'email',member.email,'department',member.department));
END $$;
REVOKE ALL ON FUNCTION public.attendance_team_calendar(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_team_calendar(uuid,date) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
