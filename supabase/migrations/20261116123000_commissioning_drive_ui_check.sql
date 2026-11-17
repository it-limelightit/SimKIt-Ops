BEGIN;
-- Operational rate limit only. This table never stores or changes business evidence/dates.
CREATE TABLE public.commissioning_drive_check_limits (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  checked_by uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commissioning_drive_check_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commissioning_drive_check_limits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.commissioning_drive_check_limits TO service_role;
CREATE FUNCTION public.reserve_commissioning_drive_check(_site_id uuid,_user_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE reserved uuid;
BEGIN
  INSERT INTO commissioning_drive_check_limits(site_id,checked_by,checked_at) VALUES(_site_id,_user_id,now())
  ON CONFLICT(site_id) DO UPDATE SET checked_by=excluded.checked_by,checked_at=excluded.checked_at
    WHERE commissioning_drive_check_limits.checked_at<now()-interval '1 minute'
  RETURNING site_id INTO reserved;
  RETURN reserved IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.reserve_commissioning_drive_check(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_commissioning_drive_check(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
