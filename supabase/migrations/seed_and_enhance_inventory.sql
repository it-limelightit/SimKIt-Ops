  -- ==========================================
-- SAFE SQL MIGRATION & SEEDING SCRIPT
-- ==========================================
-- This script ONLY modifies 'public.inventory_materials' and 'public.inventory_parcels'.
-- It does not alter, drop, or affect any other table, relation, or schema in your database.

-- 1. ADD NEW COLUMNS TO INVENTORY_MATERIALS (ONLY IF THEY DO NOT EXIST)
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

-- 2. CLEAR PREVIOUS MOCK TEST DATA TO PREVENT DUPLICATES ON RE-RUN
DELETE FROM public.inventory_materials WHERE device_id IN ('DM-027', 'DM-101', 'DM-099');
DELETE FROM public.inventory_parcels WHERE tracking_number = 'TRK-777888';

-- 3. INSERT TEST DEVICE DM-027 (Pure Temptation)
INSERT INTO public.inventory_materials (
  device_id, quantity, material_name, version, ota_key, ota_account, ct1, ct2, ct3, proxy1, proxy2, encoder, vibration, antenna, tower_light, submitted, energy_meter, plc, flash_size, vibration_model, proxy_model, state
) VALUES (
  'DM-027', 0, 'Pure Temptation (not working)', '1.0.180327', '5e97f426-d490-420d-9462-e94c878d8e98', 'kuldeepshrimali.limelight@gmail.com', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'FALSE', 'FALSE', 'TRUE', 'FALSE', 'TRUE', TRUE, 'FALSE', 'FALSE', 'Flash-16mb', 'renke', 'inductive', 'Available'
);

-- 4. INSERT TEST DEVICE DM-101 (Aatomize)
INSERT INTO public.inventory_materials (
  device_id, quantity, material_name, version, ota_key, ota_account, uplink, ct1, ct2, ct3, proxy1, proxy2, encoder, vibration, antenna, tower_light, submitted, energy_meter, plc, flash_size, vibration_model, installation_date, iccid, remark, state
) VALUES (
  'DM-101', 1, 'Aatomize', '3.0.1', '0bda416c-b70b-48a4-9b5f-f9be1ad54669', 'kuldeepshrimali.limelight@gmail.com', 'LTE', 'TRUE', 'TRUE', 'TRUE', 'FALSE', 'FALSE', 'FALSE', 'TRUE', 'TRUE', 'TRUE', TRUE, 'FALSE', 'FALSE', 'Flash-16mb', 'witmotion', '2026-06-26', '89918570407083025936', 'Three phase monitoring is done for state detection Channel A is used for CT based counting', 'Available'
);

-- 5. INSERT TEST DEVICE DM-099 (Live Stepper Transit Test)
INSERT INTO public.inventory_materials (
  device_id, quantity, material_name, version, state, tracking_number, location, industry, submitted, flash_size
) VALUES (
  'DM-099', 1, 'Active Gateway & SIM Kit', 'v3.2', 'In transit', 'TRK-777888', 'Delhi Hub', 'Steel', true, 'Flash-16mb'
);

-- 6. INSERT MATCHING PARCEL IN LOGISTICS FOR LIVE STEPPER PROGRESS
INSERT INTO public.inventory_parcels (
  parcel_name, tracking_number, carrier, status, location, notes
) VALUES (
  'High-Gain SIM Gateway Kit', 'TRK-777888', 'Delhivery', 'In transit', 'Delhi Hub', 'Package departed hub; ETA tomorrow'
);
