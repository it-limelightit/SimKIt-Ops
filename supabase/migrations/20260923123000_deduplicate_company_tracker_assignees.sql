-- Only active Field Associates can be selected in the Company Tracker.
CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name))
          ORDER BY coalesce(s.company_name, s.name)
        )
        FROM public.sites s
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.company_tracker_assignments a
          WHERE a.site_id = s.id
        )
      ),
      '[]'::jsonb
    ),
    'users', coalesce(
      (
        SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
        FROM (
          SELECT DISTINCT ON (lower(trim(coalesce(p.name, p.email))))
            p.id,
            coalesce(p.name, p.email) AS name
          FROM public.profiles p
          JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'worker'
          WHERE p.is_active
          ORDER BY lower(trim(coalesce(p.name, p.email))), p.created_at
        ) u
      ),
      '[]'::jsonb
    )
  )
  WHERE public.is_company_tracker_manager()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assignment_options() TO authenticated;
