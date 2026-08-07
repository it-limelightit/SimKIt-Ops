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
