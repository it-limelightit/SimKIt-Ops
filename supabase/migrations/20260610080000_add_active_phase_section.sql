ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS active_phase TEXT,
  ADD COLUMN IF NOT EXISTS active_section TEXT;
