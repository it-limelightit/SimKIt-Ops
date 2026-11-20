# SimKit commissioning verifier

Local, open-source verification worker for the existing Supabase application. No paid OCR/AI endpoint or extra Node dependency is used. This implementation is **not activated or deployed** by checking in these files.

Deployment update (17 November 2026): automatic commissioning migrations and the Edge Function are deployed, and the local tools and worker are installed. Automatic commissioning is enabled for new eligible sites, with 103 historical sites excluded. Approved letter/logo/authority references are still required before a real company can pass. The deployment sequence below is a reference for a new installation; see [current UI setup and status](../../docs/COMMISSIONING_UI_SETUP.md) for this project's setup. The installed worker uses backend-issued short-lived Drive tokens instead of a local Google private key.

## Agreed media rules

- At least **4 unique readable photos**. Four to five is the expected quantity; extra files are allowed.
- At least **120 seconds of video in total** across unique, readable clips. A single clip can meet the requirement.
- Exact duplicate content counts once. Recompressed or cropped copies are not currently detected as duplicates.
- Uses the company's existing root folder. Photos/videos are found inside Media/Photos/Videos folders, including nested folders. The letter may be in a commissioning-letter/certificate folder (common spelling variants accepted) or directly in the company root. Readable file/folder shortcuts are followed; unrelated parent shortcuts are ignored. Repeated target IDs count once, circular shortcuts fail clearly, and letter scans do not inflate photo counts.
- Exactly one completed certificate, maximum five pages, accepted as PDF/JPEG/PNG/WebP. Word files must be saved as PDF first.

## Existing records are protected

The migration adds configuration, exclusions, folder mapping, queue, and service-only RPCs. It does not rewrite existing commissioning, site, submission, work-date or payment records. It does not replace legacy submission/review functions.

`activate_commissioning_verification()` creates an immutable exclusion cohort for existing requests and historical completed/submitted sites. Activation is explicit and one-time. Old requests do not become new merely because their `requested_at` changes on resubmission. New requests for companies already in SimKit can qualify if they have no previous commissioning request/completion.

The finalizer locks the current request/site and checks the job lease, revision, historical exclusions, assignment, installation submission, commissioning checklist and current folder policy. It updates only that eligible site. Existing field operations triggers create the earning from the normal approved request; the worker never creates a payment or impersonates a manager. Automatic decisions have `reviewed_by=NULL` and an explicit system source/verification ID in commissioning data.

Historical work dates stay untouched. For a newly approved request, the current application's existing earnings trigger uses approval time as its completion time, just as for manager approval. Any different work-date policy needs to be agreed before activation. Verification time is retained separately in the job.

## Google Drive connection

Continue using `it@limelight.io` and the existing evidence locations.

1. In a Google Cloud project, enable Google Drive API and create a service account, with no broad Google Cloud project role.
2. Share only the approved evidence root folder with the service account email as Viewer. Keep public access restricted. Child folders must permit downloads.
3. Store its JSON credential outside the repository. Point `GOOGLE_APPLICATION_CREDENTIALS` to it. The worker requests only `drive.readonly`.
4. If Workspace policy blocks service-account sharing or key creation, use an administrator-approved authentication method. Do not bypass the policy.

The worker uses the Drive API directly. No Drive desktop sync, Google account ownership transfer, or per-associate Google login is required. Standard API usage has no additional charge within the published allowances; actual project quotas and future pricing must be checked before operation. Supabase plan limits, electricity, internet and existing hosting still apply.

