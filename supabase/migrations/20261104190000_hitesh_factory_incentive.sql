-- Hitesh bhai's factory incentive per the approved sheet:
--   assessment Rs 1,000 + installation Rs 500 = Rs 1,500 per company (total Rs 4,500)
--   Deepak Technocast, Vallabh Alloys -> assessment + installation on 7 Oct 2026
--   Waterman Industries               -> assessment + installation on 22 Oct 2026
-- Commissioning is not part of this incentive: his commissioning rate becomes 0
-- and his three October commissionings stay listed at Rs 0.
--
-- Some of these phases are not marked complete in the site checklist, so the
-- rows are recorded as manual entries (manual_entry = true): they count for
-- incentives regardless of the checklist, and checklist edits do not change
-- their eligibility. Idempotent.
BEGIN;

ALTER TABLE public.field_earnings ADD COLUMN IF NOT EXISTS manual_entry boolean NOT NULL DEFAULT false;

-- Snapshot (what Hardik verifies / Tarun approves): manual entries count without the checklist.
CREATE OR REPLACE FUNCTION public.finance_field_snapshot(_associate uuid, _end date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN
 PERFORM finance_assert();
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.earning_date,'phase',e.phase,'company',e.company_name,'amount',e.amount,'paid',EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)) ORDER BY e.earning_date,e.id),'[]')
 FROM field_earnings e WHERE e.associate_id=_associate AND public.field_ops_period_end(e.earning_date)=_end
  AND (e.phase='commissioning' OR (e.phase IN ('assessment','installation') AND public.field_ops_all_phases(_associate)))
  AND (EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)
       OR (e.eligible AND (e.manual_entry OR (e.site_id IS NOT NULL AND public.field_ops_phase_ready(e.site_id,e.phase))))));
END $function$;

-- Hitesh bhai's own "My incentives" page uses the same rule.
DO $$ DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.field_ops_my_incentives(date)'::regprocedure); o := d;
  IF position('e.manual_entry OR' IN d) = 0 THEN
    d := replace(d, 'OR (e.eligible AND e.site_id IS NOT NULL AND public.field_ops_phase_ready(e.site_id,e.phase))',
                    'OR (e.eligible AND (e.manual_entry OR (e.site_id IS NOT NULL AND public.field_ops_phase_ready(e.site_id,e.phase))))');
    IF d = o THEN RAISE EXCEPTION 'Unexpected field_ops_my_incentives definition'; END IF;
    EXECUTE d;
  END IF;
END $$;

-- Checklist edits must not flip a manual entry's eligibility.
DO $$ DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.field_ops_capture_earning()'::regprocedure); o := d;
  IF position('AND NOT previous.manual_entry' IN d) = 0 THEN
    d := replace(d, 'IF NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id = previous.id) THEN',
                    'IF NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id = previous.id) AND NOT previous.manual_entry THEN');
    IF d = o THEN RAISE EXCEPTION 'Unexpected field_ops_capture_earning definition'; END IF;
    EXECUTE d;
  END IF;
END $$;

DO $$
DECLARE hitesh uuid; item record; site uuid; company text; prior field_earnings; done_at timestamptz;
BEGIN
  SELECT u.id INTO hitesh FROM auth.users u WHERE lower(u.email)='associatelimelight@gmail.com';
  IF hitesh IS NULL THEN RAISE EXCEPTION 'Hitesh bhai account not found'; END IF;

  UPDATE field_work_rates SET assessment=1000, installation=500, commissioning=0, all_phases=true, updated_at=now()
  WHERE associate_id=hitesh;

  FOR item IN SELECT * FROM (VALUES
    ('M/S DEEPAK TECHNOCAST',                   date '2026-10-07'),
    ('M/S VALLABH ALLOYS',                      date '2026-10-07'),
    ('M/S WATERMAN INDUSTRIES PRIVATE LIMITED', date '2026-10-22')
  ) v(company, day) LOOP
    SELECT s.id, coalesce(s.company_name,s.name) INTO site, company FROM sites s WHERE s.company_name=item.company LIMIT 1;
    IF site IS NULL THEN RAISE EXCEPTION 'Site % not found', item.company; END IF;
    done_at := (item.day + time '12:00') AT TIME ZONE 'Asia/Kolkata';

    -- Assessment Rs 1,000 and installation Rs 500, credited to Hitesh bhai on the given date.
    FOR prior IN SELECT * FROM field_earnings WHERE site_id=site AND phase IN ('assessment','installation') LOOP
      IF EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=prior.id) THEN
        RAISE EXCEPTION '% % is already paid; not changing it', item.company, prior.phase;
      END IF;
    END LOOP;
    INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount,eligible,manual_entry)
    SELECT site, company, hitesh, coalesce(p.name,p.email,'Field associate'), p.created_at, ph.phase, done_at, item.day, ph.amount, true, true
    FROM profiles p CROSS JOIN (VALUES ('assessment',1000::numeric),('installation',500::numeric)) ph(phase,amount)
    WHERE p.id=hitesh
    ON CONFLICT(site_id,phase) DO UPDATE SET associate_id=excluded.associate_id, associate_name=excluded.associate_name,
      associate_joined=excluded.associate_joined, completed_at=excluded.completed_at, earning_date=excluded.earning_date,
      amount=excluded.amount, eligible=true, manual_entry=true;

    -- Commissioning is not part of this incentive.
    UPDATE field_earnings SET amount=0
    WHERE site_id=site AND phase='commissioning' AND associate_id=hitesh
      AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=field_earnings.id);
  END LOOP;

  -- October was not yet sent to Tarun; if it was, it must be verified again.
  UPDATE field_finance_reviews SET status='rejected', reason='Incentives corrected — Hardik must verify again'
  WHERE associate_id=hitesh AND period_end=public.field_ops_period_end(date '2026-10-15') AND status='tarun_pending';

  INSERT INTO finance_events(entity_id,entity_type,actor_id,actor_role,action,reason,before_data,after_data)
  VALUES(hitesh,'field_rates',(SELECT id FROM auth.users WHERE lower(email)='admin@limelightit.io'),'migration','factory_incentive_recorded',
    'Factory incentive per sheet: assessment 1,000 + installation 500 per company (Deepak, Vallabh 7 Oct; Waterman 22 Oct)',
    NULL, jsonb_build_object('assessment',1000,'installation',500,'commissioning',0));
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
