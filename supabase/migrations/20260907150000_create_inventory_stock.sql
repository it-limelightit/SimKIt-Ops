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
