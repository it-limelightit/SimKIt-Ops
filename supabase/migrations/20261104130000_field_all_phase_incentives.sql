-- Dual-role incentives (e.g. Hitesh bhai: office staff who also does field work).
-- A per-person switch "all_phases" on field_work_rates:
--   OFF (default, everyone today): commissioning-only incentive, unchanged.
--   ON: the person earns for EACH phase they personally complete
--       (assessment / installation / commissioning, any combination), each at
--       their own price. They count as an incentive earner even with a staff
--       role, and appear in Hardik's field incentive list.
-- The person who completed a phase earns it. Earnings start from 1 Nov 2026
-- (switching someone on later backfills from the start of that month).
BEGIN;

ALTER TABLE public.field_work_rates ADD COLUMN IF NOT EXISTS all_phases boolean NOT NULL DEFAULT false;
-- Installation was forced to 0 for everyone; keep that only for commissioning-only people.
ALTER TABLE public.field_work_rates DROP CONSTRAINT IF EXISTS field_installation_rate_zero;
ALTER TABLE public.field_work_rates ADD CONSTRAINT field_installation_rate_zero
  CHECK (all_phases OR installation IS NULL OR installation = 0);
-- Unset prices are NULL ("rate pending") instead of 0.
ALTER TABLE public.field_work_rates
  ALTER COLUMN assessment DROP NOT NULL,
  ALTER COLUMN installation DROP NOT NULL,
  ALTER COLUMN commissioning DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.field_ops_all_phases(_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM field_work_rates r JOIN profiles p ON p.id=r.associate_id
    WHERE r.associate_id=_id AND r.all_phases AND p.is_active)
$$;
CREATE OR REPLACE FUNCTION public.field_ops_incentive_earner(_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.field_ops_associate(_id) OR public.field_ops_all_phases(_id)
$$;
REVOKE ALL ON FUNCTION public.field_ops_all_phases(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.field_ops_incentive_earner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.field_ops_all_phases(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.field_ops_incentive_earner(uuid) TO authenticated, service_role;

-- 1) Earning capture: all-phase earners are credited and priced per phase.
DO $$ DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.field_ops_capture_earning()'::regprocedure); o := d;
  d := replace(d, 'IF TG_TABLE_NAME <> ''commissioning'' AND NOT public.field_ops_associate(worker) THEN',
                  'IF TG_TABLE_NAME <> ''commissioning'' AND NOT public.field_ops_incentive_earner(worker) THEN');
  d := replace(d, 'IF TG_OP = ''UPDATE'' AND public.field_ops_associate(OLD.worker_id) THEN',
                  'IF TG_OP = ''UPDATE'' AND public.field_ops_incentive_earner(OLD.worker_id) THEN');
  d := replace(d, 'IF NOT public.field_ops_associate(worker) THEN RETURN NEW; END IF;',
                  'IF NOT public.field_ops_incentive_earner(worker) THEN RETURN NEW; END IF;');
  d := replace(d, 'IF TG_TABLE_NAME=''installation'' THEN rate := 0;',
                  'IF public.field_ops_all_phases(worker) THEN'
                  || E'\n    SELECT CASE TG_TABLE_NAME WHEN ''assessment'' THEN assessment WHEN ''installation'' THEN installation ELSE commissioning END'
                  || E'\n      INTO rate FROM field_work_rates WHERE associate_id=worker;'
                  || E'\n  ELSIF TG_TABLE_NAME=''installation'' THEN rate := 0;');
  IF d = o OR position('field_ops_associate(' IN d) > 0 OR position('field_ops_all_phases(worker)' IN d) = 0 THEN
    RAISE EXCEPTION 'Unexpected field_ops_capture_earning definition';
  END IF;
  EXECUTE d;
END $$;

-- 2) Incentive snapshot (what Hardik verifies and Tarun approves): all phases for all-phase earners.
CREATE OR REPLACE FUNCTION public.finance_field_snapshot(_associate uuid, _end date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN
 PERFORM finance_assert();
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.earning_date,'phase',e.phase,'company',e.company_name,'amount',e.amount,'paid',EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)) ORDER BY e.earning_date,e.id),'[]')
 FROM field_earnings e WHERE e.associate_id=_associate AND public.field_ops_period_end(e.earning_date)=_end
  AND (e.phase='commissioning' OR (e.phase IN ('assessment','installation') AND public.field_ops_all_phases(_associate)))
  AND (EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id) OR (e.eligible AND (e.site_id IS NOT NULL AND public.field_ops_phase_ready(e.site_id,e.phase)))));
