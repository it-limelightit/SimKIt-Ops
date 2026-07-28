-- Company-wise / business-consultant-wise management dashboard support.
-- Run in the Supabase SQL editor after the Billing/Completion migration.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS consultant_stage text;

-- Preserve every existing site in the dashboard. Managers can later edit a
-- factory and change this value to link several factories to one company.
UPDATE public.sites
SET company_name = name
WHERE company_name IS NULL OR btrim(company_name) = '';

CREATE INDEX IF NOT EXISTS sites_company_name_idx
  ON public.sites (company_name);

CREATE INDEX IF NOT EXISTS sites_consultant_stage_idx
  ON public.sites (consultant_stage)
  WHERE consultant_stage IS NOT NULL;

COMMENT ON COLUMN public.sites.company_name IS
  'Parent company used to group one or more factory/site records in management reports.';
