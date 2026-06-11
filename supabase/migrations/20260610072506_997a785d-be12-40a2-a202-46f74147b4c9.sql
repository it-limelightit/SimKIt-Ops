ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS appt_date date,
  ADD COLUMN IF NOT EXISTS appt_time time,
  ADD COLUMN IF NOT EXISTS task_notes text,
  ADD COLUMN IF NOT EXISTS task_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS task_assigned_by uuid;