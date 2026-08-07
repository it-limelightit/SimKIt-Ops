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
