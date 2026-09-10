-- Field associates request commissioning; only the named approvers can approve it.
CREATE TABLE public.commissioning_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  drive_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (site_id)
);

GRANT SELECT, INSERT, UPDATE ON public.commissioning_approval_requests TO authenticated;
GRANT ALL ON public.commissioning_approval_requests TO service_role;
ALTER TABLE public.commissioning_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Associates read own commissioning requests" ON public.commissioning_approval_requests
  FOR SELECT TO authenticated USING (requested_by = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Associates create own commissioning requests" ON public.commissioning_approval_requests
  FOR INSERT TO authenticated WITH CHECK (requested_by = auth.uid() AND public.can_access_site(site_id));

CREATE OR REPLACE FUNCTION public.is_commissioning_approver()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND lower(email) IN ('patidarnit21@gmail.com', 'info@limelightit.io')
  );
$$;

CREATE OR REPLACE FUNCTION public.submit_commissioning_approval_request(_site_id UUID, _drive_link TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_id UUID;
BEGIN
  IF public.is_staff(auth.uid()) OR NOT public.can_access_site(_site_id) THEN
    RAISE EXCEPTION 'Only the assigned field associate can request commissioning approval';
  END IF;
  IF _drive_link !~* '^https?://(drive|docs)\.google\.com/' THEN
    RAISE EXCEPTION 'A valid Google Drive link is required';
  END IF;

  INSERT INTO public.commissioning_approval_requests (site_id, requested_by, drive_link, status, requested_at, reviewed_at, reviewed_by)
  VALUES (_site_id, auth.uid(), trim(_drive_link), 'pending', now(), NULL, NULL)
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

CREATE OR REPLACE FUNCTION public.review_commissioning_approval_request(_request_id UUID, _approved BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_row public.commissioning_approval_requests;
BEGIN
  IF NOT public.is_commissioning_approver() THEN
    RAISE EXCEPTION 'Only the designated commissioning managers can approve requests';
  END IF;
  SELECT * INTO request_row FROM public.commissioning_approval_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'This commissioning request is no longer pending';
  END IF;

  UPDATE public.commissioning_approval_requests
  SET status = CASE WHEN _approved THEN 'approved' ELSE 'rejected' END,
      reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = _request_id;

  IF _approved THEN
    UPDATE public.commissioning
    SET data = jsonb_set(
      jsonb_set(COALESCE(data, '{}'::jsonb), '{commissioning_phase_submitted}', 'true'::jsonb, true),
      '{commissioning_phase_submitted_at}', to_jsonb(now()), true
    ), updated_at = now()
    WHERE site_id = request_row.site_id;
  END IF;
END;
$$;

-- A field associate cannot bypass the approval flow by directly writing the final marker.
CREATE OR REPLACE FUNCTION public.prevent_unapproved_commissioning_submission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- OLD is unavailable on INSERT, so only inspect it for an UPDATE.
  IF COALESCE(NEW.data->>'commissioning_phase_submitted', 'false') <> 'true' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.data->>'commissioning_phase_submitted', 'false') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_staff(auth.uid())
     AND NOT public.is_commissioning_approver()
     AND NOT EXISTS (
       SELECT 1 FROM public.commissioning_approval_requests
       WHERE site_id = NEW.site_id AND status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Commissioning approval is required before submission';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_commissioning_approval ON public.commissioning;
CREATE TRIGGER require_commissioning_approval
  BEFORE INSERT OR UPDATE OF data ON public.commissioning
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unapproved_commissioning_submission();

GRANT EXECUTE ON FUNCTION public.submit_commissioning_approval_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_commissioning_approval_request(UUID, BOOLEAN) TO authenticated;
