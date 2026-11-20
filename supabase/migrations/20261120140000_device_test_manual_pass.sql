BEGIN;

CREATE OR REPLACE FUNCTION public.device_test_devices(_search text DEFAULT '', _offset integer DEFAULT 0)
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
      r.report->'steps' AS steps, r.tested_at, r.received_at,
      count(*) OVER (PARTITION BY r.mac) AS run_count,
      row_number() OVER (PARTITION BY r.mac
        ORDER BY coalesce(r.tested_at, r.received_at) DESC, r.received_at DESC, r.id DESC) AS rank,
      bool_or(strpos(lower(coalesce(r.dm_id, '')), search_term) > 0)
        OVER (PARTITION BY r.mac) AS dm_match
    FROM public.device_test_runs r
  )
  SELECT d.mac, d.dm_id,
    CASE WHEN d.overall = 'PASS' AND d.steps @? '$.* ? (@ == "PASS_m")'
      THEN 'PASS_m' ELSE d.overall END,
    d.test_fw, d.tested_at, d.received_at, d.run_count
  FROM ranked d
  WHERE d.rank = 1 AND (d.dm_match OR (mac_term <> '' AND strpos(d.mac, mac_term) > 0))
  ORDER BY coalesce(d.tested_at, d.received_at) DESC, d.received_at DESC, d.mac
  LIMIT 26 OFFSET greatest(_offset, 0);
END;
$$;

COMMIT;
