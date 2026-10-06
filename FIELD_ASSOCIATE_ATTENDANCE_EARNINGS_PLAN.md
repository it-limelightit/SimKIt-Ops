# SimKit: Field Associate Attendance, Scheduling and Earnings Plan

Recorded: 5 October 2026

Status: Local implementation authorized by the user and completed in the workspace. The new database migration has been validated against isolated PostgreSQL; it has not been applied to the live Supabase database. Implementation decisions for previously open details are recorded in section 11.

## 1. Problem and intended outcome

The user reports that field associates sometimes miss company visits, complete less work than expected, or delay work received near month end while receiving full payment. The proposed changes should make attendance, planned visits, completed work and earnings visible, motivate timely completion, and support a revised monthly payment period.

This is the user's description of the operational problem, not a finding independently verified from project data.

## 2. Scope and preservation requirements

- Apply the new associate onboarding flow, earnings view and assignment highlighting only to the field associate dashboard. Do not apply these changes to dual-role managers.
- Add the requested manager overview features and replace the current Field Visit Tracker experience within that specific area.
- Preserve unrelated manager and associate workflows, company lifecycle rules, phase forms, permissions and existing approval behavior.
- Replacing the tracker interface must not silently delete historical schedules or records. Any change to its underlying scheduling behavior needs an explicit mapping during implementation planning.
- Use the existing application theme, professional responsive layouts and restrained interactive animations. Support mobile, tablet and desktop.
- Use existing Limelight report branding and formatting for the salary PDF.
- The user subsequently authorized implementation according to this document. Live database rollout and deployment have not been performed.

## 3. Payment period described by the user

Confirmed payment rule: recurring monthly earning periods run from the 16th through the 15th, inclusive. Payment is due on the 7th of the month after the period's ending month. This is one payment per recurring monthly period, not two payments per month.

Confirmed example for Associate A joining on 1 August 2026 (Option A selected by the user):

| Work period, both dates inclusive | Payment date |
| --- | --- |
| 1 August to 15 August 2026 | 7 September 2026 |
| 16 August to 15 September 2026 | 7 October 2026 |
| 16 September to 15 October 2026 | 7 November 2026 |

Work completed on 15 August belongs to the first period and is paid on 7 September. Work completed on 16 August belongs to the next period and is paid on 7 October. The shorter first joining period includes only eligible per-work earnings in that period; no fixed-salary proration is involved. Each earning date belongs to exactly one period.

Confirmed clarification: this project tracks earnings from assessment, installation and commissioning only. Fixed salary is managed in another project and must not be included in these calculations. The original references to salary/payment in this plan concern settlement of these per-work earnings. No deductions or penalties have been requested or defined.

Calendar month reporting and payment-cycle reporting must be distinguishable: a calendar month runs from its first to last day, while the payment cycle runs from the 16th to the next month's 15th.

## 4. Field associate flow

### 4.1 Mark online before dashboard access

1. Show a themed, animated page on the associate's first access each day, unless already marked online that day.
2. Provide a mandatory **Mark as online** action before access to the subsequent pages or dashboard.
3. Capture today's date and current time automatically.
4. After marking online, continue to scheduling.
5. Confirmed clarification: marking online is required once each day before the associate can perform any action or view any other screen. After marking online, do not show this gate again that day under normal attendance conditions. Direct navigation to another screen must also respect this requirement.
6. If a manager marks the associate offline, the associate may mark online again. Every online/offline change must remain visible to the manager with its time and actor; repeated check-ins must not overwrite earlier events.
7. Being online does not earn payment. If the associate is online but completes no eligible payable work that day, no earnings are counted for that day, including in the period-end settlement.

Online is an attendance declaration. Continuous connectivity or location tracking was not requested.

### 4.2 Optional self-scheduling page

Show three selectable stage groups:

| Group | Intended work |
| --- | --- |
| Not started yet → Assessed | Assessment |
| Assessed → Installed | Installation |
| Installed → Commissioned | Commissioning |

Selecting a group shows the applicable company list. Selecting a company opens a dialog containing:

- Today's date, already populated.
- Required shift selection: 10 AM–12 PM, 12 PM–2 PM, 2 PM–4 PM, 4 PM–6 PM or 6 PM–8 PM.
- Required expected arrival time.
- Required expected end time.

