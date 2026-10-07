-- Optional request-scoped MQTT enrollment; existing HTTP bridge flow is unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.attendance_mqtt_finish_command(_id uuid,_lease uuid,_outcome text,_ack boolean DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c attendance_device_commands;
BEGIN
  IF _outcome IS NULL OR _outcome NOT IN ('not_sent','uncertain','published') OR (_ack IS NOT NULL AND _outcome<>'published') THEN RAISE EXCEPTION 'Invalid MQTT outcome'; END IF;
  SELECT * INTO c FROM attendance_device_commands WHERE id=_id AND lease_token=_lease AND status='publishing' FOR UPDATE;
  IF c.id IS NULL THEN RETURN; END IF;
  IF _ack IS NOT NULL THEN
    PERFORM attendance_ack_command(_id,(SELECT enroll_id FROM attendance_employees WHERE id=c.employee_id),_ack);
    RETURN;
  END IF;
  UPDATE attendance_device_commands SET
    status=CASE WHEN _outcome='published' THEN 'published' WHEN _outcome='uncertain' OR attempts>=5 THEN 'failed' ELSE 'pending' END,
    error=CASE WHEN _outcome='published' THEN NULL WHEN _outcome='uncertain' THEN 'MQTT send outcome unknown; verify device registration before retry' ELSE 'MQTT connection failed before enrollment was sent' END,
    next_attempt_at=now()+CASE WHEN _outcome='published' THEN interval '10 minutes' ELSE interval '1 minute' END,
    lease_until=NULL
  WHERE id=_id;
  UPDATE attendance_employees SET enrollment_status='failed' WHERE id=c.employee_id AND EXISTS(SELECT 1 FROM attendance_device_commands WHERE id=_id AND status='failed');
END $$;
REVOKE ALL ON FUNCTION public.attendance_mqtt_finish_command(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_mqtt_finish_command(uuid,uuid,text,boolean) TO service_role;
COMMIT;
