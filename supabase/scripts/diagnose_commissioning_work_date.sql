-- Read-only diagnostic for the company in the reported screenshots.
-- Run in Supabase SQL Editor. This is not a migration and changes no records.
SELECT
  s.id AS overview_site_id,
  s.name AS factory_name,
  s.company_name,
  e.id AS earning_id,
  e.site_id AS tracker_site_id,
  e.earning_date AS corrected_work_date,
  e.eligible AS stored_eligible,
  CASE WHEN s.id IS NOT NULL
    THEN public.field_ops_phase_ready(s.id, 'commissioning')
    ELSE NULL END AS currently_approved,
  approval.reviewed_at AS original_approval_at,
  (SELECT max(log.created_at) FROM public.activity_logs log
    WHERE log.site_id = s.id AND log.action <> 'login') AS latest_activity_at
FROM public.sites s
FULL OUTER JOIN public.field_earnings e
  ON e.site_id = s.id AND e.phase = 'commissioning'
LEFT JOIN public.commissioning_approval_requests approval
  ON approval.site_id = s.id
WHERE (e.phase IS NULL OR e.phase = 'commissioning')
  AND (
    regexp_replace(lower(coalesce(s.company_name, s.name, '')), '[^a-z0-9]', '', 'g')
      LIKE '%recomponents%'
    OR regexp_replace(lower(coalesce(e.company_name, '')), '[^a-z0-9]', '', 'g')
      LIKE '%recomponents%'
  )
ORDER BY s.id, e.earning_date;
