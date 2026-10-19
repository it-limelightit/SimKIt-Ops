# SimKit salary and expense feature — discussion draft

Date: 16 October 2026

Status: Development authorized by the user after discussion. Implementation now exists in the workspace; database/storage deployment is a separate step. Recommendations below that have not been explicitly confirmed remain proposals.

Latest confirmed requirement: half-day and salary calculations are automatic, and both Hardik and Tarun can edit unpaid salary/day equivalents and incentive amounts. Changes require reasons, preserve the original evidence, and restart approval. Late attendance defaults to 0.5 day; approved WFH defaults to 1 day; leave defaults to 0 until a reviewer adjusts it. These defaults are visible in the interface.

## 1. Purpose and account scope

Hardik should see office salaries, field incentives, reimbursements, approvals, and payment balances together under **Salary / Expense**, organized by month and person.

- Salary manager / first reviewer: Hardik, `admin@limelightit.io`.
- Final reviewer: Tarun sir, `tarun@limelightit.io`.
- All users, including office staff, field associates, and Tarun, can submit their own expenses, except Hardik's designated account.
- Confirmed: Hardik's account is `admin@limelightit.io`; the earlier `admin@limelight.io` spelling does not designate another approver.
- Confirmed: Hardik's account should show only Salary / Expense. Attendance information needed for salary calculation appears within this workspace. Whether he also needs attendance editing/administration inside it remains open. Removing account features does not imply deleting business records or the account.
- Other users' existing access should remain intact unless separately requested.

## 2. User Expense page

An **Expense** navigation option opens the user's own records. A top-right **Add Expense** button opens a form.

Required table content:

| Column        | Content                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| Sr. no.       | Display row number; also use a stable claim ID for tracking                      |
| Expense date  | Date the expense occurred                                                        |
| Expense name  | Short title                                                                      |
| Category      | Potter, order any item, petrol/travelling, courier                               |
| Amount        | Required amount; proposed currency INR                                           |
| Docs / photos | Open or download submitted evidence, maximum 5 MB as requested                   |
| Description   | Full explanation available without making rows excessively tall                  |
| Hardik review | Pending / approved / rejected, decision date, rejection reason                   |
| Tarun review  | Awaiting Hardik / pending / approved / rejected, decision date, rejection reason |
| Payment       | Paid / remaining, with payable and paid amounts                                  |
| Actions       | Edit, delete, or Edit & Reapply according to state and deadline                  |

The amount field is necessary to calculate reimbursement and was not explicitly included in the original column list. Confirm whether “potter” means “porter / loading labour.”

Proposed UX: month selector, status/category filters, search, sorting, sticky headings, horizontal and vertical scrolling like Excel, readable status badges, attachment preview, clear empty/loading/error states, and a visible deadline. Use text alongside colours. Long descriptions and rejection history can open in a detail panel. Keep row numbers separate from claim IDs.

Open attachment decisions: 5 MB per file or per entire claim; number of files per claim; whether evidence is compulsory; and whether DOC/DOCX is allowed alongside PDF/JPG/PNG.

## 3. Expense approval and reapplication

Normal flow:

`Submitted → Hardik review → Hardik approved and forwarded → Tarun review → Finally approved → Payment pending → Paid`

Either reviewer may reject at their own stage. Rejection must include a reason and timestamp. The owner sees both reviewers' decisions separately.

Hardik's checkbox selects claims for verification. An explicit confirmation step shows the selected claims and amount before forwarding them to Tarun. Selection alone must not approve anything.

Proposed reapplication rules:

1. A rejected claim shows **Edit & Reapply** while the deadline is open.
2. Keep the original claim ID and record a new revision / attempt number.
3. Preserve previous submitted values, attachments, reviewer decisions, dates, and reasons in history.
4. Display **Reapplied — attempt 2**, last rejection reason, and resubmission time prominently to the owner and reviewers.
5. Restart review with Hardik after any resubmission, including rejection by Tarun, because the claim details may have changed.
6. Earlier approvals remain historical and do not approve the new revision.
7. Reject attempts to approve an outdated revision; a double click must not create duplicate claims or payment records.

Items 2–7 are recommendations for discussion, rather than additional confirmed business rules.

Proposed editing/deletion policy: allow ordinary editing for drafts and rejected claims; require withdrawal and resubmission for pending claims; lock finally approved or paid claims. Use cancellation / soft deletion for submitted records so review history survives. Confirm the exact policy before implementation.

### Tarun's own expenses

