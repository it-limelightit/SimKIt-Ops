-- SimKit Ops: NEW EMPTY project jhhiwyvrhfhvvougkqmm ONLY.
-- Repository-derived schema, not a verified export of the live Lovable database.
-- No source/production connection changes. Does not import existing users/files/business data.
-- Includes application RPCs, RLS, triggers, and required configuration defaults.
-- Excludes company import and logistics user/data seeds. Do not rerun after successful setup.
BEGIN;
DO $empty_project$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public') THEN
    RAISE EXCEPTION 'Setup stopped: public contains tables. Use only on the new empty destination.';
  END IF;
END
$empty_project$;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Source migration: 20260610063229_49147e7f-6e05-4db9-821d-98d86aec2e78.sql

-- Roles
CREATE TYPE public.app_role AS ENUM ('worker', 'supervisor', 'owner');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  mobile TEXT,
  whatsapp TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('supervisor','owner')
  )
$$;

-- Profiles policies
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Staff insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.is_staff(auth.uid()));

-- user_roles policies
CREATE POLICY "Users see own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

-- Sites
CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  address TEXT,
  assigned_worker_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Worker reads own sites; staff reads all" ON public.sites
  FOR SELECT TO authenticated
  USING (assigned_worker_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Staff manages sites" ON public.sites
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- Phase tables (assessment/installation/commissioning) share shape
CREATE TABLE public.assessment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id)
);
CREATE TABLE public.installation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id)
);
CREATE TABLE public.commissioning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installation TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commissioning TO authenticated;
GRANT ALL ON public.assessment TO service_role;
GRANT ALL ON public.installation TO service_role;
GRANT ALL ON public.commissioning TO service_role;
ALTER TABLE public.assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissioning ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_site(_site_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.sites s WHERE s.id = _site_id AND s.assigned_worker_id = auth.uid())
$$;

CREATE POLICY "Phase access assessment" ON public.assessment FOR ALL TO authenticated
  USING (public.can_access_site(site_id)) WITH CHECK (public.can_access_site(site_id));
CREATE POLICY "Phase access installation" ON public.installation FOR ALL TO authenticated
  USING (public.can_access_site(site_id)) WITH CHECK (public.can_access_site(site_id));
CREATE POLICY "Phase access commissioning" ON public.commissioning FOR ALL TO authenticated
  USING (public.can_access_site(site_id)) WITH CHECK (public.can_access_site(site_id));

-- Contacts
CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name TEXT, designation TEXT, mobile TEXT, whatsapp TEXT, email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Contacts site access" ON public.contacts FOR ALL TO authenticated
  USING (public.can_access_site(site_id)) WITH CHECK (public.can_access_site(site_id));

-- Machines
CREATE TABLE public.machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name TEXT, brand TEXT, model TEXT, serial TEXT, year INT, condition TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.machines TO authenticated;
GRANT ALL ON public.machines TO service_role;
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Machines site access" ON public.machines FOR ALL TO authenticated
  USING (public.can_access_site(site_id)) WITH CHECK (public.can_access_site(site_id));

-- Custom fields
CREATE TABLE public.custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase TEXT NOT NULL,
  section TEXT NOT NULL,
  field_type TEXT NOT NULL,
  label TEXT NOT NULL,
  options JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_fields TO authenticated;
GRANT ALL ON public.custom_fields TO service_role;
ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Custom fields read" ON public.custom_fields FOR SELECT TO authenticated USING (true);
CREATE POLICY "Custom fields staff write" ON public.custom_fields FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Custom fields staff update" ON public.custom_fields FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "Custom fields staff delete" ON public.custom_fields FOR DELETE TO authenticated
  USING (public.is_staff(auth.uid()));

-- Media
CREATE TABLE public.media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  section TEXT,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_name TEXT,
  size_bytes BIGINT,
  caption TEXT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media TO authenticated;
GRANT ALL ON public.media TO service_role;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Media site access" ON public.media FOR ALL TO authenticated
  USING (public.can_access_site(site_id)) WITH CHECK (public.can_access_site(site_id));

-- Settings singleton
CREATE TABLE public.settings (
  id INT PRIMARY KEY DEFAULT 1,
  company_name TEXT,
  logo_path TEXT,
  default_cities JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);
INSERT INTO public.settings (id, company_name) VALUES (1, 'SIM-Kit Ops') ON CONFLICT DO NOTHING;
GRANT SELECT ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Settings read" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Owners write settings" ON public.settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'owner'));

-- Profile auto-create + default worker role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, mobile, whatsapp, is_active)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'name',
    NEW.email,
    NEW.raw_user_meta_data->>'mobile',
    NEW.raw_user_meta_data->>'whatsapp',
    false
  ) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'worker') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- Source migration: 20260610063256_bbcc5ae9-bcef-4028-8b5e-f160b6187ebe.sql

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_site(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
-- Storage policies for site-media and site-docs (created next as private)


-- Source migration: 20260610063325_ea811a4b-8368-4fc6-af49-1627d75b42e9.sql

-- Allow authenticated users to read/write objects in site-media and site-docs.
-- File path convention: {site_id}/{phase}/{filename}
CREATE POLICY "site files read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('site-media','site-docs')
  AND public.can_access_site(((storage.foldername(name))[1])::uuid)
);
CREATE POLICY "site files insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('site-media','site-docs')
  AND public.can_access_site(((storage.foldername(name))[1])::uuid)
);
CREATE POLICY "site files update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('site-media','site-docs')
  AND public.can_access_site(((storage.foldername(name))[1])::uuid)
);
CREATE POLICY "site files delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('site-media','site-docs')
  AND public.can_access_site(((storage.foldername(name))[1])::uuid)
);


-- Source migration: 20260610064745_f49b7c5e-2959-4de8-8d3a-7174a6e65c82.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  requested_role public.app_role;
BEGIN
  requested_role := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'role','')::public.app_role,
    'worker'::public.app_role
  );
  -- Only worker or supervisor may self-register; owner must be granted manually
  IF requested_role NOT IN ('worker','supervisor') THEN
    requested_role := 'worker';
  END IF;

  INSERT INTO public.profiles (id, name, email, mobile, whatsapp, is_active)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'name',
    NEW.email,
    NEW.raw_user_meta_data->>'mobile',
    NEW.raw_user_meta_data->>'whatsapp',
    false
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, requested_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Source migration: 20260610072506_997a785d-be12-40a2-a202-46f74147b4c9.sql
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS appt_date date,
  ADD COLUMN IF NOT EXISTS appt_time time,
  ADD COLUMN IF NOT EXISTS task_notes text,
  ADD COLUMN IF NOT EXISTS task_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS task_assigned_by uuid;

-- Source migration: 20260610080000_add_active_phase_section.sql
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS active_phase TEXT,
  ADD COLUMN IF NOT EXISTS active_section TEXT;


-- Source migration: 20260611101500_add_status_to_profiles.sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'assigned';


-- Source migration: 20260728011500_add_consultant_billing_completion.sql
-- Adds consultant-controlled end-of-work stages without giving consultants broad
-- UPDATE access to the sites table. Run this file in the Supabase SQL editor.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS consultant_stage text;

ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_consultant_stage_check;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_consultant_stage_check
  CHECK (consultant_stage IS NULL OR consultant_stage IN ('Billing', 'Completion'));

CREATE OR REPLACE FUNCTION public.set_consultant_site_stage(
  _site_id uuid,
  _stage text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _stage NOT IN ('Billing', 'Completion') THEN
    RAISE EXCEPTION 'Stage must be Billing or Completion';
  END IF;

  UPDATE public.sites
  SET consultant_stage = _stage
  WHERE id = _site_id
    AND (
      assigned_worker_id = auth.uid()
      OR COALESCE(task_notes, '') LIKE '%"' || auth.uid()::text || '"%'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not assigned to this site';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_consultant_site_stage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_consultant_site_stage(uuid, text) TO authenticated;

COMMENT ON COLUMN public.sites.consultant_stage IS
  'End-of-work stage set by an assigned business consultant: Billing or Completion.';


-- Source migration: 20260728013000_add_company_factory_dashboard.sql
-- Company-wise / business-consultant-wise management dashboard support.
-- Run in the Supabase SQL editor after the Billing/Completion migration.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS consultant_stage text;

-- Preserve every existing site in the dashboard. Managers can later edit a
-- factory and change this value to link several factories to one company.
UPDATE public.sites
SET company_name = name
WHERE company_name IS NULL OR btrim(company_name) = '';

CREATE INDEX IF NOT EXISTS sites_company_name_idx
  ON public.sites (company_name);

CREATE INDEX IF NOT EXISTS sites_consultant_stage_idx
  ON public.sites (consultant_stage)
  WHERE consultant_stage IS NOT NULL;

COMMENT ON COLUMN public.sites.company_name IS
  'Parent company used to group one or more factory/site records in management reports.';


-- Source migration: 20260730070000_normalize_factory_statuses.sql
-- Operational factory statuses requested for the Sites dashboard.
-- This updates records imported from the 25-Jul-2026 company status tracker.
-- Other site metadata and any text following the metadata block are preserved.

UPDATE public.sites
SET task_notes = regexp_replace(
  task_notes,
  '"status"\s*:\s*"[^"]*"',
  CASE
    WHEN task_notes LIKE '%"tracker_source_detail": "Bill submission pending"%'
      OR task_notes LIKE '%"tracker_source_detail":"Bill submission pending"%'
      THEN '"status":"Completed but bill pending"'
    ELSE '"status":"Completed/Billed from our end"'
  END
)
WHERE
  task_notes IS NOT NULL
  AND (
    task_notes LIKE '%"status": "Completed & Billed"%'
    OR task_notes LIKE '%"status":"Completed & Billed"%'
  );

UPDATE public.sites
SET task_notes = regexp_replace(
  task_notes,
  '"status"\s*:\s*"[^"]*"',
  '"status":"Completed but awaiting NPC confirmation"'
)
WHERE
  task_notes IS NOT NULL
  AND (
    task_notes LIKE '%"status": "Awaiting NPC Confirmation"%'
    OR task_notes LIKE '%"status":"Awaiting NPC Confirmation"%'
  );

-- The workbook's Pending Assessment/Newly Assigned sheets are authoritative
-- for these nine companies.
UPDATE public.sites
SET task_notes = regexp_replace(
  task_notes,
  '"status"\s*:\s*"[^"]*"',
  '"status":"Pending Assessment"'
)
WHERE lower(btrim(name)) IN (
  lower('M/S MOTEXO INDUSTRIES LLP'),
  lower('M/S LEXICON POLYCRAFT'),
  lower('M/S PATEL METAL TREATMENT'),
  lower('R S COMPOSITE'),
  lower('M/S R S EXIM'),
  lower('SAMURAI PUMPS PRIVATE LIMITED'),
  lower('M/S DOLPHIN POLYMERS'),
  lower('M/S ACTIVE ENTERPRISES'),
  lower('M/S HI WILL ENGINEERING SOLUTION')
);



-- Source migration: 20260805023000_add_inventory_management.sql
-- Manager-maintained parcel tracking and material inventory.
-- Associates can read the live inventory; only managers/owners can change it.

CREATE TABLE IF NOT EXISTS public.inventory_parcels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_name TEXT NOT NULL CHECK (length(trim(parcel_name)) > 0),
  tracking_number TEXT NOT NULL CHECK (length(trim(tracking_number)) > 0),
  carrier TEXT,
  status TEXT NOT NULL DEFAULT 'Preparing'
    CHECK (status IN ('Preparing', 'In transit', 'Delivered', 'Delayed', 'Cancelled')),
  location TEXT,
  estimated_arrival TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_name TEXT NOT NULL CHECK (length(trim(material_name)) > 0),
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit TEXT NOT NULL DEFAULT 'pcs',
  state TEXT NOT NULL DEFAULT 'Available'
    CHECK (state IN ('Available', 'Low stock', 'Out of stock', 'In transit', 'Reserved')),
  location TEXT,
  estimated_arrival TIMESTAMPTZ,
  tracking_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_inventory_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_parcels_updated_at ON public.inventory_parcels;
CREATE TRIGGER inventory_parcels_updated_at BEFORE UPDATE ON public.inventory_parcels
FOR EACH ROW EXECUTE FUNCTION public.set_inventory_updated_at();

DROP TRIGGER IF EXISTS inventory_materials_updated_at ON public.inventory_materials;
CREATE TRIGGER inventory_materials_updated_at BEFORE UPDATE ON public.inventory_materials
FOR EACH ROW EXECUTE FUNCTION public.set_inventory_updated_at();

ALTER TABLE public.inventory_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_materials ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.inventory_parcels, public.inventory_materials TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.inventory_parcels, public.inventory_materials TO authenticated;
GRANT ALL ON public.inventory_parcels, public.inventory_materials TO service_role;

CREATE POLICY "Authenticated users read parcels" ON public.inventory_parcels
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff manage parcels" ON public.inventory_parcels
  FOR ALL TO authenticated USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Authenticated users read materials" ON public.inventory_materials
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff manage materials" ON public.inventory_materials
  FOR ALL TO authenticated USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- Required for Supabase Realtime postgres_changes subscriptions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inventory_parcels'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_parcels; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inventory_materials'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_materials; END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_parcels_status_idx ON public.inventory_parcels(status);
CREATE INDEX IF NOT EXISTS inventory_materials_state_idx ON public.inventory_materials(state);


-- Source migration: 20260805030000_ensure_inventory_delete_permissions.sql
-- Explicit manager-only deletion rules for Inventory.
-- Safe to run in Lovable/Supabase after the main inventory migration.

GRANT DELETE ON public.inventory_parcels, public.inventory_materials TO authenticated;

DROP POLICY IF EXISTS "Staff delete parcels" ON public.inventory_parcels;
CREATE POLICY "Staff delete parcels"
  ON public.inventory_parcels
  FOR DELETE
  TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff delete materials" ON public.inventory_materials;
CREATE POLICY "Staff delete materials"
  ON public.inventory_materials
  FOR DELETE
  TO authenticated
  USING (public.is_staff(auth.uid()));


-- Source migration: 20260806120000_enhance_inventory_fields.sql
-- Migration: Enhance inventory_materials with complete device specifications and installation details

ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS submitted BOOLEAN DEFAULT false;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS version TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS ota_key TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS ota_account TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS mac_id TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS uplink TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS ct1 TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS ct2 TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS ct3 TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS proxy1 TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS proxy2 TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS encoder TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS vibration TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS antenna TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS tower_light TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS dispatch TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS energy_meter TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS plc TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS flash_size TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS vibration_model TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS proxy_model TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS installation_date DATE;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS iccid TEXT;
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS remark TEXT;


-- Source migration: 20260807120000_update_state_check_constraint.sql
-- Migration: Update state check constraint and enable INSERT for authenticated users
-- 1. Drops any existing CHECK constraints on the 'state' column and adds a new one including 'Pending', 'Packing', 'Transit', and 'Delivered'.
-- 2. Creates a policy to allow all authenticated users (including worker role) to insert new materials.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tc.constraint_name 
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu 
            ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'inventory_materials' 
          AND tc.constraint_type = 'CHECK'
          AND ccu.column_name = 'state'
    LOOP
        EXECUTE 'ALTER TABLE public.inventory_materials DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.inventory_materials 
  ADD CONSTRAINT inventory_materials_state_check 
  CHECK (state IN ('Available', 'Low stock', 'Out of stock', 'In transit', 'Reserved', 'Pending', 'Packing', 'Transit', 'Delivered'));

-- Allow all authenticated users (workers/consultants) to submit device orders (insert rows)
DROP POLICY IF EXISTS "Authenticated users can insert materials" ON public.inventory_materials;
CREATE POLICY "Authenticated users can insert materials" ON public.inventory_materials
  FOR INSERT TO authenticated WITH CHECK (true);


-- Source migration: 20260807130000_add_updated_at_sorting.sql
-- Add updated_at column to public.sites if not exists
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add updated_at column to public.inventory_materials if not exists
ALTER TABLE public.inventory_materials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Create or replace function to update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for sites
DROP TRIGGER IF EXISTS trigger_sites_updated_at ON public.sites;
CREATE TRIGGER trigger_sites_updated_at
  BEFORE UPDATE ON public.sites
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Trigger for inventory_materials
DROP TRIGGER IF EXISTS trigger_inventory_materials_updated_at ON public.inventory_materials;
CREATE TRIGGER trigger_inventory_materials_updated_at
  BEFORE UPDATE ON public.inventory_materials
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();


-- Source migration: 20260813120000_change_associate_role_and_comments.sql
-- Migration: Rebrand and update user role
-- 1. Update the role of the specified associate email to manager (supervisor)
UPDATE public.user_roles
SET role = 'supervisor'
WHERE user_id = (
  SELECT id FROM public.profiles WHERE email = 'associateatlimelightit@gmail.com' LIMIT 1
);

-- 2. Update comments on relevant tables/columns to use 'field associate'
COMMENT ON COLUMN public.sites.consultant_stage IS 'End-of-work stage set by an assigned field associate: Billing or Completion.';


-- Source migration: 20260813140000_add_toggle_user_manager_role.sql
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


-- Source migration: 20260814140000_add_password_management_rpc.sql
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


-- Source migration: 20260824090000_add_activity_logs.sql
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid null,
  actor_name text not null default 'Unknown User',
  action text not null,
  entity_type text not null,
  entity_id text null,
  entity_name text null,
  site_id uuid null references public.sites(id) on delete set null,
  company_name text null,
  factory_name text null,
  from_value text null,
  to_value text null,
  details jsonb not null default '{}'::jsonb
);

alter table public.activity_logs enable row level security;

drop policy if exists "Authenticated users can read activity logs" on public.activity_logs;
create policy "Authenticated users can read activity logs"
  on public.activity_logs for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert activity logs" on public.activity_logs;
create policy "Authenticated users can insert activity logs"
  on public.activity_logs for insert
  to authenticated
  with check (auth.uid() = actor_id or actor_id is null);

create index if not exists activity_logs_created_at_idx on public.activity_logs(created_at desc);
create index if not exists activity_logs_site_id_idx on public.activity_logs(site_id);
create index if not exists activity_logs_actor_id_idx on public.activity_logs(actor_id);

alter publication supabase_realtime add table public.activity_logs;


-- Source migration: 20260902010000_add_consultant_site_status_rpc.sql
-- Allow an assigned field associate to update only the status metadata for their site.
CREATE OR REPLACE FUNCTION public.set_consultant_site_status(
  _site_id uuid,
  _task_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sites
  SET
    task_notes = _task_notes,
    consultant_stage = NULL
  WHERE id = _site_id
    AND (
      assigned_worker_id = auth.uid()
      OR COALESCE(task_notes, '') LIKE '%"' || auth.uid()::text || '"%'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not assigned to this site';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_consultant_site_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_consultant_site_status(uuid, text) TO authenticated;


-- Source migration: 20260907150000_create_inventory_stock.sql
-- Create inventory_stock table for item stock tracking
CREATE TABLE IF NOT EXISTS public.inventory_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  sensor_type TEXT,
  actual_quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create inventory_logs table for audit & dynamic stock deductions
CREATE TABLE IF NOT EXISTS public.inventory_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id UUID REFERENCES public.inventory_stock(id) ON DELETE CASCADE,
  order_id TEXT,
  quantity_changed INTEGER NOT NULL,
  change_type TEXT NOT NULL, -- 'ADD', 'DISPATCH_DEDUCTION', 'MANUAL_ADJUSTMENT'
  triggered_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read/write access policies (matching app conventions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'inventory_stock' AND policyname = 'Allow read inventory_stock'
  ) THEN
    CREATE POLICY "Allow read inventory_stock" ON public.inventory_stock FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'inventory_stock' AND policyname = 'Allow write inventory_stock'
  ) THEN
    CREATE POLICY "Allow write inventory_stock" ON public.inventory_stock FOR ALL USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'inventory_logs' AND policyname = 'Allow read inventory_logs'
  ) THEN
    CREATE POLICY "Allow read inventory_logs" ON public.inventory_logs FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'inventory_logs' AND policyname = 'Allow write inventory_logs'
  ) THEN
    CREATE POLICY "Allow write inventory_logs" ON public.inventory_logs FOR ALL USING (true);
  END IF;
