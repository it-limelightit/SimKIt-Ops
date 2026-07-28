-- Adds consultant-controlled end-of-work stages without giving consultants broad
-- UPDATE access to the sites table. Run this file in the Supabase SQL editor.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS consultant_stage text;

ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_consultant_stage_check;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_consultant_stage_check
  CHECK (consultant_stage IS NULL OR consultant_stage IN ('Billing', 'Completion'));

CREATE OR REPLACE FUNCTION public.set_consultant_site_stage(
  _site_id uuid,
  _stage text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _stage NOT IN ('Billing', 'Completion') THEN
    RAISE EXCEPTION 'Stage must be Billing or Completion';
  END IF;

  UPDATE public.sites
  SET consultant_stage = _stage
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

REVOKE ALL ON FUNCTION public.set_consultant_site_stage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_consultant_site_stage(uuid, text) TO authenticated;

COMMENT ON COLUMN public.sites.consultant_stage IS
  'End-of-work stage set by an assigned business consultant: Billing or Completion.';