Deferred by the user: keep Tarun's own-expense case separate and discuss it later. His eligibility was requested initially, but its approval exception is not settled. No final reviewer or self-approval rule is selected for his own claims. This deferral does not change his final-review role for other users' claims.

## 4. Month, deadline, and payment dates

The requested expense period is the calendar month, from the 1st through the final day. Salary and expense settlement is due on the following month's 7th.

Confirmed clarification: a **new expense uploaded on the 1st or 2nd belongs to the new month's settlement**, payable on the following month's 7th; it must not be added to the previous month's upcoming settlement. For example, a new claim uploaded on 1 or 2 November is payable on 7 December, not 7 November, subject to approval.

One detail still needs clarification: if a receipt is dated 31 October but is first uploaded on 1 November, does the upload month control settlement too? The user's wording refers to upload date; do not silently assume expense date overrides this rule. Keep expense date, first-submission timestamp, settlement month, and reapplication timestamp distinct.

A revision/reapplication of an existing October claim is different from a newly uploaded November claim. Proposed interpretation: an October claim reapplied by 5 November keeps its original settlement month and can still be paid on 7 November after approval. Confirm that this is the intended exception.

| October 2026 example    | Date                   |
| ----------------------- | ---------------------- |
| Expense / salary month  | 1–31 October 2026      |
| Last reapplication date | 5 November 2026        |
| Reapplication closed    | 6 November 2026 onward |
| Settlement due          | 7 November 2026        |

Proposed precise boundary: reapply through **5 November at 23:59:59 Asia/Kolkata**, blocked from 6 November at 00:00. Confirm this interpretation of “after 5 date.” Enforce the deadline on the server, not only by disabling a button.

Show **October 2026 · Reapply until 5 Nov · Payment due 7 Nov** on relevant screens. Changing a rejected claim's expense date must not silently move it to another month to bypass the deadline. Any legitimate month correction needs an agreed policy and review history.

Questions still open:

- Confirm which date controls the settlement month for a newly uploaded, backdated receipt. New claims uploaded on the 1st/2nd must not join the previous month's settlement.
- What happens when rejection occurs on or after the deadline, or review is delayed?
- Do unpaid approved claims carry forward, remain in the original month, or both? Recommended: preserve the original month and show outstanding balances in later payment worklists.
- Can Hardik or Tarun reopen an exceptional claim after the deadline, with a recorded reason?
- What happens if the 7th falls on a holiday or weekend?

The 7th is a due date. It must not automatically mark claims paid or delete attachments.

## 5. Hardik's Salary / Expense workspace

Navigation: **Salary / Expense → Year and month → Office Staff / Field Associates → Person**.

Proposed month overview: salary or incentive total, submitted expense total, finally approved expense total, pending review total, rejected total, paid total, and remaining payable. Do not combine pending or rejected claims into approved payable totals.

### Office staff

Show staff names, then an individual monthly page with:

- Calendar: working days, present, absent, late / half day, work from home, holidays/off days, and relevant leave decisions.
- KPI cards (interpreting “kta” as summary cards): scheduled working days, on-time days, late days, present days, absent days, WFH days, and actual payable day equivalents.
- A monthly salary entry and a visible calculation breakdown.
- The person's expenses in the same review table, with verification checkboxes and a confirmation action to forward to Tarun.

Attendance counts and payable day equivalents are different. Late days may also be present days, so adding every KPI together would double count attendance.

Confirmed salary calculation uses **scheduled working days**, excluding weekly off days and holidays. Count each excluded date once if a holiday overlaps a Sunday.

`Daily rate = monthly salary / scheduled working days`

`Salary payable = daily rate × (full payable days + 0.5 × half payable days)`

User's example: 30 calendar days, 4 Sundays, and 1 separate holiday give **25 working days**. With INR 15,000 monthly salary, the daily rate is **INR 600**, a full day pays **INR 600**, and a half day pays **INR 300**. Working all 25 days pays INR 15,000. For example, 24 full days plus 1 half day pays INR 14,700. Off days and holidays are excluded from the divisor rather than deducted again from that full monthly entitlement.

Remaining salary rules:

- Does every late arrival count as half day, or only after a threshold / grace rule?
- Do approved leave and WFH count as full payable days, half days, or unpaid days?
- How are mid-month joining/leaving, unresolved attendance, and adjustments handled?
- Is salary saved per employee per month, or entered afresh every month?

Define rounding and handle zero scheduled working days explicitly. Show the divisor, daily rate, payable day equivalents, and final amount so Hardik can verify the calculation.