END $$;


-- Source migration: 20260908100000_create_inventory_bom.sql
-- BOM definitions are separate from physical inventory and purchase entries.
-- A BOM row describes what one product consumes when it is assembled.
CREATE TABLE IF NOT EXISTS public.inventory_bom_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT NOT NULL DEFAULT 'Data Meter',
  category TEXT NOT NULL,
  sensor_type TEXT,
  quantity_per_kit NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity_per_kit >= 0),
  unit TEXT NOT NULL DEFAULT 'Nos',
  required_by_default BOOLEAN NOT NULL DEFAULT false,
  min_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_bom_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventory_bom_items'
      AND policyname = 'Allow read inventory_bom_items'
  ) THEN
    CREATE POLICY "Allow read inventory_bom_items"
      ON public.inventory_bom_items FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventory_bom_items'
      AND policyname = 'Allow write inventory_bom_items'
  ) THEN
    CREATE POLICY "Allow write inventory_bom_items"
      ON public.inventory_bom_items FOR ALL USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_bom_items_product_idx
  ON public.inventory_bom_items (product_name, active);

CREATE INDEX IF NOT EXISTS inventory_bom_items_category_idx
  ON public.inventory_bom_items (category, sensor_type);


-- Source migration: 20260908123000_create_inventory_bulk_order_plans.sql
-- Persist Data Meter bulk-order plans separately from physical inventory.
-- A plan records the requested device count and date; it does not change stock.
CREATE TABLE IF NOT EXISTS public.inventory_bulk_order_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_quantity INTEGER NOT NULL CHECK (device_quantity > 0),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_bulk_order_plans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventory_bulk_order_plans'
      AND policyname = 'Allow read inventory_bulk_order_plans'
  ) THEN
    CREATE POLICY "Allow read inventory_bulk_order_plans"
      ON public.inventory_bulk_order_plans FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventory_bulk_order_plans'
      AND policyname = 'Allow write inventory_bulk_order_plans'
  ) THEN
    CREATE POLICY "Allow write inventory_bulk_order_plans"
      ON public.inventory_bulk_order_plans FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_bulk_order_plans_date_idx
  ON public.inventory_bulk_order_plans(order_date DESC, created_at DESC);


-- Source migration: 20260910100000_commissioning_approval.sql
-- Field associates request commissioning; only the named approvers can approve it.
CREATE TABLE public.commissioning_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  drive_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (site_id)
);

GRANT SELECT, INSERT, UPDATE ON public.commissioning_approval_requests TO authenticated;
GRANT ALL ON public.commissioning_approval_requests TO service_role;
ALTER TABLE public.commissioning_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Associates read own commissioning requests" ON public.commissioning_approval_requests
  FOR SELECT TO authenticated USING (requested_by = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Associates create own commissioning requests" ON public.commissioning_approval_requests
  FOR INSERT TO authenticated WITH CHECK (requested_by = auth.uid() AND public.can_access_site(site_id));

CREATE OR REPLACE FUNCTION public.is_commissioning_approver()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND lower(email) IN ('patidarnit21@gmail.com', 'info@limelightit.io')
  );
$$;

CREATE OR REPLACE FUNCTION public.submit_commissioning_approval_request(_site_id UUID, _drive_link TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_id UUID;
BEGIN
  IF public.is_staff(auth.uid()) OR NOT public.can_access_site(_site_id) THEN
    RAISE EXCEPTION 'Only the assigned field associate can request commissioning approval';
  END IF;
  IF _drive_link !~* '^https?://(drive|docs)\.google\.com/' THEN
    RAISE EXCEPTION 'A valid Google Drive link is required';
  END IF;

  INSERT INTO public.commissioning_approval_requests (site_id, requested_by, drive_link, status, requested_at, reviewed_at, reviewed_by)
  VALUES (_site_id, auth.uid(), trim(_drive_link), 'pending', now(), NULL, NULL)
  ON CONFLICT (site_id) DO UPDATE SET
    requested_by = EXCLUDED.requested_by,
    drive_link = EXCLUDED.drive_link,
    status = 'pending',
    requested_at = now(),
    reviewed_at = NULL,
    reviewed_by = NULL
  RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_commissioning_approval_request(_request_id UUID, _approved BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_row public.commissioning_approval_requests;
BEGIN
  IF NOT public.is_commissioning_approver() THEN
    RAISE EXCEPTION 'Only the designated commissioning managers can approve requests';
  END IF;
  SELECT * INTO request_row FROM public.commissioning_approval_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'This commissioning request is no longer pending';
  END IF;

  UPDATE public.commissioning_approval_requests
  SET status = CASE WHEN _approved THEN 'approved' ELSE 'rejected' END,
      reviewed_at = now(), reviewed_by = auth.uid()
  WHERE id = _request_id;

  IF _approved THEN
    UPDATE public.commissioning
    SET data = jsonb_set(
      jsonb_set(COALESCE(data, '{}'::jsonb), '{commissioning_phase_submitted}', 'true'::jsonb, true),
      '{commissioning_phase_submitted_at}', to_jsonb(now()), true
    ), updated_at = now()
    WHERE site_id = request_row.site_id;
  END IF;
END;
$$;

-- A field associate cannot bypass the approval flow by directly writing the final marker.
CREATE OR REPLACE FUNCTION public.prevent_unapproved_commissioning_submission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- OLD is unavailable on INSERT, so only inspect it for an UPDATE.
  IF COALESCE(NEW.data->>'commissioning_phase_submitted', 'false') <> 'true' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.data->>'commissioning_phase_submitted', 'false') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_staff(auth.uid())
     AND NOT public.is_commissioning_approver()
     AND NOT EXISTS (
       SELECT 1 FROM public.commissioning_approval_requests
       WHERE site_id = NEW.site_id AND status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Commissioning approval is required before submission';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_commissioning_approval ON public.commissioning;
CREATE TRIGGER require_commissioning_approval
  BEFORE INSERT OR UPDATE OF data ON public.commissioning
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unapproved_commissioning_submission();

GRANT EXECUTE ON FUNCTION public.submit_commissioning_approval_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_commissioning_approval_request(UUID, BOOLEAN) TO authenticated;


-- Source migration: 20260911120000_allow_dual_role_commissioning_request.sql
-- Allow a dual-role manager (supervisor + worker) to use the same
-- commissioning approval flow as a field associate. Pure managers remain
-- unable to submit approval requests.
CREATE OR REPLACE FUNCTION public.submit_commissioning_approval_request(_site_id UUID, _drive_link TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE request_id UUID;
BEGIN
  IF (
    public.is_staff(auth.uid())
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'worker'
    )
  ) OR NOT public.can_access_site(_site_id) THEN
    RAISE EXCEPTION 'Only the assigned field associate can request commissioning approval';
  END IF;

  IF _drive_link !~* '^https?://(drive|docs)\.google\.com/' THEN
    RAISE EXCEPTION 'A valid Google Drive link is required';
  END IF;

  INSERT INTO public.commissioning_approval_requests
    (site_id, requested_by, drive_link, status, requested_at, reviewed_at, reviewed_by)
  VALUES
    (_site_id, auth.uid(), trim(_drive_link), 'pending', now(), NULL, NULL)
  ON CONFLICT (site_id) DO UPDATE SET
    requested_by = EXCLUDED.requested_by,
    drive_link = EXCLUDED.drive_link,
    status = 'pending',
    requested_at = now(),
    reviewed_at = NULL,
    reviewed_by = NULL
  RETURNING id INTO request_id;

  RETURN request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_commissioning_approval_request(UUID, TEXT) TO authenticated;


-- Source migration: 20260922090000_company_tracker.sql
-- Company tracker: all state changes go through the RPCs below so that role and
-- ownership rules are enforced even when a client bypasses the UI.
CREATE TABLE public.company_tracker_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL UNIQUE REFERENCES public.sites(id) ON DELETE CASCADE,
  assignee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL DEFAULT 'Issue Resolution' CHECK (stage IN ('Issue Resolution','Monitoring','Insights Shared','Meeting Planned','Quotation Sent','Converted')),
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_tracker_assignments_assignee_idx ON public.company_tracker_assignments (assignee_id, stage);

CREATE TABLE public.company_tracker_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id UUID NOT NULL REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  stage TEXT NOT NULL,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_tracker_comments_tracker_idx ON public.company_tracker_comments (tracker_id, created_at DESC);

CREATE TABLE public.company_tracker_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id UUID NOT NULL REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  previous_stage TEXT,
  new_stage TEXT NOT NULL,
  changed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  comment_id UUID REFERENCES public.company_tracker_comments(id) ON DELETE SET NULL,
  was_manual BOOLEAN NOT NULL DEFAULT false,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_tracker_history_tracker_idx ON public.company_tracker_stage_history (tracker_id, changed_at DESC);

CREATE TABLE public.company_tracker_monitoring_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id UUID NOT NULL REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL CHECK (day_number BETWEEN 1 AND 11),
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','green','red')),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (tracker_id, day_number)
);

ALTER TABLE public.company_tracker_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_tracker_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_tracker_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_tracker_monitoring_days ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.company_tracker_assignments, public.company_tracker_comments, public.company_tracker_stage_history, public.company_tracker_monitoring_days TO authenticated;

CREATE OR REPLACE FUNCTION public.is_company_tracker_manager()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_commissioning_approver()
$$;
CREATE OR REPLACE FUNCTION public.can_access_company_tracker(_tracker_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_company_tracker_manager() OR EXISTS (
    SELECT 1 FROM public.company_tracker_assignments WHERE id = _tracker_id AND assignee_id = auth.uid()
  )
$$;
CREATE POLICY "Tracker assignment read access" ON public.company_tracker_assignments FOR SELECT TO authenticated
  USING (public.is_company_tracker_manager() OR assignee_id = auth.uid());
CREATE POLICY "Tracker comment read access" ON public.company_tracker_comments FOR SELECT TO authenticated
  USING (public.can_access_company_tracker(tracker_id));
CREATE POLICY "Tracker history read access" ON public.company_tracker_stage_history FOR SELECT TO authenticated
  USING (public.can_access_company_tracker(tracker_id));
CREATE POLICY "Tracker monitoring read access" ON public.company_tracker_monitoring_days FOR SELECT TO authenticated
  USING (public.can_access_company_tracker(tracker_id));

CREATE OR REPLACE FUNCTION public.company_tracker_assign(_site_id UUID, _assignee_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can assign companies'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id) THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _assignee_id AND is_active) THEN RAISE EXCEPTION 'Assignee must be an active user'; END IF;
  INSERT INTO public.company_tracker_assignments(site_id, assignee_id, stage, stage_changed_at, created_by)
  VALUES (_site_id, _assignee_id, 'Issue Resolution', now(), auth.uid())
  ON CONFLICT (site_id) DO UPDATE SET assignee_id = EXCLUDED.assignee_id, stage = 'Issue Resolution', stage_changed_at = now(), updated_at = now()
  RETURNING id INTO tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual)
  VALUES (tracker_id, NULL, 'Issue Resolution', auth.uid(), false);
  RETURN tracker_id;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_add_comment(_tracker_id UUID, _body TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comment_id UUID; tracker_stage TEXT;
BEGIN
  IF trim(coalesce(_body,'')) = '' THEN RAISE EXCEPTION 'A comment is required'; END IF;
  SELECT stage INTO tracker_stage FROM public.company_tracker_assignments WHERE id = _tracker_id;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, trim(_body), tracker_stage, auth.uid()) RETURNING id INTO comment_id;
  RETURN comment_id;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id UUID, _comment TEXT, _manual BOOLEAN DEFAULT true)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; next_stage TEXT; comment_id UUID;
BEGIN
  IF trim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  next_stage := CASE current_stage WHEN 'Issue Resolution' THEN 'Monitoring' WHEN 'Monitoring' THEN 'Insights Shared' WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' WHEN 'Quotation Sent' THEN 'Converted' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_save_monitoring(_tracker_id UUID, _day_number INTEGER, _checklist JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_row public.company_tracker_assignments; all_checked BOOLEAN; day_result TEXT; has_red BOOLEAN; total_days INTEGER; all_green BOOLEAN; automatic_comment_id UUID;
BEGIN
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;
  IF NOT public.is_company_tracker_manager() AND (tracker_row.stage_changed_at::date + (_day_number - 1)) <> current_date THEN RAISE EXCEPTION 'Only today''s monitoring checklist can be edited'; END IF;
  IF EXISTS (SELECT 1 FROM generate_series(1, _day_number - 1) n WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = _tracker_id AND d.day_number = n AND d.result IN ('green','red'))) THEN day_result := 'red';
  ELSE
    all_checked := coalesce((_checklist->>'Business Profile')::boolean,false) AND coalesce((_checklist->>'Product List')::boolean,false) AND coalesce((_checklist->>'Availability')::boolean,false) AND coalesce((_checklist->>'Performance')::boolean,false) AND coalesce((_checklist->>'Energy')::boolean,false) AND coalesce((_checklist->>'OAE')::boolean,false);
    day_result := CASE WHEN all_checked THEN 'green' ELSE 'red' END;
  END IF;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by) VALUES (_tracker_id, _day_number, _checklist, day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days AND bool_and(result = 'green') INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
    VALUES (_tracker_id, 'All required monitoring days were completed successfully; moved automatically to Insights Shared.', 'Monitoring', auth.uid())
    RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_board()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'site_id', a.site_id, 'stage', a.stage, 'stage_changed_at', a.stage_changed_at,
    'company_name', coalesce(s.company_name, s.name), 'city', s.city,
    'assignee_id', a.assignee_id, 'assignee_name', p.name,
    'comments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'stage', c.stage, 'created_at', c.created_at, 'author', cp.name) ORDER BY c.created_at DESC), '[]'::jsonb) FROM public.company_tracker_comments c LEFT JOIN public.profiles cp ON cp.id = c.author_id WHERE c.tracker_id = a.id),
    'monitoring_days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day_number', d.day_number, 'checklist', d.checklist, 'result', d.result, 'completed_at', d.completed_at) ORDER BY d.day_number), '[]'::jsonb) FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = a.id)
  ) ORDER BY a.updated_at DESC), '[]'::jsonb)
  FROM public.company_tracker_assignments a
  JOIN public.sites s ON s.id = a.site_id
  LEFT JOIN public.profiles p ON p.id = a.assignee_id
  WHERE public.is_company_tracker_manager() OR a.assignee_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name)) ORDER BY coalesce(s.company_name, s.name)) FROM public.sites s), '[]'::jsonb),
    'users', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, p.email)) ORDER BY coalesce(p.name, p.email)) FROM public.profiles p WHERE p.is_active), '[]'::jsonb)
  )
  WHERE public.is_company_tracker_manager()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assign(UUID, UUID), public.company_tracker_add_comment(UUID, TEXT), public.company_tracker_transition(UUID, TEXT, BOOLEAN), public.company_tracker_save_monitoring(UUID, INTEGER, JSONB), public.company_tracker_board(), public.company_tracker_assignment_options() TO authenticated;


-- Source migration: 20260922093000_company_tracker_assignment_guards.sql
-- Prevent a company from being tracked twice. Managers can remove an assignment
-- first if it was created in error, then assign it again if required.
CREATE OR REPLACE FUNCTION public.company_tracker_assign(_site_id UUID, _assignee_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can assign companies'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id) THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _assignee_id AND is_active) THEN RAISE EXCEPTION 'Assignee must be an active user'; END IF;
  IF EXISTS (SELECT 1 FROM public.company_tracker_assignments WHERE site_id = _site_id) THEN
    RAISE EXCEPTION 'This company is already in the tracker. Delete its tracker record before assigning it again.';
  END IF;
  INSERT INTO public.company_tracker_assignments(site_id, assignee_id, stage, stage_changed_at, created_by)
  VALUES (_site_id, _assignee_id, 'Issue Resolution', now(), auth.uid())
  RETURNING id INTO tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual)
  VALUES (tracker_id, NULL, 'Issue Resolution', auth.uid(), false);
  RETURN tracker_id;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name)) ORDER BY coalesce(s.company_name, s.name)) FROM public.sites s WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_assignments a WHERE a.site_id = s.id)), '[]'::jsonb),
    'users', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, p.email)) ORDER BY coalesce(p.name, p.email)) FROM public.profiles p WHERE p.is_active), '[]'::jsonb)
  )
  WHERE public.is_company_tracker_manager()
$$;

CREATE OR REPLACE FUNCTION public.company_tracker_delete(_tracker_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can delete tracker records'; END IF;
  DELETE FROM public.company_tracker_assignments WHERE id = _tracker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker record was not found'; END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assign(UUID, UUID), public.company_tracker_assignment_options(), public.company_tracker_delete(UUID) TO authenticated;


-- Source migration: 20260922094000_company_tracker_reuse_stage_comment.sql
-- When a user has already added a comment in the current stage, reuse that
-- comment as the required transition note instead of creating a duplicate.
CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id UUID, _comment TEXT, _manual BOOLEAN DEFAULT true)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; next_stage TEXT; comment_id UUID;
BEGIN
  IF trim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  next_stage := CASE current_stage WHEN 'Issue Resolution' THEN 'Monitoring' WHEN 'Monitoring' THEN 'Insights Shared' WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' WHEN 'Quotation Sent' THEN 'Converted' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  SELECT id INTO comment_id FROM public.company_tracker_comments
  WHERE tracker_id = _tracker_id AND stage = current_stage AND body = trim(_comment)
  ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
    VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  END IF;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual)
  VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_transition(UUID, TEXT, BOOLEAN) TO authenticated;


-- Source migration: 20260922100000_company_tracker_oee_and_previous_stage.sql
-- Permanently rename the monitoring field while preserving completed checklists.
UPDATE public.company_tracker_monitoring_days
SET checklist = (jsonb_set(checklist, '{OEE}', checklist->'OAE', true) - 'OAE')
WHERE checklist ? 'OAE';

