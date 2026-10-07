# SimKit Ops: Lovable Cloud to your own hosted Supabase project

Current status (2026-10-07): the initial database/Auth snapshot and 52 site documents have been migrated to `jhhiwyvrhfhvvougkqmm`. The user confirmed local login and MOM document opening. Document access code is prepared locally. The user has deferred attendance Edge Function deployment and requested ordinary local development and the existing application's production migration first. Normal `npm run dev` now uses the new project through `.env`; no custom preview launcher is required. Production remains on its original backend; no production GitHub push, Vercel environment change, schedule activation or MQTT bridge change has been performed. Keep the existing Vercel project and domain to preserve the production URL. Production release still requires its backend environment variables, existing workflow/integration checks and reconciliation of newer source writes. The sections below retain the earlier migration history; they are not instructions to rerun completed imports or to deploy deferred attendance functions.

## Current local setup and next production steps

Run `npm run dev` from this project directory and use the Local URL printed by Vite (verified as `http://localhost:8080/`). Restart an already-running terminal with Ctrl+C and `npm run dev` to reload environment changes. Both browser and server Supabase variables in the regular ignored `.env` now point to the destination. Original local variables are backed up privately as `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/local-env-before-switch.env`. Telegram and other non-Supabase settings were retained. Vite's development-only server environment plugin loads server credentials from `.env` without defining or exposing them as client variables; existing shell/deployment variables take precedence. The Supabase CLI config now names the new project.

Attendance MQTT/photo/email/cron deployment is deferred. No ordinary non-attendance frontend call to an Edge Function was found: the current factory-form Telegram workflow calls the existing TanStack server function, which is bundled into Vercel and uses its existing server credentials. The separate `notify-factory-form-telegram` Edge source is not a prerequisite for that current frontend path; assess separately if an external database webhook uses it. Do not claim device enrollment or automatic attendance photo cleanup works yet.

The ignored `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/vercel-backend.env` contains the five required destination browser/server variable values, including a private server key. Use this file only in the existing Vercel project's Settings -> Environment Variables; do not commit or paste it into chat. The regular `.env` is ignored and will not update Vercel through a GitHub push. Preserve existing SMTP/Resend/Telegram and other integration variables.

At the reviewed cutover, update these five Vercel variables together: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The last is private/server-only; never prefix it with `VITE_`. A new deployment is required for changed variables to take effect. Keep the same Vercel project, GitHub connection and domain. First rehearse the same variables in a Preview deployment when available, test existing workflows, then reconcile source changes after the snapshot and release on the existing production branch. Do not change Production variables yet merely to test a preview.

Required existing-workflow checks: login/roles, sites and assignments, assessment/installation/commissioning, client invitations/forms, document upload/open/delete, logistics/inventory/orders, field operations/reports, manager account operations, password recovery and notifications. Read-only API/prerequisite and local regression checks have passed as recorded below; real email/Telegram delivery and all role workflows are not yet confirmed. The source snapshot predates possible production changes after 13:27:20 India time on 2026-10-07; these must be reconciled before the new backend becomes authoritative.

Confirmed by the user: the destination is on the Free plan; production is deployed on Vercel through GitHub. The source database/document exports were received, and Docker-based PostgreSQL tooling completed the destination restore. Native pg_restore/psql are not needed for normal website operation. The reported npx deployment issue does not justify changing the production URL or backend before verification.

Latest destination confirmed: `jhhiwyvrhfhvvougkqmm`, URL `https://jhhiwyvrhfhvvougkqmm.supabase.co`. The user authorized the migration and the targeted private-document code correction, and now requested verification before a GitHub push. Work is confined to the destination and local project until the production release is ready for review. Original production connections remain in place. A restored snapshot must not be treated as a fully reconciled live backend.

The user has now confirmed that the destination is empty and requested table creation first. A SQL Editor setup file is prepared at `supabase/migration-deploy/NEW_PROJECT_SCHEMA.sql`. It combines 46 reviewed timestamped repository migrations into one transaction, preserving their schema/RPC definitions and omitting standalone company-import/logistics-seed scripts. It creates 43 application tables plus RLS/RPCs/triggers and configuration defaults. It guards against running when public already contains tables. Local PGlite replay passed, business tables were empty, and the rerun guard passed; the local fixture does not validate hosted pgcrypto installation or remote deployment. The original source/migrations/app code are unchanged. This is repository-derived setup, not proof of matching all live Cloud schema changes.

