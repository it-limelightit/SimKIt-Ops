-- Create security definer function to toggle supervisor role, avoiding RLS infinite recursion/violation
CREATE OR REPLACE FUNCTION public.toggle_user_manager_role(_target_user_id UUID, _make_manager BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify that the caller is a supervisor or owner
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role IN ('supervisor', 'owner')
  ) THEN
    RAISE EXCEPTION 'Access denied: Only managers can update user roles.';
  END IF;

  IF _make_manager THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user_id, 'supervisor')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'supervisor';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_user_manager_role(UUID, BOOLEAN) TO authenticated;