CREATE OR REPLACE FUNCTION public.company_tracker_save_monitoring(_tracker_id UUID, _day_number INTEGER, _checklist JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_row public.company_tracker_assignments; all_checked BOOLEAN; day_result TEXT; has_red BOOLEAN; total_days INTEGER; all_green BOOLEAN; automatic_comment_id UUID;
BEGIN
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;
  IF NOT public.is_company_tracker_manager() AND (tracker_row.stage_changed_at::date + (_day_number - 1)) <> current_date THEN RAISE EXCEPTION 'Only today''s monitoring checklist can be edited'; END IF;
  IF EXISTS (SELECT 1 FROM generate_series(1, _day_number - 1) n WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = _tracker_id AND d.day_number = n AND d.result IN ('green','red'))) THEN day_result := 'red';
  ELSE
    all_checked := coalesce((_checklist->>'Business Profile')::boolean,false) AND coalesce((_checklist->>'Product List')::boolean,false) AND coalesce((_checklist->>'Availability')::boolean,false) AND coalesce((_checklist->>'Performance')::boolean,false) AND coalesce((_checklist->>'Energy')::boolean,false) AND coalesce((_checklist->>'OEE')::boolean,false);
    day_result := CASE WHEN all_checked THEN 'green' ELSE 'red' END;
  END IF;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by) VALUES (_tracker_id, _day_number, _checklist, day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days AND bool_and(result = 'green') INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, 'All required monitoring days were completed successfully; moved automatically to Insights Shared.', 'Monitoring', auth.uid()) RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_move_previous(_tracker_id UUID, _comment TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; previous_stage_value TEXT; comment_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can move a company to a previous stage'; END IF;
  IF trim(coalesce(_comment, '')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker record was not found'; END IF;
  SELECT previous_stage INTO previous_stage_value FROM public.company_tracker_stage_history WHERE tracker_id = _tracker_id AND new_stage = current_stage AND previous_stage IS NOT NULL ORDER BY changed_at DESC LIMIT 1;
  IF previous_stage_value IS NULL THEN RAISE EXCEPTION 'There is no previous stage for this company'; END IF;
  INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  UPDATE public.company_tracker_assignments SET stage = previous_stage_value, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, current_stage, previous_stage_value, auth.uid(), comment_id, true);
  RETURN previous_stage_value;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_save_monitoring(UUID, INTEGER, JSONB), public.company_tracker_move_previous(UUID, TEXT) TO authenticated;


-- Source migration: 20260922103000_label_previous_stage_comments.sql
-- Label existing rollback comments clearly in the comment history.
UPDATE public.company_tracker_comments c
SET stage = 'Previous stage: ' || h.previous_stage || ' → ' || h.new_stage
FROM public.company_tracker_stage_history h
WHERE h.comment_id = c.id
  AND array_position(ARRAY['Issue Resolution','Monitoring','Insights Shared','Meeting Planned','Quotation Sent','Converted'], h.new_stage)
    < array_position(ARRAY['Issue Resolution','Monitoring','Insights Shared','Meeting Planned','Quotation Sent','Converted'], h.previous_stage);

CREATE OR REPLACE FUNCTION public.company_tracker_move_previous(_tracker_id UUID, _comment TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; previous_stage_value TEXT; comment_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can move a company to a previous stage'; END IF;
  IF trim(coalesce(_comment, '')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker record was not found'; END IF;
  SELECT previous_stage INTO previous_stage_value FROM public.company_tracker_stage_history WHERE tracker_id = _tracker_id AND new_stage = current_stage AND previous_stage IS NOT NULL ORDER BY changed_at DESC LIMIT 1;
  IF previous_stage_value IS NULL THEN RAISE EXCEPTION 'There is no previous stage for this company'; END IF;
  INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
  VALUES (_tracker_id, trim(_comment), 'Previous stage: ' || current_stage || ' → ' || previous_stage_value, auth.uid())
  RETURNING id INTO comment_id;
  UPDATE public.company_tracker_assignments SET stage = previous_stage_value, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, current_stage, previous_stage_value, auth.uid(), comment_id, true);
  RETURN previous_stage_value;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_move_previous(UUID, TEXT) TO authenticated;


-- Source migration: 20260922110000_rework_tracker_issue_and_monitoring.sql
-- One-time Issue Resolution checklist.
CREATE TABLE public.company_tracker_issue_resolution (
  tracker_id UUID PRIMARY KEY REFERENCES public.company_tracker_assignments(id) ON DELETE CASCADE,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.company_tracker_issue_resolution ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.company_tracker_issue_resolution TO authenticated;
CREATE POLICY "Tracker issue resolution read access" ON public.company_tracker_issue_resolution FOR SELECT TO authenticated USING (public.can_access_company_tracker(tracker_id));

CREATE OR REPLACE FUNCTION public.company_tracker_complete_issue_resolution(_tracker_id UUID, _checklist JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE all_checked BOOLEAN; current_stage TEXT;
BEGIN
  IF NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF current_stage IS DISTINCT FROM 'Issue Resolution' THEN RAISE EXCEPTION 'Issue Resolution is not active'; END IF;
  all_checked := coalesce((_checklist->>'Business Profile')::boolean,false) AND coalesce((_checklist->>'Product List')::boolean,false) AND coalesce((_checklist->>'Availability')::boolean,false) AND coalesce((_checklist->>'Performance')::boolean,false) AND coalesce((_checklist->>'Energy')::boolean,false) AND coalesce((_checklist->>'OEE')::boolean,false);
  INSERT INTO public.company_tracker_issue_resolution(tracker_id, checklist, completed_at, completed_by)
  VALUES (_tracker_id, _checklist, CASE WHEN all_checked THEN now() ELSE NULL END, CASE WHEN all_checked THEN auth.uid() ELSE NULL END)
  ON CONFLICT (tracker_id) DO UPDATE SET checklist = EXCLUDED.checklist, completed_at = EXCLUDED.completed_at, completed_by = EXCLUDED.completed_by;
  IF NOT all_checked THEN RETURN 'pending'; END IF;
  UPDATE public.company_tracker_assignments SET stage = 'Monitoring', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual) VALUES (_tracker_id, 'Issue Resolution', 'Monitoring', auth.uid(), false);
  RETURN 'Monitoring';
END; $$;

-- Monitoring has one outcome per calendar day. A missed prior day makes the
-- current day red, which extends the cycle from six total days to eleven.
CREATE OR REPLACE FUNCTION public.company_tracker_complete_monitoring_day(_tracker_id UUID, _day_number INTEGER, _outcome TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_row public.company_tracker_assignments; day_result TEXT; has_red BOOLEAN; total_days INTEGER; all_green BOOLEAN; automatic_comment_id UUID; expected_day INTEGER;
BEGIN
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _outcome NOT IN ('work', 'leave') THEN RAISE EXCEPTION 'Select Work perfect or Leave'; END IF;
  expected_day := (current_date - tracker_row.stage_changed_at::date) + 1;
  IF _day_number <> expected_day THEN RAISE EXCEPTION 'Only the current monitoring day can be completed'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  SELECT _tracker_id, n, jsonb_build_object('outcome', 'missed'), 'red', now(), auth.uid()
  FROM generate_series(1, _day_number - 1) n
  WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = _tracker_id AND d.day_number = n)
  ON CONFLICT (tracker_id, day_number) DO NOTHING;
  day_result := CASE WHEN _outcome = 'leave' THEN 'red' ELSE 'green' END;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  VALUES (_tracker_id, _day_number, jsonb_build_object('outcome', _outcome), day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, 'The required monitoring cycle was completed; moved automatically to Insights Shared.', 'Monitoring', auth.uid()) RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id UUID, _comment TEXT, _manual BOOLEAN DEFAULT true)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; next_stage TEXT; comment_id UUID;
BEGIN
  IF trim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF current_stage IN ('Issue Resolution', 'Monitoring') THEN RAISE EXCEPTION 'This stage advances automatically after its required checklist is complete'; END IF;
  next_stage := CASE current_stage WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' WHEN 'Quotation Sent' THEN 'Converted' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  SELECT id INTO comment_id FROM public.company_tracker_comments WHERE tracker_id = _tracker_id AND stage = current_stage AND body = trim(_comment) ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id; END IF;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_board()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'site_id', a.site_id, 'stage', a.stage, 'stage_changed_at', a.stage_changed_at,
    'company_name', coalesce(s.company_name, s.name), 'city', s.city, 'assignee_id', a.assignee_id, 'assignee_name', p.name,
    'issue_checklist', coalesce((SELECT ir.checklist FROM public.company_tracker_issue_resolution ir WHERE ir.tracker_id = a.id), '{}'::jsonb),
    'comments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'stage', c.stage, 'created_at', c.created_at, 'author', cp.name) ORDER BY c.created_at DESC), '[]'::jsonb) FROM public.company_tracker_comments c LEFT JOIN public.profiles cp ON cp.id = c.author_id WHERE c.tracker_id = a.id),
    'monitoring_days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day_number', d.day_number, 'checklist', d.checklist, 'result', d.result, 'completed_at', d.completed_at) ORDER BY d.day_number), '[]'::jsonb) FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = a.id)
  ) ORDER BY a.updated_at DESC), '[]'::jsonb)
  FROM public.company_tracker_assignments a JOIN public.sites s ON s.id = a.site_id LEFT JOIN public.profiles p ON p.id = a.assignee_id
  WHERE public.is_company_tracker_manager() OR a.assignee_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_complete_issue_resolution(UUID, JSONB), public.company_tracker_complete_monitoring_day(UUID, INTEGER, TEXT), public.company_tracker_transition(UUID, TEXT, BOOLEAN), public.company_tracker_board() TO authenticated;


-- Source migration: 20260923000000_monitoring_uses_india_calendar_day.sql
-- Monitoring-day progression is based on calendar dates in India, not elapsed
-- 24-hour intervals or the database server's timezone.
CREATE OR REPLACE FUNCTION public.company_tracker_complete_monitoring_day(_tracker_id UUID, _day_number INTEGER, _outcome TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_row public.company_tracker_assignments; day_result TEXT; has_red BOOLEAN; total_days INTEGER; all_green BOOLEAN; automatic_comment_id UUID; expected_day INTEGER;
BEGIN
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _outcome NOT IN ('work', 'leave') THEN RAISE EXCEPTION 'Select Work perfect or Leave'; END IF;

  expected_day := (((now() AT TIME ZONE 'Asia/Kolkata')::date - (tracker_row.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) + 1);
  IF _day_number <> expected_day THEN RAISE EXCEPTION 'Only the current monitoring day can be completed'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  SELECT _tracker_id, n, jsonb_build_object('outcome', 'missed'), 'red', now(), auth.uid()
  FROM generate_series(1, _day_number - 1) n
  WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = _tracker_id AND d.day_number = n)
  ON CONFLICT (tracker_id, day_number) DO NOTHING;
  day_result := CASE WHEN _outcome = 'leave' THEN 'red' ELSE 'green' END;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  VALUES (_tracker_id, _day_number, jsonb_build_object('outcome', _outcome), day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, 'The required monitoring cycle was completed; moved automatically to Insights Shared.', 'Monitoring', auth.uid()) RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;


-- Source migration: 20260923120000_rename_pending_works_and_choose_assignment_stage.sql
-- Rename the first Company Tracker stage while retaining all existing records.
ALTER TABLE public.company_tracker_assignments
  DROP CONSTRAINT IF EXISTS company_tracker_assignments_stage_check;

UPDATE public.company_tracker_assignments
SET stage = 'Pending Works'
WHERE stage = 'Issue Resolution';

UPDATE public.company_tracker_stage_history
SET previous_stage = 'Pending Works'
WHERE previous_stage = 'Issue Resolution';

UPDATE public.company_tracker_stage_history
SET new_stage = 'Pending Works'
WHERE new_stage = 'Issue Resolution';

UPDATE public.company_tracker_comments
SET stage = replace(stage, 'Issue Resolution', 'Pending Works')
WHERE stage LIKE '%Issue Resolution%';

ALTER TABLE public.company_tracker_assignments
  ADD CONSTRAINT company_tracker_assignments_stage_check
  CHECK (stage IN ('Pending Works', 'Monitoring', 'Insights Shared', 'Meeting Planned', 'Quotation Sent', 'Converted'));

-- A manager selects the initial tracker stage during assignment.
DROP FUNCTION IF EXISTS public.company_tracker_assign(UUID, UUID);

CREATE OR REPLACE FUNCTION public.company_tracker_assign(_site_id UUID, _assignee_id UUID, _stage TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tracker_id UUID;
BEGIN
  IF NOT public.is_company_tracker_manager() THEN RAISE EXCEPTION 'Only commissioning managers can assign companies'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id) THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _assignee_id AND is_active) THEN RAISE EXCEPTION 'Assignee must be an active user'; END IF;
  IF _stage NOT IN ('Pending Works', 'Monitoring', 'Insights Shared', 'Meeting Planned', 'Quotation Sent', 'Converted') THEN
    RAISE EXCEPTION 'Select a valid stage';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_tracker_assignments WHERE site_id = _site_id) THEN
    RAISE EXCEPTION 'This company is already in the tracker. Delete its tracker record before assigning it again.';
  END IF;

  INSERT INTO public.company_tracker_assignments(site_id, assignee_id, stage, stage_changed_at, created_by)
  VALUES (_site_id, _assignee_id, _stage, now(), auth.uid())
  RETURNING id INTO tracker_id;

  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual)
  VALUES (tracker_id, NULL, _stage, auth.uid(), false);

  RETURN tracker_id;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_complete_issue_resolution(_tracker_id UUID, _checklist JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE all_checked BOOLEAN; current_stage TEXT;
BEGIN
  IF NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF current_stage IS DISTINCT FROM 'Pending Works' THEN RAISE EXCEPTION 'Pending Works is not active'; END IF;
  all_checked := coalesce((_checklist->>'Business Profile')::boolean,false) AND coalesce((_checklist->>'Product List')::boolean,false) AND coalesce((_checklist->>'Availability')::boolean,false) AND coalesce((_checklist->>'Performance')::boolean,false) AND coalesce((_checklist->>'Energy')::boolean,false) AND coalesce((_checklist->>'OEE')::boolean,false);
  INSERT INTO public.company_tracker_issue_resolution(tracker_id, checklist, completed_at, completed_by)
  VALUES (_tracker_id, _checklist, CASE WHEN all_checked THEN now() ELSE NULL END, CASE WHEN all_checked THEN auth.uid() ELSE NULL END)
  ON CONFLICT (tracker_id) DO UPDATE SET checklist = EXCLUDED.checklist, completed_at = EXCLUDED.completed_at, completed_by = EXCLUDED.completed_by;
  IF NOT all_checked THEN RETURN 'pending'; END IF;
  UPDATE public.company_tracker_assignments SET stage = 'Monitoring', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, was_manual)
  VALUES (_tracker_id, 'Pending Works', 'Monitoring', auth.uid(), false);
  RETURN 'Monitoring';
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_transition(_tracker_id UUID, _comment TEXT, _manual BOOLEAN DEFAULT true)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_stage TEXT; next_stage TEXT; comment_id UUID;
BEGIN
  IF trim(coalesce(_comment,'')) = '' THEN RAISE EXCEPTION 'A comment is required to move stages'; END IF;
  SELECT stage INTO current_stage FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF current_stage IN ('Pending Works', 'Monitoring') THEN RAISE EXCEPTION 'This stage advances automatically after its required checklist is complete'; END IF;
  next_stage := CASE current_stage WHEN 'Insights Shared' THEN 'Meeting Planned' WHEN 'Meeting Planned' THEN 'Quotation Sent' WHEN 'Quotation Sent' THEN 'Converted' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'This company is already converted'; END IF;
  SELECT id INTO comment_id FROM public.company_tracker_comments WHERE tracker_id = _tracker_id AND stage = current_stage AND body = trim(_comment) ORDER BY created_at DESC LIMIT 1;
  IF comment_id IS NULL THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
    VALUES (_tracker_id, trim(_comment), current_stage, auth.uid()) RETURNING id INTO comment_id;
  END IF;
  UPDATE public.company_tracker_assignments SET stage = next_stage, stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
  INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual)
  VALUES (_tracker_id, current_stage, next_stage, auth.uid(), comment_id, _manual);
  RETURN next_stage;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assign(UUID, UUID, TEXT), public.company_tracker_complete_issue_resolution(UUID, JSONB), public.company_tracker_transition(UUID, TEXT, BOOLEAN) TO authenticated;


-- Source migration: 20260923123000_deduplicate_company_tracker_assignees.sql
-- Only active Field Associates can be selected in the Company Tracker.
CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name))
          ORDER BY coalesce(s.company_name, s.name)
        )
        FROM public.sites s
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.company_tracker_assignments a
          WHERE a.site_id = s.id
        )
      ),
      '[]'::jsonb
    ),
    'users', coalesce(
      (
        SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
        FROM (
          SELECT DISTINCT ON (lower(trim(coalesce(p.name, p.email))))
            p.id,
            coalesce(p.name, p.email) AS name
          FROM public.profiles p
          JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'worker'
          WHERE p.is_active
          ORDER BY lower(trim(coalesce(p.name, p.email))), p.created_at
        ) u
      ),
      '[]'::jsonb
    )
  )
  WHERE public.is_company_tracker_manager()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assignment_options() TO authenticated;


-- Source migration: 20260923140000_allow_manager_self_assignment.sql
-- Let a Company Tracker manager assign a company to themselves, active Field Associates, and other active managers.
CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name))
          ORDER BY coalesce(s.company_name, s.name)
        )
        FROM public.sites s
        WHERE NOT EXISTS (
          SELECT 1 FROM public.company_tracker_assignments a WHERE a.site_id = s.id
        )
      ),
      '[]'::jsonb
    ),
    'users', coalesce(
      (
        SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
        FROM (
          SELECT DISTINCT ON (lower(regexp_replace(trim(coalesce(candidate.name, candidate.email)), '[[:space:]]+', '', 'g')))
            candidate.id,
            coalesce(candidate.name, candidate.email) AS name
          FROM (
            SELECT p.id, p.name, p.email, p.created_at, true AS is_current_manager
            FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_active
            UNION ALL
            SELECT p.id, p.name, p.email, p.created_at, false AS is_current_manager
            FROM public.profiles p
            JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('worker', 'supervisor', 'owner')
            WHERE p.is_active
          ) candidate
          ORDER BY lower(regexp_replace(trim(coalesce(candidate.name, candidate.email)), '[[:space:]]+', '', 'g')), candidate.is_current_manager DESC, candidate.created_at
        ) u
      ),
      '[]'::jsonb
    )
  )
  WHERE public.is_company_tracker_manager()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assignment_options() TO authenticated;