To run without providing a password: open the Supabase Dashboard for `jhhiwyvrhfhvvougkqmm` -> SQL Editor -> New query, paste the complete NEW_PROJECT_SCHEMA.sql and Run. The last query lists 43 tables. Run only once on the empty destination, not the old Cloud database. On error report the exact error and do not run fragments out of order. Auth accounts/files/data and Edge Function deployments are still separate phases. Original site-media/site-docs bucket definitions are not present in repository migrations; reproduce their live settings separately during file migration, rather than guessing their visibility here.

Source backup received locally on 2026-10-07: `bucket-database_export_07_10_26-files.zip`. It contains one file, `78d107ad-7565-47c1-a10b-dfcda66189db_261007.backup`, 867250 bytes. Its PGDMP signature identifies a custom-format PostgreSQL archive. An exact extracted copy is stored at `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/source.backup`; SHA-256 `61FEF36EF595E89D2BDC9A9BF6D306DB5F9283F730986E620B3079AB7487E6D9`. The ZIP is excluded from Git because it contains sensitive database/Auth data. Contents have not yet been inspected with pg_restore and nothing has been restored remotely. Docker CLI is installed, but its daemon is unavailable; pg_restore/psql are not on PATH. Private migration.env is not yet present. The next prerequisite is restore tooling and private destination connection credentials, followed by table-of-contents inspection before choosing restore sections for the already-created destination.

Subsequent inspection: Docker is running. The existing postgres:17-alpine image successfully listed and decompressed the zstd custom archive without network access or a database connection. Snapshot: 2026-10-07 07:57:20 UTC / 13:27:20 India time. The private report contains 43 public tables and 1396 application rows; 18 Auth user rows (all with nonempty password hashes), 18 identities, 10 profiles, 12 role rows, 99 sites and 651 activity logs. Storage metadata describes 54 objects in 4 buckets; file bytes are not included. The prior activity-log CSV contained 650 rows, so do not mix it with this snapshot without reconciliation. Table counts are archive inspection results, not a live-database verification.

Database data phase completed and remotely verified on 2026-10-07. The destination connection was validated as belonging to jhhiwyvrhfhvvougkqmm. Its initial state contained zero Auth users/identities and zero business rows, with four setup defaults. A private pre-restore backup was saved at `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/inspection/destination-before-restore.backup`. The 45-table data transaction (43 public tables plus auth.users and auth.identities) passed an isolated local PostgreSQL rehearsal, then committed remotely. All 1396 public rows, 18 account rows and 18 identity rows matched their staged source column values and counts before commit. Post-commit row counts also matched. Original passwords and UUIDs were retained; no API signup emails were sent.

The destination role cannot disable all database triggers via session_replication_role. Instead, owner-controlled public application triggers were suspended only inside the transaction; the two public signup trigger function bodies were temporarily made inert and their saved full definitions restored before commit. Post-commit checks confirmed those definitions were identical, public application triggers were enabled, and all 43 public tables had RLS enabled. Foreign-key checks remained active. The new setup's generated attendance-policy date was reconciled with source dates; no business rows were deleted. The temporary local rehearsal container was removed after verification.

Transient Auth sessions, refresh tokens, one-time tokens, session AMR claims and platform migration-history records were deliberately not restored. They are not portable login sessions and must not replace the destination platform state; users must sign in again. Source exported MFA/WebAuthn/provider tables had no rows. Source business rows and account/identity rows were not selectively dropped. Public data is still only the snapshot state, not ongoing production synchronization.

Remaining migration work: Storage bucket settings and actual file bytes, destination URL mappings for media, Auth provider/redirect/email settings and login tests, Edge Function deployment and secrets, a Vercel Preview acceptance test, production changes since the snapshot, and a reviewed cutover. No Vercel production configuration, original Lovable records, application source code, or deployed Edge Functions were changed during this data phase. Private audit/result files are retained under the ignored migration directory; they must not be committed or pasted into chat.

Private inspection files: `archive-list.txt`, `inspection/archive.sql`, `backup-inspection-report.json` and `schema-column-comparison.json` under the isolated migration directory. The generated SQL contains sensitive Auth material and must not be pasted into chat or committed. Repository-derived schema comparison found additional destination-definition columns absent from the snapshot: sites.active_phase, sites.active_section and profiles.status. No source columns were missing from the reviewed repository definitions. Preserve/review additive-column defaults and validate their behavior instead of silently dropping columns or changing application code. Full destination inspection remains required; no remote restore has happened. Destination credentials file is still absent.

