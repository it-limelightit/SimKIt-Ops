-- A manager may remove one scheduled priority visit without touching any other visits.
CREATE OR REPLACE FUNCTION public.field_visit_schedule_delete(_visit_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers can delete priority visits';
  END IF;

  DELETE FROM public.field_visit_schedules WHERE id = _visit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.field_visit_schedule_delete(UUID) TO authenticated;
