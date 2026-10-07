# SimKit Ops data import order

Use this on destination jhhiwyvrhfhvvougkqmm after table setup. This order is computed from the repository schema's actual foreign keys and verified in local PostgreSQL/PGlite replay. Run supabase/scripts/data_import_order_readonly.sql in the live destination to detect schema differences. It identifies declared foreign keys, not every logical relationship stored in JSON/text.

## Before importing public tables

1. Restore Auth accounts/identities through the supported full-backup process, preserving original user UUIDs and password hashes. Ordinary public-table CSV imports do not migrate login accounts. Do not create replacement users with different UUIDs.
2. Reconcile profiles and user_roles that signup triggers or an earlier restore already created. Import/merge using original primary keys rather than appending duplicate rows.
3. Use the same consistent source snapshot for all tables. Rows exported on different days while production changes can disagree, even with correct ordering.
4. Preserve original IDs and reference columns in every CSV. Do not let the importer regenerate IDs or null reference fields to bypass failures.
5. Some configuration rows already exist from schema setup (settings, field_operations_rollout, attendance_devices, attendance_settings and possibly field_work_rates). Reconcile source values by their original keys, rather than appending conflicting duplicates. Do not bulk-delete them as a workaround.
6. Preserve NULLs, booleans, JSON, timestamps, enums, unique keys and required columns correctly. Import order prevents missing-parent errors but cannot prevent invalid CSV or unique-key errors.

## Import groups

Complete each group successfully before moving to the next. Tables within a group can be imported in any order for declared cross-table foreign keys. Always read import_after. If the live query reports cycles or self-references, pause and resolve row/restore ordering explicitly.

### Group 0

| Table | Required parent records |
| --- | --- |
| attendance_audit_logs | - |
| attendance_device_health | - |
| attendance_devices | - |
| attendance_settings | - |
| field_attendance_events | - |
| field_operations_rollout | - |
| field_payment_records | - |
| inventory_bom_items | - |
| inventory_stock | - |
| settings | - |

### Group 1

| Table | Required parent records |
| --- | --- |
| attendance_employees | public.attendance_devices |
| custom_fields | auth.users |
| inventory_bulk_order_plans | auth.users |
| inventory_materials | auth.users |
| inventory_parcels | auth.users |
| profiles | auth.users |
| sites | auth.users |
| user_roles | auth.users |

### Group 2

| Table | Required parent records |
| --- | --- |
| activity_logs | public.sites |
| assessment | auth.users, public.sites |
| attendance_device_commands | public.attendance_employees |
| attendance_leave_requests | public.attendance_employees |
| attendance_scan_events | public.attendance_devices, public.attendance_employees |
| commissioning | auth.users, public.sites |
| commissioning_approval_requests | auth.users, public.sites |
| company_tracker_assignments | auth.users, public.sites |
| contacts | public.sites |
| field_earnings | public.sites |
| field_existing_completions | public.sites |
| field_visit_schedules | auth.users, public.sites |
| field_work_rates | public.profiles |
| installation | auth.users, public.sites |
| inventory_logs | public.inventory_stock, public.profiles |
| machines | public.sites |
| media | auth.users, public.sites |

### Group 3

| Table | Required parent records |
| --- | --- |
| attendance_daily_records | public.attendance_employees, public.attendance_scan_events |
| attendance_photos | public.attendance_scan_events |
| company_tracker_comments | auth.users, public.company_tracker_assignments |
| company_tracker_issue_resolution | auth.users, public.company_tracker_assignments |
| company_tracker_monitoring_days | auth.users, public.company_tracker_assignments |
| field_earning_date_changes | public.field_earnings |
| field_payment_items | public.field_earnings, public.field_payment_records |

### Group 4

| Table | Required parent records |
| --- | --- |
| company_tracker_stage_history | auth.users, public.company_tracker_assignments, public.company_tracker_comments |

## Your activity_logs failure

The correct dependency sequence is Auth users -> sites -> activity_logs. The CSV error references site 2f41b1bb-6ba8-45c4-87df-83b7dbbe38df. Its original row must exist in public.sites before the log row is inserted. All other nonempty site_id values must also exist, not just the first failed one.

If that site does not exist in the original source either, inspect why the exports disagree before editing history. Do not invent a placeholder site.

## After each import

Compare imported IDs and expected source counts; note legitimate pre-existing configuration rows. On failure, check whether earlier batches were already inserted before retrying, using IDs from the source file. Do not assume every CSV import is all-or-nothing or repeatedly append it.

Check the importer error's foreign-key name with this read-only query:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid = 'public.activity_logs'::regclass;
```

Change only the table name for other failures. The REFERENCES portion identifies which parent table and column must exist first.

After all imports verify row contents, relationships, permissions, Auth, files and application workflows in the Vercel preview. Keep production configuration unchanged. Storage bytes and Edge Functions remain separate migration work.