An isolated deployment copy is prepared at `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/`. All available function source files are exact SHA-256-verified copies; only that copy's deployment config points to the new ref. It contains `migration.env.example` for local private credentials and `source-manifest.json` for verification. The original app config/source has not been rewritten. This directory is already excluded by `.gitignore`.

Execution prerequisites: source Cloud `.backup`/schema export or authenticated source database access, destination database password or usable connection, Supabase personal access token for CLI/API deployments, and confirmation whether destination contains existing objects. An `sb_secret_...` project API key cannot substitute for a personal access token used by the deployment API. Keep credentials in `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/migration.env`, not chat. Revoke the private project secret previously shared in chat and store its replacement securely if needed later.

## The migration approach

Keep the existing production app and Lovable backend running while building a separate Supabase destination and testing a separate app preview. Do not point production at the destination until its database, authentication, files, permissions, integrations, and final writes are verified.

```text
Existing production app -> existing Lovable Cloud backend
                                  |
                           export + copy
                                  v
Separate preview app -> new Supabase project
                                  |
                      validate + capture later writes
                                  v
                     controlled production cutover
```

Building and rehearsing can happen while production runs. However, a snapshot export does not include later writes. Zero lost writes with uninterrupted writes requires a supported continuous change-capture mechanism, durable replay, and a controlled ownership switch. This is not established for your Lovable project. Do not claim a backup-only migration achieves it.

Existing login sessions should be expected to require signing in again. This is a separate effect from data loss. See [Supabase Auth migration guidance](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects).

## Step 1: Confirm the source, destination, and hosting

Record these without publishing credentials:

| Item | What to confirm |
| --- | --- |
| Source backend | Lovable project name, actual project URL/ref used by production |
| Destination | New Supabase project URL/ref in your own account |
| Production hosting | Where the separate SimKit Ops app runs and who can edit build/runtime variables |
| Preview hosting | A separate deployment that never updates production configuration |
| Database access | Full Cloud export available? Direct database/replication access available? |
| Auth | Password login, providers, SMTP, redirects, MFA, reset flow |
| External writers | Other apps, browser tabs, background jobs, webhooks, devices, imports, service accounts |

Do not assume the project ref in local supabase/config.toml is the live production backend. Verify it against the deployed application's connection. Do not put passwords, service keys, or database archives in chat or Git.

## Step 2: Inventory the current backend without changing it

Run `supabase/scripts/migration_inventory_readonly.sql` in the old Cloud SQL editor. It reports table sizes/estimates, aggregate Auth counts, bucket counts, function signatures, policies, triggers, extensions, and Realtime membership. If the editor shows only the last result, run its numbered sections separately and save each result securely. The optional exact-count query can be expensive; run off-peak. These are discovery queries, not a production lock or full backup.

Also record Cloud Jobs, database webhooks, existing deployed functions, provider settings, and secret NAMES. Keep secret values in a password manager or secure environment configuration. A local directory is not proof a function was deployed.

Repository findings that need special handling:

- `profiles`, `user_roles`, and many business records refer to `auth.users` UUIDs. Preserve user IDs; recreating accounts with new IDs breaks assignments and permission relationships.
- `src/components/MediaUploader.tsx` stores full Storage public URLs in `media.file_path`. Copying the files alone does not update those URLs.
- Known buckets include `site-media`, `site-docs`, and new private `attendance-photos`. Inventory the live project for all other buckets.
- This is a TanStack Start application. Its browser and server both access Supabase. The server also has password-reset/admin paths and Telegram notifications.
- There are timestamped migrations plus manually named SQL files. Some migrations seed data or normalize/delete duplicates. Do not execute every file blindly against restored data.
- Six attendance function entrypoints exist locally. `notify-factory-form-telegram` also has an entrypoint. The `notify-commissioning-approval` directory currently has no index.ts; obtain actual deployed source if it is used.
- The generated TypeScript definitions are not a reliable inventory of every live table. Use the source database catalog/export.

## Step 3: Create the new Supabase project

