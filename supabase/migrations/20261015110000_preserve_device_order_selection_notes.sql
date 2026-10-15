-- Keep the device-order selections when an older courier form replaces notes.
-- The dispatch trigger runs after this BEFORE UPDATE trigger.
BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_preserve_order_selections() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE previous_notes jsonb; updated_notes jsonb; selection_key text;
BEGIN
  IF NEW.submitted IS NOT TRUE OR NEW.notes IS NOT DISTINCT FROM OLD.notes THEN RETURN NEW; END IF;

  previous_notes:=public.inventory_dispatch_notes(OLD.notes);
  updated_notes:=public.inventory_dispatch_notes(NEW.notes);
  FOREACH selection_key IN ARRAY ARRAY['dm_selected','without_cavli'] LOOP
    IF (previous_notes ? selection_key) AND NOT (updated_notes ? selection_key) THEN
      updated_notes:=updated_notes||jsonb_build_object(selection_key,previous_notes->selection_key);
    END IF;
  END LOOP;
  IF updated_notes IS DISTINCT FROM public.inventory_dispatch_notes(NEW.notes) THEN
    NEW.notes:=updated_notes::text;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS inventory_preserve_order_selections ON public.inventory_materials;
CREATE TRIGGER inventory_preserve_order_selections BEFORE UPDATE OF notes ON public.inventory_materials
FOR EACH ROW EXECUTE FUNCTION public.inventory_preserve_order_selections();

REVOKE ALL ON FUNCTION public.inventory_preserve_order_selections() FROM PUBLIC, anon, authenticated;
COMMIT;
