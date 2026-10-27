-- Deduct configured 2-core wire Qty/Kit for each selected YHDC CT sensor.
-- Preserve deduction timing, one-time markers and all other requirements.
-- No existing stock balances, orders or deduction records are updated.
BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_dispatch_requirements(_order public.inventory_materials) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE requirements jsonb:='[]'::jsonb; keys text[]; key text; b inventory_bom_items;
  ct_count integer; proxy_count integer; definitions integer; label text; dm_selected boolean; without_cavli boolean;
BEGIN
  IF coalesce(_order.quantity,1)<>1 THEN RAISE EXCEPTION 'Each device order must contain exactly one Data Meter'; END IF;
  ct_count:=CASE WHEN public.inventory_dispatch_selected(_order.ct3) THEN 3 WHEN public.inventory_dispatch_selected(_order.ct2) THEN 2 WHEN public.inventory_dispatch_selected(_order.ct1) THEN 1 ELSE 0 END;
  dm_selected:=public.inventory_dispatch_selected(coalesce(public.inventory_dispatch_notes(_order.notes)->>'dm_selected','true'));
  without_cavli:=public.inventory_dispatch_selected(coalesce(public.inventory_dispatch_notes(_order.notes)->>'without_cavli','false'));
  -- Manager uplink is authoritative; retain existing Ethernet/unconfigured fallback.
  CASE regexp_replace(lower(coalesce(_order.uplink,'')),'[^a-z]','','g')
    WHEN 'lte' THEN without_cavli:=false;
    WHEN 'wifi' THEN without_cavli:=true;
    ELSE NULL;
  END CASE;
  keys:=CASE WHEN dm_selected THEN ARRAY['enclosuresticker','simcard','3dprintedenclosure','lcdpcb','motherboardpcb','cavlipcb','dinrailmountingclip'] ELSE ARRAY[]::text[] END;
  IF without_cavli THEN keys:=array_remove(keys,'cavlipcb'); END IF;
  IF public.inventory_dispatch_selected(_order.antenna) THEN keys:=keys||ARRAY['magneticmountantenna','rfcableantenna']; END IF;
  FOREACH key IN ARRAY keys LOOP
    SELECT count(*) INTO definitions FROM public.inventory_bom_items x WHERE x.active AND x.product_name='Data Meter' AND public.inventory_component_key(x.category)=key;
    IF definitions<>1 THEN RAISE EXCEPTION 'Configure exactly one active Qty/Kit definition for % (found %)',key,definitions; END IF;
    SELECT * INTO b FROM public.inventory_bom_items x WHERE x.active AND x.product_name='Data Meter' AND public.inventory_component_key(x.category)=key;
    IF b.quantity_per_kit<=0 THEN RAISE EXCEPTION 'Configure a positive Qty/Kit for %',b.category; END IF;
    requirements:=requirements||jsonb_build_array(jsonb_build_object('key',key,'category',b.category,'model',public.inventory_component_model(b.category,b.sensor_type),'quantity',b.quantity_per_kit,'unit',public.inventory_dispatch_unit(b.unit),'reason',CASE WHEN key IN ('magneticmountantenna','rfcableantenna') THEN 'Antenna kit selected' ELSE 'Data Meter Qty/Kit' END));
  END LOOP;
  -- Additional explicitly configured Data Meter components, excluding selected
  -- sensors, conditional antenna parts, fixed accessories, and manual items.
  FOR b IN SELECT x.* FROM public.inventory_bom_items x WHERE dm_selected AND x.active AND x.product_name='Data Meter' AND x.quantity_per_kit>0
    AND NOT (public.inventory_component_key(x.category)=ANY(ARRAY['enclosuresticker','simcard','3dprintedenclosure','lcdpcb','motherboardpcb','cavlipcb','dinrailmountingclip','magneticmountantenna','rfcableantenna','energymeter','energymeterctsensor','yhdcctsensor','rotaryencoder','vibrationsensor','proximitysensor','towerlight','box','powercordcable','panelboxdoorlock','uvprinting','cablegland','2corewire','3corewire','4corewire','zip ties','tape roll','formsheet','plcinterface']))
    AND (public.inventory_dispatch_notes(x.notes)->>'inventory_group'='Data Meter' OR EXISTS(
      SELECT 1 FROM public.inventory_stock s WHERE public.inventory_component_key(s.category)=public.inventory_component_key(x.category)
      AND public.inventory_dispatch_notes(s.notes)->>'inventory_group'='Data Meter'))
  LOOP
    requirements:=requirements||jsonb_build_array(jsonb_build_object('key',public.inventory_component_key(b.category),'category',b.category,'model',public.inventory_component_model(b.category,b.sensor_type),'quantity',b.quantity_per_kit,'unit',public.inventory_dispatch_unit(b.unit),'reason','Data Meter Qty/Kit'));
  END LOOP;
  FOREACH key IN ARRAY ARRAY['box','powercordcable','panelboxdoorlock','uvprinting','cablegland'] LOOP
    label:=CASE key WHEN 'box' THEN 'Packing Box' WHEN 'powercordcable' THEN 'POWER CORD CABLE' WHEN 'panelboxdoorlock' THEN 'PANEL BOX/DOOR/LOCK' WHEN 'uvprinting' THEN 'UV PRINTING' ELSE 'CABLE GLAND' END;
    requirements:=requirements||jsonb_build_array(jsonb_build_object('key',key,'category',label,'model','','quantity',CASE WHEN key='cablegland' THEN 3 ELSE 1 END,'unit','Nos','reason','Default accessory'));
  END LOOP;
  IF public.inventory_dispatch_selected(_order.energy_meter) THEN
    requirements:=requirements||jsonb_build_array(
      jsonb_build_object('key','energymeter','category','ENERGY METER','model','','quantity',1,'unit','Nos','reason','Energy meter selected'),
      jsonb_build_object('key','energymeterctsensor','category','ENERGY METER CT SENSOR','model','','quantity',3,'unit','Nos','reason','Compulsory energy-meter CT set'));
  END IF;
  IF ct_count>0 THEN
    SELECT count(*) INTO definitions FROM public.inventory_bom_items x
      WHERE x.active AND x.product_name='Data Meter' AND public.inventory_component_key(x.category)='2corewire';
    IF definitions<>1 THEN RAISE EXCEPTION 'Configure exactly one active Qty/Kit definition for 2 CORE WIRE (found %)',definitions; END IF;
    SELECT * INTO b FROM public.inventory_bom_items x
      WHERE x.active AND x.product_name='Data Meter' AND public.inventory_component_key(x.category)='2corewire';
    IF b.quantity_per_kit IS NULL OR b.quantity_per_kit<=0 THEN RAISE EXCEPTION 'Configure a positive Qty/Kit for 2 CORE WIRE'; END IF;
    IF public.inventory_dispatch_unit(b.unit)<>'Meter' THEN RAISE EXCEPTION 'Configure 2 CORE WIRE Qty/Kit in meters'; END IF;
    requirements:=requirements||jsonb_build_array(
      jsonb_build_object('key','yhdcctsensor','category','YHDC CT SENSOR','model','','quantity',ct_count,'unit','Nos','reason','Supply phase CT sensors'),
      jsonb_build_object('key','2corewire','category','2 CORE WIRE','model','','quantity',ct_count*b.quantity_per_kit,'unit','Meter','reason','YHDC CT count x 2-core wire Qty/Kit'));
  END IF;
  IF public.inventory_dispatch_selected(_order.encoder) THEN
    requirements:=requirements||jsonb_build_array(jsonb_build_object('key','rotaryencoder','category','ROTARY ENCODER','model','','quantity',1,'unit','Nos','reason','Encoder selected'));
  END IF;
  IF public.inventory_dispatch_selected(_order.vibration) THEN
    IF btrim(coalesce(_order.vibration_model,''))='' THEN RAISE EXCEPTION 'Choose the vibration sensor model before dispatch'; END IF;
    requirements:=requirements||jsonb_build_array(
      jsonb_build_object('key','vibrationsensor','category','VIBRATION SENSOR','model',public.inventory_component_model('',_order.vibration_model),'quantity',1,'unit','Nos','reason','Vibration sensor selected'),
      jsonb_build_object('key','4corewire','category','4 CORE WIRE','model','','quantity',5,'unit','Meter','reason','Vibration wiring'));
  END IF;
  proxy_count:=public.inventory_dispatch_selected(_order.proxy1)::integer+public.inventory_dispatch_selected(_order.proxy2)::integer;
  IF proxy_count>0 THEN
    IF btrim(coalesce(_order.proxy_model,''))<>'' AND public.inventory_component_model('',_order.proxy_model)<>'inductive' THEN RAISE EXCEPTION 'Proxy sensors must use the Inductive model'; END IF;
    requirements:=requirements||jsonb_build_array(
      jsonb_build_object('key','proximitysensor','category','PROXIMITY SENSOR','model','inductive','quantity',proxy_count,'unit','Nos','reason','Selected inductive proxy inputs'),
      jsonb_build_object('key','3corewire','category','3 CORE WIRE','model','','quantity',3,'unit','Meter','reason','Proxy wiring: fixed length per order'));
  END IF;
  IF public.inventory_dispatch_selected(_order.tower_light) THEN
    requirements:=requirements||jsonb_build_array(jsonb_build_object('key','towerlight','category','TOWER LIGHT','model','','quantity',1,'unit','Nos','reason','Tower light selected'));
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(requirements) r GROUP BY r->>'key',r->>'model' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate kit definitions match the same inventory item; correct the kit configuration before dispatch';
  END IF;
  RETURN requirements;
END $$;

REVOKE ALL ON FUNCTION public.inventory_dispatch_requirements(public.inventory_materials) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

