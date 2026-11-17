BEGIN;
ALTER TABLE public.commissioning_verification_settings ADD COLUMN worker_last_seen_at timestamptz;
ALTER TABLE public.commissioning_verification_jobs ADD COLUMN initiated_by uuid REFERENCES auth.users(id);

CREATE FUNCTION public.commissioning_verification_heartbeat() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE commissioning_verification_settings SET worker_last_seen_at=now() WHERE singleton;
$$;

CREATE FUNCTION public.commissioning_verification_context(_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE mode text; job commissioning_verification_jobs; settings commissioning_verification_settings;
  policy jsonb; ready boolean; reason text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_site(_site_id) THEN RAISE EXCEPTION 'Site access required'; END IF;
  PERFORM public.assert_manager_module_access('restricted');
  SELECT * INTO settings FROM commissioning_verification_settings WHERE singleton;
  SELECT * INTO job FROM commissioning_verification_jobs WHERE site_id=_site_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF job.status='approved' THEN mode:='completed';
  ELSIF EXISTS(SELECT 1 FROM commissioning_verification_exclusions WHERE site_id=_site_id)
    OR public.commissioning_verification_historical(_site_id) THEN mode:='historical';
  ELSIF EXISTS(SELECT 1 FROM commissioning_approval_requests WHERE site_id=_site_id) AND job.id IS NULL THEN mode:='historical';
  ELSE mode:='automatic'; END IF;
  SELECT certificate_policy INTO policy FROM commissioning_drive_folders WHERE site_id=_site_id;
  ready:=settings.activated_at IS NOT NULL AND settings.auto_approve
    AND coalesce(policy->>'approved_for_automation','false')='true'
    AND settings.worker_last_seen_at>now()-interval '2 minutes';
  IF mode='historical' THEN reason:='Historical commissioning records remain protected.';
  ELSIF settings.activated_at IS NULL OR NOT settings.auto_approve THEN reason:='Automatic commissioning setup is incomplete.';
  ELSIF coalesce(policy->>'approved_for_automation','false')<>'true' THEN reason:='Commissioning letter verification needs setup.';
  ELSIF settings.worker_last_seen_at IS NULL OR settings.worker_last_seen_at<=now()-interval '2 minutes' THEN reason:='Verification service offline. Please retry later.';
  END IF;
  RETURN jsonb_build_object('mode',mode,'ready',coalesce(ready,false),'reason',reason,
    'verification',CASE WHEN job.id IS NULL THEN NULL ELSE jsonb_build_object('id',job.id,'status',job.status,
      'messages',coalesce(job.report->'messages','[]'::jsonb),'photo_count',job.report->'photo_count',
      'video_count',job.report->'video_count','video_average_seconds',job.report->'video_average_seconds',
      'created_at',job.created_at) END);
END $$;

-- Called after the Edge Function's media precheck. This only starts full verification;
-- only the existing service-only finalizer can mark the site commissioned.
CREATE FUNCTION public.start_automatic_commissioning(_site_id uuid,_drive_link text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s sites; c commissioning; req commissioning_approval_requests; job commissioning_verification_jobs;
  context jsonb; worker uuid; saved_request_id uuid; stamp timestamptz:=clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_site(_site_id) THEN RAISE EXCEPTION 'Site access required'; END IF;
  PERFORM public.assert_manager_module_access('restricted');
  -- Serializes against resubmission and prevents two clicks from creating two attempts.
  PERFORM pg_advisory_xact_lock(hashtextextended(_site_id::text,71));
  SELECT * INTO req FROM commissioning_approval_requests WHERE site_id=_site_id FOR UPDATE;
  SELECT * INTO s FROM sites WHERE id=_site_id FOR UPDATE;
  SELECT * INTO c FROM commissioning WHERE site_id=_site_id FOR UPDATE;
  context:=public.commissioning_verification_context(_site_id);
  IF context->>'mode'='completed' THEN RETURN jsonb_build_object('status','approved'); END IF;
  IF context->>'mode'<>'automatic' THEN RETURN jsonb_build_object('status','historical','message','Historical commissioning records remain protected.'); END IF;
  IF coalesce((context->>'ready')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('status','setup_required','message',context->>'reason');
  END IF;
  IF _drive_link !~ '^https://drive\.google\.com/drive/folders/[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'Invalid company folder'; END IF;
  IF c.site_id IS NULL OR NOT coalesce(c.data @> '{"coordination_done":true,"visit_done":true,"connection_done":true,"configure_done":true,"testing_done":true,"screenshots_uploaded":true,"certificate_sent":true,"final_mom_uploaded":true}',false)
    OR NOT EXISTS(SELECT 1 FROM installation WHERE site_id=_site_id AND data->>'installation_phase_submitted'='true') THEN
    RETURN jsonb_build_object('status','needs_correction','message','Complete commissioning steps before verification.');
  END IF;
  worker:=c.worker_id;
  IF NOT public.can_access_site_for_verification(_site_id,worker) THEN worker:=s.assigned_worker_id; END IF;
  IF NOT public.can_access_site_for_verification(_site_id,worker) THEN
    RETURN jsonb_build_object('status','needs_correction','message','Assign a field associate before verification.');
  END IF;
  -- Associates may only initiate their own completion. Staff can initiate the assigned associate's check.
  IF NOT public.is_staff(auth.uid()) AND auth.uid()<>worker THEN RAISE EXCEPTION 'Assigned associate access required'; END IF;
  SELECT * INTO job FROM commissioning_verification_jobs WHERE site_id=_site_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF job.status IN ('queued','checking') AND req.drive_link=_drive_link AND job.request_stamp=req.requested_at THEN
    RETURN jsonb_build_object('status',job.status,'job_id',job.id);
  END IF;
  INSERT INTO commissioning_approval_requests(site_id,requested_by,drive_link,status,requested_at,reviewed_at,reviewed_by)
    VALUES(_site_id,worker,_drive_link,'pending',stamp,NULL,NULL)
    ON CONFLICT(site_id) DO UPDATE SET requested_by=excluded.requested_by,drive_link=excluded.drive_link,
      status='pending',requested_at=excluded.requested_at,reviewed_at=NULL,reviewed_by=NULL RETURNING id INTO saved_request_id;
  SELECT * INTO job FROM commissioning_verification_jobs WHERE request_id=saved_request_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF job.id IS NULL THEN RAISE EXCEPTION 'Verification was not queued'; END IF;
  UPDATE commissioning_verification_jobs SET initiated_by=auth.uid() WHERE id=job.id;
  RETURN jsonb_build_object('status','queued','job_id',job.id);
END $$;

REVOKE ALL ON FUNCTION public.commissioning_verification_heartbeat() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commissioning_verification_heartbeat() TO service_role;
REVOKE ALL ON FUNCTION public.commissioning_verification_context(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.start_automatic_commissioning(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.commissioning_verification_context(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.start_automatic_commissioning(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
