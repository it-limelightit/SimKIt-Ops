BEGIN;

-- Restore the application profile for Vikash's existing active office account.
-- An inactive profile makes the login page sign the user out even when Supabase
-- accepts their password. Do not change passwords, roles or employee links.
-- The live correction may already be applied; rerunning this is a safe no-op.
UPDATE public.profiles AS p
SET is_active = true
FROM auth.users AS u
WHERE p.id = u.id
  AND lower(btrim(u.email)) = 'vikashkumavat.limelight@gmail.com'
  AND p.is_active = false
  AND u.email_confirmed_at IS NOT NULL
  AND (u.banned_until IS NULL OR u.banned_until < now())
  AND EXISTS (
    SELECT 1
    FROM public.user_roles AS r
    WHERE r.user_id = u.id
      AND r.role = 'employee'
  )
  AND EXISTS (
    SELECT 1
    FROM public.attendance_employees AS e
    WHERE e.auth_user_id = u.id
      AND e.active = true
      AND e.deleted_at IS NULL
  );

COMMIT;
