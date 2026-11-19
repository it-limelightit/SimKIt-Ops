BEGIN;

CREATE TABLE public.device_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mac text GENERATED ALWAYS AS (report->>'mac') STORED NOT NULL,
  dm_id text GENERATED ALWAYS AS (nullif(report->>'existing_id', '')) STORED,
  run_key text NOT NULL,
  report jsonb NOT NULL,
  tested_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (mac, run_key)
);
CREATE INDEX ON public.device_test_runs
  (mac, (coalesce(tested_at, received_at)) DESC, received_at DESC, id DESC);

ALTER TABLE public.device_test_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_test_runs FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.ingest_device_test(_report jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  saved public.device_test_runs;
  key text := coalesce('id:' || (_report->>'report_id'), 'report:' || md5(_report::text));
BEGIN
  INSERT INTO public.device_test_runs (run_key, report, tested_at)
  VALUES (key, _report, (_report->>'tested_at')::timestamptz)
  ON CONFLICT (mac, run_key) DO NOTHING
  RETURNING * INTO saved;

  IF FOUND THEN
    RETURN jsonb_build_object('status', 'created', 'id', saved.id, 'received_at', saved.received_at);
  END IF;

  SELECT * INTO STRICT saved FROM public.device_test_runs
  WHERE mac = _report->>'mac' AND run_key = key;

  IF saved.report <> _report THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;
  RETURN jsonb_build_object('status', 'duplicate', 'id', saved.id, 'received_at', saved.received_at);
END;
$$;

CREATE FUNCTION public.device_test_devices(_search text DEFAULT '', _offset integer DEFAULT 0)
RETURNS TABLE (mac text, dm_id text, overall text, test_fw text, tested_at timestamptz,
  received_at timestamptz, run_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  search_term text := lower(trim(coalesce(_search, '')));
  mac_term text := upper(translate(search_term, ':-', ''));
BEGIN
  IF NOT coalesce(public.field_inventory_manager(), false) THEN
    RAISE EXCEPTION 'Inventory manager access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT r.mac, r.dm_id, r.report->>'overall' AS overall, r.report->>'test_fw' AS test_fw,
      r.tested_at, r.received_at, count(*) OVER (PARTITION BY r.mac) AS run_count,
      row_number() OVER (PARTITION BY r.mac
        ORDER BY coalesce(r.tested_at, r.received_at) DESC, r.received_at DESC, r.id DESC) AS rank,
      bool_or(strpos(lower(coalesce(r.dm_id, '')), search_term) > 0)
        OVER (PARTITION BY r.mac) AS dm_match
    FROM public.device_test_runs r
  )
  SELECT d.mac, d.dm_id, d.overall, d.test_fw, d.tested_at, d.received_at, d.run_count
  FROM ranked d
  WHERE d.rank = 1 AND (d.dm_match OR (mac_term <> '' AND strpos(d.mac, mac_term) > 0))
  ORDER BY coalesce(d.tested_at, d.received_at) DESC, d.received_at DESC, d.mac
  LIMIT 26 OFFSET greatest(_offset, 0);
END;
$$;

CREATE FUNCTION public.device_test_history(_mac text, _offset integer DEFAULT 0)
RETURNS TABLE (id uuid, tested_at timestamptz, received_at timestamptz, report jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT coalesce(public.field_inventory_manager(), false) THEN
    RAISE EXCEPTION 'Inventory manager access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.tested_at, r.received_at, r.report FROM public.device_test_runs r
  WHERE r.mac = _mac
  ORDER BY coalesce(r.tested_at, r.received_at) DESC, r.received_at DESC, r.id DESC
  LIMIT 11 OFFSET greatest(_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_device_test(jsonb),
  public.device_test_devices(text, integer), public.device_test_history(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_device_test(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.device_test_devices(text, integer),
  public.device_test_history(text, integer) TO authenticated;

COMMIT;
