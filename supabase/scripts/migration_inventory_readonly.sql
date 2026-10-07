-- Migration discovery only: no writes, secrets, emails, password hashes or row payloads.
-- Run on the OLD backend first, then on the restored destination.
-- The UI may show only the final result: run the numbered SELECTs individually if needed.

-- 1. Capture time and source database version/size. This is not a snapshot watermark.
SELECT now() AS captured_at, current_database() AS database_name,
       current_setting('server_version') AS postgres_version,
       pg_database_size(current_database()) AS database_bytes;

-- 2. Application tables: estimates help scope the move; they are not final verification.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.reltuples::bigint AS estimated_rows,
       pg_total_relation_size(c.oid) AS total_bytes,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
ORDER BY c.relname;

-- 3. User account totals only. No passwords, hashes, tokens, or emails are returned.
SELECT count(*) AS auth_users,
       count(*) FILTER (WHERE deleted_at IS NULL) AS nondeleted_users,
       count(*) FILTER (WHERE coalesce(encrypted_password,'') <> '') AS users_with_passwords
FROM auth.users;
SELECT count(*) AS auth_identities FROM auth.identities;

-- 4. Buckets and database object counts. These do not prove the file bytes were copied.
SELECT b.id AS bucket, b.public, b.file_size_limit, b.allowed_mime_types,
       count(o.id) AS object_records
FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id=b.id
GROUP BY b.id,b.public,b.file_size_limit,b.allowed_mime_types ORDER BY b.id;

-- 5. RPC signatures and security settings; bodies are excluded to avoid exposing secrets.
SELECT n.nspname AS schema_name,p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_result(p.oid) AS result_type,p.prosecdef AS security_definer,
       p.proconfig AS configuration
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' ORDER BY p.proname,identity_arguments;

-- 6. Policy identities, triggers, extensions, and Realtime table membership.
SELECT schemaname,tablename,policyname,permissive,roles,cmd
FROM pg_policies WHERE schemaname IN ('public','storage','auth')
ORDER BY schemaname,tablename,policyname;
SELECT event_object_schema,event_object_table,trigger_name,event_manipulation,
       action_timing
FROM information_schema.triggers
WHERE event_object_schema IN ('public','auth','storage')
ORDER BY event_object_schema,event_object_table,trigger_name;
SELECT extname,extversion FROM pg_extension ORDER BY extname;
SELECT pubname,schemaname,tablename FROM pg_publication_tables
ORDER BY pubname,schemaname,tablename;

-- 7. Generate a second read-only query for exact table counts.
-- Copy the generated SQL into another query. Counts can be expensive: use off-peak.
-- Run final comparisons only at the same verified snapshot/cutover boundary.
-- Equal counts alone do not prove equal IDs or contents.
SELECT string_agg(
  format('SELECT %L AS table_name, count(*)::bigint AS row_count FROM %I.%I',
         n.nspname||'.'||c.relname,n.nspname,c.relname),
  E'\nUNION ALL\n' ORDER BY c.relname
) || E'\nORDER BY table_name;' AS exact_counts_sql
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p');
