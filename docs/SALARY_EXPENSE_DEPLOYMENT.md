# Salary / Expense deployment and operating notes

## Implemented behavior

- Hardik (`admin@limelightit.io`) lands on Salary / Expense and has no access to his former modules. Account role and history are preserved. Tarun (`tarun@limelightit.io`) retains his other modules and gains this workspace.
- Other accounts can open Expense from their staff/employee/field navigation. Tarun's personal claims remain unavailable until their separate approval exception is decided.
- First-submission month controls expense settlement, even for a backdated receipt. New November submissions are due 7 December. Reapplications keep the original month and are allowed through the following month's 5th in Asia/Kolkata.
- Hardik verifies or rejects expenses during his monthly review. Verification marks an expense **Ready to send**; it does not send it to Tarun. Hardik selects verified expenses and explicitly chooses **Send to Tarun**. Pending and verified unsent claims and their receipts stay out of Tarun's account. Resubmitted claims must be verified and sent again.
- Hardik's expense screen uses one table row per person with counts, totals, status, **View details**, **Verify all**, and **Send to Tarun**. Verification and forwarding apply only to eligible expenses for that person. The detail table retains individual verify/reject decisions, receipts, payment recording, and history. Verification never automatically forwards expenses.
- Expenses is the first section and opens by default. Tarun sees a table with one row per person: claim count, total amount, pending amount, status, **View details**, and **Approve all**. Each row's approval applies only to that person's pending claims. There is no general approval button. Details use a date-wise table with descriptions, receipts, and individual approve/reject actions. Tarun has no personal Expense tab; `/expenses` redirects finance reviewers to Salary / Expense. Rejection requires a reason. Batch actions are transactional; an outdated selection rolls back the whole action. Both reviewers' dates/reasons and every revision remain available.
- Salary uses the configured office working calendar, excluding holidays and off days once. Late days are automatically half days, approved WFH full days, absence/leave unpaid by default. Unresolved days block approval. Hardik and Tarun can edit the base salary and payable day equivalents with reasons. Original attendance evidence is retained.
- Incentives reuse existing assessment/commissioning earnings and the 16th–15th cycle. A month tile shows the incentive cycle ending on that month's 15th. Both finance reviewers can adjust unpaid earning amounts and future work rates. Adjustments invalidate existing verification.
- Salary and expenses cannot be recorded as paid before the following month's 7th. Recording payment requires a reference, does not transfer money, and locks the paid item. This version records full payment per item; partial payment is not enabled.
- PDF statements include attendance, work, expenses, approval history, and totals. Unapproved amounts are excluded from payable totals.
- Monthly ZIP includes CSV, JSON, PDF statements, all claim attachment revisions, audit events and a checksum manifest. Files are verified before the ZIP is delivered. A missing file fails the export; no records or files are deleted.

## Database rollout

Apply these migrations in order, after all earlier migrations:

1. `supabase/migrations/20261016120000_salary_expenses.sql`
2. `supabase/migrations/20261016121000_salary_manager_access.sql`
3. `supabase/migrations/20261019120000_expense_month_end_handoff.sql`

The first migration creates finance tables, checked RPCs, and private RLS access. It also updates `field_ops_record_payment` to require final finance approval while reusing the original payment ledger. Old field-earnings payment actions cannot bypass approval.

The second migration updates the existing scoped-manager permission system and restricts Hardik's direct table access. Finance RPCs can still read attendance/earnings for calculations. It assumes `20261014120000_scoped_manager_module_access.sql` has been applied.

The third migration separates verification from forwarding, adds atomic bulk decisions, and restricts Tarun's claim, receipt, and history visibility until an explicit handoff. Claims already sent under the previous flow remain sent. Deploy the updated `expense-files` Edge Function (also mirrored in `supabase/dashboard-deploy/expense-files.ts`) with this migration and frontend; its download handler enforces the same handoff rule.

Deploy the frontend together with these migrations. Applying only the access migration would hide Hardik's previous pages before the replacement works. Review existing office working-day settings: the feature uses those values rather than assuming every company has Sunday off. Historical dates without effective attendance settings are marked unresolved, not silently assigned a guessed calendar.

## Private R2 evidence storage

Create a private R2 **Standard** bucket and a bucket-scoped read/write credential. Configure these secrets for the Supabase Edge Function:

```text
EXPENSE_R2_ACCOUNT_ID
EXPENSE_R2_BUCKET
EXPENSE_R2_ACCESS_KEY_ID
EXPENSE_R2_SECRET_ACCESS_KEY
```