Confirmed clarification: expected arrival and end times do not need to fall within the selected shift. The end time is not required to extend beyond the shift either. Keep shift, arrival and end time mandatory; proposed basic validation is that expected end follows expected arrival. Whether overnight visits are supported remains unspecified.

Allow scheduling multiple companies, including installation-stage companies. Scheduling is optional: provide a skip action that continues the flow.

Proposed implementation safeguard: show only companies the associate is permitted to access under existing assignment and collaboration rules. Confirm how clashes, duplicate schedules and future-date scheduling should behave.

### 4.3 Manager-scheduled visits page

After self-scheduling or skipping, show visits assigned by the manager for the relevant time, including collaborative visits. Both collaborating associates should be able to see their applicable visit.

- Display company, work stage and scheduled time.
- Provide **Mark as complete** after the visit's required work is complete.
- Remove completed visits from the active schedule and preserve them in accessible schedule history.
- Allow the associate to access schedules again later from the regular dashboard.
- Block completion if the corresponding company phase is incomplete. For example, an assessment visit cannot be marked complete while assessment requirements remain pending.
- Completing a scheduled visit must not bypass or replace existing company phase completion and approval rules.

After this page, continue to the regular application pages. Whether this page needs an explicit continue action when scheduled work remains outstanding is open.

### 4.4 My Earnings

Add an associate-accessible **My Earnings** page showing interactive charts, graphs and earnings summaries inspired by familiar daily-earnings platforms.

- Support daily, weekly and monthly views.
- Calculate earnings using the manager's assessment and commissioning prices. Installation is tracked without payment.
- Exclude fixed salary; it is managed by another project.
- Show daily earnings to encourage completion.
- Show totals for the confirmed 16th–15th payment cycle and its due date; payment-status recording still needs clarification.
- Explain which completed company and phase produced each earning.
- Distinguish work still pending validation from payable earnings; pending work must not inflate the payable total.

### 4.5 My Assignments: delayed installation warning

Apply this warning only to companies that have completed assessment but have not completed installation.

- If a company remains uninstalled after five days from proper assessment completion, move it to the top of My Assignments.
- Use a red background and a visible warning/indicator, with accessible text so the warning does not depend on color alone.
- Remove the warning when installation is complete.

Confirmed manager warning location: the same Field Visit Tracker. The exact five-day boundary and calendar days versus working days remain open.

## 5. Manager panel

### 5.1 Overview attendance box

Below the existing KPI cards, add a box listing field associates as buttons or similar selectable controls.

- Green: associate has marked present/online for today.
- Red: associate has not marked online, or the manager has marked the associate offline, subject to the confirmed override rules.
- Clicking an associate opens a dialog with today's scheduled companies and the work to perform at each company.
- When no company is scheduled, allow the manager to schedule company work from this dialog.
- Allow the manager to mark the associate offline.

Attendance display must follow the confirmed daily rule. The associate may mark online again after a manager marks them offline. Show each change to the manager with its time and actor, preserve the history, and use the latest event for current online/offline status. Attendance alone does not produce earnings.

### 5.2 Replace the Field Visit Tracker experience

Start with an overview containing KPI cards, then show field associate names. Clicking an associate expands the associate's details below the name.

Within the expanded area:

- Right side: monthly attendance calendar. Green for online days, red for offline days, neutral for future days.
- Left side: today's scheduled companies. If none are scheduled, provide a scheduling action.
- Manager scheduling includes company, work stage, time and daily priority.
- Confirmed: the manager may add visits even when that associate already has scheduled visits.
- Selecting a calendar date shows that day's scheduled and visited companies.
- Provide per-associate rate controls for assessment and commissioning only.
- Show the five-day delayed-installation warnings in this Field Visit Tracker as well as in the associate's My Assignments.
- Make the associate's repeated online/offline events visible to the manager.
- Below the details, show interactive bar charts, pie charts and other useful views for monthly assessment, installation, commissioning, attendance/activity and overall performance.
- Then show a date-wise earnings table, including company, work stage and applicable amount for each completed activity.
- Dates with no work should retain blank activity/amount cells, without a repeated 'nothing done' message.
- Show daily totals and the monthly total. Confirm whether blank dates should also have a blank daily total or a zero total.
- Provide a month selector/filter.
- Provide salary clearance and a downloadable PDF using existing Limelight formatting. The precise meaning and recording of salary clearance must be confirmed.

