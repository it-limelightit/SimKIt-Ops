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
