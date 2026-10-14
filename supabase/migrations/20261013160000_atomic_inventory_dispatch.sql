BEGIN;

-- Wire and Qty/Kit consumption can be fractional. Preserve existing balances.
ALTER TABLE public.inventory_stock ALTER COLUMN actual_quantity TYPE numeric(14,2) USING actual_quantity::numeric;
ALTER TABLE public.inventory_logs ALTER COLUMN quantity_changed TYPE numeric(14,2) USING quantity_changed::numeric;
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS unit_price_snapshot numeric(12,2);
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS consumed_value numeric(28,2);

CREATE TABLE IF NOT EXISTS public.inventory_dispatch_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.inventory_dispatch_excluded_orders (
  order_id uuid PRIMARY KEY,
  excluded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.inventory_dispatch_excluded_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_dispatch_excluded_orders FROM PUBLIC, anon, authenticated;
WITH activated AS (
  INSERT INTO public.inventory_dispatch_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING RETURNING id
)
INSERT INTO public.inventory_dispatch_excluded_orders(order_id)
  SELECT m.id FROM public.inventory_materials m WHERE EXISTS(SELECT 1 FROM activated)
  ON CONFLICT(order_id) DO NOTHING;

-- Keep an order-level receipt even if an inventory row/audit log is later deleted.
CREATE TABLE IF NOT EXISTS public.inventory_dispatch_deductions (
  order_id uuid PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id uuid,
  status text NOT NULL CHECK (status IN ('deducted','legacy_already_deducted')),
  trigger_status text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  consumed_value numeric(28,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.inventory_dispatch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_dispatch_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_dispatch_settings, public.inventory_dispatch_deductions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_dispatch_settings, public.inventory_dispatch_deductions TO authenticated;
DROP POLICY IF EXISTS inventory_dispatch_settings_read ON public.inventory_dispatch_settings;
DROP POLICY IF EXISTS inventory_dispatch_deductions_read ON public.inventory_dispatch_deductions;
CREATE POLICY inventory_dispatch_settings_read ON public.inventory_dispatch_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_dispatch_deductions_read ON public.inventory_dispatch_deductions FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.inventory_dispatch_notes(_notes text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF _notes IS NULL OR btrim(_notes)='' THEN RETURN '{}'::jsonb; END IF;
  BEGIN result:=_notes::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb; END;
  RETURN CASE WHEN jsonb_typeof(result)='object' THEN result ELSE '{}'::jsonb END;
END $$;

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

CREATE OR REPLACE FUNCTION public.inventory_component_model(_category text,_model text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE
    WHEN btrim(coalesce(_model,''))<>'' THEN regexp_replace(lower(_model),'[^a-z0-9]','','g')
    WHEN public.inventory_component_key(_category)='vibrationsensor' AND regexp_replace(lower(_category),'[^a-z0-9]','','g') LIKE '%vibeq%' THEN 'vibeq'
    ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_dispatch_unit(_unit text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE lower(btrim(coalesce(_unit,'Nos')))
    WHEN 'nos' THEN 'Nos' WHEN 'pcs' THEN 'Nos' WHEN 'pc' THEN 'Nos' WHEN 'units' THEN 'Nos'
    WHEN 'meter' THEN 'Meter' WHEN 'meters' THEN 'Meter' WHEN 'metre' THEN 'Meter' WHEN 'm' THEN 'Meter'
    WHEN 'packet' THEN 'Packets' WHEN 'packets' THEN 'Packets'
    WHEN 'roll' THEN 'Rolls' WHEN 'rolls' THEN 'Rolls'
    ELSE btrim(_unit) END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_dispatch_selected(_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT lower(btrim(coalesce(_value,''))) IN ('true','1','yes');
$$;

CREATE OR REPLACE FUNCTION public.inventory_dispatch_requirements(_order public.inventory_materials) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE requirements jsonb:='[]'::jsonb; keys text[]; key text; b inventory_bom_items;
  ct_count integer; proxy_count integer; definitions integer; label text;
BEGIN
  IF coalesce(_order.quantity,1)<>1 THEN RAISE EXCEPTION 'Each device order must contain exactly one Data Meter'; END IF;
  ct_count:=public.inventory_dispatch_selected(_order.ct1)::integer+public.inventory_dispatch_selected(_order.ct2)::integer+public.inventory_dispatch_selected(_order.ct3)::integer;
  IF ct_count NOT IN (0,3) THEN RAISE EXCEPTION 'Normal YHDC CT sensors must be selected as a complete set of 3 or none'; END IF;
  keys:=ARRAY['enclosuresticker','simcard','3dprintedenclosure','lcdpcb','motherboardpcb','cavlipcb','dinrailmountingclip','magneticmountantenna','rfcableantenna'];
  FOREACH key IN ARRAY keys LOOP
    SELECT count(*) INTO definitions FROM public.inventory_bom_items x WHERE x.active AND x.product_name='Data Meter' AND public.inventory_component_key(x.category)=key;
    IF definitions<>1 THEN RAISE EXCEPTION 'Configure exactly one active Qty/Kit definition for % (found %)',key,definitions; END IF;
    SELECT * INTO b FROM public.inventory_bom_items x WHERE x.active AND x.product_name='Data Meter' AND public.inventory_component_key(x.category)=key;
    IF b.quantity_per_kit<=0 THEN RAISE EXCEPTION 'Configure a positive Qty/Kit for %',b.category; END IF;
    requirements:=requirements||jsonb_build_array(jsonb_build_object('key',key,'category',b.category,'model',public.inventory_component_model(b.category,b.sensor_type),'quantity',b.quantity_per_kit,'unit',public.inventory_dispatch_unit(b.unit),'reason','Data Meter Qty/Kit'));
  END LOOP;
  -- Additional explicitly configured Data Meter components, excluding selected
  -- sensors, conditional antenna parts, fixed accessories, and manual items.
  FOR b IN SELECT x.* FROM public.inventory_bom_items x WHERE x.active AND x.product_name='Data Meter' AND x.quantity_per_kit>0
    AND NOT (public.inventory_component_key(x.category)=ANY(keys||ARRAY['magneticmountantenna','rfcableantenna','energymeter','energymeterctsensor','yhdcctsensor','rotaryencoder','vibrationsensor','proximitysensor','towerlight','box','powercordcable','panelboxdoorlock','uvprinting','cablegland','2corewire','4corewire','zip ties','tape roll','formsheet','plcinterface']))
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
  IF ct_count=3 THEN
    requirements:=requirements||jsonb_build_array(
      jsonb_build_object('key','yhdcctsensor','category','YHDC CT SENSOR','model','','quantity',3,'unit','Nos','reason','Normal CT set selected'),
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

CREATE OR REPLACE FUNCTION public.inventory_dispatch_stock_unit(_stock public.inventory_stock) RETURNS text
LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT public.inventory_dispatch_unit(coalesce(public.inventory_dispatch_notes(_stock.notes)->>'inventory_unit',
    (SELECT b.unit FROM public.inventory_bom_items b WHERE b.active AND b.product_name='Data Meter'
      AND public.inventory_component_key(b.category)=public.inventory_component_key(_stock.category)
      AND public.inventory_component_model(b.category,b.sensor_type)=public.inventory_component_model(_stock.category,_stock.sensor_type)
      ORDER BY b.created_at,b.id LIMIT 1),'Nos'));
$$;

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
  IF NEW.submitted IS DISTINCT FROM true OR status NOT IN ('shipped','transit','in transit','delivered','dispatched') THEN RETURN NEW; END IF;
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
  INSERT INTO public.inventory_dispatch_deductions(order_id,actor_id,status,trigger_status,items,consumed_value)
    VALUES(NEW.id,auth.uid(),'deducted',status,items,total_cost);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS inventory_dispatch_deduction ON public.inventory_materials;
CREATE TRIGGER inventory_dispatch_deduction AFTER INSERT OR UPDATE ON public.inventory_materials
  FOR EACH ROW EXECUTE FUNCTION public.inventory_dispatch_deduct_once();

-- Configure the user's existing stock names/models without replacing quantities,
-- prices, IDs, historical orders or deduction records.
UPDATE public.inventory_stock SET sensor_type='Inductive'
  WHERE public.inventory_component_key(category)='proximitysensor' AND btrim(coalesce(sensor_type,''))='';
UPDATE public.inventory_bom_items SET sensor_type='Inductive'
  WHERE public.inventory_component_key(category)='proximitysensor' AND btrim(coalesce(sensor_type,''))='';
UPDATE public.inventory_stock SET sensor_type='Vibe Q'
  WHERE public.inventory_component_key(category)='vibrationsensor'
    AND public.inventory_component_model(category,sensor_type)='vibeq' AND btrim(coalesce(sensor_type,''))='';
UPDATE public.inventory_bom_items SET sensor_type='Vibe Q'
  WHERE public.inventory_component_key(category)='vibrationsensor'
    AND public.inventory_component_model(category,sensor_type)='vibeq' AND btrim(coalesce(sensor_type,''))='';

-- These are rollout markers, not historical consumption. Their zero quantities
-- keep an older browser's log-existence check from deducting historical orders.
INSERT INTO public.inventory_logs(order_id,quantity_changed,change_type,consumed_value)
  SELECT m.id::text,0,'INVENTORY_SERVER_MANAGED',0 FROM public.inventory_materials m
  WHERE m.submitted IS TRUE AND NOT EXISTS(SELECT 1 FROM public.inventory_logs l WHERE l.order_id=m.id::text);

REVOKE ALL ON FUNCTION public.inventory_dispatch_requirements(public.inventory_materials), public.inventory_dispatch_deduct_once() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_dispatch_stock_unit(public.inventory_stock) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_dispatch_stock_unit(public.inventory_stock) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
