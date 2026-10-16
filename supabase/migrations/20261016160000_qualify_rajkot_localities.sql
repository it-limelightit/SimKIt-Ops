BEGIN;

CREATE OR REPLACE FUNCTION public.site_location_key(_name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT regexp_replace(btrim(regexp_replace(regexp_replace(regexp_replace(
    lower(regexp_replace(btrim(_name), '\s+', ' ', 'g')),
    '^(district|dist[.]?|taluka|tal[.]?)[[:space:].:-]+', ''),
    '(,[[:space:]]*|[[:space:]]+)gujarat$', ''), '[[:space:]]+district$', '')),
    '^(lodhika|kotda sangani)[[:space:]]*[(]rajkot[)]$', '\1')
$$;

CREATE OR REPLACE FUNCTION public.normalize_site_location_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'site_localities' AND (
    btrim(NEW.name) ~* '^(district|dist[.]?)[[:space:].:-]+'
    OR btrim(NEW.name) ~* '[[:space:]]+district$'
  ) THEN
    RAISE EXCEPTION 'Enter a taluka/city name; select the district separately';
  END IF;
  NEW.name := initcap(public.site_location_key(NEW.name));
  IF TG_TABLE_NAME = 'site_localities' THEN
    IF public.site_location_key(NEW.name) IN ('lodhika','kotda sangani')
      AND EXISTS(SELECT 1 FROM public.site_districts WHERE id=NEW.district_id AND public.site_location_key(name)='rajkot') THEN
      NEW.name := NEW.name || ' (Rajkot)';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Keep every company's city and existing reports in sync when a locality is renamed.
CREATE FUNCTION public.sync_site_locality_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.sites SET city=NEW.name WHERE locality_id=NEW.id AND city IS DISTINCT FROM NEW.name;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_site_locality_name AFTER UPDATE OF name ON public.site_localities
FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION public.sync_site_locality_name();

-- Preserve historical timestamps during this one-time label correction.
CREATE TEMP TABLE qualified_location_paused_timestamps ON COMMIT DROP AS
SELECT t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE t.tgrelid='public.sites'::regclass AND t.tgname='trigger_sites_updated_at'
  AND n.nspname='public' AND p.proname='handle_updated_at' AND t.tgenabled<>'D';
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM qualified_location_paused_timestamps LOOP
    EXECUTE format('ALTER TABLE public.sites DISABLE TRIGGER %I',item.tgname);
  END LOOP;
END $$;

UPDATE public.site_localities l SET name=l.name
FROM public.site_districts d
WHERE d.id=l.district_id AND public.site_location_key(d.name)='rajkot'
  AND public.site_location_key(l.name) IN ('lodhika','kotda sangani');

DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM qualified_location_paused_timestamps LOOP
    EXECUTE format('ALTER TABLE public.sites ENABLE %s TRIGGER %I',
      CASE item.tgenabled WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END,item.tgname);
  END LOOP;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
