-- Allow a dual-role manager (supervisor + worker) to use the same
-- commissioning approval flow as a field associate. Pure managers remain
-- unable to submit approval requests.
CREATE OR REPLACE FUNCTION public.submit_commissioning_approval_request(_site_id UUID, _drive_link TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_id UUID;
BEGIN
  IF (
    public.is_staff(auth.uid())
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'worker'
    )
  ) OR NOT public.can_access_site(_site_id) THEN
    RAISE EXCEPTION 'Only the assigned field associate can request commissioning approval';
  END IF;

  IF _drive_link !~* '^https?://(drive|docs)\.google\.com/' THEN
    RAISE EXCEPTION 'A valid Google Drive link is required';
  END IF;

  INSERT INTO public.commissioning_approval_requests
    (site_id, requested_by, drive_link, status, requested_at, reviewed_at, reviewed_by)
  VALUES
    (_site_id, auth.uid(), trim(_drive_link), 'pending', now(), NULL, NULL)
  ON CONFLICT (site_id) DO UPDATE SET
    requested_by = EXCLUDED.requested_by,
    drive_link = EXCLUDED.drive_link,
    status = 'pending',
    requested_at = now(),
    reviewed_at = NULL,
    reviewed_by = NULL
  RETURNING id INTO request_id;

  RETURN request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_commissioning_approval_request(UUID, TEXT) TO authenticated;
