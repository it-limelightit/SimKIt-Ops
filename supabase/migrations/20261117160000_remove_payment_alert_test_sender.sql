BEGIN;
-- Restore the original production-only rule without rewriting applied migration history.
CREATE OR REPLACE FUNCTION public.ingest_payment_emails(_mailbox text,_messages jsonb,_completed boolean DEFAULT true) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m jsonb; inserted integer:=0; added integer;
BEGIN
 IF lower(trim(_mailbox)) IS DISTINCT FROM (SELECT mailbox FROM payment_alert_monitor WHERE singleton) THEN RAISE EXCEPTION 'Unexpected mailbox'; END IF;
 IF jsonb_typeof(_messages) IS DISTINCT FROM 'array' OR jsonb_array_length(_messages)>50 THEN RAISE EXCEPTION 'Invalid message batch'; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(_messages) LOOP
 IF m->>'sender' IS DISTINCT FROM 'no-reply@contabo.com'
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
ALTER TABLE public.payment_alert_monitor DROP COLUMN test_sender;
ALTER TABLE public.payment_alert_monitor DROP COLUMN test_until;
NOTIFY pgrst,'reload schema';
COMMIT;
