-- Late-arrival justification window: any late day of the current month, and
-- of the previous month until the 7th of the current month (IST).
BEGIN;
DO $$ DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.attendance_submit_late_justification(date,text[],text)'::regprocedure); o := d;
  -- Already applied: nothing to do (safe to re-run).
  IF position('extract(day FROM today)<=7' IN d) > 0 THEN RETURN; END IF;
  d := replace(d,
    'OR date_trunc(''month'',_date)<>date_trunc(''month'',today) OR',
    'OR NOT (date_trunc(''month'',_date)=date_trunc(''month'',today) OR (date_trunc(''month'',_date)=date_trunc(''month'',today)-interval ''1 month'' AND extract(day FROM today)<=7)) OR');
  d := replace(d,
    '''You can justify late arrivals from this month only, up to today''',
    '''You can justify late arrivals from this month, or from last month until the 7th''');
  IF d = o OR position('extract(day FROM today)<=7' IN d)=0 THEN
    RAISE EXCEPTION 'Unexpected attendance_submit_late_justification definition';
  END IF;
  EXECUTE d;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
