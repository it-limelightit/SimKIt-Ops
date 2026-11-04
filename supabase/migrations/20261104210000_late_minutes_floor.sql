-- Late minutes counted only for COMPLETED minutes after the threshold
-- (shift start + grace = 10:15 IST). A scan at 10:15:xx is on time;
-- 10:16:xx is 1 min late. Previously seconds were rounded UP (ceil), so
-- 10:15:12 showed "1 min late".
-- Recomputes existing scan-based daily records (manager-adjusted days untouched).
BEGIN;

DO $$ DECLARE f text; d text; o text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.attendance_ingest_scan(text,text,timestamp with time zone,boolean)',
                           'public.attendance_rebuild_verified_day(uuid,date)'] LOOP
    d := pg_get_functiondef(f::regprocedure); o := d;
    d := replace(d, 'greatest(0,ceil(extract(epoch FROM (', 'greatest(0,floor(extract(epoch FROM (');
    IF d = o AND position('greatest(0,floor(extract(epoch FROM (' IN d) = 0 THEN
      RAISE EXCEPTION 'Unexpected definition: %', f;
    END IF;
    IF d <> o THEN EXECUTE d; END IF;
  END LOOP;
END $$;

-- Recompute stored late minutes for scan-based records.
WITH fixed AS (
  SELECT r.id,
    greatest(0, floor(extract(epoch FROM (r.entry_at - (((r.work_date + (r.policy_snapshot->>'shift_start')::time) AT TIME ZONE 'Asia/Kolkata')
      + (r.policy_snapshot->>'grace_minutes')::integer * interval '1 minute')))/60)::integer) late
  FROM attendance_daily_records r
  WHERE r.entry_source='scan' AND r.late_minutes IS NOT NULL AND r.policy_snapshot ? 'shift_start' AND r.policy_snapshot ? 'grace_minutes')
UPDATE attendance_daily_records r SET late_minutes=f.late
FROM fixed f WHERE f.id=r.id AND r.late_minutes IS DISTINCT FROM f.late;

INSERT INTO attendance_audit_logs(actor_id,action,record_id,details)
VALUES(NULL,'late_minutes_rounding_changed',NULL,jsonb_build_object(
  'rule','completed minutes after shift start + grace (floor); 10:15:xx is on time','source','migration 20261104210000'));

NOTIFY pgrst, 'reload schema';
COMMIT;
