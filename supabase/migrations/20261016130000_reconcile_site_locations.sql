BEGIN;

CREATE FUNCTION public.site_location_key(_name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(
    lower(regexp_replace(btrim(_name), '\s+', ' ', 'g')),
    '^(district|dist[.]?|taluka|tal[.]?)[[:space:].:-]+', ''),
    '(,[[:space:]]*|[[:space:]]+)gujarat$', ''), '[[:space:]]+district$', ''))
$$;

CREATE FUNCTION public.normalize_site_location_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'site_localities' AND (
    btrim(NEW.name) ~* '^(district|dist[.]?)[[:space:].:-]+'
    OR btrim(NEW.name) ~* '[[:space:]]+district$'
  ) THEN
    RAISE EXCEPTION 'Enter a taluka/city name; select the district separately';
  END IF;
  NEW.name := initcap(public.site_location_key(NEW.name));
  RETURN NEW;
END $$;
CREATE TRIGGER normalize_site_district_name BEFORE INSERT OR UPDATE OF name ON public.site_districts
FOR EACH ROW EXECUTE FUNCTION public.normalize_site_location_name();
CREATE TRIGGER normalize_site_locality_name BEFORE INSERT OR UPDATE OF name ON public.site_localities
FOR EACH ROW EXECUTE FUNCTION public.normalize_site_location_name();

DROP INDEX public.site_districts_name_unique;
CREATE UNIQUE INDEX site_districts_name_unique ON public.site_districts(public.site_location_key(name));
DROP INDEX public.site_localities_district_name_unique;
CREATE UNIQUE INDEX site_localities_district_name_unique ON public.site_localities(district_id,public.site_location_key(name));

-- Retain the imported text before assigning any existing site a canonical location.
ALTER TABLE public.sites ADD COLUMN location_original_city text;
-- Preserve historical update times during this one-time cleanup. Only pause the
-- existing timestamp trigger; the location validation trigger remains active.
CREATE TEMP TABLE site_location_paused_timestamps ON COMMIT DROP AS
SELECT t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE t.tgrelid='public.sites'::regclass AND t.tgname='trigger_sites_updated_at'
  AND n.nspname='public' AND p.proname='handle_updated_at' AND t.tgenabled<>'D';
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM site_location_paused_timestamps LOOP
    EXECUTE format('ALTER TABLE public.sites DISABLE TRIGGER %I',item.tgname);
  END LOOP;
END $$;
UPDATE public.sites SET location_original_city = city WHERE district_id IS NULL;

-- Only exact canonical city names and their spelling/administrative variants.
-- District-only labels and area/village names remain for manager review.
UPDATE public.sites s SET district_id = l.district_id, locality_id = l.id
FROM public.site_localities l JOIN public.site_districts d ON d.id=l.district_id
WHERE s.district_id IS NULL AND s.locality_id IS NULL
  AND public.site_location_key(s.city) = public.site_location_key(l.name)
  AND public.site_location_key(l.name) = public.site_location_key(d.name)
  AND NOT (btrim(s.city) ~* '^(district|dist[.]?)[[:space:].:-]+' OR btrim(s.city) ~* '[[:space:]]+district$');

DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM site_location_paused_timestamps LOOP
    EXECUTE format('ALTER TABLE public.sites ENABLE %s TRIGGER %I',
      CASE item.tgenabled WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END,item.tgname);
  END LOOP;
END $$;

CREATE FUNCTION public.review_site_locations(_site_ids uuid[], _district_id uuid, _locality_name text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_locality uuid; expected_count integer; updated_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_staff(auth.uid()),false) THEN
    RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501';
  END IF;
  expected_count := cardinality(_site_ids);
  IF expected_count IS NULL OR expected_count=0 OR expected_count>1000
    OR expected_count <> (SELECT count(DISTINCT id) FROM unnest(_site_ids) id) THEN
    RAISE EXCEPTION 'Select between 1 and 1000 distinct sites';
  END IF;
  IF _locality_name IS NULL OR length(btrim(_locality_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Enter a taluka/city name of 1 to 100 characters';
  END IF;
  PERFORM id FROM public.sites WHERE id=ANY(_site_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.sites WHERE id=ANY(_site_ids) AND district_id IS NULL AND locality_id IS NULL) <> expected_count THEN
    RAISE EXCEPTION 'Some sites have already been reviewed or removed. Refresh and try again';
  END IF;
  INSERT INTO public.site_localities(district_id,name) VALUES(_district_id,_locality_name) ON CONFLICT DO NOTHING;
  SELECT id INTO target_locality FROM public.site_localities
    WHERE district_id=_district_id AND public.site_location_key(name)=public.site_location_key(_locality_name);
  IF target_locality IS NULL THEN RAISE EXCEPTION 'Select a valid district and taluka/city'; END IF;
  UPDATE public.sites SET district_id=_district_id,locality_id=target_locality WHERE id=ANY(_site_ids);
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END $$;
REVOKE ALL ON FUNCTION public.review_site_locations(uuid[],uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_site_locations(uuid[],uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
