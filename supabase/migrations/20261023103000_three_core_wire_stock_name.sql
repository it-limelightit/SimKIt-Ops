-- Match the existing stock item named 3 CORE to the 3 CORE WIRE requirement.
-- No stock quantities, prices, item names or existing deduction records change.
BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_component_key(_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE k
    WHEN 'enclousuresticker' THEN 'enclosuresticker'
    WHEN '3dprintenclosure' THEN '3dprintedenclosure'
    WHEN '3dprintenclousure' THEN '3dprintedenclosure'
    WHEN '3dprinterenclosure' THEN '3dprintedenclosure'
    WHEN '3dprinterenclousure' THEN '3dprintedenclosure'
    WHEN '3dprinterencloser' THEN '3dprintedenclosure'
    WHEN 'magneticmountanteena' THEN 'magneticmountantenna'
    WHEN 'antenna' THEN 'magneticmountantenna'
    WHEN 'rfcableanteena' THEN 'rfcableantenna'
    WHEN 'proximitrysensor' THEN 'proximitysensor'
    WHEN 'proxymetersensor' THEN 'proximitysensor'
    WHEN 'proxysensor' THEN 'proximitysensor'
    WHEN 'proxy1' THEN 'proximitysensor'
    WHEN 'proxy2' THEN 'proximitysensor'
    WHEN '3core' THEN '3corewire'
    WHEN 'encoder' THEN 'rotaryencoder'
    WHEN 'packingbox' THEN 'box'
    WHEN 'ziptie' THEN 'zip ties'
    WHEN 'zipties' THEN 'zip ties'
    WHEN 'zipetie' THEN 'zip ties'
    WHEN 'taperole' THEN 'tape roll'
    WHEN 'taperoll' THEN 'tape roll'
    WHEN 'taperolefragile' THEN 'tape roll'
    WHEN 'taperollfragile' THEN 'tape roll'
    ELSE CASE WHEN k IN ('vibrationsensorvibeq','vibrationsensoevibeq','vibrationsensoe') THEN 'vibrationsensor' ELSE k END
  END FROM (SELECT regexp_replace(lower(coalesce(_name,'')),'[^a-z0-9]','','g') k) n;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