-- Source migration: 20260923141000_deduplicate_company_tracker_assignee_names.sql
-- Treat spelling variations such as "Hitesh Bhai" and "HITESHBHAI" as one assignee.
CREATE OR REPLACE FUNCTION public.company_tracker_assignment_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', coalesce(s.company_name, s.name)) ORDER BY coalesce(s.company_name, s.name))
       FROM public.sites s
       WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_assignments a WHERE a.site_id = s.id)),
      '[]'::jsonb
    ),
    'users', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
       FROM (
         SELECT DISTINCT ON (lower(regexp_replace(trim(coalesce(candidate.name, candidate.email)), '[[:space:]]+', '', 'g')))
           candidate.id, coalesce(candidate.name, candidate.email) AS name
         FROM (
           SELECT p.id, p.name, p.email, p.created_at, true AS is_current_manager
           FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active
           UNION ALL
           SELECT p.id, p.name, p.email, p.created_at, false AS is_current_manager
           FROM public.profiles p
           JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('worker', 'supervisor', 'owner')
           WHERE p.is_active
         ) candidate
         ORDER BY lower(regexp_replace(trim(coalesce(candidate.name, candidate.email)), '[[:space:]]+', '', 'g')), candidate.is_current_manager DESC, candidate.created_at
       ) u),
      '[]'::jsonb
    )
  )
  WHERE public.is_company_tracker_manager()
$$;

GRANT EXECUTE ON FUNCTION public.company_tracker_assignment_options() TO authenticated;


-- Source migration: 20260925090000_add_field_visit_scheduler.sql
-- Isolated scheduler: it does not alter sites, appointments, assignments,
-- phase forms, or Company Tracker records.
CREATE TABLE IF NOT EXISTS public.field_visit_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  assignee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  visit_type TEXT NOT NULL CHECK (visit_type IN ('assessment', 'installation', 'commissioning')),
  scheduled_for DATE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'emergency')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'delayed')),
  note TEXT,
  delay_reason TEXT,
  manager_due_date DATE,
  manager_note TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS field_visit_schedules_assignee_date_idx ON public.field_visit_schedules (assignee_id, scheduled_for);
ALTER TABLE public.field_visit_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.field_visit_schedules TO authenticated;
DROP POLICY IF EXISTS "Field visit schedules visible to assignee and staff" ON public.field_visit_schedules;
CREATE POLICY "Field visit schedules visible to assignee and staff" ON public.field_visit_schedules FOR SELECT TO authenticated USING (assignee_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.field_visit_schedule_board()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'site_id', v.site_id, 'company_name', coalesce(s.company_name, s.name), 'city', s.city,
    'assignee_id', v.assignee_id, 'assignee_name', p.name, 'visit_type', v.visit_type,
    'scheduled_for', v.scheduled_for, 'priority', v.priority, 'status', v.status, 'note', v.note,
    'delay_reason', v.delay_reason, 'manager_due_date', v.manager_due_date, 'manager_note', v.manager_note,
    'created_at', v.created_at, 'completed_at', v.completed_at
  ) ORDER BY v.scheduled_for, v.created_at DESC), '[]'::jsonb)
  FROM public.field_visit_schedules v JOIN public.sites s ON s.id = v.site_id
  LEFT JOIN public.profiles p ON p.id = v.assignee_id
  WHERE public.is_staff(auth.uid()) OR v.assignee_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.field_visit_schedule_options()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'site_id', s.id, 'company_name', coalesce(s.company_name, s.name), 'assignee_id', s.assigned_worker_id,
      'status', CASE
        WHEN coalesce(c.data->>'commissioning_phase_submitted', 'false') = 'true' THEN 'Commissioned'
        WHEN coalesce(i.data->>'installation_phase_submitted', 'false') = 'true' THEN 'Installed'
        WHEN coalesce(a.data->>'assessment_phase_submitted', 'false') = 'true' THEN 'Assessed'
        ELSE 'Not Started'
      END
    ) ORDER BY coalesce(s.company_name, s.name))
    FROM public.sites s
    LEFT JOIN public.assessment a ON a.site_id = s.id
    LEFT JOIN public.installation i ON i.site_id = s.id
    LEFT JOIN public.commissioning c ON c.site_id = s.id
    WHERE public.is_staff(auth.uid()) OR s.assigned_worker_id = auth.uid()), '[]'::jsonb),
    'users', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, p.email)) ORDER BY coalesce(p.name, p.email)) FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'worker' WHERE p.is_active), '[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.field_visit_schedule_create(_site_id UUID, _visit_type TEXT, _scheduled_for DATE, _note TEXT DEFAULT NULL, _assignee_id UUID DEFAULT NULL, _priority TEXT DEFAULT 'normal', _manager_due_date DATE DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE visit_id UUID; visit_assignee UUID;
BEGIN
  IF _visit_type NOT IN ('assessment', 'installation', 'commissioning') THEN RAISE EXCEPTION 'Select a valid visit type'; END IF;
  IF _scheduled_for IS NULL THEN RAISE EXCEPTION 'Select a visit date'; END IF;
  IF _priority NOT IN ('normal', 'high', 'emergency') THEN RAISE EXCEPTION 'Select a valid priority'; END IF;
  IF public.is_staff(auth.uid()) THEN
    visit_assignee := _assignee_id;
    IF visit_assignee IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'worker' WHERE p.id = visit_assignee AND p.is_active) THEN RAISE EXCEPTION 'Select an active Field Associate'; END IF;
  ELSE
    visit_assignee := auth.uid();
    IF _assignee_id IS NOT NULL OR _priority <> 'normal' OR NOT EXISTS (SELECT 1 FROM public.sites WHERE id = _site_id AND assigned_worker_id = auth.uid()) THEN RAISE EXCEPTION 'You can schedule only your assigned companies'; END IF;
  END IF;
  INSERT INTO public.field_visit_schedules(site_id, assignee_id, visit_type, scheduled_for, note, created_by)
  VALUES (_site_id, visit_assignee, _visit_type, _scheduled_for, nullif(trim(coalesce(_note, '')), ''), auth.uid()) RETURNING id INTO visit_id;
  UPDATE public.field_visit_schedules SET priority = _priority, manager_due_date = CASE WHEN public.is_staff(auth.uid()) THEN _manager_due_date ELSE NULL END WHERE id = visit_id;
  RETURN visit_id;
END; $$;

CREATE OR REPLACE FUNCTION public.field_visit_schedule_update_status(_visit_id UUID, _status TEXT, _delay_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _status NOT IN ('scheduled', 'completed', 'delayed') THEN RAISE EXCEPTION 'Select a valid status'; END IF;
  IF _status = 'delayed' AND trim(coalesce(_delay_reason, '')) = '' THEN RAISE EXCEPTION 'A delay reason is required'; END IF;
  -- Completion is always recorded by the assigned Field Associate. This also
  -- lets a dual-role user complete their own visit from the manager tracker.
  UPDATE public.field_visit_schedules SET status = _status, delay_reason = CASE WHEN _status = 'delayed' THEN trim(_delay_reason) ELSE NULL END, completed_at = CASE WHEN _status = 'completed' THEN now() ELSE NULL END, updated_at = now() WHERE id = _visit_id AND assignee_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit not found or access denied'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.field_visit_schedule_set_priority(_visit_id UUID, _priority TEXT, _manager_due_date DATE DEFAULT NULL, _manager_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Only managers can set priority'; END IF;
  IF _priority NOT IN ('normal', 'high', 'emergency') THEN RAISE EXCEPTION 'Select a valid priority'; END IF;
  UPDATE public.field_visit_schedules SET priority = _priority, manager_due_date = _manager_due_date, manager_note = nullif(trim(coalesce(_manager_note, '')), ''), updated_at = now() WHERE id = _visit_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit not found'; END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.field_visit_schedule_board(), public.field_visit_schedule_options(), public.field_visit_schedule_create(UUID, TEXT, DATE, TEXT, UUID, TEXT, DATE), public.field_visit_schedule_update_status(UUID, TEXT, TEXT), public.field_visit_schedule_set_priority(UUID, TEXT, DATE, TEXT) TO authenticated;


-- Source migration: 20260925100000_add_field_visit_schedule_delete.sql
-- A manager may remove one scheduled priority visit without touching any other visits.
CREATE OR REPLACE FUNCTION public.field_visit_schedule_delete(_visit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers can delete priority visits';
  END IF;

  DELETE FROM public.field_visit_schedules WHERE id = _visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.field_visit_schedule_delete(UUID) TO authenticated;


-- Source migration: 20260928120000_mark_missed_monitoring_days_at_noon.sql
-- A monitoring outcome is due by 12:00 PM India time. When it has not been
-- recorded by then, preserve the existing missed-day behaviour by recording it
-- as a red Leave/Absent outcome. The board runs this reconciliation before it
-- is returned, so the status is persisted as soon as the tracker is opened.
CREATE OR REPLACE FUNCTION public.company_tracker_mark_missed_monitoring_days()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  india_now TIMESTAMP;
  tracker_row RECORD;
  due_day INTEGER;
  has_red BOOLEAN;
  total_days INTEGER;
  completed_days INTEGER;
  automatic_comment_id UUID;
BEGIN
  india_now := now() AT TIME ZONE 'Asia/Kolkata';
  IF india_now::time < TIME '12:00' THEN RETURN; END IF;

  FOR tracker_row IN
    SELECT id, stage_changed_at
    FROM public.company_tracker_assignments
    WHERE stage = 'Monitoring'
    FOR UPDATE
  LOOP
    due_day := LEAST(11, ((india_now::date - (tracker_row.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) + 1));
    IF due_day < 1 THEN CONTINUE; END IF;

    INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
    SELECT tracker_row.id, n, jsonb_build_object('outcome', 'missed'), 'red', now(), auth.uid()
    FROM generate_series(1, due_day) n
    WHERE NOT EXISTS (
      SELECT 1 FROM public.company_tracker_monitoring_days d
      WHERE d.tracker_id = tracker_row.id AND d.day_number = n
    )
    ON CONFLICT (tracker_id, day_number) DO NOTHING;

    SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = tracker_row.id AND result = 'red') INTO has_red;
    total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
    SELECT count(*) INTO completed_days FROM public.company_tracker_monitoring_days WHERE tracker_id = tracker_row.id AND day_number <= total_days;
    IF completed_days = total_days THEN
      INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
      VALUES (tracker_row.id, 'The required monitoring cycle was completed; moved automatically to Insights Shared.', 'Monitoring', auth.uid())
      RETURNING id INTO automatic_comment_id;
      UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = tracker_row.id;
      INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual)
      VALUES (tracker_row.id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_complete_monitoring_day(_tracker_id UUID, _day_number INTEGER, _outcome TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tracker_row public.company_tracker_assignments;
  day_result TEXT;
  has_red BOOLEAN;
  total_days INTEGER;
  all_green BOOLEAN;
  automatic_comment_id UUID;
  expected_day INTEGER;
  india_now TIMESTAMP;
BEGIN
  -- A stale screen cannot overwrite the red result assigned at noon.
  PERFORM public.company_tracker_mark_missed_monitoring_days();
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _outcome NOT IN ('work', 'leave') THEN RAISE EXCEPTION 'Select Work perfect or Leave'; END IF;

  india_now := now() AT TIME ZONE 'Asia/Kolkata';
  expected_day := ((india_now::date - (tracker_row.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) + 1);
  IF _day_number <> expected_day THEN RAISE EXCEPTION 'Only the current monitoring day can be completed'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;
  IF india_now::time >= TIME '12:00' THEN
    SELECT result INTO day_result FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number = _day_number;
    RETURN coalesce(day_result, 'red');
  END IF;

  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  SELECT _tracker_id, n, jsonb_build_object('outcome', 'missed'), 'red', now(), auth.uid()
  FROM generate_series(1, _day_number - 1) n
  WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = _tracker_id AND d.day_number = n)
  ON CONFLICT (tracker_id, day_number) DO NOTHING;
  day_result := CASE WHEN _outcome = 'leave' THEN 'red' ELSE 'green' END;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  VALUES (_tracker_id, _day_number, jsonb_build_object('outcome', _outcome), day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, 'The required monitoring cycle was completed; moved automatically to Insights Shared.', 'Monitoring', auth.uid()) RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_board()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE board JSONB;
BEGIN
  PERFORM public.company_tracker_mark_missed_monitoring_days();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'site_id', a.site_id, 'stage', a.stage, 'stage_changed_at', a.stage_changed_at,
    'company_name', coalesce(s.company_name, s.name), 'city', s.city, 'assignee_id', a.assignee_id, 'assignee_name', p.name,
    'issue_checklist', coalesce((SELECT ir.checklist FROM public.company_tracker_issue_resolution ir WHERE ir.tracker_id = a.id), '{}'::jsonb),
    'comments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'stage', c.stage, 'created_at', c.created_at, 'author', cp.name) ORDER BY c.created_at DESC), '[]'::jsonb) FROM public.company_tracker_comments c LEFT JOIN public.profiles cp ON cp.id = c.author_id WHERE c.tracker_id = a.id),
    'monitoring_days', (SELECT coalesce(jsonb_agg(jsonb_build_object('day_number', d.day_number, 'checklist', d.checklist, 'result', d.result, 'completed_at', d.completed_at) ORDER BY d.day_number), '[]'::jsonb) FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = a.id)
  ) ORDER BY a.updated_at DESC), '[]'::jsonb) INTO board
  FROM public.company_tracker_assignments a JOIN public.sites s ON s.id = a.site_id LEFT JOIN public.profiles p ON p.id = a.assignee_id
  WHERE public.is_company_tracker_manager() OR a.assignee_id = auth.uid();
  RETURN board;
END; $$;

REVOKE EXECUTE ON FUNCTION public.company_tracker_mark_missed_monitoring_days() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_tracker_complete_monitoring_day(UUID, INTEGER, TEXT), public.company_tracker_board() TO authenticated;


-- Source migration: 20260928130000_mark_monitoring_days_after_midnight.sql
-- Monitoring days stay editable for the complete India calendar day. At
-- 00:00 IST on the following date, any unfinished previous day is recorded as
-- missed. This replaces the earlier 12:00 PM cutoff.
CREATE OR REPLACE FUNCTION public.company_tracker_mark_missed_monitoring_days()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  india_now TIMESTAMP;
  tracker_row RECORD;
  due_day INTEGER;
  has_red BOOLEAN;
  total_days INTEGER;
  completed_days INTEGER;
  automatic_comment_id UUID;
BEGIN
  india_now := now() AT TIME ZONE 'Asia/Kolkata';

  FOR tracker_row IN
    SELECT id, stage_changed_at
    FROM public.company_tracker_assignments
    WHERE stage = 'Monitoring'
    FOR UPDATE
  LOOP
    -- On Day N, only Days 1 through N-1 are overdue. Day N remains editable
    -- until India reaches midnight and begins Day N+1.
    due_day := LEAST(11, india_now::date - (tracker_row.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date);
    IF due_day < 1 THEN CONTINUE; END IF;

    INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
    SELECT tracker_row.id, n, jsonb_build_object('outcome', 'missed'), 'red', now(), auth.uid()
    FROM generate_series(1, due_day) n
    WHERE NOT EXISTS (
      SELECT 1 FROM public.company_tracker_monitoring_days d
      WHERE d.tracker_id = tracker_row.id AND d.day_number = n
    )
    ON CONFLICT (tracker_id, day_number) DO NOTHING;

    SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = tracker_row.id AND result = 'red') INTO has_red;
    total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
    SELECT count(*) INTO completed_days FROM public.company_tracker_monitoring_days WHERE tracker_id = tracker_row.id AND day_number <= total_days;
    IF completed_days = total_days THEN
      INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id)
      VALUES (tracker_row.id, 'The required monitoring cycle was completed; moved automatically to Insights Shared.', 'Monitoring', auth.uid())
      RETURNING id INTO automatic_comment_id;
      UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = tracker_row.id;
      INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual)
      VALUES (tracker_row.id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.company_tracker_complete_monitoring_day(_tracker_id UUID, _day_number INTEGER, _outcome TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tracker_row public.company_tracker_assignments;
  day_result TEXT;
  has_red BOOLEAN;
  total_days INTEGER;
  all_green BOOLEAN;
  automatic_comment_id UUID;
  expected_day INTEGER;
  india_now TIMESTAMP;
BEGIN
  PERFORM public.company_tracker_mark_missed_monitoring_days();
  SELECT * INTO tracker_row FROM public.company_tracker_assignments WHERE id = _tracker_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company_tracker(_tracker_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF tracker_row.stage <> 'Monitoring' THEN RAISE EXCEPTION 'Monitoring is not active'; END IF;
  IF _outcome NOT IN ('work', 'leave') THEN RAISE EXCEPTION 'Select Work perfect or Leave'; END IF;

  india_now := now() AT TIME ZONE 'Asia/Kolkata';
  expected_day := (india_now::date - (tracker_row.stage_changed_at AT TIME ZONE 'Asia/Kolkata')::date) + 1;
  IF _day_number <> expected_day THEN RAISE EXCEPTION 'Only the current monitoring day can be completed'; END IF;
  IF _day_number < 1 OR _day_number > 11 THEN RAISE EXCEPTION 'Invalid monitoring day'; END IF;

  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  SELECT _tracker_id, n, jsonb_build_object('outcome', 'missed'), 'red', now(), auth.uid()
  FROM generate_series(1, _day_number - 1) n
  WHERE NOT EXISTS (SELECT 1 FROM public.company_tracker_monitoring_days d WHERE d.tracker_id = _tracker_id AND d.day_number = n)
  ON CONFLICT (tracker_id, day_number) DO NOTHING;
  day_result := CASE WHEN _outcome = 'leave' THEN 'red' ELSE 'green' END;
  INSERT INTO public.company_tracker_monitoring_days(tracker_id, day_number, checklist, result, completed_at, completed_by)
  VALUES (_tracker_id, _day_number, jsonb_build_object('outcome', _outcome), day_result, now(), auth.uid())
  ON CONFLICT (tracker_id, day_number) DO UPDATE SET checklist = EXCLUDED.checklist, result = EXCLUDED.result, completed_at = now(), completed_by = auth.uid();
  SELECT EXISTS(SELECT 1 FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND result = 'red') INTO has_red;
  total_days := CASE WHEN has_red THEN 11 ELSE 6 END;
  SELECT count(*) = total_days INTO all_green FROM public.company_tracker_monitoring_days WHERE tracker_id = _tracker_id AND day_number <= total_days;
  IF all_green THEN
    INSERT INTO public.company_tracker_comments(tracker_id, body, stage, author_id) VALUES (_tracker_id, 'The required monitoring days were completed successfully; moved automatically to Insights Shared.', 'Monitoring', auth.uid()) RETURNING id INTO automatic_comment_id;
    UPDATE public.company_tracker_assignments SET stage = 'Insights Shared', stage_changed_at = now(), updated_at = now() WHERE id = _tracker_id;
    INSERT INTO public.company_tracker_stage_history(tracker_id, previous_stage, new_stage, changed_by, comment_id, was_manual) VALUES (_tracker_id, 'Monitoring', 'Insights Shared', auth.uid(), automatic_comment_id, false);
    RETURN 'Insights Shared';
  END IF;
  RETURN day_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.company_tracker_complete_monitoring_day(UUID, INTEGER, TEXT) TO authenticated;


-- Source migration: 20261005120000_field_operations_attendance_earnings.sql
-- Additive field operations. Existing phase submission/approval RPCs are unchanged.


CREATE TABLE public.field_attendance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  associate_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  online BOOLEAN NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  work_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date
);
CREATE TABLE public.field_operations_rollout (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.field_operations_rollout DEFAULT VALUES;
CREATE INDEX ON public.field_attendance_events(associate_id, work_date, occurred_at DESC);
CREATE TABLE public.field_work_rates (
  associate_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  assessment NUMERIC(12,2) NOT NULL CHECK (assessment >= 0),
  installation NUMERIC(12,2) NOT NULL CHECK (installation >= 0),
  commissioning NUMERIC(12,2) NOT NULL CHECK (commissioning >= 0),
  updated_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.field_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES public.sites(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  associate_id UUID NOT NULL,
  associate_name TEXT NOT NULL,
  associate_joined TIMESTAMPTZ NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('assessment','installation','commissioning')),
  completed_at TIMESTAMPTZ NOT NULL,
  earning_date DATE NOT NULL,
  amount NUMERIC(12,2) CHECK (amount >= 0),
  eligible BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(site_id, phase)
);
CREATE INDEX ON public.field_earnings(associate_id, earning_date);
CREATE TABLE public.field_earning_date_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_id UUID NOT NULL REFERENCES public.field_earnings(id),
  old_date DATE NOT NULL,
  new_date DATE NOT NULL,
  reason TEXT NOT NULL,
  actor_id UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Clearance is a manual payment record, never a transfer of money.
CREATE TABLE public.field_payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  associate_id UUID NOT NULL,
  period_end DATE NOT NULL CHECK (extract(day FROM period_end) = 15),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  reference TEXT,
  recorded_by UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(associate_id, period_end)
);
CREATE TABLE public.field_payment_items (
  payment_id UUID NOT NULL REFERENCES public.field_payment_records(id),
  earning_id UUID PRIMARY KEY REFERENCES public.field_earnings(id),
  amount NUMERIC(12,2) NOT NULL
);

ALTER TABLE public.field_visit_schedules ADD COLUMN shift TEXT;
ALTER TABLE public.field_visit_schedules ADD COLUMN expected_arrival TIME;
ALTER TABLE public.field_visit_schedules ADD COLUMN expected_end TIME;
ALTER TABLE public.field_visit_schedules ADD CONSTRAINT field_visit_time_order CHECK (
  expected_arrival IS NULL OR expected_end > expected_arrival
);

-- Parse only the metadata block used by the application; free-form notes stay untouched.
CREATE FUNCTION public.field_ops_site_metadata(_notes TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE raw TEXT; pos INT; start_pos INT; depth INT := 0; quoted BOOLEAN := false; escaped BOOLEAN := false; ch TEXT;
BEGIN
  pos := position('[METADATA:' IN coalesce(_notes,''));
  IF pos > 0 THEN
    start_pos := pos + length('[METADATA:');
    FOR pos IN start_pos..length(_notes) LOOP
      ch := substring(_notes,pos,1);
      IF escaped THEN escaped := false;
      ELSIF quoted AND ch = chr(92) THEN escaped := true;
      ELSIF ch = '"' THEN quoted := NOT quoted;
      ELSIF NOT quoted AND ch = '{' THEN depth := depth + 1;
      ELSIF NOT quoted AND ch = '}' THEN
        depth := depth - 1;
        IF depth = 0 THEN raw := substring(_notes,start_pos,pos-start_pos+1); EXIT; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN coalesce(raw::jsonb,'{}'::jsonb);
EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION public.field_ops_worker_ids(_site public.sites) RETURNS UUID[]
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE result UUID[];
BEGIN
  BEGIN
    SELECT array_agg(value::uuid) INTO result FROM jsonb_array_elements_text(public.field_ops_site_metadata(_site.task_notes)->'worker_ids');
  EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN result := NULL;
  END;
  RETURN coalesce(result, ARRAY[_site.assigned_worker_id]::uuid[]);
END $$;
CREATE FUNCTION public.field_ops_site_active(_site public.sites) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT lower(coalesce(public.field_ops_site_metadata(_site.task_notes)->>'status','')) !~ '(drop|reject)'
    AND lower(coalesce(_site.consultant_stage,'')) !~ '(drop|reject)'
$$;
CREATE FUNCTION public.field_ops_associate(_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM profiles p WHERE p.id = _id AND p.is_active)
    AND public.has_role(_id, 'worker') AND NOT public.is_staff(_id)
$$;
CREATE FUNCTION public.field_ops_period_end(_date DATE) RETURNS DATE
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (date_trunc('month', _date)::date +
    CASE WHEN extract(day FROM _date) > 15 THEN interval '1 month' ELSE interval '0 month' END + interval '14 days')::date
$$;
CREATE FUNCTION public.field_ops_company_key(_name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(_name,'')),
    '^m/s\.?\s+|^ms\.?\s+','','g'), '\s+pvt\.?\s*ltd\.?|\s+private\s+limited','','g'),
    '\s+ltd\.?','','g'),'[^a-z0-9]','','g')
