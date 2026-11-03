-- Grant Tarun the HR / Hiring workspace (same server access admin@limelightit.io
-- has). hr_can_manage() is the single gate behind every HR RLS policy and RPC,
-- so widening it here enables Tarun's reads and writes. The frontend already
-- shows the HR nav/route for this email (canManageHr).
BEGIN;
CREATE OR REPLACE FUNCTION public.hr_can_manage() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u JOIN profiles p ON p.id=u.id
  WHERE u.id=auth.uid() AND lower(btrim(u.email)) IN ('admin@limelightit.io','tarun@limelightit.io')
   AND u.email_confirmed_at IS NOT NULL AND p.is_active)
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