For small screens, stack the calendar and schedule so the same information remains usable.

## 6. Completion and earnings rules

### Assessment

Count assessment earnings and the earning date only when assessment is fully complete. Pending MOM, factory form, photos, videos or any other existing mandatory assessment requirement must prevent recognition of assessment earnings.

Proposed date rule for confirmation: use the timestamp when the final required assessment item becomes complete, rather than the visit date or date work first started.

### Installation

Installation is not payable. Keep the existing installation completion and scheduling workflow for work tracking.

### Commissioning

- Recognize commissioning earnings only after the existing manager acceptance/approval requirement is satisfied.
- Confirmed default: commissioning is recognized when the manager accepts it, with earnings attributed to the acceptance date unless the manager edits the commissioning earnings date.
- The manager must be able to shift the earnings date for commissioning only. Example: commissioning work occurred on Saturday, approval occurred on Monday, and the manager attributes the earning to Saturday.
- Provide the commissioning date-edit action in this manager tracking/reporting area and show the payment allocation according to the edited date. The permitted date range and treatment of already-cleared periods remain unspecified.
- Proposed safeguard: retain the original approval timestamp and store the earnings-date override separately with who changed it, when and why. Do not rewrite approval history or grant approval powers to additional managers.
- Recalculate affected reporting and payment-cycle allocation when the permitted date adjustment crosses a boundary, subject to salary-clearance rules.

### Proposed accounting safeguards, not yet confirmed business rules

- Recognize each eligible company phase once for its entitled associate(s); repeated clicks, visits or approvals must not duplicate money.
- Capture the applicable rate on each earning entry so later rate changes do not silently rewrite history.
- Confirmed scope clarification: the user says collaborative earnings are not an edge case to handle here. Do not introduce full-rate, split-rate or manager-allocated collaborative earnings rules. Retain the earlier requirement that applicable collaborative schedules are visible to both associates.
- Define corrections for reopened phases, reassignment, approval withdrawal and cleared payment periods.
- Use a consistent business timezone for day boundaries, attendance, schedules and reporting; Asia/Kolkata is proposed for confirmation.

## 7. Limited repository observations

A read-only inspection found:

- `src/routes/manager.field-visit-tracker.tsx` currently renders `FieldVisitScheduler`.
- Existing field visit scheduling migrations are present, including `supabase/migrations/20260925090000_add_field_visit_scheduler.sql` and `supabase/migrations/20260925100000_add_field_visit_schedule_delete.sql`.
- Commissioning approval migrations and submission/approval markers already exist. A later migration also references dual-role commissioning requests; those existing permissions must remain intact while the new associate flow excludes dual-role managers.
- The dependency manifest already includes Recharts, date-fns, jsPDF and jsPDF AutoTable, which may support charts, dates and PDF reporting without new libraries.

These observations are not a full code or database audit. Existing completion predicates, active permissions, collaborator representation and report templates still require inspection before implementation.

## 8. Questions to resolve before implementation

1. **Payment boundary — confirmed:** Option A. Joining period 1–15 August is paid 7 September; recurring period 16 August–15 September is paid 7 October. Both boundaries are inclusive and do not overlap.
2. **Earnings scope — confirmed:** Latest confirmation: include per-assessment and per-commissioning earnings only. Installation is not payable. Fixed salary is handled in another project.
3. **Attendance — confirmed:** Daily online gate is mandatory. An associate may mark online again after a manager marks them offline; every change must be visible to the manager. Online attendance with no eligible completed work earns no payment.
4. **Time selection — partly confirmed:** Arrival and end do not have to fall inside the selected shift; end need not exceed the shift. Whether self-scheduling supports future dates, overlapping visits or overnight visits remains open.
5. **Completion dates — commissioning confirmed, other details open:** Commissioning earns payment upon manager acceptance, using the acceptance date by default. The manager may edit its earnings date in the tracking/reporting area and payment allocation follows that date. Installation's payable completion event, the allowed override range and cleared-period corrections remain open.
6. **Collaboration — closed; rate changes still open:** No collaborative earnings allocation edge case is required by the user. Keep collaborative schedule visibility as previously requested. When rates change, should only future completions use the new rate?
7. **Salary clearance — undecided by the user:** Proposed approach for later confirmation: the manager manually records that a period's per-work earnings have been paid, storing amount, payment date and optional reference, and downloads a Limelight-branded statement. This would record payment, not send money. Authority and correction rules remain open; this proposal is not a confirmed requirement.
8. **Five-day warning — location confirmed:** Show it in the same manager Field Visit Tracker. Calendar versus working days and day-five versus after-five-complete-days behavior remain open.
9. **Historical coverage:** Should attendance and earnings start from rollout, or should existing work be included? How should pre-rollout attendance, holidays, approved leave and days before joining appear in the calendar?
10. **Manager schedules — adding visits confirmed:** The manager may add more visits when some already exist. Daily priority choices and postponed/missed visit history behavior remain open.

