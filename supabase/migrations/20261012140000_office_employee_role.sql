-- Office accounts must not acquire field associate permissions.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'employee';