$$;
CREATE FUNCTION public.field_ops_phase_ready(_site UUID, _phase TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d JSONB;
BEGIN
  IF _phase = 'assessment' THEN
    SELECT data INTO d FROM assessment WHERE site_id = _site;
    RETURN coalesce(d @> '{"assessment_phase_submitted":true,"mom_uploaded":true,"media_uploaded":true,"factory_operations_done":true}', false)
      AND (coalesce(d->>'device_order_completed','false') = 'true' OR EXISTS (
        SELECT 1 FROM inventory_materials m JOIN sites s ON s.id = _site
        WHERE m.submitted = true AND (
          (length(public.field_ops_company_key(s.company_name)) > 0 AND length(public.field_ops_company_key(m.material_name)) > 0
          AND (position(public.field_ops_company_key(s.company_name) IN public.field_ops_company_key(m.material_name)) > 0
            OR position(public.field_ops_company_key(m.material_name) IN public.field_ops_company_key(s.company_name)) > 0))
          OR (length(public.field_ops_company_key(s.name)) > 0 AND length(public.field_ops_company_key(m.material_name)) > 0
          AND (position(public.field_ops_company_key(s.name) IN public.field_ops_company_key(m.material_name)) > 0
            OR position(public.field_ops_company_key(m.material_name) IN public.field_ops_company_key(s.name)) > 0))
        )
      ));
  ELSIF _phase = 'installation' THEN
    SELECT data INTO d FROM installation WHERE site_id = _site;
    RETURN coalesce(d @> '{"installation_phase_submitted":true,"coordination_done":true,"photos_uploaded":true}', false);
  ELSIF _phase = 'commissioning' THEN
    SELECT data INTO d FROM commissioning WHERE site_id = _site;
    RETURN coalesce(d->>'commissioning_phase_submitted','false') = 'true'
      AND EXISTS(SELECT 1 FROM commissioning_approval_requests WHERE site_id = _site AND status = 'approved');
  END IF;
  RETURN false;
END $$;

CREATE TABLE public.field_existing_completions (
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  PRIMARY KEY(site_id,phase)
);
-- Remember completed work at rollout so later edits cannot create historical payroll.
INSERT INTO public.field_existing_completions(site_id,phase)
  SELECT s.id,p.phase FROM public.sites s CROSS JOIN (VALUES('assessment'),('installation'),('commissioning')) p(phase)
  WHERE public.field_ops_phase_ready(s.id,p.phase);

-- Only new completion transitions create earnings. No automatic historical payroll backfill.
CREATE FUNCTION public.field_ops_capture_earning() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE worker UUID; stamp TIMESTAMPTZ; rate NUMERIC; ready BOOLEAN; previous public.field_earnings;
BEGIN
  ready := public.field_ops_phase_ready(NEW.site_id, TG_TABLE_NAME);
  SELECT * INTO previous FROM field_earnings WHERE site_id = NEW.site_id AND phase = TG_TABLE_NAME FOR UPDATE;
  IF previous.id IS NOT NULL THEN
    -- Paid entries are immutable; live eligibility is still checked before reporting/payment.
    IF NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id = previous.id) THEN
      UPDATE field_earnings SET eligible = ready WHERE id = previous.id;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ready THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM field_existing_completions WHERE site_id=NEW.site_id AND phase=TG_TABLE_NAME) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.data IS NOT DISTINCT FROM OLD.data THEN RETURN NEW; END IF;
  worker := NEW.worker_id;
  IF TG_TABLE_NAME = 'commissioning' THEN
    SELECT requested_by, reviewed_at INTO worker, stamp FROM commissioning_approval_requests WHERE site_id = NEW.site_id AND status = 'approved';
  END IF;
  -- Manager edits must not replace the associate's entitlement with the editing manager.
  IF TG_TABLE_NAME <> 'commissioning' AND NOT public.field_ops_associate(worker) THEN
    IF TG_OP = 'UPDATE' AND public.field_ops_associate(OLD.worker_id) THEN worker := OLD.worker_id;
    ELSE SELECT assigned_worker_id INTO worker FROM sites WHERE id = NEW.site_id;
    END IF;
  END IF;
  IF NOT public.field_ops_associate(worker) THEN RETURN NEW; END IF;
  stamp := coalesce(stamp, now());
  SELECT CASE TG_TABLE_NAME WHEN 'assessment' THEN assessment WHEN 'installation' THEN installation ELSE commissioning END
    INTO rate FROM field_work_rates WHERE associate_id = worker;
  INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount)
    SELECT NEW.site_id,coalesce(s.company_name,s.name),worker,coalesce(p.name,p.email,'Field associate'),p.created_at,TG_TABLE_NAME,stamp,(stamp AT TIME ZONE 'Asia/Kolkata')::date,rate
    FROM sites s JOIN profiles p ON p.id=worker WHERE s.id=NEW.site_id
    ON CONFLICT(site_id,phase) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER field_ops_assessment_earning AFTER INSERT OR UPDATE ON public.assessment FOR EACH ROW EXECUTE FUNCTION public.field_ops_capture_earning();
CREATE TRIGGER field_ops_installation_earning AFTER INSERT OR UPDATE ON public.installation FOR EACH ROW EXECUTE FUNCTION public.field_ops_capture_earning();
CREATE TRIGGER field_ops_commissioning_earning AFTER INSERT OR UPDATE ON public.commissioning FOR EACH ROW EXECUTE FUNCTION public.field_ops_capture_earning();

-- An externally submitted device order can be the last required assessment item.
-- Capture the earning without changing the assessment form or its timestamps.
CREATE FUNCTION public.field_ops_device_order_earning() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.submitted IS DISTINCT FROM true THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.submitted IS NOT DISTINCT FROM NEW.submitted AND OLD.material_name IS NOT DISTINCT FROM NEW.material_name THEN RETURN NEW; END IF;
  INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount)
    SELECT a.site_id,coalesce(s.company_name,s.name),w.worker,coalesce(p.name,p.email,'Field associate'),p.created_at,'assessment',now(),(now() AT TIME ZONE 'Asia/Kolkata')::date,r.assessment
    FROM assessment a JOIN sites s ON s.id=a.site_id
    CROSS JOIN LATERAL (SELECT CASE WHEN public.field_ops_associate(a.worker_id) THEN a.worker_id ELSE s.assigned_worker_id END AS worker) w
    JOIN profiles p ON p.id=w.worker
    LEFT JOIN field_work_rates r ON r.associate_id=w.worker
    WHERE public.field_ops_associate(w.worker) AND public.field_ops_phase_ready(a.site_id,'assessment')
      AND NOT EXISTS(SELECT 1 FROM field_existing_completions h WHERE h.site_id=a.site_id AND h.phase='assessment')
    ON CONFLICT(site_id,phase) DO UPDATE SET eligible=true;
  RETURN NEW;
END $$;
CREATE TRIGGER field_ops_device_order_earning AFTER INSERT OR UPDATE ON public.inventory_materials FOR EACH ROW EXECUTE FUNCTION public.field_ops_device_order_earning();

-- Protect the legacy status endpoint too; dual-role visits keep their existing behavior.
CREATE FUNCTION public.field_ops_visit_completion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status='completed' AND OLD.status <> 'completed' AND public.field_ops_associate(NEW.assignee_id)
    AND NOT public.field_ops_phase_ready(NEW.site_id,NEW.visit_type) THEN
    RAISE EXCEPTION 'Complete all required phase work and approval before completing this visit';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER field_ops_visit_completion_guard BEFORE UPDATE ON public.field_visit_schedules FOR EACH ROW EXECUTE FUNCTION public.field_ops_visit_completion_guard();

