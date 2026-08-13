-- Migration: Seed Jenil Thakar and logistics data entries

DO $$
DECLARE
  v_worker_id uuid;
  v_site_id uuid;
  v_material_id uuid;
  v_site_notes text;
  v_site_name text;
  v_site_address text;
  v_site_city text;
  v_meta jsonb;
  v_new_meta jsonb;
  v_new_notes text;
BEGIN
  -- 1. Check if Jenil Thakar already exists in profiles
  SELECT id INTO v_worker_id FROM public.profiles WHERE name ILIKE '%Jenil%' OR email = 'jenilthakar@gmail.com' LIMIT 1;

  -- 2. If not, insert into auth.users (trigger on_auth_user_created will auto-populate profiles and user_roles)
  IF v_worker_id IS NULL THEN
    v_worker_id := gen_random_uuid();
    
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at,
      phone,
      confirmed_at,
      is_sso_user
    ) VALUES (
      v_worker_id,
      '00000000-0000-0000-0000-000000000000',
      'jenilthakar@gmail.com',
      -- 'Password123!' encrypted using blowfish
      '$2a$10$wN1H9iCjY6r7wX2.jYVb4OuU6fBfPUpQ3vR95fX.u.Hn6v6T8iV1K',
      now(),
      '{"provider": "email", "providers": ["email"]}',
      '{"name": "Jenil Thakar", "mobile": "9876543210"}',
      false,
      now(),
      now(),
      NULL,
      now(),
      false
    );

    -- Activate profile
    UPDATE public.profiles
    SET is_active = true,
        name = 'Jenil Thakar',
        mobile = '9876543210',
        whatsapp = '9876543210'
    WHERE id = v_worker_id;

    -- Ensure he has worker role
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_worker_id, 'worker')
    ON CONFLICT DO NOTHING;
  END IF;

  -- 3. Seed/Sync companies: Motexo, Hi Will, Lexicon, Dolphin
  
  -- Company 1: Motexo
  SELECT id, name, company_name, address, city, task_notes INTO v_site_id, v_site_name, v_site_address, v_site_city, v_site_notes
  FROM public.sites
  WHERE name ILIKE '%Motexo%' OR company_name ILIKE '%Motexo%' LIMIT 1;

  IF v_site_id IS NOT NULL THEN
    -- Update site assignment & stage
    IF v_site_notes LIKE '[METADATA:%' THEN
      v_meta := substring(v_site_notes from '\[METADATA:(.*?)\]')::jsonb;
    ELSE
      v_meta := '{}'::jsonb;
    END IF;
    
    v_new_meta := jsonb_set(
      v_meta,
      '{worker_ids}',
      coalesce((v_meta->'worker_ids')::jsonb, '[]'::jsonb) || jsonb_build_array(v_worker_id::text)
    );
    v_new_meta := jsonb_set(v_new_meta, '{status}', '"Assessed"');
    
    v_new_notes := '[METADATA:' || v_new_meta::text || ']' || COALESCE(substring(v_site_notes from '\](.*)$'), '');

    UPDATE public.sites
    SET assigned_worker_id = v_worker_id,
        assigned_at = now(),
        task_notes = v_new_notes,
        consultant_stage = 'Billing'
    WHERE id = v_site_id;

    -- Check if material exists
    SELECT id INTO v_material_id FROM public.inventory_materials 
    WHERE material_name = COALESCE(v_site_name, 'M/S MOTEXO INDUSTRIES LLP') LIMIT 1;

    IF v_material_id IS NULL THEN
      INSERT INTO public.inventory_materials (
        material_name, location, device_id, submitted, state,
        ct1, ct2, ct3, proxy_model, proxy1, proxy2, encoder,
        vibration, vibration_model, antenna, tower_light, energy_meter, plc,
        created_by, quantity, unit, created_at, updated_at, installation_date, notes
      ) VALUES (
        COALESCE(v_site_name, 'M/S MOTEXO INDUSTRIES LLP'),
        COALESCE(v_site_address, v_site_city, 'Address not specified'),
        'SIM-Kit Gateway V3', true, 'Available',
        'TRUE', 'TRUE', 'TRUE', NULL, 'FALSE', 'FALSE', 'FALSE',
        'TRUE', 'renke', 'TRUE', 'TRUE', 'TRUE', 'FALSE',
        v_worker_id, 1, 'pcs', '2026-07-29 10:00:00+00', '2026-07-29 10:00:00+00', '2026-07-29',
        '{"courier_partner":"","packing_date":"","transit_date":"","arrived_date":"","courier_id":"","logistics_status":"Pending"}'
      );
    ELSE
      UPDATE public.inventory_materials SET
        location = COALESCE(v_site_address, v_site_city, 'Address not specified'),
        created_by = v_worker_id,
        ct1 = 'TRUE',
        ct2 = 'TRUE',
        ct3 = 'TRUE',
        proxy_model = NULL,
        proxy1 = 'FALSE',
        proxy2 = 'FALSE',
        encoder = 'FALSE',
        vibration = 'TRUE',
        vibration_model = 'renke',
        antenna = 'TRUE',
        tower_light = 'TRUE',
        energy_meter = 'TRUE',
        plc = 'FALSE'
      WHERE id = v_material_id;
    END IF;
  END IF;

  -- Company 2: Hi Will
  SELECT id, name, company_name, address, city, task_notes INTO v_site_id, v_site_name, v_site_address, v_site_city, v_site_notes
  FROM public.sites
  WHERE name ILIKE '%Hi Will%' OR company_name ILIKE '%Hi Will%' LIMIT 1;

  IF v_site_id IS NOT NULL THEN
    IF v_site_notes LIKE '[METADATA:%' THEN
      v_meta := substring(v_site_notes from '\[METADATA:(.*?)\]')::jsonb;
    ELSE
      v_meta := '{}'::jsonb;
    END IF;
    
    v_new_meta := jsonb_set(
      v_meta,
      '{worker_ids}',
      coalesce((v_meta->'worker_ids')::jsonb, '[]'::jsonb) || jsonb_build_array(v_worker_id::text)
    );
    v_new_meta := jsonb_set(v_new_meta, '{status}', '"Assessed"');
    
    v_new_notes := '[METADATA:' || v_new_meta::text || ']' || COALESCE(substring(v_site_notes from '\](.*)$'), '');

    UPDATE public.sites
    SET assigned_worker_id = v_worker_id,
        assigned_at = now(),
        task_notes = v_new_notes,
        consultant_stage = 'Billing'
    WHERE id = v_site_id;

    -- Check if material exists
    SELECT id INTO v_material_id FROM public.inventory_materials 
    WHERE material_name = COALESCE(v_site_name, 'M/S HI WILL ENGINEERING SOLUTION') LIMIT 1;

    IF v_material_id IS NULL THEN
      INSERT INTO public.inventory_materials (
        material_name, location, device_id, submitted, state,
        ct1, ct2, ct3, proxy_model, proxy1, proxy2, encoder,
        vibration, vibration_model, antenna, tower_light, energy_meter, plc,
        created_by, quantity, unit, created_at, updated_at, installation_date, notes
      ) VALUES (
        COALESCE(v_site_name, 'M/S HI WILL ENGINEERING SOLUTION'),
        COALESCE(v_site_address, v_site_city, 'Address not specified'),
        'SIM-Kit Gateway V3', true, 'Available',
        'TRUE', 'TRUE', 'TRUE', NULL, 'FALSE', 'FALSE', 'FALSE',
        'TRUE', 'renke', 'TRUE', 'TRUE', 'TRUE', 'FALSE',
        v_worker_id, 1, 'pcs', '2026-07-29 10:00:00+00', '2026-07-29 10:00:00+00', '2026-07-29',
        '{"courier_partner":"","packing_date":"","transit_date":"","arrived_date":"","courier_id":"","logistics_status":"Pending"}'
      );
    ELSE
      UPDATE public.inventory_materials SET
        location = COALESCE(v_site_address, v_site_city, 'Address not specified'),
        created_by = v_worker_id,
        ct1 = 'TRUE',
        ct2 = 'TRUE',
        ct3 = 'TRUE',
        proxy_model = NULL,
        proxy1 = 'FALSE',
        proxy2 = 'FALSE',
        encoder = 'FALSE',
        vibration = 'TRUE',
        vibration_model = 'renke',
        antenna = 'TRUE',
        tower_light = 'TRUE',
        energy_meter = 'TRUE',
        plc = 'FALSE'
      WHERE id = v_material_id;
    END IF;
  END IF;

  -- Company 3: Lexicon
  SELECT id, name, company_name, address, city, task_notes INTO v_site_id, v_site_name, v_site_address, v_site_city, v_site_notes
  FROM public.sites
  WHERE name ILIKE '%Lexicon%' OR company_name ILIKE '%Lexicon%' LIMIT 1;

  IF v_site_id IS NOT NULL THEN
    IF v_site_notes LIKE '[METADATA:%' THEN
      v_meta := substring(v_site_notes from '\[METADATA:(.*?)\]')::jsonb;
    ELSE
      v_meta := '{}'::jsonb;
    END IF;
    
    v_new_meta := jsonb_set(
      v_meta,
      '{worker_ids}',
      coalesce((v_meta->'worker_ids')::jsonb, '[]'::jsonb) || jsonb_build_array(v_worker_id::text)
    );
    v_new_meta := jsonb_set(v_new_meta, '{status}', '"Assessed"');
    
    v_new_notes := '[METADATA:' || v_new_meta::text || ']' || COALESCE(substring(v_site_notes from '\](.*)$'), '');

    UPDATE public.sites
    SET assigned_worker_id = v_worker_id,
        assigned_at = now(),
        task_notes = v_new_notes,
        consultant_stage = 'Billing'
    WHERE id = v_site_id;

    -- Check if material exists
    SELECT id INTO v_material_id FROM public.inventory_materials 
    WHERE material_name = COALESCE(v_site_name, 'M/S LEXICON POLYCRAFT') LIMIT 1;

    IF v_material_id IS NULL THEN
      INSERT INTO public.inventory_materials (
        material_name, location, device_id, submitted, state,
        ct1, ct2, ct3, proxy_model, proxy1, proxy2, encoder,
        vibration, vibration_model, antenna, tower_light, energy_meter, plc,
        created_by, quantity, unit, created_at, updated_at, installation_date, notes
      ) VALUES (
        COALESCE(v_site_name, 'M/S LEXICON POLYCRAFT'),
        COALESCE(v_site_address, v_site_city, 'Address not specified'),
        'SIM-Kit Gateway V3', true, 'Available',
        'TRUE', 'TRUE', 'TRUE', NULL, 'FALSE', 'FALSE', 'FALSE',
        'TRUE', 'renke', 'TRUE', 'TRUE', 'TRUE', 'FALSE',
        v_worker_id, 1, 'pcs', '2026-07-29 10:00:00+00', '2026-07-29 10:00:00+00', '2026-07-29',
        '{"courier_partner":"","packing_date":"","transit_date":"","arrived_date":"","courier_id":"","logistics_status":"Pending"}'
      );
    ELSE
      UPDATE public.inventory_materials SET
        location = COALESCE(v_site_address, v_site_city, 'Address not specified'),
        created_by = v_worker_id,
        ct1 = 'TRUE',
        ct2 = 'TRUE',
        ct3 = 'TRUE',
        proxy_model = NULL,
        proxy1 = 'FALSE',
        proxy2 = 'FALSE',
        encoder = 'FALSE',
        vibration = 'TRUE',
        vibration_model = 'renke',
        antenna = 'TRUE',
        tower_light = 'TRUE',
        energy_meter = 'TRUE',
        plc = 'FALSE'
      WHERE id = v_material_id;
    END IF;
  END IF;

  -- Company 4: Dolphin
  SELECT id, name, company_name, address, city, task_notes INTO v_site_id, v_site_name, v_site_address, v_site_city, v_site_notes
  FROM public.sites
  WHERE name ILIKE '%Dolphin%' OR company_name ILIKE '%Dolphin%' LIMIT 1;

  IF v_site_id IS NOT NULL THEN
    IF v_site_notes LIKE '[METADATA:%' THEN
      v_meta := substring(v_site_notes from '\[METADATA:(.*?)\]')::jsonb;
    ELSE
      v_meta := '{}'::jsonb;
    END IF;
    
    v_new_meta := jsonb_set(
      v_meta,
      '{worker_ids}',
      coalesce((v_meta->'worker_ids')::jsonb, '[]'::jsonb) || jsonb_build_array(v_worker_id::text)
    );
    v_new_meta := jsonb_set(v_new_meta, '{status}', '"Assessed"');
    
    v_new_notes := '[METADATA:' || v_new_meta::text || ']' || COALESCE(substring(v_site_notes from '\](.*)$'), '');

    UPDATE public.sites
    SET assigned_worker_id = v_worker_id,
        assigned_at = now(),
        task_notes = v_new_notes,
        consultant_stage = 'Billing'
    WHERE id = v_site_id;

    -- Check if material exists
    SELECT id INTO v_material_id FROM public.inventory_materials 
    WHERE material_name = COALESCE(v_site_name, 'M/S DOLPHIN POLYMERS') LIMIT 1;

    IF v_material_id IS NULL THEN
      INSERT INTO public.inventory_materials (
        material_name, location, device_id, submitted, state,
        ct1, ct2, ct3, proxy_model, proxy1, proxy2, encoder,
        vibration, vibration_model, antenna, tower_light, energy_meter, plc,
        created_by, quantity, unit, created_at, updated_at, installation_date, notes
      ) VALUES (
        COALESCE(v_site_name, 'M/S DOLPHIN POLYMERS'),
        COALESCE(v_site_address, v_site_city, 'Address not specified'),
        'SIM-Kit Gateway V3', true, 'Available',
        'TRUE', 'TRUE', 'TRUE', NULL, 'FALSE', 'FALSE', 'FALSE',
        'TRUE', 'renke', 'TRUE', 'TRUE', 'TRUE', 'FALSE',
        v_worker_id, 1, 'pcs', '2026-08-11 10:00:00+00', '2026-08-11 10:00:00+00', '2026-08-11',
        '{"courier_partner":"","packing_date":"","transit_date":"","arrived_date":"","logistics_status":"Pending"}'
      );
    ELSE
      UPDATE public.inventory_materials SET
        location = COALESCE(v_site_address, v_site_city, 'Address not specified'),
        created_by = v_worker_id,
        ct1 = 'TRUE',
        ct2 = 'TRUE',
        ct3 = 'TRUE',
        proxy_model = NULL,
        proxy1 = 'FALSE',
        proxy2 = 'FALSE',
        encoder = 'FALSE',
        vibration = 'TRUE',
        vibration_model = 'renke',
        antenna = 'TRUE',
        tower_light = 'TRUE',
        energy_meter = 'TRUE',
        plc = 'FALSE'
      WHERE id = v_material_id;
    END IF;
  END IF;

  -- 4. Clean up duplicate entries in inventory_materials
  -- We partition by material_name (case-insensitive) and rank them:
  -- - Score 1: Has a real address (does not look like 'm/s' or match the company name prefix) and has longer address length
  -- - Score 2: Name-like or fallback locations
  -- We delete everything except the highest ranked row for each material name.
  DELETE FROM public.inventory_materials
  WHERE id IN (
    SELECT id
    FROM (
      SELECT id,
             row_number() OVER (
               PARTITION BY lower(trim(material_name))
               ORDER BY 
                 CASE 
                   WHEN location IS NOT NULL AND location NOT ILIKE '%m/s%' AND location NOT ILIKE '%' || split_part(material_name, ' ', 2) || '%' THEN 1
                   ELSE 2
                 END ASC,
                 length(COALESCE(location, '')) DESC,
                 created_at DESC
             ) as rn
      FROM public.inventory_materials
    ) t
    WHERE t.rn > 1
  );

END $$;