END $function$;

-- 3) People list: all-phase earners appear as field people for Hardik / Tarun.
DO $$ DECLARE d text; o text;
BEGIN
  d := pg_get_functiondef('public.finance_board(date)'::regprocedure); o := d;
  d := replace(d, 'public.has_role(p.id,''worker'') AND NOT public.is_staff(p.id) AS field',
                  '((public.has_role(p.id,''worker'') AND NOT public.is_staff(p.id)) OR public.field_ops_all_phases(p.id)) AS field');
  IF d = o THEN RAISE EXCEPTION 'Unexpected finance_board definition'; END IF;
  EXECUTE d;
END $$;

-- Backfill earnings for an all-phase earner's completed phases from _from (unpaid, missing only).
CREATE OR REPLACE FUNCTION public.field_backfill_all_phases(_associate uuid, _from date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE added integer := 0; n integer; ph text; r field_work_rates;
BEGIN
  SELECT * INTO r FROM field_work_rates WHERE associate_id=_associate AND all_phases;
  IF r.associate_id IS NULL THEN RETURN 0; END IF;
  FOREACH ph IN ARRAY ARRAY['assessment','installation','commissioning'] LOOP
    EXECUTE format($q$
      INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount)
      SELECT t.site_id,coalesce(s.company_name,s.name),$1,coalesce(p.name,p.email,'Field associate'),p.created_at,%L,t.updated_at,
             (t.updated_at AT TIME ZONE 'Asia/Kolkata')::date,$3
      FROM %I t JOIN sites s ON s.id=t.site_id JOIN profiles p ON p.id=$1
      WHERE t.worker_id=$1 AND (t.updated_at AT TIME ZONE 'Asia/Kolkata')::date >= $2
        AND public.field_ops_phase_ready(t.site_id,%L)
        AND NOT EXISTS(SELECT 1 FROM field_existing_completions x WHERE x.site_id=t.site_id AND x.phase=%L)
      ON CONFLICT(site_id,phase) DO NOTHING$q$, ph, ph, ph, ph)
      USING _associate, _from, CASE ph WHEN 'assessment' THEN r.assessment WHEN 'installation' THEN r.installation ELSE r.commissioning END;
    GET DIAGNOSTICS n = ROW_COUNT; added := added + n;
  END LOOP;
  -- Price this person's unpaid assessment / installation rows from _from that were captured at 0 or unpriced.
  UPDATE field_earnings e SET amount = CASE e.phase WHEN 'assessment' THEN r.assessment ELSE r.installation END
  WHERE e.associate_id=_associate AND e.phase IN ('assessment','installation') AND e.earning_date >= _from
    AND coalesce(e.amount,0)=0 AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id);
  RETURN added;
END $$;
REVOKE ALL ON FUNCTION public.field_backfill_all_phases(uuid,date) FROM PUBLIC, anon, authenticated;

