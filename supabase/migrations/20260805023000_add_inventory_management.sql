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
