BEGIN;

-- Additive rollout. No historical business rows or dates are backfilled.
CREATE TABLE public.commissioning_verification_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  activated_at timestamptz,
  auto_approve boolean NOT NULL DEFAULT false
);
INSERT INTO public.commissioning_verification_settings DEFAULT VALUES;

CREATE TABLE public.commissioning_verification_exclusions (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  reason text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.commissioning_drive_folders (
  site_id uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  -- Optional pin. Otherwise resolve an exact company-name folder under the worker's approved parent.
  root_folder_id text CHECK(root_folder_id ~ '^[A-Za-z0-9_-]+$'),
  -- Certificate policy is deliberately empty until real company references are supplied.
  certificate_policy jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.commissioning_verification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.commissioning_approval_requests(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  request_stamp timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN
    ('queued','checking','passed','needs_correction','needs_review','technical_error','superseded','approved')),
  rule_version text NOT NULL DEFAULT 'media-average-v1',
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}',
  completed_at timestamptz
);
CREATE INDEX commissioning_verification_queue ON public.commissioning_verification_jobs(status,created_at);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['commissioning_verification_settings','commissioning_verification_exclusions',
    'commissioning_drive_folders','commissioning_verification_jobs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  END LOOP;
END $$;

-- Every previous approval/completion excludes a site, even if later reopened.
CREATE FUNCTION public.commissioning_verification_historical(_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM commissioning c WHERE c.site_id=_site AND
      (c.data->>'commissioning_phase_submitted'='true' OR
       nullif(c.data->>'commissioning_phase_submitted_at','') IS NOT NULL))
    OR EXISTS(SELECT 1 FROM commissioning_approval_requests WHERE site_id=_site AND
      (status='approved' OR reviewed_at IS NOT NULL))
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

-- Service-only, explicit activation; installing this migration does not activate the flow.
CREATE FUNCTION public.activate_commissioning_verification() RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE stamp timestamptz;
BEGIN
  -- Serialize activation against all request mutations, including the legacy RPC.
  LOCK TABLE commissioning_approval_requests IN SHARE ROW EXCLUSIVE MODE;
  SELECT activated_at INTO stamp FROM commissioning_verification_settings WHERE singleton FOR UPDATE;
  IF stamp IS NOT NULL THEN RETURN stamp; END IF;
  INSERT INTO commissioning_verification_exclusions(site_id,reason)
    SELECT s.id,'Existing request or historical commissioning/submission'
    FROM sites s WHERE public.commissioning_verification_historical(s.id)
      OR EXISTS(SELECT 1 FROM commissioning_approval_requests r WHERE r.site_id=s.id)
    ON CONFLICT DO NOTHING;
  stamp:=clock_timestamp();
  UPDATE commissioning_verification_settings SET activated_at=stamp WHERE singleton;
  RETURN stamp;
END $$;

CREATE FUNCTION public.enqueue_commissioning_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE activation timestamptz;
BEGIN
  SELECT activated_at INTO activation FROM commissioning_verification_settings WHERE singleton;
  IF activation IS NULL OR NEW.status<>'pending' OR NEW.requested_at<activation THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.requested_at IS NOT DISTINCT FROM OLD.requested_at
    AND NEW.drive_link IS NOT DISTINCT FROM OLD.drive_link THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM commissioning_verification_exclusions WHERE site_id=NEW.site_id) THEN RETURN NEW; END IF;
  IF public.commissioning_verification_historical(NEW.site_id) THEN
    INSERT INTO commissioning_verification_exclusions(site_id,reason) VALUES(NEW.site_id,'Historical completion') ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
  -- An UPDATE alone cannot opt an existing legacy request into the rollout.
  IF TG_OP='UPDATE' AND NOT EXISTS(SELECT 1 FROM commissioning_verification_jobs WHERE request_id=NEW.id) THEN RETURN NEW; END IF;
  UPDATE commissioning_verification_jobs SET status='superseded',lease_token=NULL,lease_until=NULL
    WHERE request_id=NEW.id AND status NOT IN ('approved','superseded');
  INSERT INTO commissioning_verification_jobs(request_id,site_id,requested_by,request_stamp)
    VALUES(NEW.id,NEW.site_id,NEW.requested_by,NEW.requested_at);
  RETURN NEW;
