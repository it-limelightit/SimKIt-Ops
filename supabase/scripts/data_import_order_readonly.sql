-- Read-only: run in the NEW Supabase project after schema creation.
-- Equal import_group means tables have the same dependency depth, not equal data priority.
-- Auth users must be migrated using a supported Auth restore, not ordinary public-table CSV.
-- Self-referencing rows need parent-row ordering within their own table.
-- A cycle warning requires a reviewed restore strategy; do not disable foreign keys.
WITH RECURSIVE
app_tables AS (
  SELECT c.oid, n.nspname || '.' || c.relname AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
),
foreign_keys AS (
  SELECT con.conrelid AS child, con.confrelid AS parent,
         pn.nspname || '.' || pc.relname AS parent_name,
         con.conname, pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN app_tables t ON t.oid=con.conrelid
  JOIN pg_class pc ON pc.oid=con.confrelid
  JOIN pg_namespace pn ON pn.oid=pc.relnamespace
  WHERE con.contype='f'
),
walk AS (
  SELECT oid AS starting_table, oid AS current_table,
         ARRAY[oid] AS path, 0 AS depth, false AS cycle
  FROM app_tables
  UNION ALL
  SELECT w.starting_table, f.parent, w.path || f.parent,
         w.depth+1, f.parent=ANY(w.path)
  FROM walk w JOIN foreign_keys f ON f.child=w.current_table
  WHERE NOT w.cycle AND f.parent<>f.child
),
depths AS (
  SELECT starting_table, max(depth) AS depth, bool_or(cycle) AS cycle
  FROM walk GROUP BY starting_table
)
SELECT CASE WHEN d.cycle THEN NULL ELSE d.depth END AS import_group,
       t.table_name,
       coalesce((SELECT string_agg(DISTINCT f.parent_name, ', ' ORDER BY f.parent_name)
                 FROM foreign_keys f WHERE f.child=t.oid), '-') AS import_after,
       CASE WHEN d.cycle THEN 'STOP: circular dependency; review restore strategy'
            WHEN EXISTS(SELECT 1 FROM foreign_keys f WHERE f.child=t.oid AND f.parent=t.oid)
              THEN 'Order parent rows before child rows inside this table'
            ELSE 'Preserve original IDs; verify all referenced rows exist' END AS notes
FROM app_tables t JOIN depths d ON d.starting_table=t.oid
ORDER BY import_group NULLS LAST, t.table_name;

-- For a failing table, run this separate query to see the exact foreign-key columns:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE contype='f' AND conrelid='public.activity_logs'::regclass;
