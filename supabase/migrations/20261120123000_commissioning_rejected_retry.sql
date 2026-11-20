BEGIN;

-- A service operator can enroll a single previously rejected site. Keep the
-- original decision intact here when the active request is reused for a retry.
CREATE TABLE IF NOT EXISTS public.commissioning_rejected_retries (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  rejected_request jsonb NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commissioning_rejected_retries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commissioning_rejected_retries FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.commissioning_verification_completed_history(_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM commissioning c WHERE c.site_id=_site AND
      (c.data->>'commissioning_phase_submitted'='true' OR
       nullif(c.data->>'commissioning_phase_submitted_at','') IS NOT NULL))
    OR EXISTS(SELECT 1 FROM commissioning_approval_requests WHERE site_id=_site AND
      status='approved')
    OR EXISTS(SELECT 1 FROM field_manager_commissionings WHERE site_id=_site)
    OR EXISTS(SELECT 1 FROM field_existing_completions WHERE site_id=_site AND phase='commissioning')
    OR EXISTS(SELECT 1 FROM field_earnings WHERE site_id=_site AND phase='commissioning')
    OR EXISTS(SELECT 1 FROM sites s WHERE s.id=_site AND (
      s.consultant_stage IN ('Billing','Completion') OR
      public.field_ops_site_metadata(s.task_notes)->>'status' IN ('Commissioned','Submitted','Certification Pending','Unsubmitted') OR
      coalesce(public.field_ops_site_metadata(s.task_notes)->'activity_logs','[]'::jsonb)
        @> '[{"to_status":"Commissioned"}]'::jsonb OR
      coalesce(public.field_ops_site_metadata(s.task_notes)->'activity_logs','[]'::jsonb)
        @> '[{"to_status":"Submitted"}]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.commissioning_verification_historical(_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.commissioning_verification_completed_history(_site)
    OR EXISTS(SELECT 1 FROM commissioning_approval_requests
      WHERE site_id=_site AND reviewed_at IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.commissioning_rejected_retry_allowed(_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(
    SELECT 1 FROM commissioning_rejected_retries e
    JOIN commissioning_approval_requests r ON r.site_id=e.site_id
    WHERE e.site_id=_site
      AND r.id::text=e.rejected_request->>'id'
      AND ((r.status='rejected' AND r.reviewed_at=(e.rejected_request->>'reviewed_at')::timestamptz
            AND r.requested_at=(e.rejected_request->>'requested_at')::timestamptz)
        OR (r.status='pending' AND r.reviewed_at IS NULL))
  ) AND NOT public.commissioning_verification_completed_history(_site);
$$;

CREATE OR REPLACE FUNCTION public.commissioning_verification_blocked(_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT NOT public.commissioning_rejected_retry_allowed(_site)
    AND (public.commissioning_verification_historical(_site)
      OR EXISTS(SELECT 1 FROM commissioning_verification_exclusions WHERE site_id=_site));
$$;

CREATE OR REPLACE FUNCTION public.enroll_commissioning_rejected_retry(_site uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE req commissioning_approval_requests;
BEGIN
  SELECT * INTO req FROM commissioning_approval_requests WHERE site_id=_site FOR UPDATE;
  PERFORM 1 FROM sites WHERE id=_site FOR UPDATE;
  IF req.id IS NULL OR req.status<>'rejected' OR req.reviewed_at IS NULL
    OR public.commissioning_verification_completed_history(_site) THEN
    RAISE EXCEPTION 'Site must have a rejected request and no previous commissioning completion';
  END IF;
  INSERT INTO commissioning_rejected_retries(site_id,rejected_request)
    VALUES(_site,to_jsonb(req)) ON CONFLICT(site_id) DO NOTHING;
  IF NOT public.commissioning_rejected_retry_allowed(_site) THEN
    RAISE EXCEPTION 'The rejection has changed since the retry was enrolled';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.commissioning_verification_completed_history(uuid),
  public.commissioning_rejected_retry_allowed(uuid),public.commissioning_verification_blocked(uuid),
  public.enroll_commissioning_rejected_retry(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_commissioning_rejected_retry(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_commissioning_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE activation timestamptz;
BEGIN
  SELECT activated_at INTO activation FROM commissioning_verification_settings WHERE singleton;
  IF activation IS NULL OR NEW.status<>'pending' OR NEW.requested_at<activation THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.requested_at IS NOT DISTINCT FROM OLD.requested_at
    AND NEW.drive_link IS NOT DISTINCT FROM OLD.drive_link THEN RETURN NEW; END IF;
  IF public.commissioning_verification_blocked(NEW.site_id) THEN
    INSERT INTO commissioning_verification_exclusions(site_id,reason) VALUES(NEW.site_id,'Historical completion') ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
  -- An existing request needs a prior job or a service-enrolled rejection retry.
  IF TG_OP='UPDATE' AND NOT public.commissioning_rejected_retry_allowed(NEW.site_id) AND NOT EXISTS(SELECT 1 FROM commissioning_verification_jobs WHERE request_id=NEW.id) THEN RETURN NEW; END IF;
  UPDATE commissioning_verification_jobs SET status='superseded',lease_token=NULL,lease_until=NULL
    WHERE request_id=NEW.id AND status NOT IN ('approved','superseded');
  INSERT INTO commissioning_verification_jobs(request_id,site_id,requested_by,request_stamp)
    VALUES(NEW.id,NEW.site_id,NEW.requested_by,NEW.requested_at);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.finish_commissioning_verification(_job_id uuid,_lease_token uuid,_report jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job commissioning_verification_jobs; req commissioning_approval_requests; folder commissioning_drive_folders;
  c commissioning; s sites; outcome text; stamp timestamptz:=now(); d jsonb; meta jsonb; notes text; start_pos integer; end_pos integer;
BEGIN
  -- Lock request before job: same ordering as resubmission's request trigger.
  SELECT r.* INTO req FROM commissioning_approval_requests r JOIN commissioning_verification_jobs j ON j.request_id=r.id WHERE j.id=_job_id FOR UPDATE OF r;
  SELECT * INTO job FROM commissioning_verification_jobs WHERE id=_job_id FOR UPDATE;
  IF job.status='approved' THEN RETURN 'approved'; END IF;
  IF job.id IS NULL OR job.status<>'checking' OR job.lease_token IS DISTINCT FROM _lease_token OR job.lease_until<now() THEN
    RAISE EXCEPTION 'Verification lease is no longer current';
  END IF;
  SELECT * INTO s FROM sites WHERE id=job.site_id FOR UPDATE;
  SELECT * INTO c FROM commissioning WHERE site_id=job.site_id FOR UPDATE;
  SELECT * INTO folder FROM commissioning_drive_folders WHERE site_id=job.site_id FOR SHARE;
  IF req.status<>'pending' OR req.requested_at IS DISTINCT FROM job.request_stamp OR req.requested_by<>job.requested_by
    OR public.commissioning_verification_blocked(job.site_id) THEN
    UPDATE commissioning_verification_jobs SET status='superseded',completed_at=stamp WHERE id=job.id;
    RETURN 'superseded';
  END IF;
  outcome:=_report->>'status';
  IF outcome IS NULL OR outcome NOT IN ('passed','needs_correction','needs_review','technical_error') THEN RAISE EXCEPTION 'Invalid result'; END IF;
  IF outcome='passed' THEN
    -- Defense in depth: independently enforce media policy and bind the worker result to configuration.
    IF folder.site_id IS NULL OR _report->'folders' IS DISTINCT FROM to_jsonb(folder)
      OR _report->>'rule_version' IS DISTINCT FROM job.rule_version
      OR coalesce((_report->>'photo_count')::integer,0)<4
      OR NOT (CASE job.rule_version
        WHEN 'media-total-v2' THEN
          coalesce((_report->>'video_count')::integer,0)>0
          AND coalesce(jsonb_typeof(_report->'video_total_seconds'),'')='number'
          AND coalesce((_report->>'video_total_seconds')::numeric,0)>=120
        WHEN 'media-average-v1' THEN
          coalesce((_report->>'video_count')::integer,0)>=4
          AND coalesce((_report->>'video_average_seconds')::numeric,0)>=120
        ELSE false
      END)
      OR coalesce((_report->>'certificate_passed')::boolean,false) IS NOT TRUE
      OR coalesce((_report->>'manifest_rechecked')::boolean,false) IS NOT TRUE
      OR coalesce((folder.certificate_policy->>'approved_for_automation')::boolean,false) IS NOT TRUE
      THEN RAISE EXCEPTION 'Verification evidence or configuration mismatch'; END IF;
    IF c.site_id IS NULL OR NOT coalesce(c.data @> '{"coordination_done":true,"visit_done":true,"connection_done":true,"configure_done":true,"testing_done":true,"screenshots_uploaded":true,"certificate_sent":true,"final_mom_uploaded":true}',false)
      OR NOT EXISTS(SELECT 1 FROM installation WHERE site_id=job.site_id AND data->>'installation_phase_submitted'='true')
      OR NOT public.can_access_site_for_verification(job.site_id,job.requested_by) THEN
      outcome:='needs_review';
      _report:=_report || '{"messages":["Site assignment or commissioning prerequisites need review."]}'::jsonb;
    ELSIF (SELECT auto_approve FROM commissioning_verification_settings WHERE singleton) THEN
      UPDATE commissioning_approval_requests SET status='approved',reviewed_at=stamp,reviewed_by=NULL WHERE id=req.id;
      d:=coalesce(c.data,'{}'::jsonb) || jsonb_build_object('commissioning_phase_submitted',true,
        'commissioning_phase_submitted_at',stamp,'commissioning_approval_status','approved',
        'commissioning_approval_source','automatic','commissioning_verification_id',job.id);
      UPDATE commissioning SET data=d,updated_at=stamp WHERE site_id=job.site_id;
      -- Keep unrelated metadata, text and all pre-existing dates intact. No manager impersonation.
      meta:=public.field_ops_site_metadata(s.task_notes);
      meta:=meta || jsonb_build_object('status','Commissioned','status_source','associate','visit_status','Commissioned');
      notes:=coalesce(s.task_notes,''); start_pos:=strpos(notes,'[METADATA:');
      IF start_pos>0 THEN
        -- Locate the end of the existing metadata by parsing its balanced JSON, preserving surrounding notes.
        end_pos:=public.commissioning_metadata_end(notes,start_pos);
        IF end_pos=0 THEN RAISE EXCEPTION 'Malformed site metadata; manual review required'; END IF;
        PERFORM substring(notes,start_pos+10,end_pos-start_pos-10)::jsonb;
        notes:=substring(notes,1,start_pos-1)||'[METADATA:'||meta::text||']'||substring(notes,end_pos+1);
      ELSE notes:='[METADATA:'||meta::text||']'||notes; END IF;
      UPDATE sites SET task_notes=notes WHERE id=job.site_id;
      outcome:='approved';
    END IF;
  END IF;
  UPDATE commissioning_verification_jobs SET status=outcome,report=_report,completed_at=stamp,lease_until=NULL WHERE id=job.id;
  RETURN outcome;
END $$;

CREATE OR REPLACE FUNCTION public.commissioning_verification_context(_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE mode text; job commissioning_verification_jobs; settings commissioning_verification_settings;
  policy jsonb; ready boolean; reason text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_site(_site_id) THEN RAISE EXCEPTION 'Site access required'; END IF;
  PERFORM public.assert_manager_module_access('restricted');
  SELECT * INTO settings FROM commissioning_verification_settings WHERE singleton;
  SELECT * INTO job FROM commissioning_verification_jobs WHERE site_id=_site_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF job.status='approved' THEN mode:='completed';
  ELSIF public.commissioning_verification_blocked(_site_id) THEN mode:='historical';
  ELSIF EXISTS(SELECT 1 FROM commissioning_approval_requests WHERE site_id=_site_id) AND job.id IS NULL
    AND NOT public.commissioning_rejected_retry_allowed(_site_id) THEN mode:='historical';
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
      'video_total_seconds',coalesce(nullif(job.report->'video_total_seconds','null'::jsonb),
        to_jsonb((job.report->>'video_count')::integer * (job.report->>'video_average_seconds')::numeric)),
      'created_at',job.created_at) END);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