The hosted function also uses the standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment secrets. Never put R2 credentials or a service-role key in Vite variables/client code.

Deploy `supabase/functions/expense-files/index.ts` as `expense-files`. Its `verify_jwt = false` setting is intentional: the handler validates the user session through Supabase Auth, checks verification/active-account status, and enforces owner/reviewer access itself.

Uploads are proxied through the function and bounded before parsing. Allow up to five PDF/JPG/PNG files per claim, each up to **5,000,000 bytes**. Content signatures must match the declared type. Downloads use 60-second signed URLs.

For browser downloads and monthly ZIP checks, allow **GET** from the exact production/frontend origins in the bucket CORS configuration. Browser PUT access is unnecessary because uploads go through the function. Keep the bucket private and avoid automatic expiry rules for submitted evidence. Suggested R2 CORS configuration, replacing the example origin:

```json
[
  {
    "AllowedOrigins": ["https://your-simkit-domain.example"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Official implementation reference: [Cloudflare R2 with aws4fetch](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/).

Uploads abandoned before final claim submission may remain as unattached private objects. Do not add broad bucket cleanup rules; a future cleanup job should target only unclaimed files after a documented grace period.

## Backup scope and limits

The manual ZIP fulfills the requested download alternative. Google Drive automatic backup is not configured. Monthly archives are capped at 200 MB of uncompressed contents in this version to keep browser memory bounded. A larger month requires a server-side archive before any source evidence is removed.

An archive is a finance module export, not a full Supabase disaster-recovery backup. Retention, partial payments, notification delivery, late-rejection exceptions, and Tarun's personal approval flow remain separate decisions. There is no automatic deletion on the 7th.

## Verification

```text
npm run test:finance
npm run check:finance
npm run test:finance:browser
npm run build
```

Finance tests exercise real PostgreSQL-compatible migrations using PGlite, owner isolation, approval state transitions, deadlines, payment locks, role restrictions, working-day calculations, and mocked R2/Auth file requests. The focused finance type check reports unrelated project errors separately; it does not claim the whole repository is type-clean.

Browser tests use Playwright with a local Vite server and mocked Supabase/R2 responses. On Windows the configuration can use installed Chrome. On other systems install Playwright Chromium first. These tests never contact or write to the live database.

Before rollout, verify the migrations against the deployed schema and test a real private upload/download using the configured R2 bucket. Local tests use fixtures and cannot confirm cloud credentials, CORS, or available bucket capacity.

## Storage configuration check — 16 October 2026

The supplied R2 credentials were read from `.tmp.env` without printing them. That file is now explicitly ignored by Git. The four server-secret values are normalized in the ignored local file `.tmp/expense-r2.private.env` and installed as Supabase Edge Function secrets. They are not included in client-side environment variables.

Live checks passed for the `simkit-expense-receipts` bucket: authenticated upload, checksum-verified download, rejection of anonymous access, signed download, and CORS for `https://sim-k-it-ops.vercel.app`, `http://localhost:5173`, and `http://127.0.0.1:5173`. The temporary check object was removed. No CORS changes were needed. The supplied object-scoped credential intentionally cannot read bucket configuration.

The live Supabase expense claims/files/events/salary tables and finance RPC are present. Hardik's live module access is `salary-expense`. Using the replacement deployment credential, all four `EXPENSE_R2_*` secrets were saved and `expense-files` version 1 was deployed successfully with status ACTIVE at 12:56 UTC on 16 October 2026.

The live Edge Function passed checks for authenticated PDF upload; owner, size and SHA-256 metadata; owner download access; exact signed-download contents; production-origin CORS; blocked anonymous/unsigned access; blocked inactive-account access; and rejection of spoofed content and files above 5 MB. The verification used a temporary account without sending messages. The test PDF, attachment row, and account were removed afterward. Financial claims, salary calculations and existing users were not changed by this verification.

Non-secret local reports: `.tmp/expense-storage-deployment.json` and `.tmp/expense-files-live-verification.json`. The management token is only used during deployment, not by the application at runtime.

For manual deployment, `supabase/dashboard-deploy/expense-files.ts` contains the same handler as `supabase/functions/expense-files/index.ts`. Install the four secrets in the Supabase dashboard and deploy that handler as `expense-files` with gateway JWT verification disabled, since the function validates sessions itself. Then verify an authenticated application upload and download.
