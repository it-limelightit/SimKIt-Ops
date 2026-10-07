-- Restore workflow RPCs present in the Cloud export but absent from repository setup.
-- Apply to the migrated destination. No existing records are changed.
-- Client-token form access is preserved. Administrative operations require
-- authenticated staff/site access; legacy reset helpers are service-role only.
BEGIN;
CREATE OR REPLACE FUNCTION public.delete_worker(worker_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.is_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'Access denied: staff permission required';
  END IF;
  -- Delete roles
  DELETE FROM public.user_roles WHERE user_id = worker_id;
  
  -- Delete profile
  DELETE FROM public.profiles WHERE id = worker_id;
  
  -- Delete master auth user (cascades automatically)
  DELETE FROM auth.users WHERE id = worker_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_worker(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_worker(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_client_form_site_by_token(token_val text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  site_rec record;
  notes text;
  prefix text := '[METADATA:';
  idx integer;
  start_idx integer;
  depth integer;
  json_str text;
  meta jsonb;
  matched_site jsonb := null;
  assess_rec record;
  assess_data jsonb := '{}'::jsonb;
  c char;
BEGIN
  -- Search all sites
  FOR site_rec IN SELECT id, name, company_name, address, city, task_notes, consultant_stage FROM sites LOOP
    notes := site_rec.task_notes;
    IF notes IS NOT NULL THEN
      idx := position(prefix in notes);
      IF idx > 0 THEN
        start_idx := idx + char_length(prefix);
        
        -- Safe character loop to isolate the JSON block
        depth := 0;
        json_str := '';
        FOR i IN start_idx..char_length(notes) LOOP
          c := substring(notes from i for 1);
          IF c = '{' THEN
            depth := depth + 1;
          ELSIF c = '}' THEN
            depth := depth - 1;
            IF depth = 0 THEN
              json_str := substring(notes from start_idx for (i - start_idx + 1));
              EXIT;
            END IF;
          END IF;
        END LOOP;

        IF json_str <> '' THEN
          BEGIN
            meta := json_str::jsonb;
            IF meta->>'client_token' = token_val THEN
              matched_site := jsonb_build_object(
                'id', site_rec.id,
                'name', site_rec.name,
                'company_name', site_rec.company_name,
                'address', site_rec.address,
                'city', site_rec.city,
                'consultant_stage', site_rec.consultant_stage,
                'client_email', COALESCE(meta->>'client_email', '')
              );
              EXIT;
            END IF;
          EXCEPTION WHEN others THEN
            -- ignore parsing error
          END;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF matched_site IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid client access link or form has expired');
  END IF;

  -- Get the existing assessment data for this site if it exists
  SELECT data INTO assess_rec FROM assessment WHERE site_id = (matched_site->>'id')::uuid;
  IF FOUND THEN
    assess_data := assess_rec.data;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'site', matched_site,
    'assessmentData', assess_data
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_client_form_site_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_form_site_by_token(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_client_form_by_token(token_val text, assessment_data jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  site_rec record;
  notes text;
  prefix text := '[METADATA:';
  idx integer;
  start_idx integer;
  depth integer;
  json_str text;
  meta jsonb;
  matched_site_id uuid := null;
  final_data jsonb;
  c char;
BEGIN
  -- Search all sites to find the matching token
  FOR site_rec IN SELECT id, task_notes FROM sites LOOP
    notes := site_rec.task_notes;
    IF notes IS NOT NULL THEN
      idx := position(prefix in notes);
      IF idx > 0 THEN
        start_idx := idx + char_length(prefix);
        
        -- Safe character loop to isolate the JSON block
        depth := 0;
        json_str := '';
        FOR i IN start_idx..char_length(notes) LOOP
          c := substring(notes from i for 1);
          IF c = '{' THEN
            depth := depth + 1;
          ELSIF c = '}' THEN
            depth := depth - 1;
            IF depth = 0 THEN
              json_str := substring(notes from start_idx for (i - start_idx + 1));
              EXIT;
            END IF;
          END IF;
        END LOOP;

        IF json_str <> '' THEN
          BEGIN
            meta := json_str::jsonb;
            IF meta->>'client_token' = token_val THEN
              matched_site_id := site_rec.id;
              EXIT;
            END IF;
          EXCEPTION WHEN others THEN
            -- ignore
          END;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF matched_site_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid client access link or form has expired');
  END IF;

  -- Prepare final assessment data
  final_data := assessment_data || '{"factory_operations_done": true, "assessment_phase_submitted": true}'::jsonb;

  -- Upsert assessment record (Omitting created_at since it doesn't exist in the database)
  INSERT INTO assessment (site_id, data, updated_at)
  VALUES (matched_site_id, final_data, now())
  ON CONFLICT (site_id)
  DO UPDATE SET data = EXCLUDED.data, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.save_client_form_by_token(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_client_form_by_token(text, jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_client_invitation(site_id uuid, client_email text, token_val text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  current_notes text;
  new_notes text;
  meta_json jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.can_access_site(site_id), false) THEN
    RAISE EXCEPTION 'Access denied: site permission required';
  END IF;
  -- Get existing task_notes
  SELECT task_notes INTO current_notes FROM sites WHERE id = site_id;
  
  -- Create new metadata block
  meta_json := jsonb_build_object(
    'client_email', client_email,
    'client_token', token_val,
    'status', 'Running'
  );
  
  -- Strip existing metadata block if present
  DECLARE
    prefix text := '[METADATA:';
    idx integer;
  BEGIN
    IF current_notes IS NOT NULL THEN
      idx := position(prefix in current_notes);
      IF idx > 0 THEN
        current_notes := substring(current_notes from 1 for idx - 1);
        current_notes := trim(current_notes);
      END IF;
    END IF;
  END;

  new_notes := '[METADATA:' || meta_json::text || ']' || COALESCE(current_notes, '');

  -- Update sites table bypassing RLS
  UPDATE sites SET task_notes = new_notes WHERE id = site_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.save_client_invitation(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_client_invitation(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reset_password_by_identifier(identifier text, new_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'auth', 'extensions', 'public'
    AS $$
  DECLARE
    target_id UUID;
  BEGIN
    SELECT id INTO target_id FROM auth.users WHERE lower(email) = lower(identifier);
    IF target_id IS NULL THEN
      SELECT id INTO target_id FROM public.profiles WHERE mobile = identifier;
    END IF;
    IF target_id IS NULL THEN
      RAISE EXCEPTION 'No account found for that mobile or email.';
    END IF;
    UPDATE auth.users 
    SET encrypted_password = crypt(new_password, gen_salt('bf')),
        updated_at = now()
    WHERE id = target_id;
  END;
  $$;
REVOKE ALL ON FUNCTION public.reset_password_by_identifier(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_password_by_identifier(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reset_user_password(target_user_id uuid, new_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'auth', 'extensions', 'public'
    AS $$
  BEGIN
    UPDATE auth.users
    SET encrypted_password = crypt(new_password, gen_salt('bf')),
        updated_at = now()
    WHERE id = target_user_id;
  END;
  $$;
REVOKE ALL ON FUNCTION public.reset_user_password(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_user_password(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.is_commissioning_approver() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$                                                                                                      
    SELECT EXISTS (                                                                                          
      SELECT 1                                                                                               
      FROM public.profiles                                                                                   
      WHERE id = auth.uid()                                                                                  
        AND lower(email) IN (                                                                                
          'patidarnit21@gmail.com',                                                                          
          'info@limelightit.io',                                                                             
          'tarun@limelightit.io'                                                                             
        )                                                                                                    
    );                                                                                                       
  $$;
REVOKE ALL ON FUNCTION public.is_commissioning_approver() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_commissioning_approver() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
