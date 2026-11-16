-- A day with APPROVED leave and also a face scan used to show "Needs review"
-- with no day value (counted as 0 in salary, and it blocked salary approval).
-- Rule: approved leave wins — the day is shown as "On leave" and is a full paid
-- day, like any approved leave. (e.g. Kuldeep, 19 Oct 2026.)
-- Days before the tracking start keep their own handling.
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_apply_approved_arrival(_row jsonb,_employee uuid,_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE
    -- Approved leave + a scan on the same day: treat as approved leave.
    WHEN _row->>'status'='needs_review' AND _row->>'request_type'='leave' AND _row->>'request_status'='approved'
      AND coalesce(_row->>'review_reason','')<>'before_tracking_start'
    THEN _row||jsonb_build_object('status','on_leave','late_minutes',NULL,'leave_conflict',false,
      'time_review_reason',NULL,'leave_with_scan',true)
    WHEN a.id IS NOT NULL AND a.kind='absence_justification' AND _row->>'status'='absent'
    THEN _row||jsonb_build_object('status','absence_justified','late_minutes',NULL,
      'request_type','absence_justified','request_status','approved','reason',a.reason,'request_reason',a.reason)
    WHEN a.id IS NOT NULL AND a.kind<>'absence_justification' AND _row->>'entry_at' IS NOT NULL AND _row->>'status' IN ('late','present')
    THEN _row||jsonb_build_object('status','present','late_minutes',0,'arrival_approved',true,
      'arrival_half_day',a.is_half_day,'arrival_expected',a.expected_arrival)
      ||CASE WHEN _row->>'request_status' IS NULL THEN jsonb_build_object(
        'request_type',CASE WHEN a.kind='justification' THEN 'late_justified' WHEN a.is_half_day THEN 'half_day' ELSE 'late' END,
        'request_status','approved','reason',a.reason,'request_reason',a.reason) ELSE '{}'::jsonb END
    ELSE _row END
  FROM (SELECT 1) x LEFT JOIN LATERAL (
    SELECT * FROM attendance_late_requests
    WHERE employee_id=_employee AND arrival_date=_date AND status='approved'
    ORDER BY reviewed_at DESC NULLS LAST LIMIT 1) a ON true
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
