BEGIN;

-- Existing companies were entered from the NPC portal. The default also keeps
-- older clients and imports in that category until a source is chosen.
ALTER TABLE public.sites
  ADD COLUMN company_source text NOT NULL DEFAULT 'npc'
  CONSTRAINT sites_company_source_check CHECK (company_source IN ('npc', 'lead'));

CREATE INDEX sites_company_source_idx ON public.sites(company_source);
COMMENT ON COLUMN public.sites.company_source IS
  'Company origin: npc for NPC portal assignments, lead for sales-team companies. Independent of lifecycle status.';

NOTIFY pgrst, 'reload schema';
COMMIT;
