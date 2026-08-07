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