Create a project in your own account, with an appropriate region and a strong database password stored securely. Leave production settings alone. Free is suitable for a rehearsal if the data fits: confirm the 500 MB database and 1 GB file allowances against the actual inventory, and account for inactivity pausing. Avoid choosing a destination too small for existing production data. [Current Supabase plans](https://supabase.com/pricing).

Record its URL/ref and public client key separately from its server-only service-role key and database connection. Public client keys belong in frontend configuration; service-role/database credentials do not.

## Step 4: Request a full Lovable Cloud export

In the existing Lovable project:

1. Open More -> Cloud -> Overview -> Advanced settings.
2. Find Export project data -> Export data.
3. In the Database card choose Export -> Start export.
4. Download when ready; keep the original archive and a second encrypted copy.
5. Record request time, export completion, confirmed snapshot boundary if provided, and SHA-256 checksum.

Lovable documents a full database export, including Auth accounts/password hashes. Its export is a custom PostgreSQL `.backup` archive; an outer ZIP must be extracted first. It is not SQL to paste into the SQL editor. [Official migration instructions](https://docs.lovable.dev/tips-tricks/external-deployment-hosting).

Lovable currently documents one export per 24 hours, source storage up to 15 GB, and archive size up to 5 GB. It excludes actual Storage files, function code, and secrets. Keep Cloud running and retain export downloads before any removal. [Export availability and limits](https://docs.lovable.dev/features/advanced-settings).

Do not use per-table CSV as the only migration backup: it does not preserve the complete Auth/schema/relationship setup. Do not remove Cloud.

## Step 5: Inspect and rehearse the restore

A browser-only workflow is not sufficient to restore this custom archive. PostgreSQL client tools with zstd support are required; this does not require npm/npx. If your PC cannot run these tools, use a trusted administrator's machine or a secure temporary migration environment, keeping archive and credentials private.

First run only this inspection command on the downloaded archive:

```powershell
pg_restore --version
pg_restore --list 'C:\private-migration\source.backup' > 'C:\private-migration\archive-list.txt'
```

Replace those paths with the actual private backup location. This lists archive objects; it does not connect to production or restore data. Confirm the tool supports the archive version and can actually decompress its data; listing alone is insufficient.

Before any restore, inspect the table of contents and prepare a reviewed selection/order:

1. Compare source/destination PostgreSQL versions, extensions, Auth schema versions, and platform roles.
2. Establish the application schema using a reviewed export selection or audited chronological migrations; avoid creating it twice.
3. Identify existing initialized `auth`/`storage` objects and restore compatible data/customizations separately. Do not overwrite all managed platform schema definitions.
4. Preserve Auth user UUIDs, password hashes, identities and relevant supported Auth data. Keep profile-creation triggers from producing duplicate records during import.
5. Restore application tables respecting foreign keys, seeds, enum values, sequences, constraints, views, RPCs, grants, policies, and custom Auth/Storage triggers.
6. Deal explicitly with extension-managed objects, Vault, Cron, webhooks and jobs. They must not send real notifications or call production during rehearsal.
7. Restore under an operator account with the required privileges; log errors and stop on them. Verify no constraints/triggers remain disabled afterward.

Do not use `--clean`, drop schemas, or relax RLS as a shortcut around restore conflicts. Do not restore to the old project. Do not run all repository seed/normalization scripts over imported business data. Record which migrations the export already includes and reconcile migration history for future releases.

There is intentionally no generic executable full-restore command here: the correct selection depends on the actual archive and initialized destination. Once the archive listing is available, prepare the exact restore plan for that destination. Supabase's [restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) describes the managed-schema/customization issues; its plain-SQL commands are not a direct replacement for custom-archive restore.

For rehearsal use a disposable destination or a reviewed repeat-restore procedure. A later fresh snapshot cannot safely be appended on top of the previous one without handling deletes, updates, duplicate seeds, constraints, and Auth records.

## Step 6: Copy Storage file bytes and fix references

Create a manifest of every source bucket/object: path, size, content type, visibility and available checksum. Download bytes through supported storage access, then upload to the corresponding destination buckets with the same paths and intended policies. SQL `storage.objects` records alone are not a file copy. Reconcile metadata using the supported Storage service, rather than treating imported object rows as proof of existing bytes.

Compare object counts, sizes and content checksums, and test retrieval with the actual permitted user roles. Capture uploads, replacements and deletions that happen after this first copy for the final reconciliation. Preserve private/public settings. Do not make private buckets public to make a test pass.

On the destination only, rewrite `media.file_path` values whose prefix exactly matches the old project's Storage URL, keeping bucket and object path. Save a before/after mapping. Do not globally replace user-entered external links. Audit all other URL-bearing fields and settings for old backend URLs. Confirm upload, open/download, and delete still work; the app extracts an object path from that URL when deleting.

For attendance photos keep the original expires_at and 24-hour retention. Do not copy already expired photo bytes, and do not extend retention by treating migration time as scan time. Permanent attendance records remain.

## Step 7: Recreate Auth and integrations

Preserve IDs and roles. Configure enabled sign-in providers, provider client credentials, callback URLs, Site URL, allowed production/preview redirect URLs, SMTP/templates, signup rules and applicable MFA settings. Test existing passwords after a supported Auth restore. Do not reset everybody's password as the default migration method.

Old sessions do not automatically become valid sessions in the new project. Plan a user notice and a controlled sign-in-again step. Test your custom reset-token/server password-reset workflow as well as normal login and signup.

Inventory and deploy functions actually needed by existing production. Recreate their secrets securely, and leave duplicate schedules/webhooks/notifications inactive until ownership is switched. The original deployment restriction in Lovable does not apply to functions in your own Supabase project.

Keep attendance enablement separate from migrating existing working features. You can deploy `attendance-enroll-user` to the destination using the existing single-file Dashboard copy, but do not send real enrollment commands during restore testing. Its actual vendor command/topic/reply rules are still required.

## Step 8: Deploy an isolated preview of this repository

Use a separate host preview environment, not production settings. This app needs a host that runs TanStack Start server code, not only a static file upload.

| Variable | Set to in the preview |
| --- | --- |
| VITE_SUPABASE_URL | New project URL (build-time) |
| VITE_SUPABASE_PUBLISHABLE_KEY | New public/anon client key (build-time) |
| VITE_SUPABASE_PROJECT_ID | New ref where used by tools/config |
| SUPABASE_URL | Same new project URL (server runtime) |
| SUPABASE_PUBLISHABLE_KEY | Same new public/anon key (server runtime) |
| SUPABASE_SERVICE_ROLE_KEY | New service-role key; server runtime only |

The `.env.example` currently does not list all runtime settings used by the code. Use this table plus an inventory of runtime variables; do not rely on that example alone. Preserve unrelated Telegram/external-service settings, but use test recipients or disabled sending in preview.

Rebuild the frontend after changing VITE values and redeploy/restart the server after changing runtime values. Confirm browser calls and server calls both reach the new project. Never expose SUPABASE_SERVICE_ROLE_KEY with a VITE prefix. Do not mix old browser URL with new server credentials.

The local repo includes Vercel configuration but this does not establish where current production is hosted. Confirm hosting first. You do not need to connect this repository to Lovable to test/deploy it elsewhere.

### Your confirmed Vercel + GitHub setup

1. In Vercel open the existing project -> Settings -> Git and record the actual Production Branch. It is often main, but verify it.
2. Record the currently working production deployment and securely preserve its configuration for rollback. Do not expose secret values in a screenshot/chat.
3. Create a non-production branch for migration testing in GitHub, based on the intended production source. Do not merge it or push migration changes to the production branch yet. Review the current local uncommitted attendance work before publishing any branch; a migration should not accidentally ship unrelated unfinished features.
4. Open Vercel Project -> Settings -> Environment Variables. For the Supabase variables in the table above, choose Preview ONLY and scope them to the migration branch. Leave Production and other previews unchanged. Override both browser and runtime values together.
5. Configure only destination Auth redirects to permit the migration preview's URL. Existing production Auth settings remain on the old backend.
6. Create/redeploy that branch's Preview deployment after restore. Vercel changes apply to new deployments, and Vite frontend values require a rebuild. Confirm the preview URL, not the production domain, is open when testing.
7. Use test notification recipients or disabled sending in this preview. Ensure it does not inherit production external-writing credentials and accidentally send duplicate notifications.
8. Do not promote this Preview artifact to Production: it was built with preview settings. At the final reviewed cutover, set Production-scoped variables and create a fresh Production build with the reviewed source/config; coordinate the writer switch described below.

Vercel supports separate Production/Preview values and branch-specific preview overrides: [Environment variable documentation](https://vercel.com/docs/environment-variables).

## Step 9: Validate the rehearsal

Save a verification report, using consistent source/destination boundaries:

- Schema: tables, columns/types, enums, RPC definitions/signatures, RLS/grants, indexes, constraints and triggers.
- Data: exact row counts, primary-key sets, row-content checksums or canonical comparisons, sequence next values, and no broken foreign keys. Counts alone are insufficient. Explain intentional URL transformations and expired-photo exclusions.
- Auth: same account IDs, identities, role mapping and password sign-in; sample owner, supervisor, worker, consultant and logistics access as applicable. Confirm denied operations stay denied.
- Files: manifest completeness, byte/checksum verification and private/public access.
- Workflows: site/company creation, assignments/tracker/comments, assessment, installation, commissioning approvals, inventory/BOM/orders, logistics, field attendance/earnings/visits, manager user creation/password reset, notification behavior and uploads/deletes.
- Operations: Realtime subscription behavior, secret availability, jobs/webhook destinations, absence of duplicate external effects, logs/errors, expected performance.

Use synthetic test records and an inventory of their IDs; remove only those test records before final validation. Do not alter imported historical records to make tests pass.

## Step 10: Choose a cutover method before touching production

### A. If writes must continue without interruption

Obtain a supported source change-capture mechanism from Lovable/support or approved database access. It must cover all inserts, updates AND deletes, preserve transaction boundaries and ordering, and start at a boundary aligned to the snapshot. Reconcile Auth changes and Storage bytes separately, including deletes and concurrent password changes.

Build a durable replay/checkpoint process and rehearse it. Define a final source watermark, prove every earlier committed change is applied, and serialize/route ownership of later writes to the destination. Handle stale tabs, queued device events, independent services and in-flight jobs. There must be one writer authority per operation. Database logical replication by itself does not migrate every Auth/Storage/integration behavior.

Do not implement naive browser dual writes: one side can succeed while the other fails. API polling cannot prove delete capture without a durable deletion log. `updated_at` values alone are not a complete migration protocol.

If this source access is unavailable, stop before cutover. A running snapshot export alone cannot satisfy the no-interrupted-writes requirement. Ask support for an assisted migration or change-capture capability.

### B. If a controlled temporary read-only interval is acceptable later

This is a separate user decision; it is not authorized by the current request for no stop. Do not enact it yet.

Once approved, keep reads available and enforce a write barrier for every writer at the backend, including signup/password changes, Storage and jobs; a frontend banner alone is insufficient. Drain in-flight work, then take the authoritative snapshot/final delta and restore/reconcile it. Validate final data and files while source writes remain blocked. Switch browser/server configuration together, invalidate obsolete clients appropriately, switch integrations/schedules once, and reopen destination writes only after verification.

The duration depends on the measured restore/file-copy time and Cloud export availability. Do not promise a five-minute window: exports are asynchronous and documented cadence is once per 24 hours. Schedule rehearsal and final exports accordingly, or arrange support assistance.

## Step 11: Production release and rollback

Prepare the exact release/config diff and reconciliation report first. Review the go/no-go with the user before changing production. The user is approving a concrete tested switch, not an untested replacement.

At cutover update build-time and server-runtime variables to the same project, rebuild, route traffic, switch external writer destinations/credentials, and activate only destination jobs. Ensure cached/stale clients cannot continue writing to the old source. Confirm fresh sign-in and a recorded create/update/delete operation on the destination.

Rollback rules:

- Before any new production writes on the destination, return traffic/config to the old backend if the source is still authoritative and available.
- After destination writes begin, switching URLs back can lose those writes. Block/re-route writes using the reviewed recovery procedure, export/replay destination changes to the old source or recover forward, verify reconciliation, and only then switch. Keep a durable operation/change record for this recovery.
- Keep the old backend intact and funded/available for an agreed validation period, with writes controlled after cutover. Protect/download final backups and file manifests. Do not click Remove Cloud or delete the project as part of the initial switch.

Monitor auth failures, errors, missing files, job histories, unexpected old-backend traffic, row differences, duplicates, performance and quota usage. Take an independent backup of the verified new state.

## What you should do first today

1. Confirm the destination project and production host.
2. Request the first full Cloud export, download it privately, and run discovery queries off-peak.
3. Ask Lovable/support the access question below. Do not disconnect Cloud.
4. Share only the archive's object listing/metadata through a secure channel after redacting sensitive names as needed; do not paste its user data or password hashes.
5. Prepare a rehearsed destination restore and preview before scheduling any production action.

Support request:

```text
We want to migrate this running Lovable Cloud backend to a Supabase
project in our own account, preserving all user UUIDs, password hashes,
business data, files, and permissions without losing ongoing writes.

Please confirm the supported full-export process and its snapshot
boundary, and whether we can obtain ongoing change capture or an
assisted migration. We need inserts, updates and deletes, plus Auth
and Storage changes after the snapshot and a controlled cutover.

Do not pause, remove Cloud, change production credentials, or deploy
application changes while inspecting options. If uninterrupted writes
cannot be supported, state that explicitly before any migration.
```

The initial database snapshot has been restored to `jhhiwyvrhfhvvougkqmm`. Production cutover remains pending; this snapshot does not include later source writes.

## Site documents copied — 2026-10-07

`site-docs-export.zip` contains all 52 source document objects. Their paths, sizes and all 52 source metadata MD5 checksums matched the database export. Files were extracted into the ignored private migration staging directory and uploaded through the destination Storage API with original paths and content types. Uploads did not overwrite differing objects. Each destination document was downloaded and SHA-256 compared with its extracted source file; all 52 matched. The destination `site-docs` bucket remains private. `site-media` file copying was skipped as requested, without deleting its database records or source objects.

Read-only inspection of destination `public.media` found 44 `site-docs` references, all pointing to objects present in the export. They initially referenced the old backend and used public URL format despite the private bucket. The user subsequently authorized fixing document access. All 44 references have now been updated to stable authenticated object URLs for the destination in one guarded transaction, verifying that all other media metadata and unrelated links stayed unchanged. Original URL mappings are retained in private staging for recovery. No source/production database URLs were changed.

The app now resolves same-backend document references to fresh five-minute signed URLs using the browser user's existing authenticated Supabase client. Storage RLS remains responsible for permissions. `SiteDocumentLink` handles clicks in the uploader and the staff links panel; external links and site-media downloads retain their existing behavior. New document uploads store stable authenticated references, not expiring signed tokens. Document deletion recognizes both legacy and authenticated references and stops if Storage deletion fails. No additional Edge Function or secret browser key is needed for document access.

Verification: five document regression tests passed; the production build passed; the new helper/component lint passed. Full TypeScript diagnostics were compared with the same checkout before this change: 106 errors before and 106 after, with no added diagnostics. Existing uploader/staff-panel lint errors (three `any` catches, one unnecessary regex escape, and existing formatting) remain outside this focused change. Real destination API checks verified all 44 new URLs, denied anonymous URL signing and public downloads, and downloaded a temporary signed document whose SHA-256 matched its source. The successful signed-download API check used the administrative client. The user subsequently reported successful login/dashboard access and MOM document opening in the local preview. Other roles and workflows still need validation; this does not establish that the production migration is complete.

A local preview against the new project was started at `http://127.0.0.1:4175/` with isolated environment variables from the ignored `preview.env` file. The regular `.env`, production deployment settings and original Supabase configuration project ID were not changed. To restart from the project directory, run `node .tmp/start-migration-preview.mjs`. Sign in with an existing migrated account, open an existing MOM document, and verify upload/download/delete access for an authorized user before cutover. The app should reject inaccessible documents for other users. Do not publish to production yet: Edge Function deployment/secrets, Auth configuration, integration checks and reconciliation of source writes after the backup are still pending.

Private verification artifacts: `site-docs-audit.json`, `site-docs-upload-result.json`, `site-docs-link-update-map.json`, and `document-access-verification.json` in `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/`. The ZIP and staging files are excluded from Git. Production configuration, source storage files and source database remain unchanged. Only the authorized local document handling and the new project's document references were changed.

## Temporary-file cleanup and production MOM report

The user authorized removal of unwanted files. Removed 62 generated targets containing 921 files (68.27 MiB): generated `.output`, obsolete `.tmp` test outputs/dependencies, duplicate extracted document files, and obsolete local rehearsal SQL/logs/credentials. Original database/document ZIPs, source/recovery backups, migration manifests/reports, preview credentials, deployment files and application code were preserved. The cleanup receipt is `.tmp/cleanup-receipt.json`; duplicate document extraction can be regenerated with `prepare-site-docs.ps1` if needed for upload recovery. The preview remained accessible after cleanup and still pointed at the new project.

The user reported production MOM links return `404 NoSuchBucket`. Production code/configuration has not been switched by this migration. A public object URL to a private bucket can return this error; it does not by itself prove that the document bytes are missing. Confirm the actual production website's backend and download flow before making any deployment changes. Production website URL was requested. Do not make buckets public or switch production merely to bypass this error; preserve ongoing source writes and complete the remaining deployment/reconciliation checks first.

## Verification before GitHub/Vercel release — 2026-10-07

The user's production address should remain unchanged: continue using the same Vercel project/domain. A GitHub push deploys code, but does not automatically migrate backend functions, secrets, jobs or newer source data. Do not push to the production branch or replace Production environment variables while the following blockers remain.

Passed checks:

- 57 existing regression tests covering field operations, attendance/Edge/MQTT logic and document URL handling passed. Seven new database workflow migration tests passed, for 64 tests in total. These are local regression tests, not proof of a live device or external email/Telegram integration.
- A build with `VERCEL=1` and isolated destination preview variables passed and generated `.vercel/output/config.json`. Scanning 70 client output files found the new backend settings, no old backend URL, and no private Supabase secret key. This proves build configuration; the generated build has not been deployed.
- The hosted destination has all 43 application tables with RLS enabled, no disabled public triggers and no unvalidated application foreign keys. Its 18 Auth accounts/identities remain present. All 43 distinct literal RPC names called by the app now resolve to hosted functions; no referenced application table is missing. Dynamic runtime call shapes still need workflow tests.
- The audit found six functions present in the Cloud export but absent from repository schema setup. They were restored by `20261007180000_restore_cloud_workflow_functions.sql`: `delete_worker`, `get_client_form_site_by_token`, `save_client_form_by_token`, `save_client_invitation`, `reset_password_by_identifier`, and `reset_user_password`. The source commissioning approver list was also restored. Account deletion requires staff/service permissions; invitation changes require site/service permissions; unused legacy identifier reset helpers are service-role only. Client-token form endpoints remain callable with a valid token. No existing data was changed by this transaction. Anonymous invitation/account deletion and invalid-token reads/writes were checked against hosted APIs and denied.
- The private `site-media` bucket was created with source settings to support future uploads. Its two old files remain intentionally uncopied at the user's request. `site-docs` remains private with 52 objects, and `attendance-photos` remains private with no snapshot photos.

Remaining prerequisites before production:

1. All seven existing Edge Function source entrypoints currently return `404 NOT_FOUND` on the new project. Deploy the six attendance functions and `notify-factory-form-telegram`; configure needed secrets/webhooks and test authorized/denied behavior. A Supabase personal access token is required for deployment/management inspection; the project secret key cannot replace it. The token should be added as `SUPABASE_ACCESS_TOKEN` in the existing private `migration.env`, never pasted into chat or committed. The empty `notify-commissioning-approval` directory is not deployable source; confirm whether a live source implementation needs exporting separately.
2. Auth settings/email delivery and server email/Telegram credentials need inspection and end-to-end testing. Existing password hashes preserve accounts but do not prove recovery emails, account creation, client invitation email or external callbacks work.
3. MQTT enrollment command format/acknowledgment, broker credentials and device callback delivery require real-device verification. The local MQTT tests do not prove a live enrollment succeeded.
4. Cron is not yet installed/configured on the destination. Photo cleanup/retry schedules must be prepared and tested before claiming automatic retention behavior; do not activate duplicate external side effects while the old backend is authoritative.
5. Manual preview checks still need to cover representative roles and site creation/assignment, assessment, installation, commissioning approval/submission, tracker/comments, inventory/BOM/orders/logistics, field visits/attendance/earnings and reports, new upload/delete operations, user creation/password recovery and notifications. Local login/MOM access is confirmed for the account tested by the user, not every role.
6. Reconcile source inserts/updates/deletes, Auth and Storage changes after the original snapshot (2026-10-07 13:27:20 India time), using a supported change-capture/assisted migration process. The current destination is a snapshot plus preview activity. Do not promise zero data loss or uninterrupted writes from a snapshot alone.

Private evidence: `readiness-analysis.json`, `workflow-prerequisites-verification.json`, `vercel-build-check.json`, `vercel-client-env-check.json`, and `.tmp/migration-regression-results.txt`. The source/target function bodies are not all identical: some differences are comments/formatting, others are current repository password-validation/email-confirmation behavior, newer field-visit features and the explicitly applied administrative access guards. Do not replace newer repository functions wholesale with older export bodies. Existing 106 TypeScript errors remain a separate recorded limitation, despite successful Vercel builds.

The next action is to obtain the personal access token and inspect/deploy the existing Edge Functions to the destination. When all prerequisites pass, prepare one reviewed Vercel release on the same project/domain, with browser and server environment variables targeting the same backend, then approve the production switch using the reconciliation and rollback plan above.
