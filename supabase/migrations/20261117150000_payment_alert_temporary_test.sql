BEGIN;
ALTER TABLE public.payment_alert_monitor ADD COLUMN test_sender text;
ALTER TABLE public.payment_alert_monitor ADD COLUMN test_until timestamptz;
-- A one-day test window; normal Contabo monitoring continues throughout.
UPDATE public.payment_alert_monitor SET test_sender='nitsanghani05@gmail.com',test_until=now()+interval '24 hours' WHERE singleton;
CREATE OR REPLACE FUNCTION public.ingest_payment_emails(_mailbox text,_messages jsonb,_completed boolean DEFAULT true) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m jsonb; inserted integer:=0; added integer; settings payment_alert_monitor;
BEGIN
 SELECT * INTO settings FROM payment_alert_monitor WHERE singleton;
 IF lower(trim(_mailbox)) IS DISTINCT FROM settings.mailbox THEN RAISE EXCEPTION 'Unexpected mailbox'; END IF;
 IF jsonb_typeof(_messages) IS DISTINCT FROM 'array' OR jsonb_array_length(_messages)>50 THEN RAISE EXCEPTION 'Invalid message batch'; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(_messages) LOOP
 IF NOT coalesce((m->>'sender'='no-reply@contabo.com' OR (m->>'sender'=settings.test_sender AND now()<settings.test_until)),false)
 OR coalesce(m->>'subject','') !~* '^contabo\s*:\s*payment\s+missing\M'
 OR coalesce(m->>'id','') !~ '^[a-fA-F0-9]{8,64}$'
 OR length(coalesce(m->>'subject',''))>500 OR length(coalesce(m->>'preview',''))>1000
 OR nullif(m->>'received_at','') IS NULL THEN RAISE EXCEPTION 'Invalid Contabo message'; END IF;
 INSERT INTO payment_email_alerts(mailbox,gmail_message_id,sender,subject,preview,received_at)
 VALUES(lower(trim(_mailbox)),m->>'id',m->>'sender',m->>'subject',coalesce(m->>'preview',''),(m->>'received_at')::timestamptz)
 ON CONFLICT(mailbox,gmail_message_id) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT; inserted:=inserted+added;
 END LOOP;
 UPDATE payment_alert_monitor SET last_checked_at=CASE WHEN _completed THEN now() ELSE last_checked_at END,last_matching_email_at=(SELECT max(received_at) FROM payment_email_alerts) WHERE singleton;
 RETURN inserted;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