END $$;
CREATE TRIGGER queue_commissioning_verification AFTER INSERT OR UPDATE ON public.commissioning_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_commissioning_verification();

CREATE FUNCTION public.claim_commissioning_verification() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job commissioning_verification_jobs; folder commissioning_drive_folders; company text;
BEGIN
  UPDATE commissioning_verification_jobs SET status='technical_error',completed_at=now(),
    report='{"messages":["Worker retry limit reached. Resubmit after checking the worker."]}'::jsonb
    WHERE status='checking' AND lease_until<now() AND attempts>=3;
  SELECT * INTO job FROM commissioning_verification_jobs
    WHERE (status='queued' OR (status='checking' AND lease_until<now())) AND attempts<3
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF job.id IS NULL THEN RETURN NULL; END IF;
  UPDATE commissioning_verification_jobs SET status='checking',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '30 minutes'
    WHERE id=job.id RETURNING * INTO job;
  SELECT * INTO folder FROM commissioning_drive_folders WHERE site_id=job.site_id;
  SELECT coalesce(company_name,name) INTO company FROM sites WHERE id=job.site_id;
  RETURN jsonb_build_object('job',to_jsonb(job),'folders',to_jsonb(folder),'company_name',company,
    'drive_link',(SELECT drive_link FROM commissioning_approval_requests WHERE id=job.request_id));
END $$;

CREATE FUNCTION public.finish_commissioning_verification(_job_id uuid,_lease_token uuid,_report jsonb) RETURNS text
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
    OR EXISTS(SELECT 1 FROM commissioning_verification_exclusions WHERE site_id=job.site_id)
    OR public.commissioning_verification_historical(job.site_id) THEN
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
      OR coalesce((_report->>'video_count')::integer,0)<4
      OR coalesce((_report->>'video_average_seconds')::numeric,0)<120
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

-- Assignment check without spoofing auth.uid() or changing session claims.
CREATE FUNCTION public.can_access_site_for_verification(_site uuid,_worker uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM sites s JOIN profiles p ON p.id=_worker WHERE s.id=_site
    AND p.is_active AND public.has_role(_worker,'worker')
    AND _worker=ANY(public.field_ops_worker_ids(s)) AND public.field_ops_site_active(s));
$$;
CREATE FUNCTION public.commissioning_metadata_end(_notes text,_start integer) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE pos integer; depth integer:=0; quoted boolean:=false; escaped boolean:=false; ch text;
BEGIN
  FOR pos IN (_start+10)..length(_notes) LOOP
    ch:=substring(_notes,pos,1);
    IF escaped THEN escaped:=false;
    ELSIF quoted AND ch=chr(92) THEN escaped:=true;
    ELSIF ch='"' THEN quoted:=NOT quoted;
    ELSIF NOT quoted AND ch='{' THEN depth:=depth+1;
    ELSIF NOT quoted AND ch='}' THEN
      depth:=depth-1;
      IF depth=0 THEN IF substring(_notes,pos+1,1)=']' THEN RETURN pos+1; ELSE RETURN 0; END IF; END IF;
    END IF;
  END LOOP;
  RETURN 0;
END $$;

CREATE FUNCTION public.my_commissioning_verification(_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access_site(_site_id) THEN RAISE EXCEPTION 'Site access required'; END IF;
  SELECT jsonb_build_object('status',status,'messages',coalesce(report->'messages','[]'::jsonb),
    'photo_count',report->'photo_count','video_count',report->'video_count',
    'video_average_seconds',report->'video_average_seconds','created_at',created_at)
    INTO result FROM commissioning_verification_jobs WHERE site_id=_site_id ORDER BY created_at DESC,id DESC LIMIT 1;
  RETURN result;
END $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
    ('commissioning_verification_historical','activate_commissioning_verification','enqueue_commissioning_verification',
     'claim_commissioning_verification','finish_commissioning_verification','can_access_site_for_verification',
     'commissioning_metadata_end','my_commissioning_verification') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.my_commissioning_verification(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
