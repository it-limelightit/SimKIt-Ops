-- Migration: Add RPC functions for secure password updates, token resets, and auto-confirm emails
-- 1. Ensure reset token columns exist on profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

-- 2. Create function for managers/users to update user passwords securely (bypasses service role requirement)
CREATE OR REPLACE FUNCTION public.admin_update_user_password(_target_user_id UUID, _new_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  -- Verify caller is a supervisor/owner, or updating their own password
  IF NOT (
    auth.uid() = _target_user_id OR 
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('supervisor', 'owner'))
  ) THEN
    RAISE EXCEPTION 'Access denied: Only managers can update user passwords.';
  END IF;

  IF _new_password IS NULL OR length(_new_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters long.';
  END IF;

  -- Update encrypted password directly in auth.users using pgcrypto bcrypt salt
  -- Also ensure email is marked confirmed
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(_new_password, extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now())
  WHERE id = _target_user_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user_password(UUID, TEXT) TO authenticated, anon;

-- 3. Create function to set reset token for forgotten password
CREATE OR REPLACE FUNCTION public.set_reset_token(user_email TEXT, token_val TEXT, expires_val TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  SELECT id, name INTO v_profile FROM public.profiles WHERE LOWER(email) = LOWER(user_email) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No user account found with that email address.');
  END IF;

  UPDATE public.profiles
  SET reset_token = token_val, reset_token_expires = expires_val
  WHERE id = v_profile.id;

  RETURN jsonb_build_object('success', true, 'name', v_profile.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_reset_token(TEXT, TEXT, TIMESTAMPTZ) TO authenticated, anon;

-- 4. Create function to reset password by valid token
CREATE OR REPLACE FUNCTION public.reset_password_by_token(token_val TEXT, new_pw TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE reset_token = token_val AND reset_token_expires > now();

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF new_pw IS NULL OR length(new_pw) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters long.';
  END IF;

  -- Update encrypted password in auth.users and ensure email confirmed
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(new_pw, extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now())
  WHERE id = v_user_id;

  -- Clear reset token
  UPDATE public.profiles
  SET reset_token = NULL, reset_token_expires = NULL
  WHERE id = v_user_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_password_by_token(TEXT, TEXT) TO authenticated, anon;

-- 5. Auto-confirm all new user signups & confirm any existing unconfirmed users
CREATE OR REPLACE FUNCTION public.auto_confirm_user_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_auto_confirm
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_user_email();

-- Instantly auto-confirm all existing users in the database
UPDATE auth.users
SET email_confirmed_at = now()
WHERE email_confirmed_at IS NULL;
