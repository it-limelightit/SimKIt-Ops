-- Treat spelling variations such as "Hitesh Bhai" and "HITESHBHAI" as one assignee.
CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name)) ORDER BY coalesce(s.company_name, s.name))
       FROM public.sites s
       WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_assignments a WHERE a.site_id = s.id)),
      '[]'::jsonb
    ),
    'users', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
       FROM (
         SELECT DISTINCT ON (lower(regexp_replace(trim(coalesce(candidate.name, candidate.email)), '[[:space:]]+', '', 'g')))
           candidate.id, coalesce(candidate.name, candidate.email) AS name
         FROM (
           SELECT p.id, p.name, p.email, p.created_at, true AS is_current_manager
           FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active
           UNION ALL
           SELECT p.id, p.name, p.email, p.created_at, false AS is_current_manager
           FROM public.profiles p
           JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('worker', 'supervisor', 'owner')
           WHERE p.is_active
         ) candidate
         ORDER BY lower(regexp_replace(trim(coalesce(candidate.name, candidate.email)), '[[:space:]]+', '', 'g')), candidate.is_current_manager DESC, candidate.created_at
       ) u),
      '[]'::jsonb
    )
  )
  WHERE public.is_company_tracker_manager()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assignment_options() TO authenticated;
