-- ONE-TIME DATA BACKFILL. Run the entire script in Supabase SQL Editor.
-- No schema changes, phase-form edits, approval-date edits or salary clearance.
-- Recording manager: patidarnit21@gmail.com
-- Associate: alakhbrahmbhatt0225@gmail.com
-- Work: Punar Enterprise assessment/installation (3 October), Medinova
-- assessment/installation/commissioning (2 October), TWINFITT PLASTIC INDUSTRIES
-- assessment (3 October). Installation remains unpaid.
-- Only dates were supplied: noon IST is a date-only display placeholder for
-- assessment/installation. Commissioning retains its actual approval timestamp.

BEGIN;

CREATE TEMP TABLE alakh_historical_work (
  site_id UUID NOT NULL,
  company_label TEXT NOT NULL,
  phase TEXT NOT NULL,
  work_date DATE NOT NULL,
  PRIMARY KEY (site_id, phase)
) ON COMMIT DROP;

DO $$
DECLARE
  associate_uuid UUID;
  manager_uuid UUID;
  associate_name TEXT;
  manager_name TEXT;
  joined_at TIMESTAMPTZ;
  assessment_price NUMERIC;
  commissioning_price NUMERIC;
  matched_ids UUID[];
  company RECORD;
  work RECORD;
  prior public.field_earnings;
  earning_uuid UUID;
  approval_at TIMESTAMPTZ;
  completed_stamp TIMESTAMPTZ;
  price NUMERIC;
  inserted_count INTEGER := 0;
  corrected_count INTEGER := 0;
  attendance_count INTEGER := 0;
  affected INTEGER;
  reason TEXT := 'Historical work backfill authorized by manager: platform introduced after this work; actual dates supplied for 2 and 3 October 2026';