References: [Google credentials](https://developers.google.com/workspace/guides/create-credentials), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive quotas/pricing](https://developers.google.com/workspace/drive/api/guides/limits).

## Worker prerequisites

Use an existing maintained PC/server with Node.js 22+, FFmpeg/ffprobe, ImageMagick, Tesseract with English language data, and Poppler (`pdfinfo`, `pdftoppm`). Use current patched tool builds. These executables are not bundled or installed by this change. The worker uses argument arrays, never shell commands assembled from file names.

Keep the Supabase service-role key private. This worker is trusted backend infrastructure: service-role credentials are powerful and bypass RLS. Restrict access to the machine and its secrets. The browser never receives Google credentials, folder policies, job lease tokens, or service-role keys.

Copy `.env.example` to an untracked `.env` beside this README and fill the private values. Environment values are read explicitly with Node's `--env-file` option:

```powershell
node --env-file=integrations/commissioning-verifier/.env integrations/commissioning-verifier/worker.mjs --once
```

Remove `--once` for ongoing polling every 15 seconds. Run under your existing process supervisor for automatic restart. No inbound public port is needed. If the worker is offline, jobs wait; they never approve on timeout. Claimed jobs have a 30-minute lease and up to three crash/lease recovery attempts. Reported technical failures require correction and resubmission. Subprocesses have 120-second timeouts. Attempts are capped at 100 MB per file, 512 MB downloaded overall, and 60 files per folder.

## Deployment sequence

1. Run `node --test tests/commissioning-verification.test.mjs tests/field-operations.test.mjs` and the application build.
2. Apply `supabase/migrations/20261116120000_commissioning_verification.sql` through the project's usual migration process. Installing it leaves both activation and automatic approvals disabled.
3. Configure one test site's trusted certificate policy. Optionally pin its company root folder ID; otherwise set `GOOGLE_DRIVE_COMPANIES_ROOT_ID` to the approved parent containing all company folders. Exact normalized names/approved aliases are matched against the Supabase company name. Multiple matches fail; no arbitrary first result is selected. Use a staging environment first. Do not use historical production companies as test approvals.
4. Configure the worker and verify tool availability and folder access.
5. Enable the optional browser display using `VITE_COMMISSIONING_VERIFICATION_ENABLED=true` when building the application after migration. Existing requests without a verification job keep their existing flow. Polling is site-scoped and respects access checks.
6. In staging, call `activate_commissioning_verification()`, then submit a fresh request. Run the worker in shadow mode. A passed job remains `passed`, with the request still pending.
7. Review real sample results and historical before/after snapshots. Only when Drive access, logo matching and certificate rules are calibrated should production activation be scheduled and `auto_approve` explicitly enabled. Set it back to false to pause future automatic approvals; do not clear `activated_at` or exclusions.

Example service/admin SQL, **templates only, not executed by this change**:

```sql
INSERT INTO public.commissioning_drive_folders
  (site_id,root_folder_id,certificate_policy)
VALUES
  ('REPLACE_WITH_SITE_UUID',NULL,
   '{"approved_for_automation":false}'::jsonb);

-- After staging verification and explicit rollout preparation:
SELECT public.activate_commissioning_verification();
-- Keep false for shadow verification. Change only after policy/sample acceptance:
UPDATE public.commissioning_verification_settings SET auto_approve=false WHERE singleton;
```

No separate media/certificate folder mapping is required. Name-based company discovery is confined to the configured parent; an explicit company-root ID can resolve duplicate names. If a company has multiple sites, pin the correct site-specific evidence root rather than pooling sites. A pasted request link must identify the resolved root. Shared Drive listings are supported. All pagination is followed; incomplete searches fail. Traversal is bounded to 5 levels, 50 folders and 500 entries within a company, with at most 60 direct children per evidence folder. The companies parent listing permits 2,000 entries. The worker resolves the company again and compares the evidence manifest after inspection; changed evidence requires resubmission. Google Drive does not provide an atomic lock against edits after this recheck. Preserve approved evidence by access policy if an immutable audit is needed.

Shortcut targets are read only when reached through the selected company folder or its matching company-root shortcut. Targets may be physically stored elsewhere in Drive; the explicit shortcut is the association with this company. The service account still needs access to the actual target. Resource keys supplied by Drive are forwarded when needed. File manifests include shortcut IDs and target IDs, so retargeting is detected on the worker's second pass. A company-root shortcut's target is resolved again before completion. No shortcut is moved or replaced.

## Certificate policy: configuration still required

No company policy, logo or signatory list is invented. Until supplied, a job reports `needs_review` rather than approving. A policy has this shape:

```json
{
  "approved_for_automation": false,
  "signature_policy": "UNCONFIRMED",
  "company_aliases": [],
  "required_phrases": ["installation and commissioning certificate", "successfully installed and commissioned"],
  "signatory_names": [],
  "designations": [],
  "max_age_days": 30,
  "logo_sha256": "REPLACE_WITH_APPROVED_REFERENCE_SHA256"
}
```

The date window and authority policy above are examples to agree, not accepted business rules. The scanner currently reads numeric DD/MM/YYYY or DD-MM-YYYY dates. It compares full normalized company-name phrases, required text, approved entered signatory name/designation, date window, and a logo reference. It does not establish that a physical signature or seal is genuine.

**Signature-presence checks are not implemented.** The worker refuses to pass a certificate unless an authorized administrator explicitly accepts `signature_policy="name_and_designation_only"` and enables the calibrated policy. If physical signature/seal presence is required, retain exception review until a validated detector is added. Never enable the name/designation-only policy to bypass an unfulfilled requirement.

Place each approved logo crop at `<COMMISSIONING_REFERENCES_DIR>/<sha256>.png`; its bytes must match the configured SHA-256. Logo matching currently uses ImageMagick NCC subimage matching at a conservative 0.98 threshold. Reference scale must match the 150-DPI rendered letter. Rotation, resizing and different letterheads can cause false negatives; calibrate on actual accepted/rejected scans before setting `approved_for_automation=true`. Unknown logos fail closed. This is reference comparison, not universal logo recognition.

There must be one unambiguous final certificate candidate across the company root and letter folders. Multiple candidates require correction; the verifier does not guess which is final. Root-level PDFs/scans are treated as possible letters, not site photos. Blank templates fail because actual approved person/role values and other required content must be read. Full OCR text is not stored by default; reports retain decision messages and a versioned Drive file manifest.

When an authorized human has reviewed an original signed PDF with unreadable handwriting, a service operator can set that site's `reviewed_pdf_sha256` to the reviewed original's SHA-256 and enable `approved_for_automation`. The worker matches the exact PDF bytes and records the verification method and hash. Replacement files require ordinary letter verification or a fresh review. Media, Drive manifest and commissioning prerequisite checks still apply.

## Validation and outstanding setup

Tests execute the actual migration in PGlite, the original legacy approval guard and actual earnings capture function. They cover old-record exclusions, new requests, stale worker results, the total-duration boundary, duplicates, missing durations, certificate mismatch/date checks, pagination, disabled automatic approval, service-only permissions, idempotent finalization and one earning.

Live Drive reads, OCR executables, PDF rendering and logo matching still need integration validation with actual credentials and files. No live Supabase migration, Google account configuration or production activation is performed by this implementation.
