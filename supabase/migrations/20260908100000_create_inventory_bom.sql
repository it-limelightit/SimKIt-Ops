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