BEGIN
  IF (SELECT count(*) FROM public.profiles
    WHERE lower(trim(email)) = 'alakhbrahmbhatt0225@gmail.com') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one profile for alakhbrahmbhatt0225@gmail.com';
  END IF;
  SELECT p.id, coalesce(p.name, p.email), p.created_at
    INTO associate_uuid, associate_name, joined_at
    FROM public.profiles p
    WHERE lower(trim(p.email)) = 'alakhbrahmbhatt0225@gmail.com';
  IF associate_uuid IS NULL OR NOT public.field_ops_associate(associate_uuid) THEN
    RAISE EXCEPTION 'Alakh must have an active field-associate account with this exact email';
  END IF;
  IF (joined_at AT TIME ZONE 'Asia/Kolkata')::date > DATE '2026-10-02' THEN
    RAISE EXCEPTION 'The account joining date is after 2 October; verify the historical joining date before backfilling';
  END IF;

  IF (SELECT count(*) FROM public.profiles
    WHERE lower(trim(email)) = 'patidarnit21@gmail.com') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one profile for patidarnit21@gmail.com';
  END IF;
  SELECT p.id, coalesce(p.name, p.email)
    INTO manager_uuid, manager_name
    FROM public.profiles p
    WHERE lower(trim(p.email)) = 'patidarnit21@gmail.com';
  IF manager_uuid IS NULL OR NOT public.is_staff(manager_uuid) THEN
    RAISE EXCEPTION 'patidarnit21@gmail.com must be an existing manager account';
  END IF;

  -- Same period lock as payment recording; never add work to a cleared cycle.
  PERFORM pg_advisory_xact_lock(hashtextextended(associate_uuid::text || DATE '2026-10-15'::text, 0));
  IF EXISTS (SELECT 1 FROM public.field_payment_records
    WHERE associate_id = associate_uuid AND period_end = DATE '2026-10-15') THEN
    RAISE EXCEPTION 'Alakh payment cycle ending 15 October is already cleared; no changes made';
  END IF;
  SELECT assessment, commissioning INTO assessment_price, commissioning_price
    FROM public.field_work_rates WHERE associate_id = associate_uuid;

  -- Use the verified site ID for TWINFITT; match other names without choosing duplicates.
  FOR company IN SELECT * FROM (VALUES
    ('Punar Enterprise', '%punarenterpris%', DATE '2026-10-03', ARRAY['assessment', 'installation']::TEXT[], NULL::UUID),
    ('Medinova', '%medinova%', DATE '2026-10-02', ARRAY['assessment', 'installation', 'commissioning']::TEXT[], NULL::UUID),
    ('TWINFITT PLASTIC INDUSTRIES', '%twinfittplastic%', DATE '2026-10-03', ARRAY['assessment']::TEXT[], '843a510c-a72e-44d8-9f9a-d4cdfb25e0b8'::UUID)
  ) AS companies(label, pattern, work_date, phases, exact_site_id)
  LOOP
    SELECT array_agg(s.id) INTO matched_ids FROM public.sites s
      WHERE public.field_ops_site_active(s) AND (
        (company.exact_site_id IS NOT NULL AND s.id = company.exact_site_id)
        OR (company.exact_site_id IS NULL AND (
          public.field_ops_company_key(s.company_name) LIKE company.pattern
          OR public.field_ops_company_key(s.name) LIKE company.pattern
        ))
      );
    IF coalesce(cardinality(matched_ids), 0) <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one active company matching %, found %. Verify the company name/site ID; transaction stopped',
        company.label, coalesce(cardinality(matched_ids), 0);
    END IF;
    INSERT INTO alakh_historical_work(site_id, company_label, phase, work_date)
      SELECT matched_ids[1], company.label, phase, company.work_date
      FROM unnest(company.phases) AS phase;
  END LOOP;

  FOR work IN SELECT * FROM alakh_historical_work ORDER BY work_date, company_label, phase
  LOOP
    IF NOT public.field_ops_phase_ready(work.site_id, work.phase) THEN
      RAISE EXCEPTION '%: % is not fully complete/approved. Finish or verify required records first; no partial import is committed',
        work.company_label, work.phase;
    END IF;
    IF work.phase = 'commissioning' THEN
      SELECT reviewed_at INTO approval_at FROM public.commissioning_approval_requests
        WHERE site_id = work.site_id AND requested_by = associate_uuid AND status = 'approved';
      IF approval_at IS NULL THEN
        RAISE EXCEPTION '% must have approved commissioning requested by Alakh', work.company_label;
      END IF;
      IF work.work_date > (approval_at AT TIME ZONE 'Asia/Kolkata')::date THEN
        RAISE EXCEPTION '%: the supplied work date is after commissioning approval', work.company_label;
      END IF;
      completed_stamp := approval_at;
      price := commissioning_price;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.sites s WHERE s.id = work.site_id
        AND associate_uuid = ANY(public.field_ops_worker_ids(s)))
        AND NOT EXISTS (SELECT 1 FROM public.assessment a WHERE a.site_id = work.site_id
          AND work.phase = 'assessment' AND a.worker_id = associate_uuid)
        AND NOT EXISTS (SELECT 1 FROM public.installation i WHERE i.site_id = work.site_id
          AND work.phase = 'installation' AND i.worker_id = associate_uuid) THEN
        RAISE EXCEPTION '%: % is not assigned to or recorded for Alakh', work.company_label, work.phase;
      END IF;
      completed_stamp := (work.work_date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata';
      price := CASE WHEN work.phase = 'installation' THEN 0 ELSE assessment_price END;
    END IF;

    SELECT * INTO prior FROM public.field_earnings
      WHERE site_id = work.site_id AND phase = work.phase FOR UPDATE;
    IF prior.id IS NOT NULL THEN
      IF prior.associate_id <> associate_uuid THEN
        RAISE EXCEPTION '%: % already belongs to another associate; no entitlement is reassigned', work.company_label, work.phase;
      END IF;
      IF EXISTS (SELECT 1 FROM public.field_payment_items WHERE earning_id = prior.id) THEN
        RAISE EXCEPTION '%: % already has a recorded payment; paid records are unchanged', work.company_label, work.phase;
      END IF;
      IF prior.earning_date <> work.work_date THEN
        INSERT INTO public.field_earning_date_changes(earning_id, old_date, new_date, reason, actor_id)
          VALUES(prior.id, prior.earning_date, work.work_date, reason, manager_uuid);
      END IF;
      UPDATE public.field_earnings SET
        earning_date = work.work_date,
        completed_at = CASE WHEN work.phase = 'commissioning' THEN prior.completed_at ELSE completed_stamp END,
        amount = CASE WHEN work.phase = 'installation' THEN 0 ELSE coalesce(prior.amount, price) END,
        eligible = true
        WHERE id = prior.id AND (
          earning_date <> work.work_date OR NOT eligible
          OR (work.phase <> 'commissioning' AND completed_at <> completed_stamp)
          OR (work.phase = 'installation' AND amount IS DISTINCT FROM 0)
          OR (amount IS NULL AND price IS NOT NULL)
        );
      GET DIAGNOSTICS affected = ROW_COUNT;
      corrected_count := corrected_count + affected;
    ELSE
      INSERT INTO public.field_earnings(site_id, company_name, associate_id, associate_name,
        associate_joined, phase, completed_at, earning_date, amount, eligible)
        SELECT s.id, coalesce(nullif(s.company_name, ''), s.name), associate_uuid, associate_name,
          joined_at, work.phase, completed_stamp, work.work_date, price, true
        FROM public.sites s WHERE s.id = work.site_id
        RETURNING id INTO earning_uuid;
      inserted_count := inserted_count + 1;
    END IF;
  END LOOP;

  -- Confirmed historical work days, recorded NOW by the named manager.
  -- These are retrospective entries, not invented historical login timestamps.
  INSERT INTO public.field_attendance_events(associate_id, actor_id, online, work_date, occurred_at)
    SELECT associate_uuid, manager_uuid, true, day, clock_timestamp()
    FROM (SELECT DISTINCT work_date AS day FROM alakh_historical_work) dates
    WHERE NOT EXISTS (SELECT 1 FROM public.field_attendance_events a
      WHERE a.associate_id = associate_uuid AND a.work_date = dates.day AND a.online);
  GET DIAGNOSTICS attendance_count = ROW_COUNT;

  IF inserted_count + corrected_count + attendance_count > 0 THEN
    INSERT INTO public.activity_logs(actor_id, actor_name, action, entity_type, entity_id,
      entity_name, details)
    VALUES(manager_uuid, manager_name, 'create', 'field_work_backfill', associate_uuid::text,
      associate_name || ' historical work: 2 and 3 October 2026',
      jsonb_build_object('source', 'manager_authorized_historical_import', 'reason', reason,
        'associate_email', 'alakhbrahmbhatt0225@gmail.com', 'date_only_completion_times', true,
        'inserted_work_records', inserted_count, 'corrected_work_records', corrected_count,
        'retrospective_attendance_records', attendance_count,
        'work', (SELECT jsonb_agg(to_jsonb(w)) FROM alakh_historical_work w)));
  END IF;
  RAISE NOTICE 'Backfill complete: % inserted, % corrected, % historical attendance entries. Farid and Sparsh are untouched',
    inserted_count, corrected_count, attendance_count;
END $$;

-- Review the six resulting activities and amounts before the transaction ends.
SELECT e.company_name, e.phase AS work_type, e.earning_date AS work_date,
  e.amount, CASE WHEN e.phase = 'installation' THEN 'Not payable'
    WHEN e.amount IS NULL THEN 'Rate pending' ELSE 'Unpaid' END AS payment_status
FROM alakh_historical_work w
JOIN public.field_earnings e ON e.site_id = w.site_id AND e.phase = w.phase
ORDER BY e.earning_date, e.company_name, CASE e.phase
  WHEN 'assessment' THEN 1 WHEN 'installation' THEN 2 ELSE 3 END;

COMMIT;
