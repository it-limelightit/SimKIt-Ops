# HR / Hiring

HR / Hiring is available at `/manager/hr-hiring` only for the verified, active account `admin@limelightit.io`. Hardik keeps Salary / Expense access alongside it. Other accounts do not receive HR or compensation access.

## Deploy

1. If HR is not installed, apply `supabase/migrations/20261021120000_hr_hiring.sql` after the existing attendance, office-account and scoped-manager migrations. It adds HR tables and RPCs and extends Hardik's allowed modules. If HR is already installed, skip this step. Reading the directory does not create HR records or change account roles.
2. Apply `supabase/migrations/20261022140000_hr_reporting_directory_delete.sql` next. This sets the requested reporting hierarchy, adds HR directory deletion with Undo, and prevents edits to deleted records. It includes the updated directory RPC, so it supersedes the directory-only follow-up when upgrading the original HR migration. If HR is already installed, run only this new migration for the reporting and deletion changes.
3. Deploy `supabase/functions/hr-employee-account/index.ts` as `hr-employee-account`, with JWT gateway verification disabled as configured in `supabase/config.toml`. The handler validates the session with Supabase Auth and calls the dedicated HR authorization RPC before any account or device operation. Include its existing `_shared/attendance.ts`, `_shared/attendance-validation.ts` and `_shared/attendance-mqtt.ts` dependencies.
4. The function uses the existing `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` secrets. Explicit device enrollment reuses the existing attendance MQTT/adapter configuration. It needs no camera or webcam on Hardik's computer.
5. Build and deploy the frontend with `public/hr-templates/` included. No original candidate PDF is published. The three clean letterhead PNGs and the Liberation font files are public branding assets; original sample employee names, emails and signatures are excluded.

Example commands, for an already linked Supabase CLI project:

```powershell
supabase functions deploy hr-employee-account --no-verify-jwt
npm run build
```

Apply the reviewed SQL migration through your normal database migration workflow before enabling the frontend. Do not run a blanket database push against an unverified migration history. The UI displays an HR setup message when the RPCs are unavailable.

## Employee flow

- **New hire:** Add employee and employment terms. This saves an onboarding HR record only. Future joining dates are supported. Generate the offer before joining if needed.
- **Existing person:** Existing office employees and active field associates appear in the main HR table immediately, without using Add employee first. Unknown employment type, compensation, mentor, designation and actual joining date remain unset. Select Complete HR details on their row to fill these values and link the HR record to their existing account and attendance history. The attendance start date is shown as a reference in the form; the actual joining date must be entered explicitly. Saved HR records replace their corresponding existing rows without duplicates. Saving preserves the device enrollment ID and roles and activates the profile. Email, workspace and attendance method are locked after linking. Add employee → Employee source remains available as an alternative.
- **Login:** On or after joining, select Set up login. Link a verified existing account with matching workspace permissions or create an employee/field login with an initial password. Existing manager accounts can be linked; HR cannot create manager permissions or reset an existing password.
- **Office attendance:** Linking an office login creates or links its attendance directory entry without queuing enrollment. The explicit Enroll on device action queues the request and uses the existing publisher. The employee registers their face at the office device. Device-confirmed registration is reflected after Refresh; the open profile also refreshes every 30 seconds.
- **Field associates:** Use their worker workspace and its Mark as online flow. No office face record or device command is created.
- **Revision:** Revise employment / salary adds an effective date, reason, stipend or salary, annual CTC where applicable, and internship duration/end where applicable. Internship-to-full-time conversion keeps the same HR record, linked account and attendance history. Future revisions remain scheduled; the directory shows the revision effective today. Change designation separately through Edit details if their role title changes.
- **Leaving:** Mark as left requires a reason, deactivates the app profile and office attendance, and preserves all history. Manager deactivation is intentionally handled outside this action.

HR compensation is a record of agreed employment terms. This change does not automatically alter existing monthly payroll calculations, approvals or paid salary records in Salary / Expense.

## Directory and reporting hierarchy

The directory has searchable office/field/needs-details/left groups, department/employment/manager filters, sorting, expandable contact and attendance details, pagination, and mobile cards. Click a manager to filter their team. Row actions include completing/editing HR details, revisions, offer generation and deletion.

