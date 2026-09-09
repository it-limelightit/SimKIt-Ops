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