CREATE FUNCTION public.field_ops_attendance(_associate UUID, _online BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Select an active field associate'; END IF;
  IF NOT public.is_staff(auth.uid()) AND (_associate <> auth.uid() OR NOT _online) THEN RAISE EXCEPTION 'Access denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text,0));
  IF (SELECT online FROM field_attendance_events WHERE associate_id = _associate AND work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1) IS NOT DISTINCT FROM _online THEN RETURN; END IF;
  INSERT INTO field_attendance_events(associate_id,actor_id,online) VALUES(_associate,auth.uid(),_online);
END $$;

CREATE FUNCTION public.field_ops_set_rates(_associate UUID, _assessment NUMERIC, _installation NUMERIC, _commissioning NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF _assessment IS NULL OR _installation IS NULL OR _commissioning IS NULL OR least(_assessment,_installation,_commissioning) < 0 THEN RAISE EXCEPTION 'Enter non-negative rates'; END IF;
  INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,updated_by)
    VALUES(_associate,_assessment,_installation,_commissioning,auth.uid())
    ON CONFLICT(associate_id) DO UPDATE SET assessment=EXCLUDED.assessment, installation=EXCLUDED.installation, commissioning=EXCLUDED.commissioning, updated_by=auth.uid(), updated_at=now();
  -- Resolve unpriced work once; never reprice existing amounts.
  UPDATE field_earnings SET amount = CASE phase WHEN 'assessment' THEN _assessment WHEN 'installation' THEN _installation ELSE _commissioning END
    WHERE associate_id = _associate AND amount IS NULL;
END $$;

CREATE FUNCTION public.field_ops_schedule(_site UUID, _associate UUID, _phase TEXT, _date DATE, _shift TEXT, _arrival TIME, _end TIME, _priority TEXT DEFAULT 'normal', _note TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result UUID; s public.sites; next_phase TEXT;
BEGIN
  SELECT * INTO s FROM sites WHERE id = _site;
  IF auth.uid() IS NULL OR s.id IS NULL OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Select a company and active field associate'; END IF;
  IF NOT coalesce(_associate = ANY(public.field_ops_worker_ids(s)),false) THEN RAISE EXCEPTION 'Company is not assigned to this associate'; END IF;
  IF NOT public.field_ops_site_active(s) THEN RAISE EXCEPTION 'Dropped or rejected companies cannot be scheduled'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN
    IF _associate <> auth.uid() OR _priority <> 'normal' OR _date <> (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Schedule your own companies for today'; END IF;
    IF NOT coalesce((SELECT online FROM field_attendance_events WHERE associate_id=auth.uid() AND work_date=_date ORDER BY occurred_at DESC LIMIT 1),false) THEN RAISE EXCEPTION 'Mark online first'; END IF;
  END IF;
  IF _date IS NULL OR _date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select today or a future date'; END IF;
  IF _shift IS NULL OR _shift NOT IN ('10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00') OR _arrival IS NULL OR _end IS NULL OR _end <= _arrival THEN RAISE EXCEPTION 'Select a shift and arrival/end times; end must follow arrival'; END IF;
  IF _priority IS NULL OR _priority NOT IN ('normal','high','emergency') THEN RAISE EXCEPTION 'Select a valid priority'; END IF;
  IF public.field_ops_phase_ready(_site,'commissioning') THEN RAISE EXCEPTION 'Company is already commissioned'; END IF;
  next_phase := CASE WHEN public.field_ops_phase_ready(_site,'installation') THEN 'commissioning'
    WHEN EXISTS(SELECT 1 FROM assessment WHERE site_id=_site AND data->>'assessment_phase_submitted'='true') THEN 'installation' ELSE 'assessment' END;
  IF _phase IS DISTINCT FROM next_phase THEN RAISE EXCEPTION 'Refresh company list; the phase has changed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _date::text,0));
  IF EXISTS(SELECT 1 FROM field_visit_schedules WHERE site_id=_site AND assignee_id=_associate AND visit_type=_phase AND scheduled_for=_date AND status <> 'completed') THEN RAISE EXCEPTION 'This company phase is already scheduled for this day'; END IF;
  IF EXISTS(SELECT 1 FROM field_visit_schedules WHERE assignee_id=_associate AND scheduled_for=_date AND status <> 'completed' AND expected_arrival < _end AND expected_end > _arrival) THEN RAISE EXCEPTION 'Arrival/end times overlap another visit'; END IF;
  INSERT INTO field_visit_schedules(site_id,assignee_id,visit_type,scheduled_for,shift,expected_arrival,expected_end,priority,note,created_by)
    VALUES(_site,_associate,_phase,_date,_shift,_arrival,_end,_priority,nullif(trim(_note),''),auth.uid()) RETURNING id INTO result;
  RETURN result;
END $$;

CREATE FUNCTION public.field_ops_complete_visit(_visit UUID, _delayed BOOLEAN DEFAULT false, _reason TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.field_visit_schedules; s public.sites;
BEGIN
  SELECT * INTO v FROM field_visit_schedules WHERE id=_visit FOR UPDATE;
  SELECT * INTO s FROM sites WHERE id=v.site_id;
  IF v.id IS NULL OR s.id IS NULL OR auth.uid() IS NULL OR NOT public.field_ops_associate(auth.uid()) OR NOT coalesce(auth.uid() = ANY(public.field_ops_worker_ids(s)),false)
    OR NOT coalesce(v.assignee_id = ANY(public.field_ops_worker_ids(s)),false) THEN RAISE EXCEPTION 'Visit not found or access denied'; END IF;
  IF NOT coalesce((SELECT online FROM field_attendance_events WHERE associate_id=auth.uid() AND work_date=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1),false) THEN RAISE EXCEPTION 'Mark online first'; END IF;
  IF v.status = 'completed' THEN RETURN; END IF;
  IF _delayed THEN
    IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A delay reason is required'; END IF;
    UPDATE field_visit_schedules SET status='delayed',delay_reason=trim(_reason),updated_at=now() WHERE id=_visit;
  ELSE
    IF NOT public.field_ops_phase_ready(v.site_id,v.visit_type) THEN RAISE EXCEPTION 'Complete all required phase work and approval before completing this visit'; END IF;
    UPDATE field_visit_schedules SET status='completed',completed_at=now(),updated_at=now(),delay_reason=NULL WHERE id=_visit;
  END IF;
END $$;

CREATE FUNCTION public.field_ops_edit_commissioning_date(_earning UUID, _date DATE, _reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.field_earnings;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  SELECT * INTO e FROM field_earnings WHERE id=_earning FOR UPDATE;
  IF e.id IS NULL OR e.phase <> 'commissioning' OR NOT public.field_ops_phase_ready(e.site_id,'commissioning') THEN RAISE EXCEPTION 'Select approved commissioning work'; END IF;
  IF EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id) THEN RAISE EXCEPTION 'Paid earnings cannot be moved'; END IF;
  IF _date IS NULL OR _date > (e.completed_at AT TIME ZONE 'Asia/Kolkata')::date
    OR _date < (e.associate_joined AT TIME ZONE 'Asia/Kolkata')::date
    OR coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'Choose a work date from joining through approval and enter a reason'; END IF;
  IF EXISTS(SELECT 1 FROM field_payment_records WHERE associate_id=e.associate_id AND period_end=public.field_ops_period_end(_date)) THEN RAISE EXCEPTION 'Destination payment period is already cleared'; END IF;
  INSERT INTO field_earning_date_changes(earning_id,old_date,new_date,reason,actor_id) VALUES(e.id,e.earning_date,_date,trim(_reason),auth.uid());
  UPDATE field_earnings SET earning_date=_date WHERE id=e.id;
END $$;

CREATE FUNCTION public.field_ops_record_payment(_associate UUID, _period_end DATE, _paid_on DATE, _reference TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total NUMERIC; payment UUID;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF _period_end IS NULL OR extract(day FROM _period_end) <> 15 OR _period_end >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select a finished 16th–15th payment period'; END IF;
  IF _paid_on IS NULL OR _paid_on > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Enter a valid payment date'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _period_end::text,0));
  PERFORM 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end FOR UPDATE;
  IF EXISTS(SELECT 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND eligible AND amount IS NULL) THEN RAISE EXCEPTION 'Set rates before clearing payment'; END IF;
  SELECT sum(amount) INTO total FROM field_earnings e WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND eligible
    AND (site_id IS NULL OR public.field_ops_phase_ready(site_id,phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
  IF coalesce(total,0) <= 0 THEN RAISE EXCEPTION 'No payable completed work in this period'; END IF;
  INSERT INTO field_payment_records(associate_id,period_end,amount,paid_on,reference,recorded_by) VALUES(_associate,_period_end,total,_paid_on,nullif(trim(_reference),''),auth.uid()) RETURNING id INTO payment;
  INSERT INTO field_payment_items(payment_id,earning_id,amount) SELECT payment,e.id,e.amount FROM field_earnings e WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND eligible AND (site_id IS NULL OR public.field_ops_phase_ready(site_id,phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
  RETURN payment;
END $$;

CREATE FUNCTION public.field_ops_board() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE staff BOOLEAN := public.is_staff(auth.uid()); result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT (staff OR public.field_ops_associate(auth.uid())) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT jsonb_build_object(
    'today',(now() AT TIME ZONE 'Asia/Kolkata')::date,
    'tracking_started',(SELECT (started_at AT TIME ZONE 'Asia/Kolkata')::date FROM field_operations_rollout),
    'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'joined',u.joined,'active',u.active,
      'online',u.active AND coalesce((SELECT online FROM field_attendance_events WHERE associate_id=u.id AND work_date=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1),false))) FROM (
        SELECT p.id,coalesce(p.name,p.email) AS name,p.created_at AS joined,p.is_active AS active FROM profiles p
        WHERE public.has_role(p.id,'worker') AND NOT public.is_staff(p.id) AND (p.is_active OR EXISTS(SELECT 1 FROM field_earnings WHERE associate_id=p.id))
        UNION ALL SELECT e.associate_id,max(e.associate_name),min(e.associate_joined),false FROM field_earnings e
        WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE id=e.associate_id) GROUP BY e.associate_id
      ) u WHERE staff OR (u.id=auth.uid() AND u.active)),'[]'::jsonb),
    'attendance',coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('actor_name',coalesce(p.name,p.email,'Former user')) ORDER BY a.occurred_at DESC) FROM field_attendance_events a LEFT JOIN profiles p ON p.id=a.actor_id WHERE staff OR a.associate_id=auth.uid()),'[]'::jsonb),
    'rates',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM field_work_rates r WHERE staff OR r.associate_id=auth.uid()),'[]'::jsonb),
    'earnings',coalesce((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('company_name',coalesce(s.company_name,s.name,e.company_name),
      'eligible',e.eligible AND (e.site_id IS NULL OR public.field_ops_phase_ready(e.site_id,e.phase)),'paid',EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id))) FROM field_earnings e LEFT JOIN sites s ON s.id=e.site_id WHERE staff OR e.associate_id=auth.uid()),'[]'::jsonb),
    'payments',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM field_payment_records p WHERE staff OR p.associate_id=auth.uid()),'[]'::jsonb),
    'date_changes',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM field_earning_date_changes c JOIN field_earnings e ON e.id=c.earning_id WHERE staff OR e.associate_id=auth.uid()),'[]'::jsonb),
    'sites',coalesce((SELECT jsonb_agg(jsonb_build_object('site_id',s.id,'company_name',coalesce(s.company_name,s.name),'worker_ids',public.field_ops_worker_ids(s),
      'active',public.field_ops_site_active(s),
      'phase',CASE WHEN public.field_ops_phase_ready(s.id,'commissioning') THEN 'complete' WHEN public.field_ops_phase_ready(s.id,'installation') THEN 'commissioning' WHEN a.data->>'assessment_phase_submitted'='true' THEN 'installation' ELSE 'assessment' END,
      'assessment_ready',public.field_ops_phase_ready(s.id,'assessment'),'installation_ready',public.field_ops_phase_ready(s.id,'installation'),'commissioning_ready',public.field_ops_phase_ready(s.id,'commissioning'),
      'assessment_completed_at',CASE WHEN public.field_ops_phase_ready(s.id,'assessment') THEN coalesce((SELECT completed_at FROM field_earnings WHERE site_id=s.id AND phase='assessment'),a.updated_at) ELSE NULL END))
      FROM sites s LEFT JOIN assessment a ON a.site_id=s.id WHERE staff OR auth.uid()=ANY(public.field_ops_worker_ids(s))),'[]'::jsonb),
    'visits',coalesce((SELECT jsonb_agg(to_jsonb(v) || jsonb_build_object('company_name',coalesce(s.company_name,s.name)) ORDER BY v.scheduled_for,v.expected_arrival) FROM field_visit_schedules v JOIN sites s ON s.id=v.site_id WHERE staff OR v.assignee_id=auth.uid() OR (auth.uid()=ANY(public.field_ops_worker_ids(s)) AND v.assignee_id=ANY(public.field_ops_worker_ids(s)))),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

-- All writes go through validated RPCs; no authenticated direct-write policies.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['field_operations_rollout','field_existing_completions','field_attendance_events','field_work_rates','field_earnings','field_earning_date_changes','field_payment_records','field_payment_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
  END LOOP;
END $$;
-- Functions default to PUBLIC EXECUTE in Postgres; explicitly restrict every new function.
DO $$ DECLARE f RECORD; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'field_ops_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.field_ops_board(), public.field_ops_attendance(UUID,BOOLEAN), public.field_ops_set_rates(UUID,NUMERIC,NUMERIC,NUMERIC), public.field_ops_schedule(UUID,UUID,TEXT,DATE,TEXT,TIME,TIME,TEXT,TEXT), public.field_ops_complete_visit(UUID,BOOLEAN,TEXT), public.field_ops_edit_commissioning_date(UUID,DATE,TEXT), public.field_ops_record_payment(UUID,DATE,DATE,TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';



-- Source migration: 20261005130000_field_operations_company_stages.sql


-- Scheduling follows company lifecycle status; earnings retain strict completion checks.
CREATE FUNCTION public.field_ops_company_status(_site public.sites) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE meta JSONB := public.field_ops_site_metadata(_site.task_notes); a JSONB; i JSONB; c JSONB;
  status TEXT := meta->>'status'; latest JSONB; manual BOOLEAN; dispatched BOOLEAN := false; material JSONB; notes JSONB;
BEGIN
  IF NOT public.field_ops_site_active(_site) THEN RETURN 'Dropped / Rejected'; END IF;
  SELECT data INTO a FROM assessment WHERE site_id=_site.id;
  SELECT data INTO i FROM installation WHERE site_id=_site.id;
  SELECT data INTO c FROM commissioning WHERE site_id=_site.id;
  IF jsonb_typeof(meta->'activity_logs')='array' THEN
    SELECT value INTO latest FROM jsonb_array_elements(meta->'activity_logs') WHERE value->>'type'='status_change' LIMIT 1;
  END IF;
  manual := coalesce(meta->>'status_source'='manager' OR latest->>'to_status'=status,false);
  IF (manual OR (meta->>'status_source'='associate' AND NOT (
    coalesce(c->>'commissioning_phase_submitted'='true',false) AND status IN ('In Assessment','Assessed','Panel Dispatched','Installed')))) AND coalesce(status,'')<>'' THEN
    RETURN CASE WHEN status='In Assessment' THEN 'Assessed' ELSE status END;
  END IF;
  IF status IN ('Submitted','Certification Pending','Unsubmitted','Commissioned') THEN RETURN status; END IF;
  IF c->>'commissioning_phase_submitted'='true' THEN RETURN 'Commissioned'; END IF;
  IF status='Installed' THEN RETURN 'Installed'; END IF;
  IF _site.consultant_stage IN ('Completion','Billing') THEN RETURN 'Submitted'; END IF;
  SELECT to_jsonb(m) INTO material FROM inventory_materials m
    WHERE m.submitted IS DISTINCT FROM false AND (
      (length(public.field_ops_company_key(_site.company_name))>0 AND
       (position(public.field_ops_company_key(_site.company_name) IN public.field_ops_company_key(m.material_name))>0 OR position(public.field_ops_company_key(m.material_name) IN public.field_ops_company_key(_site.company_name))>0)) OR
      (length(public.field_ops_company_key(_site.name))>0 AND
       (position(public.field_ops_company_key(_site.name) IN public.field_ops_company_key(m.material_name))>0 OR position(public.field_ops_company_key(m.material_name) IN public.field_ops_company_key(_site.name))>0))) LIMIT 1;
  BEGIN
    notes := CASE WHEN jsonb_typeof(material->'notes')='object' THEN material->'notes' ELSE (material->>'notes')::jsonb END;
  EXCEPTION WHEN invalid_text_representation THEN notes := '{}'::jsonb;
  END;
  dispatched := lower(trim(coalesce(nullif(notes->>'logistics_status',''),material->>'state','Pending'))) IN ('shipped','transit','in transit','delivered');
  IF status='Panel Dispatched' AND dispatched THEN RETURN 'Panel Dispatched'; END IF;
  IF status IN ('Assessed','In Assessment') THEN RETURN 'Assessed'; END IF;
  IF status='Not Started Yet' AND NOT dispatched THEN RETURN status; END IF;
  IF status='Pending Assignment' AND NOT dispatched THEN
    RETURN CASE WHEN EXISTS(SELECT 1 FROM unnest(public.field_ops_worker_ids(_site)) w WHERE w IS NOT NULL) THEN 'Not Started Yet' ELSE status END;
  END IF;
  IF i->>'installation_phase_submitted'='true' OR i @> '{"coordination_done":true,"photos_uploaded":true}' THEN RETURN 'Installed'; END IF;
  IF dispatched THEN RETURN 'Panel Dispatched'; END IF;
  IF a->>'assessment_phase_submitted'='true' OR a @> '{"media_uploaded":true,"factory_operations_done":true}' THEN RETURN 'Assessed'; END IF;
  RETURN CASE WHEN EXISTS(SELECT 1 FROM unnest(public.field_ops_worker_ids(_site)) w WHERE w IS NOT NULL) THEN 'Not Started Yet' ELSE 'Pending Assignment' END;
END $$;

CREATE FUNCTION public.field_ops_company_phase(_site public.sites) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE public.field_ops_company_status(_site)
    WHEN 'Not Started Yet' THEN 'assessment' WHEN 'Pending Assignment' THEN 'assessment'
    WHEN 'Assessed' THEN 'installation' WHEN 'Panel Dispatched' THEN 'installation' WHEN 'Device Order' THEN 'installation'
    WHEN 'Installed' THEN 'commissioning' ELSE 'complete' END
$$;
REVOKE ALL ON FUNCTION public.field_ops_company_status(public.sites), public.field_ops_company_phase(public.sites) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.field_ops_schedule(_site UUID, _associate UUID, _phase TEXT, _date DATE, _shift TEXT, _arrival TIME, _end TIME, _priority TEXT DEFAULT 'normal', _note TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result UUID; s public.sites; next_phase TEXT;
BEGIN
  SELECT * INTO s FROM sites WHERE id = _site;
  IF auth.uid() IS NULL OR s.id IS NULL OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Select a company and active field associate'; END IF;
  IF NOT coalesce(_associate = ANY(public.field_ops_worker_ids(s)),false) THEN RAISE EXCEPTION 'Company is not assigned to this associate'; END IF;
  IF NOT public.field_ops_site_active(s) THEN RAISE EXCEPTION 'Dropped or rejected companies cannot be scheduled'; END IF;
  IF NOT public.is_staff(auth.uid()) THEN
    IF _associate <> auth.uid() OR _priority <> 'normal' OR _date <> (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Schedule your own companies for today'; END IF;
    IF NOT coalesce((SELECT online FROM field_attendance_events WHERE associate_id=auth.uid() AND work_date=_date ORDER BY occurred_at DESC LIMIT 1),false) THEN RAISE EXCEPTION 'Mark online first'; END IF;
  END IF;
  IF _date IS NULL OR _date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select today or a future date'; END IF;
  IF _shift IS NULL OR _shift NOT IN ('10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00') OR _arrival IS NULL OR _end IS NULL OR _end <= _arrival THEN RAISE EXCEPTION 'Select a shift and arrival/end times; end must follow arrival'; END IF;
  IF _priority IS NULL OR _priority NOT IN ('normal','high','emergency') THEN RAISE EXCEPTION 'Select a valid priority'; END IF;
  next_phase := public.field_ops_company_phase(s);
  IF next_phase='complete' THEN RAISE EXCEPTION 'Company has no pending visit stage'; END IF;
  IF _phase IS DISTINCT FROM next_phase THEN RAISE EXCEPTION 'Refresh company list; the phase has changed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _date::text,0));
  IF EXISTS(SELECT 1 FROM field_visit_schedules WHERE site_id=_site AND assignee_id=_associate AND visit_type=_phase AND scheduled_for=_date AND status <> 'completed') THEN RAISE EXCEPTION 'This company phase is already scheduled for this day'; END IF;
  IF EXISTS(SELECT 1 FROM field_visit_schedules WHERE assignee_id=_associate AND scheduled_for=_date AND status <> 'completed' AND expected_arrival < _end AND expected_end > _arrival) THEN RAISE EXCEPTION 'Arrival/end times overlap another visit'; END IF;
  INSERT INTO field_visit_schedules(site_id,assignee_id,visit_type,scheduled_for,shift,expected_arrival,expected_end,priority,note,created_by)
    VALUES(_site,_associate,_phase,_date,_shift,_arrival,_end,_priority,nullif(trim(_note),''),auth.uid()) RETURNING id INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.field_ops_board() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE staff BOOLEAN := public.is_staff(auth.uid()); result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT (staff OR public.field_ops_associate(auth.uid())) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT jsonb_build_object(
    'today',(now() AT TIME ZONE 'Asia/Kolkata')::date,
    'tracking_started',(SELECT (started_at AT TIME ZONE 'Asia/Kolkata')::date FROM field_operations_rollout),
    'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'joined',u.joined,'active',u.active,
      'online',u.active AND coalesce((SELECT online FROM field_attendance_events WHERE associate_id=u.id AND work_date=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1),false))) FROM (
        SELECT p.id,coalesce(p.name,p.email) AS name,p.created_at AS joined,p.is_active AS active FROM profiles p
        WHERE public.has_role(p.id,'worker') AND NOT public.is_staff(p.id) AND (p.is_active OR EXISTS(SELECT 1 FROM field_earnings WHERE associate_id=p.id))
        UNION ALL SELECT e.associate_id,max(e.associate_name),min(e.associate_joined),false FROM field_earnings e
        WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE id=e.associate_id) GROUP BY e.associate_id
      ) u WHERE staff OR (u.id=auth.uid() AND u.active)),'[]'::jsonb),
    'attendance',coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('actor_name',coalesce(p.name,p.email,'Former user')) ORDER BY a.occurred_at DESC) FROM field_attendance_events a LEFT JOIN profiles p ON p.id=a.actor_id WHERE staff OR a.associate_id=auth.uid()),'[]'::jsonb),
    'rates',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM field_work_rates r WHERE staff OR r.associate_id=auth.uid()),'[]'::jsonb),
    'earnings',coalesce((SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('company_name',coalesce(s.company_name,s.name,e.company_name),
      'eligible',e.eligible AND (e.site_id IS NULL OR public.field_ops_phase_ready(e.site_id,e.phase)),'paid',EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id))) FROM field_earnings e LEFT JOIN sites s ON s.id=e.site_id WHERE staff OR e.associate_id=auth.uid()),'[]'::jsonb),
    'payments',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM field_payment_records p WHERE staff OR p.associate_id=auth.uid()),'[]'::jsonb),
    'date_changes',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM field_earning_date_changes c JOIN field_earnings e ON e.id=c.earning_id WHERE staff OR e.associate_id=auth.uid()),'[]'::jsonb),
    'sites',coalesce((SELECT jsonb_agg(jsonb_build_object('site_id',s.id,'company_name',coalesce(s.company_name,s.name),'worker_ids',public.field_ops_worker_ids(s),
      'active',public.field_ops_site_active(s),'status',public.field_ops_company_status(s),
      'phase',public.field_ops_company_phase(s),
      'assessment_ready',public.field_ops_phase_ready(s.id,'assessment'),'installation_ready',public.field_ops_phase_ready(s.id,'installation'),'commissioning_ready',public.field_ops_phase_ready(s.id,'commissioning'),
      'assessment_completed_at',CASE WHEN public.field_ops_phase_ready(s.id,'assessment') THEN coalesce((SELECT completed_at FROM field_earnings WHERE site_id=s.id AND phase='assessment'),a.updated_at) ELSE NULL END))
      FROM sites s LEFT JOIN assessment a ON a.site_id=s.id WHERE staff OR auth.uid()=ANY(public.field_ops_worker_ids(s))),'[]'::jsonb),
    'visits',coalesce((SELECT jsonb_agg(to_jsonb(v) || jsonb_build_object('company_name',coalesce(s.company_name,s.name)) ORDER BY v.scheduled_for,v.expected_arrival) FROM field_visit_schedules v JOIN sites s ON s.id=v.site_id WHERE staff OR v.assignee_id=auth.uid() OR (auth.uid()=ANY(public.field_ops_worker_ids(s)) AND v.assignee_id=ANY(public.field_ops_worker_ids(s)))),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

NOTIFY pgrst, 'reload schema';



-- Source migration: 20261005140000_field_operations_assessment_commissioning_pay.sql

-- Installation stays in the work ledger for activity tracking and earns no payment.
-- Keep already recorded payments/items untouched; remove unpaid installation entitlement.
UPDATE public.field_work_rates SET installation=0 WHERE installation<>0;
UPDATE public.field_earnings e SET amount=0 WHERE phase='installation'
  AND NOT EXISTS(SELECT 1 FROM public.field_payment_items WHERE earning_id=e.id);
ALTER TABLE public.field_work_rates ADD CONSTRAINT field_installation_rate_zero CHECK(installation=0);

CREATE OR REPLACE FUNCTION public.field_ops_capture_earning() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE worker UUID; stamp TIMESTAMPTZ; rate NUMERIC; ready BOOLEAN; previous public.field_earnings;
BEGIN
  ready := public.field_ops_phase_ready(NEW.site_id, TG_TABLE_NAME);
  SELECT * INTO previous FROM field_earnings WHERE site_id = NEW.site_id AND phase = TG_TABLE_NAME FOR UPDATE;
  IF previous.id IS NOT NULL THEN
    -- Paid entries are immutable; live eligibility is still checked before reporting/payment.
    IF NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id = previous.id) THEN
      UPDATE field_earnings SET eligible = ready WHERE id = previous.id;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ready THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM field_existing_completions WHERE site_id=NEW.site_id AND phase=TG_TABLE_NAME) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.data IS NOT DISTINCT FROM OLD.data THEN RETURN NEW; END IF;
  worker := NEW.worker_id;
  IF TG_TABLE_NAME = 'commissioning' THEN
    SELECT requested_by, reviewed_at INTO worker, stamp FROM commissioning_approval_requests WHERE site_id = NEW.site_id AND status = 'approved';
  END IF;
  -- Manager edits must not replace the associate's entitlement with the editing manager.
  IF TG_TABLE_NAME <> 'commissioning' AND NOT public.field_ops_associate(worker) THEN
    IF TG_OP = 'UPDATE' AND public.field_ops_associate(OLD.worker_id) THEN worker := OLD.worker_id;
    ELSE SELECT assigned_worker_id INTO worker FROM sites WHERE id = NEW.site_id;
    END IF;
  END IF;
  IF NOT public.field_ops_associate(worker) THEN RETURN NEW; END IF;
  stamp := coalesce(stamp, now());
  IF TG_TABLE_NAME='installation' THEN rate := 0;
  ELSE
    SELECT CASE TG_TABLE_NAME WHEN 'assessment' THEN assessment ELSE commissioning END
      INTO rate FROM field_work_rates WHERE associate_id=worker;
  END IF;
  INSERT INTO field_earnings(site_id,company_name,associate_id,associate_name,associate_joined,phase,completed_at,earning_date,amount)
    SELECT NEW.site_id,coalesce(s.company_name,s.name),worker,coalesce(p.name,p.email,'Field associate'),p.created_at,TG_TABLE_NAME,stamp,(stamp AT TIME ZONE 'Asia/Kolkata')::date,rate
    FROM sites s JOIN profiles p ON p.id=worker WHERE s.id=NEW.site_id
    ON CONFLICT(site_id,phase) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.field_ops_set_rates(_associate UUID, _assessment NUMERIC, _installation NUMERIC, _commissioning NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) OR NOT public.field_ops_associate(_associate) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF _assessment IS NULL OR _commissioning IS NULL OR least(_assessment,_commissioning) < 0 THEN RAISE EXCEPTION 'Enter non-negative rates'; END IF;
  INSERT INTO field_work_rates(associate_id,assessment,installation,commissioning,updated_by)
    VALUES(_associate,_assessment,0,_commissioning,auth.uid())
    ON CONFLICT(associate_id) DO UPDATE SET assessment=EXCLUDED.assessment, installation=EXCLUDED.installation, commissioning=EXCLUDED.commissioning, updated_by=auth.uid(), updated_at=now();
  -- Resolve unpriced work once; never reprice existing amounts.
  UPDATE field_earnings SET amount = CASE phase WHEN 'assessment' THEN _assessment WHEN 'installation' THEN 0 ELSE _commissioning END
    WHERE associate_id = _associate AND amount IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.field_ops_record_payment(_associate UUID, _period_end DATE, _paid_on DATE, _reference TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total NUMERIC; payment UUID;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Manager access required'; END IF;
  IF _period_end IS NULL OR extract(day FROM _period_end) <> 15 OR _period_end >= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Select a finished 16th–15th payment period'; END IF;
  IF _paid_on IS NULL OR _paid_on > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Enter a valid payment date'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _period_end::text,0));
  PERFORM 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end FOR UPDATE;
  IF EXISTS(SELECT 1 FROM field_earnings WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND phase IN ('assessment','commissioning') AND eligible AND amount IS NULL) THEN RAISE EXCEPTION 'Set rates before clearing payment'; END IF;
  SELECT sum(amount) INTO total FROM field_earnings e WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND phase IN ('assessment','commissioning') AND eligible
    AND (site_id IS NULL OR public.field_ops_phase_ready(site_id,phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
  IF coalesce(total,0) <= 0 THEN RAISE EXCEPTION 'No payable completed work in this period'; END IF;
  INSERT INTO field_payment_records(associate_id,period_end,amount,paid_on,reference,recorded_by) VALUES(_associate,_period_end,total,_paid_on,nullif(trim(_reference),''),auth.uid()) RETURNING id INTO payment;
  INSERT INTO field_payment_items(payment_id,earning_id,amount) SELECT payment,e.id,e.amount FROM field_earnings e WHERE associate_id=_associate AND public.field_ops_period_end(earning_date)=_period_end AND phase IN ('assessment','commissioning') AND eligible AND (site_id IS NULL OR public.field_ops_phase_ready(site_id,phase)) AND NOT EXISTS(SELECT 1 FROM field_payment_items WHERE earning_id=e.id);
  RETURN payment;
END $$;

NOTIFY pgrst, 'reload schema';



-- Source migration: 20261006120000_field_operations_follow_up_visits.sql


-- Follow-up visits resolve issues at assigned companies, including commissioned ones, without reopening phases
-- or creating payroll entries. Existing visits and phase scheduling are unchanged.
ALTER TABLE public.field_visit_schedules
  DROP CONSTRAINT field_visit_schedules_visit_type_check;
ALTER TABLE public.field_visit_schedules
  ADD CONSTRAINT field_visit_schedules_visit_type_check
  CHECK (visit_type IN ('assessment', 'installation', 'commissioning', 'follow_up'));

CREATE FUNCTION public.field_ops_schedule_follow_up(
  _site UUID, _associate UUID, _date DATE, _shift TEXT,
  _arrival TIME, _end TIME, _priority TEXT, _note TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result UUID; s public.sites;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Manager access required';
  END IF;
  SELECT * INTO s FROM sites WHERE id = _site;
  IF s.id IS NULL OR NOT public.field_ops_associate(_associate) THEN
    RAISE EXCEPTION 'Select a company and active field associate';
  END IF;
  IF NOT coalesce(_associate = ANY(public.field_ops_worker_ids(s)), false) THEN
    RAISE EXCEPTION 'Company is not assigned to this associate';
  END IF;
  IF NOT public.field_ops_site_active(s) THEN
    RAISE EXCEPTION 'Dropped or rejected companies cannot be scheduled';
  END IF;
  IF _date IS NULL OR _date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Select today or a future date';
  END IF;
  IF _shift IS NULL OR _shift NOT IN
    ('10:00-12:00','12:00-14:00','14:00-16:00','16:00-18:00','18:00-20:00')
    OR _arrival IS NULL OR _end IS NULL OR _end <= _arrival THEN
    RAISE EXCEPTION 'Select a shift and arrival/end times; end must follow arrival';
  END IF;
  IF _priority IS NULL OR _priority NOT IN ('normal','high','emergency') THEN
    RAISE EXCEPTION 'Select a valid priority';
  END IF;
  IF coalesce(trim(_note), '') = '' THEN
    RAISE EXCEPTION 'Describe the issue or reason for this follow-up visit';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_associate::text || _date::text, 0));
  IF EXISTS (SELECT 1 FROM field_visit_schedules WHERE site_id = _site
    AND assignee_id = _associate AND visit_type = 'follow_up'
    AND scheduled_for = _date AND status <> 'completed') THEN
    RAISE EXCEPTION 'This company follow-up is already scheduled for this day';
  END IF;
  IF EXISTS (SELECT 1 FROM field_visit_schedules WHERE assignee_id = _associate
    AND scheduled_for = _date AND status <> 'completed'
    AND expected_arrival < _end AND expected_end > _arrival) THEN
    RAISE EXCEPTION 'Arrival/end times overlap another visit';
  END IF;
  INSERT INTO field_visit_schedules
    (site_id, assignee_id, visit_type, scheduled_for, shift, expected_arrival,
     expected_end, priority, note, created_by)
    VALUES (_site, _associate, 'follow_up', _date, _shift, _arrival,
      _end, _priority, trim(_note), auth.uid()) RETURNING id INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.field_ops_schedule_follow_up(UUID,UUID,DATE,TEXT,TIME,TIME,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_ops_schedule_follow_up(UUID,UUID,DATE,TEXT,TIME,TIME,TEXT,TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.field_ops_visit_completion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status='completed' AND OLD.status <> 'completed'
    AND NEW.visit_type <> 'follow_up' AND public.field_ops_associate(NEW.assignee_id)
    AND NOT public.field_ops_phase_ready(NEW.site_id,NEW.visit_type) THEN
    RAISE EXCEPTION 'Complete all required phase work and approval before completing this visit';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.field_ops_complete_visit(_visit UUID, _delayed BOOLEAN DEFAULT false, _reason TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.field_visit_schedules; s public.sites;
BEGIN
  SELECT * INTO v FROM field_visit_schedules WHERE id=_visit FOR UPDATE;
  SELECT * INTO s FROM sites WHERE id=v.site_id;
  IF v.id IS NULL OR s.id IS NULL OR auth.uid() IS NULL OR NOT public.field_ops_associate(auth.uid()) OR NOT coalesce(auth.uid() = ANY(public.field_ops_worker_ids(s)),false)
    OR NOT coalesce(v.assignee_id = ANY(public.field_ops_worker_ids(s)),false) THEN RAISE EXCEPTION 'Visit not found or access denied'; END IF;
  IF NOT coalesce((SELECT online FROM field_attendance_events WHERE associate_id=auth.uid() AND work_date=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY occurred_at DESC LIMIT 1),false) THEN RAISE EXCEPTION 'Mark online first'; END IF;
  IF v.status = 'completed' THEN RETURN; END IF;
  IF _delayed THEN
    IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A delay reason is required'; END IF;
    UPDATE field_visit_schedules SET status='delayed',delay_reason=trim(_reason),updated_at=now() WHERE id=_visit;
  ELSE
    IF v.visit_type <> 'follow_up' AND NOT public.field_ops_phase_ready(v.site_id,v.visit_type) THEN RAISE EXCEPTION 'Complete all required phase work and approval before completing this visit'; END IF;
    UPDATE field_visit_schedules SET status='completed',completed_at=now(),updated_at=now(),delay_reason=NULL WHERE id=_visit;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';



-- Source migration: 20261006150000_manager_device_attendance.sql
-- Additive office/device attendance. No existing field attendance/payroll functions are changed.

CREATE TABLE public.attendance_devices (
  id text PRIMARY KEY CHECK (id = 'office'),
  label text NOT NULL DEFAULT 'Office face device',
  broker_host text NOT NULL DEFAULT '62.72.43.204',
  broker_port integer NOT NULL DEFAULT 1883,
  last_heartbeat_at timestamptz,
  last_scan_at timestamptz
);
INSERT INTO public.attendance_devices(id) VALUES ('office');
CREATE TABLE public.attendance_settings (
  effective_from date PRIMARY KEY,
  shift_start time NOT NULL,
  grace_minutes integer NOT NULL CHECK (grace_minutes BETWEEN 0 AND 120),
  absence_cutoff time,
  working_days integer[] NOT NULL CHECK (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ ARRAY[0,1,2,3,4,5,6]),
  holidays date[] NOT NULL DEFAULT '{}',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extract(epoch FROM absence_cutoff) > extract(epoch FROM shift_start) + grace_minutes * 60)
);
-- User confirmed 10 AM; choose 15 minutes from the allowed 10-15 minute range.
-- Leave absence cutoff unset until the manager confirms the working calendar.
INSERT INTO public.attendance_settings(effective_from,shift_start,grace_minutes,working_days)
VALUES((now() AT TIME ZONE 'Asia/Kolkata')::date,'10:00',15,ARRAY[0,1,2,3,4,5,6]);
CREATE TABLE public.attendance_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL DEFAULT 'office' REFERENCES public.attendance_devices(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  department text NOT NULL CHECK (department IN ('firmware','hardware','logistic','software','manager')),
  enroll_id text NOT NULL CHECK (length(btrim(enroll_id)) BETWEEN 1 AND 64),
  email text CHECK (email IS NULL OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  email_verified boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  employment_start date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  deactivated_at timestamptz,
  enrollment_status text NOT NULL DEFAULT 'pending' CHECK (enrollment_status IN ('pending','enrolled','failed')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id,enroll_id)
);
CREATE UNIQUE INDEX attendance_employee_email ON public.attendance_employees(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE public.attendance_device_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','publishing','published','acknowledged','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE UNIQUE INDEX attendance_one_open_command ON public.attendance_device_commands(employee_id) WHERE status IN ('pending','publishing','published');
CREATE INDEX ON public.attendance_device_commands(next_attempt_at) WHERE status IN ('pending','publishing','published');
CREATE TABLE public.attendance_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL REFERENCES public.attendance_devices(id),
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 128),
  enroll_id text NOT NULL CHECK (length(enroll_id) BETWEEN 1 AND 64),
  employee_id uuid REFERENCES public.attendance_employees(id),
  scanned_at timestamptz NOT NULL,
  recognized boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  work_date date NOT NULL,
  validation_state text NOT NULL CHECK (validation_state IN ('valid','unknown_employee','inactive_employee','invalid_time','failed_recognition')),
  UNIQUE(device_id,event_id)
);
CREATE INDEX ON public.attendance_scan_events(employee_id,work_date,scanned_at);
CREATE TABLE public.attendance_daily_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.attendance_employees(id),
  work_date date NOT NULL,
  first_event_id uuid NOT NULL REFERENCES public.attendance_scan_events(id),
  entry_at timestamptz NOT NULL,
  employee_name text NOT NULL,
  department text NOT NULL,
  policy_snapshot jsonb,
  late_minutes integer,
  UNIQUE(employee_id,work_date)
);
CREATE TABLE public.attendance_photos (
  event_id uuid PRIMARY KEY REFERENCES public.attendance_scan_events(id),
  storage_path text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','deleted')),
  deleted_at timestamptz
);
CREATE INDEX ON public.attendance_photos(expires_at) WHERE status <> 'deleted';
CREATE TABLE public.attendance_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.attendance_employees(id),
  sender_email text,
  start_date date,
  end_date date,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  source text NOT NULL CHECK (source IN ('manual','email')),
  message_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','needs_review','approved','rejected','cancelled')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX ON public.attendance_leave_requests(employee_id,start_date,end_date);
CREATE TABLE public.attendance_device_health (
  work_date date PRIMARY KEY,
  first_heartbeat_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  gap_detected boolean NOT NULL
);
CREATE TABLE public.attendance_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  record_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Read access only for managers. All writes use guarded RPCs or service-role functions.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_devices','attendance_settings','attendance_employees','attendance_device_commands','attendance_scan_events','attendance_daily_records','attendance_photos','attendance_leave_requests','attendance_device_health','attendance_audit_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
    EXECUTE format('CREATE POLICY attendance_manager_read ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(),''supervisor''))',t);
  END LOOP;
END $$;

CREATE FUNCTION public.attendance_assert_manager() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'supervisor') THEN RAISE EXCEPTION 'Manager access required' USING ERRCODE = '42501'; END IF;
END $$;

CREATE FUNCTION public.attendance_save_employee(_name text,_department text,_enroll_id text,_email text DEFAULT NULL,_email_verified boolean DEFAULT false,_start date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE employee uuid; BEGIN
  PERFORM attendance_assert_manager();
  IF _start > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Employment start cannot be in the future'; END IF;
  INSERT INTO attendance_employees(name,department,enroll_id,email,email_verified,employment_start,created_by)
    VALUES(btrim(_name),_department,btrim(_enroll_id),nullif(lower(btrim(_email)),''),_email_verified AND nullif(btrim(_email),'') IS NOT NULL,coalesce(_start,(now() AT TIME ZONE 'Asia/Kolkata')::date),auth.uid()) RETURNING id INTO employee;
  INSERT INTO attendance_device_commands(employee_id) VALUES(employee);
  INSERT INTO attendance_audit_logs(actor_id,action,record_id) VALUES(auth.uid(),'employee_created',employee);
  RETURN employee;
END $$;

CREATE FUNCTION public.attendance_retry_enrollment(_employee uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  PERFORM 1 FROM attendance_employees WHERE id=_employee AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee not found'; END IF;
  IF EXISTS(SELECT 1 FROM attendance_device_commands WHERE employee_id=_employee AND status IN ('pending','publishing','published')) THEN RETURN; END IF;
  INSERT INTO attendance_device_commands(employee_id) VALUES(_employee);
  UPDATE attendance_employees SET enrollment_status='pending' WHERE id=_employee;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id) VALUES(auth.uid(),'enrollment_retried',_employee);
END $$;

CREATE FUNCTION public.attendance_set_active(_employee uuid,_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  IF _active IS NULL THEN RAISE EXCEPTION 'Active state required'; END IF;
  UPDATE attendance_employees SET active=_active,deactivated_at=CASE WHEN _active THEN NULL ELSE clock_timestamp() END WHERE id=_employee;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details) VALUES(auth.uid(),'employee_active_changed',_employee,jsonb_build_object('active',_active,'device_sync',false));
END $$;

CREATE FUNCTION public.attendance_save_settings(_start time,_grace integer,_cutoff time,_days integer[],_holidays date[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  IF _start IS NULL OR _grace IS NULL OR _cutoff IS NULL OR _days IS NULL THEN RAISE EXCEPTION 'Complete office timing and working days required'; END IF;
  INSERT INTO attendance_settings VALUES((now() AT TIME ZONE 'Asia/Kolkata')::date,_start,_grace,_cutoff,_days,coalesce(_holidays,'{}'),auth.uid(),now())
    ON CONFLICT(effective_from) DO UPDATE SET shift_start=excluded.shift_start,grace_minutes=excluded.grace_minutes,absence_cutoff=excluded.absence_cutoff,working_days=excluded.working_days,holidays=excluded.holidays,updated_by=auth.uid(),updated_at=now();
  INSERT INTO attendance_audit_logs(actor_id,action,details) VALUES(auth.uid(),'settings_saved',jsonb_build_object('start',_start,'grace',_grace,'cutoff',_cutoff,'days',_days,'holidays',_holidays));
END $$;

CREATE FUNCTION public.attendance_create_leave(_employee uuid,_start date,_end date,_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE request uuid; BEGIN
  PERFORM attendance_assert_manager();
  IF _start IS NULL OR _end IS NULL OR _employee IS NULL THEN RAISE EXCEPTION 'Employee and dates required'; END IF;
  PERFORM 1 FROM attendance_employees WHERE id=_employee AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee not found'; END IF;
  INSERT INTO attendance_leave_requests(employee_id,start_date,end_date,reason,source) VALUES(_employee,_start,_end,btrim(_reason),'manual') RETURNING id INTO request;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id) VALUES(auth.uid(),'leave_created',request);
  RETURN request;
END $$;

CREATE FUNCTION public.attendance_review_leave(_request uuid,_decision text,_comment text DEFAULT NULL,_employee uuid DEFAULT NULL,_start date DEFAULT NULL,_end date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE r attendance_leave_requests; BEGIN
  PERFORM attendance_assert_manager();
  IF _decision NOT IN ('approved','rejected','cancelled') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO r FROM attendance_leave_requests WHERE id=_request FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status NOT IN ('pending','needs_review') AND NOT (r.status='approved' AND _decision='cancelled') THEN RAISE EXCEPTION 'Request already reviewed'; END IF;
  r.employee_id := coalesce(_employee,r.employee_id); r.start_date := coalesce(_start,r.start_date); r.end_date := coalesce(_end,r.end_date);
  IF _decision='approved' THEN
    IF r.employee_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL OR r.end_date < r.start_date THEN RAISE EXCEPTION 'Employee and valid dates required for approval'; END IF;
    PERFORM 1 FROM attendance_employees WHERE id=r.employee_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
    IF EXISTS(SELECT 1 FROM attendance_leave_requests WHERE id<>r.id AND employee_id=r.employee_id AND status='approved' AND start_date<=r.end_date AND end_date>=r.start_date) THEN RAISE EXCEPTION 'Approved leave already covers these dates'; END IF;
  END IF;
  UPDATE attendance_leave_requests SET employee_id=r.employee_id,start_date=r.start_date,end_date=r.end_date,status=_decision,reviewed_by=auth.uid(),reviewed_at=now(),comment=left(_comment,1000) WHERE id=_request;
  INSERT INTO attendance_audit_logs(actor_id,action,record_id,details) VALUES(auth.uid(),'leave_reviewed',_request,jsonb_build_object('decision',_decision,'comment',left(_comment,1000)));
END $$;

-- Service-only atomic ingestion: event identity is immutable; duplicates may retry photos.
CREATE FUNCTION public.attendance_ingest_scan(_event_id text,_enroll_id text,_scanned_at timestamptz,_recognized boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e attendance_employees; s attendance_scan_events; p attendance_settings; d date; state text; threshold timestamptz; minutes integer; prior attendance_daily_records;
BEGIN
  IF _scanned_at IS NULL OR _event_id IS NULL OR _enroll_id IS NULL OR _recognized IS NULL THEN RAISE EXCEPTION 'Missing scan fields'; END IF;
  d := (_scanned_at AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT * INTO e FROM attendance_employees WHERE device_id='office' AND enroll_id=_enroll_id;
  state := CASE WHEN NOT _recognized THEN 'failed_recognition' WHEN _scanned_at>now()+interval '5 minutes' OR _scanned_at<now()-interval '90 days' THEN 'invalid_time' WHEN e.id IS NULL THEN 'unknown_employee' WHEN d<e.employment_start OR (e.deactivated_at IS NOT NULL AND _scanned_at>e.deactivated_at) THEN 'inactive_employee' ELSE 'valid' END;
  INSERT INTO attendance_scan_events(device_id,event_id,enroll_id,employee_id,scanned_at,recognized,work_date,validation_state) VALUES('office',_event_id,_enroll_id,e.id,_scanned_at,_recognized,d,state) ON CONFLICT(device_id,event_id) DO NOTHING RETURNING * INTO s;
  IF s.id IS NULL THEN
    SELECT * INTO s FROM attendance_scan_events WHERE device_id='office' AND event_id=_event_id;
    IF s.enroll_id<>_enroll_id OR s.scanned_at<>_scanned_at OR s.recognized<>_recognized THEN RAISE EXCEPTION 'Event ID reused with different scan details'; END IF;
    RETURN jsonb_build_object('id',s.id,'state',s.validation_state,'duplicate',true,'expires_at',s.scanned_at+interval '24 hours');
  END IF;
  UPDATE attendance_devices SET last_scan_at=clock_timestamp() WHERE id='office';
  IF state='valid' THEN
    -- Serialize aggregation per employee/date, including the first concurrent scan.
    PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text||d::text,0));
    SELECT * INTO prior FROM attendance_daily_records WHERE employee_id=e.id AND work_date=d;
    SELECT * INTO p FROM attendance_settings WHERE effective_from<=d ORDER BY effective_from DESC LIMIT 1;
    IF prior.id IS NOT NULL THEN
      threshold := ((d + (prior.policy_snapshot->>'shift_start')::time) AT TIME ZONE 'Asia/Kolkata') + (prior.policy_snapshot->>'grace_minutes')::integer*interval '1 minute';
    ELSIF p.effective_from IS NOT NULL THEN
      threshold := ((d+p.shift_start) AT TIME ZONE 'Asia/Kolkata') + p.grace_minutes*interval '1 minute';
    END IF;
    minutes := CASE WHEN threshold IS NULL THEN NULL ELSE greatest(0,ceil(extract(epoch FROM (_scanned_at-threshold))/60)::integer) END;
    INSERT INTO attendance_daily_records(employee_id,work_date,first_event_id,entry_at,employee_name,department,policy_snapshot,late_minutes)
      VALUES(e.id,d,s.id,_scanned_at,e.name,e.department,CASE WHEN p.effective_from IS NULL THEN NULL ELSE to_jsonb(p) END,minutes)
      ON CONFLICT(employee_id,work_date) DO UPDATE SET first_event_id=excluded.first_event_id,entry_at=excluded.entry_at,late_minutes=excluded.late_minutes WHERE excluded.entry_at<attendance_daily_records.entry_at;
    IF prior.id IS NOT NULL AND _scanned_at<prior.entry_at THEN
      INSERT INTO attendance_audit_logs(action,record_id,details) VALUES('earlier_scan_received',prior.id,jsonb_build_object('before',prior.entry_at,'after',_scanned_at));
    END IF;
  END IF;
  RETURN jsonb_build_object('id',s.id,'state',state,'duplicate',false,'expires_at',_scanned_at+interval '24 hours');
END $$;

CREATE FUNCTION public.attendance_heartbeat() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE stamp timestamptz := clock_timestamp(); d date; p attendance_settings; BEGIN
  d := (stamp AT TIME ZONE 'Asia/Kolkata')::date;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=d ORDER BY effective_from DESC LIMIT 1;
  UPDATE attendance_devices SET last_heartbeat_at=stamp WHERE id='office';
  INSERT INTO attendance_device_health VALUES(d,stamp,stamp,p.effective_from IS NULL OR p.absence_cutoff IS NULL OR stamp>((d+p.shift_start) AT TIME ZONE 'Asia/Kolkata')+interval '5 minutes')
  ON CONFLICT(work_date) DO UPDATE SET last_heartbeat_at=excluded.last_heartbeat_at,gap_detected=attendance_device_health.gap_detected OR (excluded.last_heartbeat_at-attendance_device_health.last_heartbeat_at>interval '5 minutes' AND excluded.last_heartbeat_at>((d+p.shift_start) AT TIME ZONE 'Asia/Kolkata') AND (attendance_device_health.last_heartbeat_at AT TIME ZONE 'Asia/Kolkata')::time < p.absence_cutoff);
END $$;

CREATE FUNCTION public.attendance_claim_commands(_employee uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE result jsonb; BEGIN
  UPDATE attendance_device_commands SET status='failed',error='Device acknowledgment not received; review before retry' WHERE status='published' AND next_attempt_at<=now();
  UPDATE attendance_device_commands SET status='failed',error='Publish retry limit reached; review before retry' WHERE status='publishing' AND attempts>=5 AND lease_until<now();
  UPDATE attendance_employees e SET enrollment_status='failed' WHERE EXISTS(SELECT 1 FROM attendance_device_commands c WHERE c.employee_id=e.id AND c.status='failed') AND NOT EXISTS(SELECT 1 FROM attendance_device_commands c WHERE c.employee_id=e.id AND c.status IN ('pending','publishing','published')) AND e.enrollment_status<>'enrolled';
  WITH claimed AS (
    SELECT c.id FROM attendance_device_commands c JOIN attendance_employees e ON e.id=c.employee_id WHERE e.active AND (_employee IS NULL OR c.employee_id=_employee) AND c.attempts<5 AND ((c.status='pending' AND c.next_attempt_at<=now()) OR (c.status='publishing' AND c.lease_until<now())) ORDER BY c.created_at FOR UPDATE OF c SKIP LOCKED LIMIT 5
  ), changed AS (
    UPDATE attendance_device_commands c SET status='publishing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' FROM claimed WHERE c.id=claimed.id RETURNING c.*
  ) SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('name',e.name,'department',e.department,'enroll_id',e.enroll_id)),'[]') INTO result FROM changed c JOIN attendance_employees e ON e.id=c.employee_id;
  RETURN result;
END $$;

CREATE FUNCTION public.attendance_finish_command(_id uuid,_lease uuid,_sent boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
  UPDATE attendance_device_commands SET status=CASE WHEN _sent THEN 'published' WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,error=CASE WHEN _sent THEN NULL ELSE 'Publishing failed; check integration configuration or connectivity' END,next_attempt_at=now()+CASE WHEN _sent THEN interval '10 minutes' ELSE least(3600,power(2,attempts)::integer*30)*interval '1 second' END,lease_until=NULL
    WHERE id=_id AND lease_token=_lease AND status='publishing';
  UPDATE attendance_employees e SET enrollment_status='failed' FROM attendance_device_commands c WHERE c.id=_id AND c.employee_id=e.id AND c.status='failed';
END $$;

CREATE FUNCTION public.attendance_ack_command(_id uuid,_enroll_id text,_success boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE employee uuid; BEGIN
  IF _success IS NULL THEN RAISE EXCEPTION 'Acknowledgment success required'; END IF;
  SELECT c.employee_id INTO employee FROM attendance_device_commands c JOIN attendance_employees e ON e.id=c.employee_id WHERE c.id=_id AND e.enroll_id=_enroll_id FOR UPDATE OF c;
  IF employee IS NULL THEN RAISE EXCEPTION 'Unknown enrollment command'; END IF;
  -- Ignore responses to superseded commands and repeated terminal acknowledgments.
  IF EXISTS(SELECT 1 FROM attendance_device_commands WHERE employee_id=employee AND created_at>(SELECT created_at FROM attendance_device_commands WHERE id=_id)) OR EXISTS(SELECT 1 FROM attendance_device_commands WHERE id=_id AND status='acknowledged') THEN RETURN; END IF;
  UPDATE attendance_device_commands SET status=CASE WHEN _success THEN 'acknowledged' ELSE 'failed' END,acknowledged_at=now(),error=CASE WHEN _success THEN NULL ELSE 'Device rejected enrollment' END WHERE id=_id;
  UPDATE attendance_employees SET enrollment_status=CASE WHEN _success THEN 'enrolled' ELSE 'failed' END WHERE id=employee;
  INSERT INTO attendance_audit_logs(action,record_id,details) VALUES('device_enrollment_ack',_id,jsonb_build_object('success',_success));
END $$;

CREATE FUNCTION public.attendance_email_leave(_message_id text,_sender text,_start date,_end date,_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ DECLARE employee uuid; request uuid; review boolean; BEGIN
  SELECT id INTO employee FROM attendance_employees WHERE lower(email)=lower(_sender) AND email_verified AND active;
  review := employee IS NULL OR _start IS NULL OR _end IS NULL OR _end<_start OR EXISTS(SELECT 1 FROM attendance_leave_requests WHERE employee_id=employee AND status IN ('pending','approved') AND start_date<=_end AND end_date>=_start);
  INSERT INTO attendance_leave_requests(employee_id,sender_email,start_date,end_date,reason,source,message_id,status) VALUES(employee,left(_sender,254),CASE WHEN _end>=_start THEN _start END,CASE WHEN _end>=_start THEN _end END,left(_reason,2000),'email',_message_id,CASE WHEN review THEN 'needs_review' ELSE 'pending' END) ON CONFLICT(message_id) DO NOTHING RETURNING id INTO request;
  RETURN coalesce(request,(SELECT id FROM attendance_leave_requests WHERE message_id=_message_id));
END $$;

CREATE FUNCTION public.attendance_board(_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ DECLARE result jsonb; p attendance_settings; BEGIN
  PERFORM attendance_assert_manager();
  IF _date IS NULL THEN RAISE EXCEPTION 'Date required'; END IF;
  SELECT * INTO p FROM attendance_settings WHERE effective_from<=_date ORDER BY effective_from DESC LIMIT 1;
  SELECT jsonb_build_object(
    'settings',(SELECT to_jsonb(s) FROM attendance_settings s ORDER BY effective_from DESC LIMIT 1),
    'device',(SELECT to_jsonb(d)||jsonb_build_object('state',CASE WHEN last_heartbeat_at IS NULL THEN 'unknown' WHEN last_heartbeat_at<now()-interval '5 minutes' THEN 'offline' ELSE 'online' END) FROM attendance_devices d WHERE id='office'),
    'employees',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.name),'[]') FROM attendance_employees e),
    'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id',e.id,'name',coalesce(r.employee_name,e.name),'department',coalesce(r.department,e.department),'enroll_id',e.enroll_id,'entry_at',r.entry_at,'late_minutes',r.late_minutes,'event_id',r.first_event_id,'photo_expires_at',ph.expires_at,'photo_status',ph.status,'leave_conflict',r.id IS NOT NULL AND l.id IS NOT NULL,'status',CASE
      WHEN r.id IS NOT NULL AND l.id IS NOT NULL THEN 'needs_review'
      WHEN r.id IS NOT NULL AND r.late_minutes IS NULL THEN 'needs_review'
      WHEN r.id IS NOT NULL AND r.late_minutes>0 THEN 'late'
      WHEN r.id IS NOT NULL THEN 'present'
      WHEN l.id IS NOT NULL THEN 'on_leave'
      WHEN p.effective_from IS NULL OR p.absence_cutoff IS NULL THEN 'needs_review'
      WHEN NOT extract(dow FROM _date)::integer=ANY(p.working_days) OR _date=ANY(p.holidays) THEN 'off_day'
      WHEN now()<((_date+p.absence_cutoff) AT TIME ZONE 'Asia/Kolkata') THEN 'awaiting_scan'
      WHEN h.work_date IS NOT NULL AND NOT h.gap_detected AND h.last_heartbeat_at>=((_date+p.absence_cutoff) AT TIME ZONE 'Asia/Kolkata') THEN 'absent'
      ELSE 'needs_review' END) ORDER BY coalesce(r.employee_name,e.name)),'[]') FROM attendance_employees e
      LEFT JOIN attendance_daily_records r ON r.employee_id=e.id AND r.work_date=_date
      LEFT JOIN attendance_photos ph ON ph.event_id=r.first_event_id
      LEFT JOIN LATERAL(SELECT id FROM attendance_leave_requests WHERE employee_id=e.id AND status='approved' AND _date BETWEEN start_date AND end_date LIMIT 1) l ON true
      LEFT JOIN attendance_device_health h ON h.work_date=_date
      WHERE r.id IS NOT NULL OR (e.employment_start<=_date AND (e.deactivated_at IS NULL OR (e.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date>=_date))),
    'leaves',(SELECT coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('employee_name',e.name) ORDER BY l.created_at DESC),'[]') FROM (SELECT * FROM attendance_leave_requests ORDER BY created_at DESC LIMIT 200) l LEFT JOIN attendance_employees e ON e.id=l.employee_id),
    'review_events',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.received_at DESC),'[]') FROM (SELECT * FROM attendance_scan_events WHERE work_date=_date AND validation_state<>'valid' ORDER BY received_at DESC LIMIT 100) s),
    'server_time',now()
  ) INTO result;
  RETURN result;