## 9. Proposed implementation sequence after clarification

1. Inspect current role detection, associate navigation, visit scheduler, completion validation, collaboration, approval permissions and Limelight PDF templates.
2. Use the confirmed payment boundary, daily attendance gate and repeat check-in behavior; finalize rate-change handling, installation completion, remaining date rules and salary-clearance rules.
3. Design additive attendance, schedule-history, effective-rate, earnings and payment-record storage as needed, reusing compatible existing schedule records. Enforce associate/manager access and validations on the server.
4. Add the associate entry flow and reusable scheduling/history views, restricted to the requested associate role.
5. Add the manager overview box and rebuilt tracker interface, preserving existing records and unrelated workflows.
6. Add phase-based earnings recognition, commissioning date adjustment, charts, reporting filters, salary clearance and branded PDF.
7. Add the five-day warning to associate My Assignments and manager Field Visit Tracker, using the confirmed timing rule once specified.
8. Validate responsive behavior, existing phase forms and approvals, role exclusions and the edge cases below before release.

## 10. Acceptance checks for the future implementation

- Entry flow runs with the confirmed attendance frequency; dual-role managers retain their existing entry flow.
- Required online action captures trustworthy date/time, and optional scheduling can be skipped.
- Multiple companies can be scheduled with required timing fields and correct stage eligibility.
- Applicable collaborative visits appear to both associates; no additional collaborative earnings allocation feature is introduced.
- Mark as complete is blocked for incomplete phases; completed visits remain available in history.
- Incomplete assessment documents/media never produce earnings.
- Pending or rejected commissioning approval never produces payable commissioning earnings.
- Saturday work approved Monday can receive an authorized commissioning-only earnings-date adjustment without rewriting approval history.
- Rate changes, repeated actions, reassignment and phase corrections follow the confirmed accounting rules.
- Five-day installation warnings sort and clear correctly at the confirmed boundary.
- Calendar colors, past dates, future dates and offline overrides follow the agreed attendance rules.
- An associate can mark online again after a manager offline action, and the manager can see every attendance change. Repeated online events never create earnings.
- A day marked online with no eligible completed work contributes no payment.
- Arrival/end times outside the shift are accepted under the confirmed timing rule.
- Managers can add further visits to an associate who already has scheduled work.
- Reports match recognized activity, daily totals, monthly totals and the confirmed payment cycle; no work date belongs to two cycles.
- Joining periods, month/year boundaries, date overrides crossing a cycle and salary-clearance corrections behave consistently.
- Blank days display as requested; PDF totals match the on-screen statement and use Limelight branding.
- Other dashboards, company forms, approval workflows and existing permissions continue to work.

## 11. Implementation notes and chosen defaults

The following decisions fill details that remained open when the user authorized implementation. They are implementation defaults, not additional answers attributed to the user.

