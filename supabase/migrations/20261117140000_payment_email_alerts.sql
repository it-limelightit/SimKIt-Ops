BEGIN;
CREATE TABLE public.payment_email_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 mailbox text NOT NULL, gmail_message_id text NOT NULL,
 sender text NOT NULL, subject text NOT NULL, preview text NOT NULL DEFAULT '',
 received_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','seen','paid')),
 seen_at timestamptz, seen_by uuid REFERENCES auth.users(id), seen_by_email text,
 paid_at timestamptz, paid_by uuid REFERENCES auth.users(id), paid_by_email text,
 UNIQUE(mailbox,gmail_message_id)
);
CREATE TABLE public.payment_alert_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 alert_id uuid NOT NULL REFERENCES public.payment_email_alerts(id),
 action text NOT NULL CHECK(action IN ('seen','paid')),
 actor_id uuid NOT NULL REFERENCES auth.users(id), actor_email text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(alert_id,actor_id,action)
);
CREATE TABLE public.payment_alert_monitor (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 mailbox text NOT NULL DEFAULT 'it@limelightit.io', last_checked_at timestamptz,
 last_matching_email_at timestamptz
);
INSERT INTO public.payment_alert_monitor DEFAULT VALUES;

CREATE FUNCTION public.can_view_payment_alerts() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u JOIN profiles p ON p.id=u.id
 WHERE u.id=auth.uid() AND p.is_active AND u.email_confirmed_at IS NOT NULL
 AND lower(trim(u.email)) IN ('tarun@limelightit.io','nitsanghani1@gmail.com','kishanvyas308@gmail.com'));
$$;
REVOKE ALL ON FUNCTION public.can_view_payment_alerts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_payment_alerts() TO authenticated;
ALTER TABLE public.payment_email_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_alert_monitor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_email_alerts,public.payment_alert_events,public.payment_alert_monitor FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payment_email_alerts,public.payment_alert_events,public.payment_alert_monitor TO authenticated;
GRANT ALL ON public.payment_email_alerts,public.payment_alert_events,public.payment_alert_monitor TO service_role;
CREATE POLICY payment_alert_read ON public.payment_email_alerts FOR SELECT TO authenticated USING(public.can_view_payment_alerts());
CREATE POLICY payment_event_read ON public.payment_alert_events FOR SELECT TO authenticated USING(public.can_view_payment_alerts());
CREATE POLICY payment_monitor_read ON public.payment_alert_monitor FOR SELECT TO authenticated USING(public.can_view_payment_alerts());

CREATE FUNCTION public.payment_alert_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.can_view_payment_alerts() THEN RAISE EXCEPTION 'Payment alert access denied' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
 'active',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY received_at DESC) FROM payment_email_alerts a WHERE status<>'paid'),'[]'::jsonb),
 'history',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY paid_at DESC) FROM (SELECT * FROM payment_email_alerts WHERE status='paid' ORDER BY paid_at DESC LIMIT 100) a),'[]'::jsonb),
 'monitor',(SELECT to_jsonb(m) FROM payment_alert_monitor m WHERE singleton));
END $$;

CREATE FUNCTION public.set_payment_alert_status(_alert_id uuid,_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a payment_email_alerts; actor text;
BEGIN
 IF NOT public.can_view_payment_alerts() THEN RAISE EXCEPTION 'Payment alert access denied' USING ERRCODE='42501'; END IF;
 IF _action IS NULL OR _action NOT IN ('seen','paid') THEN RAISE EXCEPTION 'Invalid payment alert action'; END IF;
 SELECT * INTO a FROM payment_email_alerts WHERE id=_alert_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Payment alert not found'; END IF;
 IF a.status='paid' THEN RETURN; END IF;
 SELECT lower(trim(email)) INTO actor FROM auth.users WHERE id=auth.uid();
 INSERT INTO payment_alert_events(alert_id,action,actor_id,actor_email) VALUES(a.id,_action,auth.uid(),actor) ON CONFLICT DO NOTHING;
 IF _action='seen' THEN
 UPDATE payment_email_alerts SET status='seen',seen_at=coalesce(seen_at,now()),seen_by=coalesce(seen_by,auth.uid()),seen_by_email=coalesce(seen_by_email,actor) WHERE id=a.id;
 ELSE
 UPDATE payment_email_alerts SET status='paid',paid_at=now(),paid_by=auth.uid(),paid_by_email=actor WHERE id=a.id;
 END IF;
END $$;

CREATE FUNCTION public.ingest_payment_emails(_mailbox text,_messages jsonb,_completed boolean DEFAULT true) RETURNS integer
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
REVOKE ALL ON FUNCTION public.payment_alert_overview(),public.set_payment_alert_status(uuid,text),public.ingest_payment_emails(text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payment_alert_overview(),public.set_payment_alert_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_payment_emails(text,jsonb,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