END $$;

CREATE FUNCTION public.attendance_history(_employee uuid,_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$ BEGIN
  PERFORM attendance_assert_manager();
  RETURN jsonb_build_object(
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('photo_status',p.status,'photo_expires_at',p.expires_at) ORDER BY e.scanned_at),'[]') FROM attendance_scan_events e LEFT JOIN attendance_photos p ON p.event_id=e.id WHERE e.employee_id=_employee AND e.work_date=_date),
    'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.occurred_at DESC),'[]') FROM attendance_audit_logs a WHERE a.record_id IN (SELECT id FROM attendance_daily_records WHERE employee_id=_employee AND work_date=_date))
  );
END $$;

-- Explicit grants prevent public/anonymous invocation of privileged helpers.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'attendance_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
    IF f.proname IN ('attendance_assert_manager','attendance_save_employee','attendance_retry_enrollment','attendance_set_active','attendance_save_settings','attendance_create_leave','attendance_review_leave','attendance_board','attendance_history') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
  END LOOP;
END $$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('attendance-photos','attendance-photos',false,2097152,ARRAY['image/jpeg','image/png']) ON CONFLICT(id) DO NOTHING;
-- No authenticated storage policy: photo access is issued by the guarded Edge Function only.



-- Source migration: 20261006160000_attendance_direct_mqtt.sql
-- Optional request-scoped MQTT enrollment; existing HTTP bridge flow is unchanged.

