-- Settled company payment lists for field associates (first: Alakh Brahmbhatt).
-- Source: SIM_KIT_Commissioning_Tracker.xlsx. Rs 5,000 per company
-- (assessment + commissioning incentive). "Received" rows were paid to Alakh
-- in September 2026; the remaining 11 ("Pending" in the sheet) were paid in
-- October 2026. This is a read-only record for Tarun/Hardik and the associate;
-- the field_earnings incentive ledger is intentionally not modified.
BEGIN;

CREATE TABLE IF NOT EXISTS public.field_settled_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  associate_id uuid NOT NULL,
  paid_month date NOT NULL CHECK (paid_month = date_trunc('month', paid_month)::date),
  sr_no integer NOT NULL,
  company_name text NOT NULL CHECK (length(btrim(company_name)) > 0),
  city text,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  remark text,
  source text NOT NULL DEFAULT 'SIM_KIT_Commissioning_Tracker.xlsx',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (associate_id, company_name)
);
ALTER TABLE public.field_settled_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_settled_payments FROM PUBLIC, anon, authenticated;

-- Normalised company key: drops "M/S", punctuation and extra spaces.
CREATE OR REPLACE FUNCTION public.field_company_key(_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT btrim(regexp_replace(regexp_replace(upper(coalesce(_name,'')), '^\s*M\s*/\s*S\.?\s+', ''), '[^A-Z0-9]+', ' ', 'g'))
$$;

-- Settled list for one associate: Tarun/Hardik for anyone, an associate for themselves.
-- Each row carries the matching app incentive records so mismatches are visible.
CREATE OR REPLACE FUNCTION public.field_settled_payments_list(_associate uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR (public.finance_role() IS NULL AND auth.uid() IS DISTINCT FROM _associate) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'paid_month', s.paid_month, 'sr_no', s.sr_no, 'company', s.company_name,
      'city', s.city, 'amount', s.amount, 'remark', s.remark,
      'app', (SELECT coalesce(jsonb_agg(jsonb_build_object('phase', e.phase, 'date', e.earning_date, 'amount', e.amount)
                ORDER BY e.earning_date, e.phase), '[]'::jsonb)
              FROM field_earnings e
              WHERE e.associate_id = s.associate_id AND e.eligible
                AND e.phase IN ('assessment','commissioning')
                AND public.field_company_key(e.company_name) = public.field_company_key(s.company_name))
    ) ORDER BY s.paid_month, s.sr_no), '[]'::jsonb)
    FROM field_settled_payments s WHERE s.associate_id = _associate);
END $$;
REVOKE ALL ON FUNCTION public.field_settled_payments_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.field_settled_payments_list(uuid) TO authenticated;

DO $$
DECLARE alakh uuid;
BEGIN
  SELECT id INTO alakh FROM auth.users WHERE lower(email) = 'alakhbrahmbhatt0225@gmail.com';
  IF alakh IS NULL THEN RAISE EXCEPTION 'Alakh account not found'; END IF;
  INSERT INTO field_settled_payments(associate_id, paid_month, sr_no, company_name, city, amount)
  SELECT alakh, t.paid::date, t.sr, t.company, 'Vadodara', 5000
  FROM (VALUES
    ('2026-09-01', 1,  'GHANSHYAM ENGINEERING WORKS'),
    ('2026-09-01', 2,  'AES HYDRO'),
    ('2026-09-01', 3,  'SHIVSONS INDUSTRIES'),
    ('2026-09-01', 4,  'TRISHULRUDRA CORRUGATORS PRIVATE LIMITED'),
    ('2026-09-01', 5,  'SUPER SCIENTIFIC WORKS PRIVATE LIMITED'),
    ('2026-09-01', 6,  'ASPIRE PACKAGING'),
    ('2026-09-01', 7,  'CREATIVE TOUGHENED GLASS PRIVATE LIMITED'),
    ('2026-09-01', 8,  'MEHTA RACE PRODUCTS'),
    ('2026-09-01', 9,  'CALYREX TRADING PRIVATE LIMITED'),
    ('2026-09-01', 10, 'V B INDUSTRIES'),
    ('2026-09-01', 11, 'SHREE NARAYAN MASALA MILL'),
    ('2026-09-01', 12, 'SHREEJI INDUSTRIES'),
    ('2026-09-01', 13, 'TWINFITT PLASTIC INDUSTRIES'),
    ('2026-09-01', 14, 'PARMANAND INDUSTRIES'),
    ('2026-10-01', 15, 'BARODA MOULDS & DIES PRIVATE LIMITED'),
    ('2026-10-01', 16, 'SHARVIK INDUSTRIES PRIVATE LIMITED'),
    ('2026-10-01', 17, 'DYNAMIC PLASTIC INDUSTRY'),
    ('2026-10-01', 18, 'MEDINOVA ENDOSYS PRIVATE LIMITED'),
    ('2026-10-01', 19, 'PUNAR ENTERPRISE'),
    ('2026-10-01', 20, 'BARODA BUSHINGS & INSULATORS PRIVATE LIMITED'),
    ('2026-10-01', 21, 'ORBIT EXIM'),
    ('2026-10-01', 22, 'ALUCAST INDUSTRIES'),
    ('2026-10-01', 23, 'KANSEI VALVES AND AUTOMATIONS LLP'),
    ('2026-10-01', 24, 'GANESH ENGINEERING'),
    ('2026-10-01', 25, 'C J ENGINEERING WORKS')
  ) t(paid, sr, company)
  ON CONFLICT (associate_id, company_name) DO NOTHING;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
