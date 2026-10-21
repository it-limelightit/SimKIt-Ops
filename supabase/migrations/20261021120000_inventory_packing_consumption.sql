-- Apply packing deductions prospectively. Do not alter balances, logs or completed orders.
BEGIN;
LOCK TABLE public.inventory_materials IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.inventory_dispatch_settings ADD COLUMN IF NOT EXISTS packing_activated_at timestamptz;
ALTER TABLE public.inventory_dispatch_deductions ADD COLUMN IF NOT EXISTS packing_policy boolean NOT NULL DEFAULT false;
WITH activated AS (
  UPDATE public.inventory_dispatch_settings SET packing_activated_at=clock_timestamp()
  WHERE id=true AND packing_activated_at IS NULL RETURNING id
)
INSERT INTO public.inventory_dispatch_excluded_orders(order_id)
  SELECT m.id FROM public.inventory_materials m WHERE EXISTS(SELECT 1 FROM activated)
  AND lower(btrim(coalesce(public.inventory_dispatch_notes(m.notes)->>'logistics_status',m.state,'')))
      IN ('shipped','transit','in transit','delivered','dispatched')
  ON CONFLICT(order_id) DO NOTHING;

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
    AND NOT (public.inventory_component_key(x.category)=ANY(ARRAY['enclosuresticker','simcard','3dprintedenclosure','lcdpcb','motherboardpcb','cavlipcb','dinrailmountingclip','magneticmountantenna','rfcableantenna','energymeter','energymeterctsensor','yhdcctsensor','rotaryencoder','vibrationsensor','proximitysensor','towerlight','box','powercordcable','panelboxdoorlock','uvprinting','cablegland','2corewire','4corewire','zip ties','tape roll','formsheet','plcinterface']))
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
    requirements:=requirements||jsonb_build_array(
      jsonb_build_object('key','yhdcctsensor','category','YHDC CT SENSOR','model','','quantity',ct_count,'unit','Nos','reason','Supply phase CT sensors'),
      jsonb_build_object('key','2corewire','category','2 CORE WIRE','model','','quantity',12,'unit','Meter','reason','Normal CT wiring'));
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
    requirements:=requirements||jsonb_build_array(jsonb_build_object('key','proximitysensor','category','PROXIMITY SENSOR','model','inductive','quantity',proxy_count,'unit','Nos','reason','Selected inductive proxy inputs'));
  END IF;
  IF public.inventory_dispatch_selected(_order.tower_light) THEN
    requirements:=requirements||jsonb_build_array(jsonb_build_object('key','towerlight','category','TOWER LIGHT','model','','quantity',1,'unit','Nos','reason','Tower light selected'));
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(requirements) r GROUP BY r->>'key',r->>'model' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate kit definitions match the same inventory item; correct the kit configuration before dispatch';
  END IF;
  RETURN requirements;
END $$;

CREATE OR REPLACE FUNCTION public.inventory_dispatch_deduct_once() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE status text; cutoff timestamptz; requirements jsonb; requirement jsonb; s inventory_stock;
  available numeric; remaining numeric; consumed numeric; cost numeric; total_cost numeric:=0;
  items jsonb:='[]'::jsonb; receipt jsonb;
