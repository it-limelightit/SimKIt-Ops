BEGIN;

-- Earlier rollout exclusions omitted real approved companies from work reports.
-- Recover their original associate and approval date, without inventing a price
-- or changing any existing earning, approval timestamp or payment history.
INSERT INTO public.field_earnings (
  site_id, company_name, associate_id, associate_name, associate_joined,
  phase, completed_at, earning_date, amount, eligible
)
SELECT s.id, coalesce(s.company_name,s.name), r.requested_by,
       coalesce(p.name,p.email,'Field associate'), p.created_at,
       'commissioning', r.reviewed_at,
       (r.reviewed_at AT TIME ZONE 'Asia/Kolkata')::date, NULL, true
FROM public.commissioning_approval_requests r
JOIN public.commissioning c ON c.site_id=r.site_id
JOIN public.sites s ON s.id=r.site_id
JOIN public.profiles p ON p.id=r.requested_by
WHERE r.status='approved' AND r.reviewed_at IS NOT NULL
  AND c.data->>'commissioning_phase_submitted'='true'
  AND public.has_role(r.requested_by,'worker')
  AND NOT EXISTS (
    SELECT 1 FROM public.field_earnings e
    WHERE e.site_id=r.site_id AND e.phase='commissioning'
  )
ON CONFLICT(site_id,phase) DO NOTHING;

NOTIFY pgrst,'reload schema';
COMMIT;