Reporting defaults and the migration backfill use the requested hierarchy:

| Employees                     | Mentor / reports to       |
| ----------------------------- | ------------------------- |
| Vikash (Vikas), Mayank, Suraj | Kuldeep Shrimali          |
| Kuldeep, Nit, Kishan          | Tarun Purohit (Tarun sir) |
| Aryan                         | Hitesh Bhai               |
| Hitesh, Raghav                | Tarun Purohit (Tarun sir) |
| Field associates              | Raghav Gaur & Hitesh Bhai |

The field group uses shared supervision because no individual assignment was specified. Hardik can select either supervisor or edit the mentor in Complete HR details / Edit details. Existing offer snapshots retain their original reporting details.

**Delete employee** requires confirmation and removes the entry from HR only. It preserves the login, profile activity, attendance, employment terms and saved letters. It also works for existing people whose HR details have not been completed; they stay hidden after refresh. The confirmation explains the scope. An Undo action is available for 10 seconds after deletion. Authorized recovery later is possible with `hr_restore_employee(deletion_id)`; the audit is retained in `hr_directory_deletions`. Use Mark as left when the intent is to deactivate a departing employee. Deleted HR records reject account, enrollment, revision and offer operations until restored.

## Offer letters

The three supplied sources are mapped separately:

| Template        | Source                                  | Standard pages | Format             |
| --------------- | --------------------------------------- | -------------: | ------------------ |
| Software        | `offer-latter (1).pdf`                  |              3 | 595.56 × 842.04 pt |
| Firmware        | `Suraj_Offer_Letter.pdf`                |              3 | US Letter          |
| Field associate | `Farid_Garana_Job_Offer_letter (1).pdf` |              4 | US Letter          |

The generator preserves their branding, watermark where present, annexure structure, department responsibilities, notice clauses and footer addresses. Text is rebuilt with licensed Liberation Sans fonts so employee details can wrap and remain searchable. The result follows the source format; it is not a pixel-identical replacement of the original Calibri text. Long fields can add continuation pages instead of being clipped.

Employee name, email, location/institute, designation, mentor, joining date and chosen employment revision are dynamic. Letter inputs include offer date, greeting, honorific, acceptance window/place, office hours, and initial stipend period. The field template additionally exposes installation incentive, travel allowance, installation target, probation period, monthly payment day and certificate cutoff day.

The source software letter had inconsistent first-period stipend wording; both references now use the same initial stipend period selected in the form. The field source combined a Job Offer heading with internship clauses. Generated internship letters use internship wording; full-time letters use a job-offer heading, employment wording, annual CTC and monthly gross salary. Review the preview before saving. Acceptance/signature fields remain blank; no candidate signature is reused.

Save & download stores a numbered, immutable employee/terms/input snapshot before downloading. Later employee edits or salary revisions do not affect old snapshots. Re-download from the employee's Offer letters tab. PDF files themselves are generated from the saved version-1 snapshot, not uploaded or emailed automatically. Keep the version-1 renderer and version-1 letterheads stable when introducing future template versions.

To reproduce the clean branding assets locally, install dev dependencies and keep the three original PDFs in the ignored `.tmp/hr-reference/` folder, then run:

```powershell
node scripts/build-hr-letterheads.mjs
```

You can supply a different local folder as the first argument: `node scripts/build-hr-letterheads.mjs "D:/path/to/reference-pdfs"`. Original offer PDFs and reference screenshots remain local and are not included in the PR or deployed application.

The font license is included at `public/hr-templates/fonts/LICENSE_LIBERATION`.

## Validation

```powershell
npm run test:hr
npm run test:hr:browser
npm run test:finance
npm run test:attendance
npm run build
```

HR database tests execute the real migration in PGlite, including authorization, RLS, immutable revisions/snapshots, optimistic concurrency, existing-office and field linking, numeric device IDs, explicit enrollment and leaving. PDF tests parse each output and check dynamic values, source page sizes/counts, full-time wording, long-field bounds and absence of sample candidate details. Browser tests exercise the directory, conversion history, preview/download and mobile layout against mocked backend responses. Hosted database migration, Auth provisioning and physical face-device registration still need deployment checks in the target environment.
