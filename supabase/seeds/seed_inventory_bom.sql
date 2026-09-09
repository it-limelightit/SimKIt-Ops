-- Seeds the BOM & INVENTORY rows from:
-- Ramp_Up_Project_Detameter_Info.xlsx / BOM & INVENTORY
--
-- This file changes BOM definitions only. It does not create physical stock,
-- bulk orders, or inventory usage logs. It is safe to run more than once.

BEGIN;

WITH seed(category, quantity_per_kit, unit, required_by_default, min_quantity) AS (
  VALUES
    ('PANEL BOX/DOOR/LOCK', 1, 'Nos', true, 5),
    ('UV PRINTING', 1, 'Nos', true, 5),
    ('3D PRINT ENCLOUSURE', 1, 'Nos', true, 5),
    ('ENCLOUSURE STICKER', 1, 'Nos', true, 5),
    ('DIN RAIL MOUNTING CLIP', 2, 'Nos', true, 5),
    ('LCD PCB', 1, 'Nos', true, 5),
    ('MOTHER BOARD PCB', 1, 'Nos', true, 5),
    ('CAVLI PCB', 1, 'Nos', true, 5),
    ('SIM CARD', 1, 'Nos', true, 5),
    ('TOWER LIGHT', 1, 'Nos', true, 10),
    ('CABLE GLAND', 3, 'Nos', true, 15),
    ('POWER CORD CABLE', 1, 'Nos', true, 5),
    ('MAGNETIC MOUNT ANTEENA', 2, 'Nos', true, 10),
    ('RF CABLE (ANTEENA)', 2, 'Nos', true, 5),
    ('ENERGY METER CT SENSOR', 0, 'Nos', false, 5),
    ('ENERGY METER', 0, 'Nos', false, 5),
    ('YHDC CT SENSOR', 3, 'Nos', true, 5),
    ('22 OHM RESISTOR FOR CT', 3, 'Nos', true, 5),
    ('PROXIMITRY SENSOR', 1, 'Nos', true, 5),
    ('ROTARY ENCODER', 0, 'Nos', false, 5),
    ('VIBRATION SENSOE (VIBE Q)', 1, 'Nos', true, 5),
    ('4 CORE WIRE', 10, 'METER', true, 5),
    ('2 CORE WIRE', 15, 'Nos', true, 5),
    ('TAPE ROLE', 0, 'Nos', false, 5),
    ('ZIPE TIE', 0, 'PACKET', false, 5),
    ('BOX', 1, 'Nos', true, 5),
    ('FORM SHEET', 0, 'ROLL', false, 5)
)
UPDATE public.inventory_bom_items AS bom
SET
  quantity_per_kit = seed.quantity_per_kit,
  unit = seed.unit,
  required_by_default = seed.required_by_default,
  min_quantity = seed.min_quantity,
  active = true,
  updated_at = now()
FROM seed
WHERE bom.product_name = 'Data Meter'
  AND lower(trim(bom.category)) = lower(trim(seed.category));

WITH seed(category, quantity_per_kit, unit, required_by_default, min_quantity) AS (
  VALUES
    ('PANEL BOX/DOOR/LOCK', 1, 'Nos', true, 5),
    ('UV PRINTING', 1, 'Nos', true, 5),
    ('3D PRINT ENCLOUSURE', 1, 'Nos', true, 5),
    ('ENCLOUSURE STICKER', 1, 'Nos', true, 5),
    ('DIN RAIL MOUNTING CLIP', 2, 'Nos', true, 5),
    ('LCD PCB', 1, 'Nos', true, 5),
    ('MOTHER BOARD PCB', 1, 'Nos', true, 5),
    ('CAVLI PCB', 1, 'Nos', true, 5),
    ('SIM CARD', 1, 'Nos', true, 5),
    ('TOWER LIGHT', 1, 'Nos', true, 10),
    ('CABLE GLAND', 3, 'Nos', true, 15),
    ('POWER CORD CABLE', 1, 'Nos', true, 5),
    ('MAGNETIC MOUNT ANTEENA', 2, 'Nos', true, 10),
    ('RF CABLE (ANTEENA)', 2, 'Nos', true, 5),
    ('ENERGY METER CT SENSOR', 0, 'Nos', false, 5),
    ('ENERGY METER', 0, 'Nos', false, 5),
    ('YHDC CT SENSOR', 3, 'Nos', true, 5),
    ('22 OHM RESISTOR FOR CT', 3, 'Nos', true, 5),
    ('PROXIMITRY SENSOR', 1, 'Nos', true, 5),
    ('ROTARY ENCODER', 0, 'Nos', false, 5),
    ('VIBRATION SENSOE (VIBE Q)', 1, 'Nos', true, 5),
    ('4 CORE WIRE', 10, 'METER', true, 5),
    ('2 CORE WIRE', 15, 'Nos', true, 5),
    ('TAPE ROLE', 0, 'Nos', false, 5),
    ('ZIPE TIE', 0, 'PACKET', false, 5),
    ('BOX', 1, 'Nos', true, 5),
    ('FORM SHEET', 0, 'ROLL', false, 5)
)
INSERT INTO public.inventory_bom_items (
  product_name,
  category,
  quantity_per_kit,
  unit,
  required_by_default,
  min_quantity,
  active
)
SELECT
  'Data Meter',
  seed.category,
  seed.quantity_per_kit,
  seed.unit,
  seed.required_by_default,
  seed.min_quantity,
  true
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inventory_bom_items AS bom
  WHERE bom.product_name = 'Data Meter'
    AND lower(trim(bom.category)) = lower(trim(seed.category))
);

COMMIT;