BEGIN
  status:=lower(btrim(coalesce(public.inventory_dispatch_notes(NEW.notes)->>'logistics_status',NEW.state,'')));
  -- Older browser bundles check for any order log before running their separate
  -- deduction loop. A zero-change marker makes them skip it, including Packing.
  IF NEW.submitted IS TRUE AND NOT EXISTS(SELECT 1 FROM public.inventory_logs WHERE order_id=NEW.id::text) THEN
    INSERT INTO public.inventory_logs(order_id,quantity_changed,change_type,consumed_value)
      VALUES(NEW.id::text,0,'INVENTORY_SERVER_MANAGED',0);
  END IF;
  IF NEW.submitted IS DISTINCT FROM true OR status NOT IN ('packing','in packing','in_packing','shipped','transit','in transit','delivered','dispatched') THEN RETURN NEW; END IF;
  -- Stock changes on entry into Packing. Keep the existing late-status fallback
  -- for orders that skip Packing, without deducting on unrelated field edits.
  IF TG_OP='UPDATE' AND status=lower(btrim(coalesce(public.inventory_dispatch_notes(OLD.notes)->>'logistics_status',OLD.state,''))) THEN RETURN NEW; END IF;
  SELECT activated_at INTO cutoff FROM public.inventory_dispatch_settings WHERE id=true;
  IF cutoff IS NULL OR NEW.created_at IS NULL OR NEW.created_at<cutoff
    OR EXISTS(SELECT 1 FROM public.inventory_dispatch_excluded_orders WHERE order_id=NEW.id) THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_dispatch_deductions WHERE order_id=NEW.id) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Inventory manager access required to dispatch an order' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_logs WHERE order_id=NEW.id::text AND change_type='DISPATCH_DEDUCTION') THEN
    INSERT INTO public.inventory_dispatch_deductions(order_id,actor_id,status,trigger_status)
      VALUES(NEW.id,auth.uid(),'legacy_already_deducted',status);
    RETURN NEW;
  END IF;
  IF public.inventory_dispatch_selected(coalesce(public.inventory_dispatch_notes(NEW.notes)->>'dm_selected','true'))
    AND btrim(coalesce(NEW.uplink,''))='' THEN
    RAISE EXCEPTION 'Select and save the uplink type in Hardware Configuration before marking In Packing';
  END IF;
  requirements:=public.inventory_dispatch_requirements(NEW);
  -- A stable lock order prevents two different device orders from deadlocking.
  PERFORM 1 FROM public.inventory_stock candidate WHERE public.inventory_component_key(candidate.category) IN (
    SELECT r->>'key' FROM jsonb_array_elements(requirements) r) ORDER BY candidate.id FOR UPDATE;
  FOR requirement IN SELECT value FROM jsonb_array_elements(requirements) LOOP
    SELECT coalesce(sum(candidate.actual_quantity),0) INTO available FROM public.inventory_stock candidate
      WHERE public.inventory_component_key(candidate.category)=requirement->>'key'
      AND public.inventory_component_model(candidate.category,candidate.sensor_type)=requirement->>'model'
      AND public.inventory_dispatch_stock_unit(candidate)=requirement->>'unit'
      AND candidate.actual_quantity>=0 AND coalesce(public.inventory_dispatch_notes(candidate.notes)->>'inventory_entry_type','')<>'bulk_order';
    IF available<(requirement->>'quantity')::numeric THEN
      RAISE EXCEPTION 'Insufficient stock: % %. Required % %, available % %. Check the inventory item, model and unit.',
        requirement->>'category',CASE WHEN requirement->>'model'='' THEN '' ELSE '('||(requirement->>'model')||')' END,
        requirement->>'quantity',requirement->>'unit',available,requirement->>'unit' USING ERRCODE='P0001';
    END IF;
  END LOOP;
  FOR requirement IN SELECT value FROM jsonb_array_elements(requirements) LOOP
    remaining:=(requirement->>'quantity')::numeric;
    FOR s IN SELECT x.* FROM public.inventory_stock x
      WHERE public.inventory_component_key(x.category)=requirement->>'key'
      AND public.inventory_component_model(x.category,x.sensor_type)=requirement->>'model'
      AND public.inventory_dispatch_stock_unit(x)=requirement->>'unit'
      AND x.actual_quantity>0 AND coalesce(public.inventory_dispatch_notes(x.notes)->>'inventory_entry_type','')<>'bulk_order'
      ORDER BY x.entry_date,x.created_at,x.id
    LOOP
      EXIT WHEN remaining<=0;
      consumed:=least(remaining,s.actual_quantity);
      cost:=round(consumed*s.unit_price,2);
      UPDATE public.inventory_stock SET actual_quantity=actual_quantity-consumed,updated_at=clock_timestamp() WHERE id=s.id;
      INSERT INTO public.inventory_logs(stock_id,order_id,quantity_changed,change_type,triggered_by,unit,unit_price_snapshot,consumed_value)
        VALUES(s.id,NEW.id::text,-consumed,'DISPATCH_DEDUCTION',auth.uid(),requirement->>'unit',s.unit_price,cost);
      receipt:=jsonb_build_object('stock_id',s.id,'category',s.category,'sensor_type',s.sensor_type,'quantity',consumed,'unit',requirement->>'unit','unit_price',s.unit_price,'consumed_value',cost,'remaining_quantity',s.actual_quantity-consumed,'reason',requirement->>'reason');
      items:=items||jsonb_build_array(receipt);
      total_cost:=total_cost+cost;
      remaining:=remaining-consumed;
    END LOOP;
    IF remaining>0 THEN RAISE EXCEPTION 'Inventory changed during deduction; no stock or status changes were saved'; END IF;
  END LOOP;
  INSERT INTO public.inventory_dispatch_deductions(order_id,actor_id,status,trigger_status,items,consumed_value,packing_policy)
    VALUES(NEW.id,auth.uid(),'deducted',status,items,total_cost,true);
  RETURN NEW;
END $$;


-- A deducted packing order must continue to describe the stock actually consumed.
-- Historical receipts retain their old behavior; courier, tracking and OTA edits remain allowed.
CREATE OR REPLACE FUNCTION public.inventory_packing_hardware_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_meta jsonb; new_meta jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.inventory_dispatch_deductions d
    WHERE d.order_id=OLD.id AND d.status='deducted' AND d.packing_policy) THEN RETURN NEW; END IF;
  old_meta:=public.inventory_dispatch_notes(OLD.notes);
  new_meta:=public.inventory_dispatch_notes(NEW.notes);
  IF NEW.id IS DISTINCT FROM OLD.id OR ROW(NEW.quantity,NEW.submitted,NEW.ct1,NEW.ct2,NEW.ct3,NEW.proxy1,NEW.proxy2,NEW.proxy_model,
      NEW.encoder,NEW.vibration,NEW.vibration_model,NEW.antenna,NEW.tower_light,NEW.energy_meter,NEW.plc)
    IS DISTINCT FROM ROW(OLD.quantity,OLD.submitted,OLD.ct1,OLD.ct2,OLD.ct3,OLD.proxy1,OLD.proxy2,OLD.proxy_model,
      OLD.encoder,OLD.vibration,OLD.vibration_model,OLD.antenna,OLD.tower_light,OLD.energy_meter,OLD.plc)
    OR regexp_replace(lower(coalesce(NEW.uplink,'')),'[^a-z]','','g')<>regexp_replace(lower(coalesce(OLD.uplink,'')),'[^a-z]','','g')
    OR coalesce(new_meta->>'dm_selected',old_meta->>'dm_selected','true')<>coalesce(old_meta->>'dm_selected','true')
    OR coalesce(new_meta->>'without_cavli',old_meta->>'without_cavli','false')<>coalesce(old_meta->>'without_cavli','false') THEN
    RAISE EXCEPTION 'Stock has already been deducted for this order. Hardware selections cannot be changed after In Packing';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inventory_packing_hardware_guard ON public.inventory_materials;
CREATE TRIGGER inventory_packing_hardware_guard BEFORE UPDATE ON public.inventory_materials
  FOR EACH ROW EXECUTE FUNCTION public.inventory_packing_hardware_guard();
REVOKE ALL ON FUNCTION public.inventory_packing_hardware_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.inventory_dispatch_requirements(public.inventory_materials) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