- Use Asia/Kolkata for attendance, earning dates, payment boundaries and dates shown in the new screens.
- Five-day warnings start on the fifth calendar-date boundary after complete assessment (assessment on 1 August becomes overdue on 6 August). Dropped/rejected companies are excluded from warnings and new scheduling.
- Self-scheduling is for today; managers can schedule today or future days, including when visits already exist. Dates selected in the manager calendar seed the scheduling form for today/future selections.
- Arrival/end times are independent of the shift. End must follow arrival on the same date. Block overlapping timed visits and duplicate active company-phase/day schedules.
- Keep existing normal/high/emergency priority choices; managers can change priority within the tracker. Postponing keeps the record and requires a reason; past scheduled visits remain visible for follow-up.
- Installation is tracked with zero payable amount when its existing submission marker, coordination and photos are complete. Assessment requires all current pending-work requirements, including MOM, media, factory form and device order.
- Payment recognition uses the actual qualifying completion event, not a status label or schedule completion click. Commissioning uses its existing approved request and approval timestamp.
- A manager's edit of phase paperwork does not change earnings ownership to that manager. Use the recorded associate, falling back to the assigned associate for manager-authored assessment/installation rows. Commissioning uses the approval request's associate. No collaborative split/full-rate feature is introduced.
- Snapshot rates on recognized work. Missing prices display as rate pending; setting rates fills unpriced entries once. Later price edits do not rewrite priced work.
- The first cycle display is shortened to the associate's profile creation/joining date. Subsequent cycles use the 16th–15th rule, with payment due on the next month's 7th.
- Salary clearance is implemented as **Record payment already made**: a manager records the payment date/reference for a finished cycle. The server calculates the payable amount; the action does not transfer money. Only per-work earnings are included.
- Paid entries cannot be moved or paid twice. Commissioning date adjustments require a reason and may range from the associate's profile joining date through approval date; cleared destination periods cannot receive moved entries. Approval timestamps are preserved, with a separate date-change audit trail.
- Preserve paid financial records when a phase is later edited. Incomplete/reopened unpaid work is excluded from payable totals. Administrative corrections to already-paid periods are not implemented.
- Existing company/profile deletion is not blocked by the new earnings records. Completed earnings retain company/associate name snapshots; removed or inactive associates with earnings remain available as archived entries in the tracker. Attendance events and payment history retain their recorded identifiers. Deleted associates cannot receive new schedules or work-rate settings.
- New attendance and earnings tracking begins at database migration rollout. Do not automatically backfill historical payroll. Remember work already complete at rollout so later unrelated edits cannot generate historical earnings. Historical complete assessments remain available for installation warning calculations.
- Calendar dates before rollout/joining and future dates are neutral. Green means at least one online check-in occurred that day; the current attendance badge follows the latest event. All online/offline events remain visible to the manager. Holidays and leave have no separate category.
- The overview and tracker refresh in the foreground every 15 seconds and on window focus. Associates must check in again when the manager's offline action is observed. India midnight also returns the associate to the attendance gate.
- Daily table rows appear only for online dates with recognized work. PDF statements list recognized work dates without empty daily rows. Reports use the existing Limelight logo and company name, navy headers, page numbering and daily totals.
- Before the database migration is available, the existing dashboard and scheduler remain accessible. New pages become functional after the migration is applied and work prices are configured. Other database errors are shown with a retry action.

### Files and rollout

- Additive migration: `supabase/migrations/20261005120000_field_operations_attendance_earnings.sql`.
- Stage correction migration: `supabase/migrations/20261005130000_field_operations_company_stages.sql`. Apply after the attendance/earnings migration (or apply only this correction if the first migration is already installed). Scheduling follows the existing dashboard lifecycle status, including manager overrides, and lists only companies assigned to the selected associate. This correction does not change earnings eligibility or the existing submission/approval functions.
- Field associate navigation uses a left sidebar on desktop and a collapsible menu on mobile. Earnings charts share the updated presentation across manager and associate views; calculations remain unchanged.
- The associate sidebar has no Logistics link. Manager associate details open on Visits & attendance, which excludes completed visits. Completed records remain available under Visit history. The full tracker has separate Earnings and Work prices tabs, so price settings are displayed only when selected; overview dialogs provide visits/attendance and history tabs. This presentation change requires no additional database migration.
- Daily work records start collapsed and expand/collapse by clicking their date row. The existing reporting filters scope the selected period. Show date rows only when the associate has an online event and recognized work that day. Earnings eligibility remains independent of attendance/display filtering. Installation remains visible as Not payable; PDF statements include all recognized work dates to preserve complete earning-date totals, including commissioning approval/override dates without attendance.
- Visits & attendance includes attendance activity and daily earnings-by-work charts with monthly, weekly and daily views. Attendance uses the same online-event rule as the calendar; future and pre-joining/pre-rollout dates are excluded from online/offline counts. Earnings charts use the existing eligible/paid ledger entries. The calendar explanation paragraph is removed; recorded attendance, payment rules and schema are unchanged.
- Screens: `src/components/field-operations/FieldOperations.tsx`.
- Data loading: `src/hooks/use-field-operations.ts`; shared types/date helpers: `src/lib/field-operations.ts`.
- Integrations: associate route, manager overview and manager Field Visit Tracker route. Existing company submission forms and approval RPCs are unchanged.
- Database regression command: `npm run test:field-ops`. It runs the actual migration in PGlite PostgreSQL with an isolated fixture; it does not connect to Supabase.
- Payment-policy migration: `supabase/migrations/20261005140000_field_operations_assessment_commissioning_pay.sql`. Apply after the stage correction. Installation rates and new work amounts are zero; unpaid installation amounts are cleared and installation is excluded from future settlements. Already recorded payments/items remain unchanged.
- Rollout order: apply missing migrations in timestamp order: attendance/earnings, stage correction, and payment-policy correction to the intended Supabase database, configure manager work prices, then release the application changes. No new attendance or earning history is created until the attendance/earnings migration is installed.

