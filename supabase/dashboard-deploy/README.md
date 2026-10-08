# Deploy attendance to the new Supabase project

This folder contains six **Supabase Edge Functions**, ready to paste into the Supabase Dashboard editor. Each generated `.ts` file includes its shared attendance helpers, with only the external Supabase SDK import remaining. No separate application server or Docker is required for this deployment method.

**Current status (8 October 2026):** all six functions below have already been deployed to project `jhhiwyvrhfhvvougkqmm`. Baseline attendance secrets and both Cron schedules are installed. You do not need to paste these files again for the initial setup. Continue with the MQTT configuration and scan forwarding steps; the manual deployment instructions remain here for future updates.

## 1. Deploy the functions

1. Open https://supabase.com/dashboard/project/jhhiwyvrhfhvvougkqmm/functions.
2. Choose **Deploy a new function → Via Editor**. Create a function using the exact name from the table below.
3. Replace the editor's `index.ts` with the **entire contents** of its matching file from this folder. Paste code, not the file path.
4. Deploy it. Under the function's settings, turn **Verify JWT** off. Each function checks its own manager session, webhook secret or email signature. Do not remove those checks.
5. Repeat for all six functions.

| Function name              | File to paste                 | Responsibility                                                      |
| -------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `attendance-enroll-user`   | `attendance-enroll-user.ts`   | Saves employee, sends enrollment over MQTT, records device outcome  |
| `attendance-device-event`  | `attendance-device-event.ts`  | Receives authenticated scans, device replies and heartbeats         |
| `attendance-command-retry` | `attendance-command-retry.ts` | Retries eligible commands through a secret-protected scheduled call |
| `attendance-photo-access`  | `attendance-photo-access.ts`  | Gives signed, short-lived photo links to authenticated managers     |
| `attendance-photo-cleanup` | `attendance-photo-cleanup.ts` | Removes expired photos, preserving attendance records               |
| `attendance-leave-email`   | `attendance-leave-email.ts`   | Receives signed, normalized leave emails for manager review         |

The browser already calls these names. Keep the app's Supabase environment on the new project; attendance does not require changing Telegram or outgoing email credentials. Existing normal email notifications do not automatically configure inbound leave email.

## 2. Configure secrets

Open **Edge Functions → Secrets** in the same Supabase project. Use `../attendance-secrets.env.example` as a list of required attendance values. Enter real secrets in the Dashboard, never in frontend `VITE_` variables, GitHub source files or chat. Supabase supplies the standard `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions.

For the requested direct MQTT flow, select `ATTENDANCE_PUBLISH_MODE=mqtt`. The command topic and JSON must come from the actual device protocol. Do not paste illustrative commands into production. Configure acknowledgment rules to report enrollment success only after a matching device acknowledgment. Broker acceptance alone leaves the employee pending.

If MQTT values are missing, Add User can save the employee with a pending enrollment. It cannot register them on the device until the values are correct.

## 3. Connect incoming scans

The scan endpoint is:

```text
https://jhhiwyvrhfhvvougkqmm.supabase.co/functions/v1/attendance-device-event
```

The device or existing broker's HTTP forwarding feature must POST JSON with `Content-Type: application/json` and `x-attendance-secret: <ATTENDANCE_DEVICE_WEBHOOK_SECRET>`. The Edge Function is request-driven; it cannot stay connected as a permanent MQTT subscriber. If neither the device nor broker supports HTTPS forwarding, an existing external subscriber/gateway is required. Confirm that capability before choosing its configuration; no bridge script has been changed.

A normalized scan has this format (use the real enrollment ID and timestamp):

```json
{
  "device_id": "AYUE22065256",
  "topic": "EXACT_ALLOWED_SCAN_TOPIC",
  "kind": "scan",
  "event_id": "DEVICE_UNIQUE_SCAN_ID",
  "enroll_id": "104",
  "recognized": true,
  "scanned_at": "2026-10-08T10:05:00+05:30",
  "photo_mime": "image/jpeg",
  "photo_base64": "BASE64_IMAGE_BYTES"
}
```

Omit photo fields if no photo exists. Images must be JPEG/PNG, at most 2 MB. Repeat deliveries must reuse the same event ID. The broker must transform the actual device payload into this contract; raw vendor messages are not assumed to match it. See `../../ATTENDANCE_DEPLOYMENT.md` for acknowledgments, heartbeats and inbound email contracts.

## 4. Enable photo cleanup

After functions and secrets are deployed, create these two secrets in Supabase **Vault**:

| Vault name               | Value                                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| `attendance_project_url` | `https://jhhiwyvrhfhvvougkqmm.supabase.co`                            |
| `attendance_cron_secret` | The exact same secret as the Edge Function's `ATTENDANCE_CRON_SECRET` |

Run `../scripts/setup_attendance_cron.sql` in this project's SQL Editor. It schedules cleanup and eligible command retries once per minute and replaces only those two attendance jobs when rerun. Photo access expires 24 hours after the scan; scheduled deletion removes the stored image on the next successful cleanup. Attendance rows remain.

## 5. Check before live use

1. Sign in locally with a manager (`supervisor`) account using `npm run dev`. Open **Manager → Attendance**.
2. In Office settings, confirm 10:00 AM start, 15 minutes grace, actual working days and absence cutoff. With this policy, exactly 10:15 AM is within grace; later entry is highlighted as late.
3. Add a test employee using an unused device enrollment ID. Confirm the device receives the command. Confirm success only when the matching device reply has been received.
4. Scan the enrolled employee. Verify name, date, entry time, photo and refresh. Repeat the same event to check there is no duplicate record. Test a scan after 10:15 AM on a working day.
5. Submit and review a manual leave request. Approved leave should appear on the selected date. A scan on approved leave remains visible as a conflict for review.
6. Confirm the Cron jobs run successfully and photo cleanup leaves the durable attendance record intact. Do not change the retention timestamp of real records merely to test expiry.

Run `npm run test:attendance` for isolated automated checks. For a read-only deployed inventory, run:

```powershell
node supabase/scripts/check_attendance_cloud.mjs .tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/migration.env
```

An available OPTIONS response establishes endpoint deployment only; it does not prove MQTT connectivity or a successful scan. Keep the function source under `supabase/functions` authoritative and regenerate these files with `node supabase/scripts/build_attendance_dashboard.mjs` after edits.
