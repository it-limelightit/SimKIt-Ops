-- Allow an assigned field associate to update only the status metadata for their site.
CREATE OR REPLACE FUNCTION public.set_consultant_site_status(
  _site_id uuid,
  _task_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sites
  SET
    task_notes = _task_notes,
    consultant_stage = NULL
  WHERE id = _site_id
    AND (
      assigned_worker_id = auth.uid()
      OR COALESCE(task_notes, '') LIKE '%"' || auth.uid()::text || '"%'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not assigned to this site';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_consultant_site_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_consultant_site_status(uuid, text) TO authenticated;