CREATE OR REPLACE FUNCTION public.attendance_mqtt_finish_command(_id uuid,_lease uuid,_outcome text,_ack boolean DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c attendance_device_commands;
BEGIN
  IF _outcome IS NULL OR _outcome NOT IN ('not_sent','uncertain','published') OR (_ack IS NOT NULL AND _outcome<>'published') THEN RAISE EXCEPTION 'Invalid MQTT outcome'; END IF;
  SELECT * INTO c FROM attendance_device_commands WHERE id=_id AND lease_token=_lease AND status='publishing' FOR UPDATE;
  IF c.id IS NULL THEN RETURN; END IF;
  IF _ack IS NOT NULL THEN
    PERFORM attendance_ack_command(_id,(SELECT enroll_id FROM attendance_employees WHERE id=c.employee_id),_ack);
    RETURN;
  END IF;
  UPDATE attendance_device_commands SET
    status=CASE WHEN _outcome='published' THEN 'published' WHEN _outcome='uncertain' OR attempts>=5 THEN 'failed' ELSE 'pending' END,
    error=CASE WHEN _outcome='published' THEN NULL WHEN _outcome='uncertain' THEN 'MQTT send outcome unknown; verify device registration before retry' ELSE 'MQTT connection failed before enrollment was sent' END,
    next_attempt_at=now()+CASE WHEN _outcome='published' THEN interval '10 minutes' ELSE interval '1 minute' END,
    lease_until=NULL
  WHERE id=_id;
  UPDATE attendance_employees SET enrollment_status='failed' WHERE id=c.employee_id AND EXISTS(SELECT 1 FROM attendance_device_commands WHERE id=_id AND status='failed');
END $$;
REVOKE ALL ON FUNCTION public.attendance_mqtt_finish_command(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_mqtt_finish_command(uuid,uuid,text,boolean) TO service_role;


COMMIT;

SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
