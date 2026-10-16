BEGIN;

CREATE TABLE public.site_districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100 AND name = btrim(name))
);
CREATE UNIQUE INDEX site_districts_name_unique ON public.site_districts (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
ALTER TABLE public.site_districts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.site_districts TO authenticated;
GRANT ALL ON public.site_districts TO service_role;
CREATE POLICY site_districts_read ON public.site_districts FOR SELECT TO authenticated USING (true);
CREATE POLICY site_districts_add ON public.site_districts FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.site_localities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid NOT NULL REFERENCES public.site_districts(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100 AND name = btrim(name))
);
CREATE UNIQUE INDEX site_localities_district_name_unique ON public.site_localities (district_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
ALTER TABLE public.site_localities ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.site_localities TO authenticated;
GRANT ALL ON public.site_localities TO service_role;
CREATE POLICY site_localities_read ON public.site_localities FOR SELECT TO authenticated USING (true);
CREATE POLICY site_localities_add ON public.site_localities FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

INSERT INTO public.site_districts(name) VALUES
  ('Ahmedabad'), ('Bharuch'), ('Bhavnagar'), ('Jamnagar'), ('Rajkot'), ('Surat'), ('Vadodara');
INSERT INTO public.site_localities(district_id, name)
  SELECT id, name FROM public.site_districts;

ALTER TABLE public.sites
  ADD COLUMN district_id uuid REFERENCES public.site_districts(id) ON DELETE RESTRICT,
  ADD COLUMN locality_id uuid REFERENCES public.site_localities(id) ON DELETE RESTRICT,
  ADD CONSTRAINT sites_location_pair CHECK ((district_id IS NULL) = (locality_id IS NULL));

-- Existing sites retain their location until a manager reviews it. New sites
-- must have a district and locality; the city text stays canonical for old views.
CREATE FUNCTION public.site_location_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE locality_name text;
BEGIN
  IF NEW.district_id IS NULL OR NEW.locality_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Select a district and taluka/city before creating this site';
    END IF;
    IF NEW.district_id IS NOT NULL OR NEW.locality_id IS NOT NULL THEN
      RAISE EXCEPTION 'Select both district and taluka/city';
    END IF;
    IF NEW.city IS DISTINCT FROM OLD.city THEN
      RAISE EXCEPTION 'Select a district and taluka/city before changing this site location';
    END IF;
    RETURN NEW;
  END IF;

  SELECT name INTO locality_name FROM public.site_localities
    WHERE id = NEW.locality_id AND district_id = NEW.district_id;
  IF locality_name IS NULL THEN
    RAISE EXCEPTION 'Select a taluka/city belonging to the selected district';
  END IF;
  NEW.city := locality_name;
  RETURN NEW;
END $$;

CREATE TRIGGER site_location_guard
  BEFORE INSERT OR UPDATE OF district_id, locality_id, city ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.site_location_guard();

NOTIFY pgrst, 'reload schema';
COMMIT;