### Field associates

- Show names and monthly calendar with online/offline evidence, approved/rejected leave, and off days.
- Show matching KPI cards. A rejected leave request is a review outcome; it should not alone determine whether the person worked that day. Define daily status precedence where records overlap.
- Skip monthly salary for now.
- Reuse existing assessment and commissioning work earnings and rate-setting functionality from Field Visit Tracking / Earnings.
- Show date, work type, site/company, amount/rate, eligibility, and payment status.
- Show expenses with the same Hardik → Tarun approval flow.
- Do not add a separate field-associate monthly salary table or duplicate existing incentive entries. Approval, reimbursement, and settlement history still need persistent records.

Confirmed: **retain the existing 16th–15th field-incentive cycle** and existing payment scheduling. Do not convert incentives to calendar months. Salaries and expenses use calendar months independently. Label incentive period start/end explicitly in the combined workspace so a calendar-month expense total is not mistaken for a 16th–15th incentive total. The exact association of an incentive cycle with a month tile should follow the existing cycle label and be made clear before implementation. Previously paid earnings must never be counted or paid twice.

## 6. Tarun review, statement, and payments

Tarun should see the person, month, salary/incentive breakdown, attendance basis, verified expenses, evidence, and Hardik's confirmation. Clarify whether final approval applies separately to each expense, to the salary/incentive calculation, or to the entire monthly package. Recommended: record per-claim decisions and separately approve the monthly settlement so one rejected expense need not block everything else.

After approval, generate a professional PDF payslip / reimbursement statement with company identity, unique statement number, person and period, attendance summary, salary or itemized incentives, approved expenses, deductions/adjustments if agreed, total payable, reviewer names/dates, paid amount, and balance. A salary statement and reimbursement statement can be combined visually while keeping each component clear. Confirm the required document title and details.

Approval and payment are separate events. Marking paid records a completed payment; it does not transfer money. Confirm who can record payments, whether partial payments are allowed, and which reference, payment date, and payment method are required.

Proposed totals:

`Total payable = approved salary OR approved field incentives + finally approved expenses + agreed adjustments`

`Remaining = total payable − recorded payments allocated to those items`

For an unapproved claim, display **Not yet payable**, rather than treating its requested amount as an approved remaining balance. If partial payments are enabled, show **Partially paid** with the exact remainder. Reuse existing field-payment allocations to prevent payment duplication across the old and new screens.

## 7. Database, files, and backup discussion

Store structured claim data, file metadata/object keys, revisions, approval events, monthly salary calculations, settlement snapshots, payment allocations, and backup status in Supabase. Store actual documents/images in private object storage. Reuse existing attendance, leaves, field rates, earnings, and payment records.

Recommended storage arrangement: **private Cloudflare R2 Standard storage for active evidence, plus a monthly ZIP download; add Google Drive automatic backup if desired**. This is a recommendation, not a selected provider or configured integration.