-- 4) Rates v2: per-phase prices + the all-phases switch (Hardik / Tarun).
CREATE OR REPLACE FUNCTION public.finance_field_rates_v2(_associate uuid, _assessment numeric, _installation numeric,
  _commissioning numeric, _all_phases boolean, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_row jsonb; was_on boolean; bad boolean;
BEGIN
  PERFORM finance_assert();
  IF _associate IS NULL OR coalesce(length(btrim(_reason)),0)=0 THEN RAISE EXCEPTION 'Associate and change reason required'; END IF;
  IF NOT coalesce(_all_phases,false) AND NOT public.field_ops_associate(_associate) THEN
    RAISE EXCEPTION 'This person is not a field associate. Turn on "all phases" to pay their field work.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=_associate AND is_active) THEN RAISE EXCEPTION 'Active account required'; END IF;
  IF NOT coalesce(_all_phases,false) THEN _assessment:=0; _installation:=0; END IF;
  SELECT bool_or(v IS NOT NULL AND (v::text IN ('NaN','Infinity','-Infinity') OR v<0)) INTO bad
    FROM unnest(ARRAY[_assessment,_installation,_commissioning]) v;
  IF bad THEN RAISE EXCEPTION 'Rates must be zero or more'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,19));
  SELECT to_jsonb(r), r.all_phases INTO before_row, was_on FROM field_work_rates r WHERE r.associate_id=_associate;
  INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,all_phases,updated_by)
    VALUES(_associate,_assessment,_installation,_commissioning,coalesce(_all_phases,false),auth.uid())
  ON CONFLICT(associate_id) DO UPDATE SET assessment=excluded.assessment,installation=excluded.installation,
    commissioning=excluded.commissioning,all_phases=excluded.all_phases,updated_by=auth.uid(),updated_at=now();
  -- Fill prices on unpaid, unpriced work (existing priced work stays unchanged).
  UPDATE field_earnings e SET amount = CASE e.phase WHEN 'assessment' THEN _assessment WHEN 'installation' THEN _installation ELSE _commissioning END
  WHERE e.associate_id=_associate AND e.amount IS NULL
    AND (e.phase='commissioning' OR coalesce(_all_phases,false))
    AND NOT EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id);
  IF coalesce(_all_phases,false) AND NOT coalesce(was_on,false) THEN
    PERFORM field_backfill_all_phases(_associate, greatest(date '2026-11-01', date_trunc('month',(now() AT TIME ZONE 'Asia/Kolkata')::date)::date));
  END IF;
  PERFORM finance_log('field_rates',_associate,'rates_saved',before_row,(SELECT to_jsonb(r) FROM field_work_rates r WHERE r.associate_id=_associate),_reason);
END $$;
REVOKE ALL ON FUNCTION public.finance_field_rates_v2(uuid,numeric,numeric,numeric,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_field_rates_v2(uuid,numeric,numeric,numeric,boolean,text) TO authenticated;

-- 5) Own incentives for an all-phase earner (e.g. Hitesh bhai's "My incentives" page).
CREATE OR REPLACE FUNCTION public.field_ops_my_incentives(_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid := auth.uid(); ending date;
BEGIN
  IF me IS NULL OR NOT public.field_ops_incentive_earner(me) THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  IF _month IS NULL OR _month < date '2000-01-01' OR _month > date '2100-12-01' THEN RAISE EXCEPTION 'Choose a valid month'; END IF;
  ending := public.field_ops_period_end(_month);
  RETURN jsonb_build_object(
    'enabled', true,
    'all_phases', public.field_ops_all_phases(me),
    'rates', (SELECT jsonb_build_object('assessment',assessment,'installation',installation,'commissioning',commissioning) FROM field_work_rates WHERE associate_id=me),
    'earnings', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.earning_date,'phase',e.phase,'company',coalesce(s.company_name,s.name,e.company_name),
        'amount',e.amount,'paid',EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)) ORDER BY e.earning_date, e.phase),'[]')
      FROM field_earnings e LEFT JOIN sites s ON s.id=e.site_id
      WHERE e.associate_id=me AND public.field_ops_period_end(e.earning_date)=ending
        AND (e.phase='commissioning' OR public.field_ops_all_phases(me))
        AND (EXISTS(SELECT 1 FROM field_payment_items i WHERE i.earning_id=e.id)
             OR (e.eligible AND e.site_id IS NOT NULL AND public.field_ops_phase_ready(e.site_id,e.phase)))),
    'review', (SELECT jsonb_build_object('status',r.status,'hardik_at',r.hardik_at,'tarun_at',r.tarun_at,'reason',r.reason)
      FROM field_finance_reviews r WHERE r.associate_id=me AND r.period_end=ending),
    'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('amount',p.amount,'paid_on',p.paid_on,'reference',p.reference)),'[]')
      FROM field_payment_records p WHERE p.associate_id=me AND p.period_end=ending));
END $$;
REVOKE ALL ON FUNCTION public.field_ops_my_incentives(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.field_ops_my_incentives(date) TO authenticated;

-- 6) Turn it on for Hitesh bhai (prices pending until Hardik sets them) and backfill from 1 Nov 2026.
INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,all_phases,updated_by)
SELECT u.id, NULL, NULL, NULL, true, u.id FROM auth.users u WHERE lower(u.email)='associatelimelight@gmail.com'
ON CONFLICT(associate_id) DO UPDATE SET all_phases=true, updated_at=now();
SELECT field_backfill_all_phases(u.id, date '2026-11-01') FROM auth.users u WHERE lower(u.email)='associatelimelight@gmail.com';

NOTIFY pgrst, 'reload schema';
COMMIT;
