# Supabase Administration & User Management Queries

This document contains the SQL queries used to manage users, reset passwords, change roles, and add new managers directly via the Supabase SQL Editor.

---

## 1. Clean Up / Delete Test Users
Deletes specific test and placeholder accounts from authentication, profiles, and roles:
```sql
-- Step 1: Remove roles
DELETE FROM public.user_roles 
WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE email IN ('supervisor@test.com', 'owner@test.com', 'manager@example.com', 'mmecgrah@gmail.com')
);

-- Step 2: Remove profiles
DELETE FROM public.profiles 
WHERE email IN ('supervisor@test.com', 'owner@test.com', 'manager@example.com', 'mmecgrah@gmail.com');

-- Step 3: Remove authentication
DELETE FROM auth.users 
WHERE email IN ('supervisor@test.com', 'owner@test.com', 'manager@example.com', 'mmecgrah@gmail.com');
```

---

## 2. Set Up Active Managers
Activates `tarun@limelightit.io` and `info@limelightit.io` and sets their roles to `supervisor` (Manager), while removing any non-standard roles from the system:
```sql
-- Step 1: Activate profiles
UPDATE public.profiles
SET is_active = true
WHERE email IN ('tarun@limelightit.io', 'info@limelightit.io');

-- Step 2: Update roles to supervisor
UPDATE public.user_roles
SET role = 'supervisor'
WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE email IN ('tarun@limelightit.io', 'info@limelightit.io')
);

-- Step 3: Insert role if it didn't exist
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'supervisor'::public.app_role
FROM auth.users
WHERE email IN ('tarun@limelightit.io', 'info@limelightit.io')
  AND id NOT IN (SELECT user_id FROM public.user_roles);

-- Step 4: Clean up any invalid roles
DELETE FROM public.user_roles 
WHERE role NOT IN ('supervisor', 'worker');
```

---

## 3. Rename Profile Name
Changes the name for the profile associated with `info@limelightit.io`:
```sql
UPDATE public.profiles
SET name = 'Raghav'
WHERE email = 'info@limelightit.io';
```

---

## 4. Reset Passwords

### A. Reset Password for Tarun (`tarun@limelightit.io`)
```sql
UPDATE auth.users 
SET encrypted_password = crypt('TarunSecurePassword123!', gen_salt('bf'))
WHERE email = 'tarun@limelightit.io';
```

### B. Reset Password for Raghav (`info@limelightit.io`)
```sql
UPDATE auth.users 
SET encrypted_password = crypt('RaghavSecure987!', gen_salt('bf'))
WHERE email = 'info@limelightit.io';
```

---

## 5. Add a New Manager
To add a new manager manually since public manager signup is disabled, run this transaction block:
```sql
DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
BEGIN
  -- 1. Insert into auth.users (Authentication)
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, 
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, 
    updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    'newmanager@limelightit.io', -- <-- CHANGE THIS EMAIL
    crypt('TemporaryPassword123!', gen_salt('bf')), -- <-- CHANGE THIS PASSWORD
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"role":"supervisor"}',
    now(),
    now()
  );

  -- 2. Insert into public.profiles (Profile)
  INSERT INTO public.profiles (
    id, email, name, mobile, whatsapp, is_active, created_at
  )
  VALUES (
    new_user_id,
    'newmanager@limelightit.io', -- <-- CHANGE THIS EMAIL
    'John Doe', -- <-- CHANGE THIS NAME
    '9876543210', -- <-- CHANGE THIS MOBILE
    '9876543210', -- <-- CHANGE THIS WHATSAPP
    true,
    now()
  );

  -- 3. Insert into public.user_roles (Role)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new_user_id, 'supervisor'::public.app_role);

END $$;
```