### Validation

- Production build passed.
- Isolated PostgreSQL financial/attendance/scheduling regression tests passed.
- All 18 database/helper tests pass, including lifecycle comparisons against the existing `getCanonicalStatus` function, manager status overrides, assignment filtering, and strict earnings eligibility despite lifecycle status changes.
- Focused lint checks passed for new TypeScript files.
- A comparison with the unchanged tracked source found 106 existing TypeScript diagnostics and zero added diagnostics.
- Browser checks with mocked RPC responses passed for the daily gate, self-scheduling outside shift boundaries, incomplete-work completion blocking, earnings, PDF download, mobile widths, manager offline action and dual-role gate exclusion. These checks do not claim a live Supabase rollout or production end-to-end validation.
- Additional browser checks passed for the three scheduling stage lists in both panels, exclusion of another associate's companies, desktop sidebar access, and opening/closing mobile navigation without page overflow.
- Browser checks also verified completed visits are hidden from the active tracker and manager overview dialog, retained in Visit history, and that Work prices/Earnings appear only in their selected tab. Associate navigation contains no Logistics button.
- Daily-record browser checks verified initially collapsed rows, repeated open/close clicks, daily/weekly/monthly row filters, attendance and work-earnings chart filters, removal of the calendar explanation, and no horizontal page overflow on mobile. Existing PDF and history/navigation checks continue to pass.

