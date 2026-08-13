-- Migration: Rebrand and update user role
-- 1. Update the role of the specified associate email to manager (supervisor)
UPDATE public.user_roles
SET role = 'supervisor'
WHERE user_id = (
  SELECT id FROM public.profiles WHERE email = 'associateatlimelightit@gmail.com' LIMIT 1
);

-- 2. Update comments on relevant tables/columns to use 'field associate'
COMMENT ON COLUMN public.sites.consultant_stage IS 'End-of-work stage set by an assigned field associate: Billing or Completion.';