- R2 Standard currently includes 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations monthly, with free egress. Usage beyond allowances can cost money; backup execution and other infrastructure have separate limits. See [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/).
- A personal Google account provides up to 15 GB shared across Drive, Gmail, and Photos; available space depends on the actual account. See [Google storage](https://support.google.com/mail/answer/6374270?hl=en-3).
- Google Drive uploads and scheduled backups are technically possible through its API, with an authorized account and an external scheduled job. Do not assume a standalone service account has personal Drive storage: Google's [Drive error guidance](https://developers.google.com/workspace/drive/api/guides/handle-errors) describes storage-quota constraints. Authentication, destination ownership, and available capacity must be checked before setup.

For capacity planning, 1,000 attachments at the maximum 5 MB is approximately 5 GB before previous revisions, overlapping months, or ZIP archives. A free tier is a capacity allowance, not unlimited retention.

Keep evidence private. Give only the owner and authorized reviewers access through authenticated downloads or short-lived links. Validate size and file type on the server. An incomplete upload must not appear as a fully submitted claim.

### Manual monthly ZIP

Hardik's month page should offer **Download Monthly Backup**. Proposed contents: Excel/CSV summaries, structured JSON records, salary/incentive statements, original receipts grouped by person/claim/revision, approval and rejection history, and payment details. Include rejected and pending records so “all data” means the full month's history.

Include a manifest with export time, record counts, file sizes/checksums, and any missing files. Generate large exports as background jobs with queued/running/ready/failed status and retry. A download request alone does not prove that a backup was received or verified.

This is a salary/expense export, not a complete backup of every SimKit database table.

### Automatic Google Drive backup

Possible proposed schedule: the 8th in Asia/Kolkata, after the usual settlement date, plus an updated archive if later approvals/payments change the month. Exact date/time and Drive destination remain undecided.

Use a stable monthly export ID/version to avoid accidental duplicate archives. Track success, upload verification, archive size, file/record counts, destination, and failure reason. Failed backups remain retryable and must not trigger deletion. Archive overdue/unpaid items too; do not imply that everything exported is settled.

### Retention after the 7th

The user requires records and evidence to survive at least until settlement on the following month's 7th. Longer retention is undecided.

Recommended: retain searchable financial records and approval history in Supabase; only consider moving/removing active attachments after a verified archive and an agreed retention period. Keep unresolved or unpaid evidence accessible. A calendar-triggered purge on the 7th would risk losing documents before delayed reviews/payments finish.

If active attachments are later archived, decide how users and reviewers retrieve them and show **Archived** with a working retrieval path. Do not leave broken receipt links. No automatic deletion policy is authorized by this draft.

## 8. Existing repository findings

These observations come from local source inspection, not verification of the deployed database:

- `src/lib/manager-access.ts`: Hardik currently has restricted manager paths for attendance, field-visit tracker, logistics, and inventory.
- `src/lib/device-attendance.ts` and `src/lib/attendance-analytics.ts`: attendance, lateness, working-day settings, WFH, leave, and summary helpers exist. Their current metrics are not an agreed payroll calculation.
- `src/components/field-operations/FieldOperations.tsx` and `src/lib/field-operations.ts`: earnings views, work rates, statements, and payment information exist; payment periods currently use the 16th–15th cycle.
- `supabase/migrations/20261005140000_field_operations_assessment_commissioning_pay.sql`: assessment/commissioning earnings and payment allocation logic exist.
- Some attendance/leave code recognizes `tarun@limelight.io` as well as `tarun@limelightit.io`. Confirm account identity for this feature instead of granting financial approval to aliases automatically.

## 9. Questions to resolve next

Priority business decisions:

Confirmed decisions: Hardik is `admin@limelightit.io`; his account shows only Salary / Expense; incentives retain the 16th–15th cycle; staff salary uses working days; full and half days pay 1 and 0.5 daily rates; newly uploaded expenses on the 1st/2nd go to the following month's payment. Tarun's own-expense case is deferred.

1. Does upload month determine settlement for a backdated new receipt too, while reapplications retain the original month?
2. What late/half-day threshold and approved-leave/WFH payment rules apply?
3. What happens to late rejections after the 5th?
4. Is approval per expense, per monthly settlement, or both?
5. Does Hardik need attendance editing within Salary / Expense, or only attendance viewing?

Remaining product choices: attachment rules and category wording; edit/delete permissions; payment recorder and partial payments; R2 versus Drive; manual versus automatic backup; archive retention and retrieval; and whether all approvers/claimants need notifications.

## 10. Future acceptance checks, once implementation is authorized

- A user sees only their own expenses; reviewers see only authorized records.
- Hardik receives a new claim before Tarun and cannot forward an unconfirmed revision.
- Both rejection reasons/dates remain visible through reapplication history.
- October reapplication is allowed through the agreed 5 November cutoff and blocked afterward by the server.
- Reapplied claims are visibly marked and return to Hardik.
- Salary calculation matches the agreed attendance policy; incomplete data is flagged.
- A 30-day month with four Sundays and one separate holiday produces 25 working days; INR 15,000 gives INR 600/full day and INR 300/half day. Overlapping off days/holidays are excluded once.
- New expenses first uploaded on 1 or 2 November are excluded from the 7 November settlement and shown for 7 December, subject to approval. Backdated receipts and reapplications follow the separately agreed assignment rules.
- Field incentives retain their existing 16th–15th cycle, clearly distinguished from calendar-month salary and expenses.
- Field incentives match existing eligible work and never duplicate paid earnings.
- Final approval does not automatically record payment; totals reconcile with payment allocations.
- Monthly exports include evidence and audit history; failed backups do not delete originals.
- Hardik's old navigation/access changes only after its replacement scope is agreed.

Implementation notes and deployment steps are maintained in `docs/SALARY_EXPENSE_DEPLOYMENT.md`. Tarun's own-expense case remains deferred. The first version provides a verified manual monthly ZIP, with no automatic deletion and no configured Google Drive integration.