- Latest policy validation: migration tests verify installation exclusion, zero amounts without rate setup, normalization of legacy rate requests, and preservation of previously paid installation records. Browser checks verify online/work-only date rows, two payable price fields, unchanged eligible assessment totals despite legacy installation amounts, expansion/filtering, PDF and mobile layouts.
- Latest UI refinement: Work prices uses two compact currency cards. Expanded daily records have separate Company, Work type, Amount and Status columns. Tracker gaps, card padding, calendar width and attendance-history height are reduced. Insights sit beside the calendar under the scheduled visits to use the available space.
- Activity & work insights now uses donut charts for the selected reporting period: online/offline counts and percentages over tracked elapsed days, and assessment/commissioning earnings shares with completed-work counts. Installation counts remain visible as non-payable work; future/pre-rollout/pre-joining days are excluded from the attendance denominator. Empty analytics display a neutral ring. These charts change presentation only; attendance/payment rules and schema remain unchanged.
- Browser checks verify the Work type column, both currency inputs, attendance percentages, income totals excluding installation, future-period empty charts and compact mobile layout. Build and focused lint pass; TypeScript comparison reports zero added diagnostics.
- Commissioning table correction: recognized/paid commissioning records appear on their earning date even without an online check-in that day, including manager date overrides and approval-date differences. Other work-date rows retain the online/work requirement. Date filters remain in effect: a move into another month appears when that month is selected. Attendance is not fabricated or changed. Helper and browser checks verify date movement, no duplicate old-date row, association/eligibility filtering, and visibility across months. No additional schema migration is required for this correction.
- Payment labels: Unpaid means no payment item exists for the earning. A manager/authorized administrator records an already-made payment for a finished cycle through Earnings → Payment cycle → Record payment. This creates payment records/items and Paid status; it does not transfer funds. Commissioning approval/date edits do not mark payment. Installation is Not payable; Rate pending indicates that the phase price has not yet been configured.
- Payment button explanation: display the reason when recording is disabled (cycle still running, no positive payable earnings, or payment already recorded). A cycle ending on 15 October becomes available on 16 October, with the existing planned due date of 7 November. Successful recording still requires payable assessment/commissioning work with configured rates. No payment eligibility rule or database schema is changed.
- PDF presentation: use one compact, continuous table: Work date, Company, Work type, Amount, Status and Day total. Shade rows by work date and show the day total only on its final activity row. Show the period total once at the end. Remove summary cards, the duplicate daily-summary table and separate daily tables. Keep complete company names, aligned INR amounts, repeated column headers and page numbering. Empty work dates are omitted; installation remains visible as Not payable with no amount. Recorded payment references follow the work details without an unnecessary page break. Payment and earning calculations are unchanged.
- PDF/payment UI validation: browser checks cover running, empty, eligible closed and already-paid cycles. Compact PDF fixtures verify two dates/four activities fit on one page; 31 dates/31 activities fit on one page; 31 dates/93 activities fit on three pages. An extreme 93-activity fixture with long multi-line company names needs six pages, preserving the full names. The period total appears once in each export; layouts were visually inspected. Production build and focused lint pass; TypeScript comparison reports zero added diagnostics. Existing 18 database regression tests passed before this presentation-only revision.
- Effective commissioning date: the ledger's `earning_date` is the reporting work date, initially the approval date and subsequently the manager's corrected date. Commissioned overview rows, commissioning activity reports/exports and performance/factory timelines read this same existing date. Other overview statuses retain the original latest-update behavior. Stored approval/submission timestamps and raw audit logs are preserved; no new SQL migration is needed. Missing ledger dates fall back to existing behavior. Screens refresh dates on focus, every 15 seconds and after a correction in the current tab. Factory Analysis commissioning corrections with a ledger entry use the same existing audited RPC and paid-period restrictions so that its editor does not conflict with tracker corrections; historical records without a ledger retain the existing editor.
- Commissioning date synchronization validation: mocked browser checks verify approval on 6 October followed by correction to 2 October moves the company into the 2 October overview range, excludes it from 6 October, and shows 2 October in activity reports and factory timelines without database timestamp mutations. Three date regression tests cover corrected-day filtering, crossing months and legacy fallback; existing overview filter and field-operations tests pass. Production build passed and TypeScript comparison found zero added diagnostics.
- Commissioning date loader correction: field-operation tables intentionally deny direct authenticated reads. Reporting date lookup uses the existing authorized `field_ops_board` RPC, matching the tracker, rather than selecting `field_earnings` directly. No grants, policies or schema changes are required. Browser checks reject direct earnings reads and verify 29 September overrides a 6 October approval in overview/reports/timelines. PostgreSQL tests also verify that an authenticated manager can read the corrected date through the RPC while direct reads remain denied and the approval timestamp is unchanged. Build, focused lint and all 18 regression tests pass; TypeScript comparison reports zero added diagnostics.
- Authorized historical backfill: `supabase/scripts/backfill_alakh_october_2026.sql` is a manually run, one-time data script, not a migration. It targets only `alakhbrahmbhatt0225@gmail.com`, with `patidarnit21@gmail.com` as the recording manager: Punar Enterprise assessment/installation on 3 October, Medinova assessment/installation/commissioning on 2 October, Twinfit Plastic assessment on 3 October 2026. It validates unique company matches, association/completion/approval, joining date and payment locks. Missing rates stay pending, priced snapshots remain unchanged, installation earns zero, and all changes roll back on a failed check. Two historical work-day attendance events are recorded at import time by the manager; original approval/forms/logins are not backdated. Global rollout dates and pre-rollout calendar neutrality stay unchanged. Results appear in October Earnings daily records, charts and PDF; no historical scheduled visits or arrival/shift times are invented. Farid and Sparsh are untouched. Isolated PostgreSQL checks verify six work rows, repeat-run idempotency, configured/missing rates, attendance attribution, approval preservation and failed-approval/cleared-period rollback. The script has not been executed against the live database.
