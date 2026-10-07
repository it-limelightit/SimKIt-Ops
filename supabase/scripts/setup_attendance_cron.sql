-- Run AFTER the attendance migration and Edge Function deployment.
-- Create Vault secrets named attendance_project_url and attendance_cron_secret
-- using the Supabase dashboard first. Never commit actual credentials here.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='attendance_project_url')
     OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='attendance_cron_secret') THEN
    RAISE EXCEPTION 'Create attendance_project_url and attendance_cron_secret in Vault first';
  END IF;
END $$;

-- Re-running replaces these two jobs only; unrelated schedules are untouched.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('attendance-photo-cleanup','attendance-command-retry');
SELECT cron.schedule('attendance-photo-cleanup','* * * * *',$job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='attendance_project_url' LIMIT 1) || '/functions/v1/attendance-photo-cleanup',
    headers := jsonb_build_object('Content-Type','application/json','x-attendance-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='attendance_cron_secret' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
SELECT cron.schedule('attendance-command-retry','* * * * *',$job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='attendance_project_url' LIMIT 1) || '/functions/v1/attendance-command-retry',
    headers := jsonb_build_object('Content-Type','application/json','x-attendance-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='attendance_cron_secret' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
