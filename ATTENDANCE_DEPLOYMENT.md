# Manager device attendance: implementation and setup

## Current deployment status — 8 October 2026

The active Supabase project is `jhhiwyvrhfhvvougkqmm`. All ten attendance tables exist with Row Level Security enabled, and the `attendance-photos` bucket is private. Do **not** run the base CREATE TABLE migration again on this project. All six attendance Edge Functions are now deployed and active. Each rejected unauthenticated POST requests with HTTP 401. An authenticated cleanup call returned HTTP 200 with no failed deletions; command retry returned `configured: false, sent: 0`, because broker credentials and protocol remain unset. An authenticated device request with an invalid serial was rejected before any scan write.

Attendance webhook/Cron/email signing secrets were generated and saved privately under `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/attendance-secrets.private.json`, then installed in Supabase Edge Function Secrets. The matching Cron secret and project URL were saved in Vault. Both attendance Cron jobs are active, scheduled once per minute. Office policy was verified as 10:00 AM with 15 minutes grace; absence cutoff remains unset pending manager confirmation. No actual employee enrollment or face scan has been tested against the device.

Deployment used the project's management API and touched only the six attendance functions, attendance-specific secrets, Vault names and schedules, plus the required Cron extensions. No other function or application credential was changed. Repeat deployment is available via `node supabase/scripts/deploy_attendance_cloud.mjs <private-migration-env-path>`; `--configure-only` skips code redeployment. The script prints no credentials and refuses a Vault update if the locally saved Cron secret cannot authenticate the cleanup function. Keep the private files out of Git.

For the shortest Dashboard deployment instructions, open [supabase/dashboard-deploy/README.md](supabase/dashboard-deploy/README.md). That directory now contains a self-contained source file for **each** attendance Edge Function. The files are generated from the real implementation; they do not introduce another backend or modify the MQTT bridge.

Actual device enrollment requires confirmed command JSON, command topic, reply topic and acknowledgment fields. The screenshot alone does not establish them. Continuous face scans also require the device or broker to forward events to HTTPS. Deployment by itself does not establish either connection. Automatic email leave requests require a configured inbound mail provider/gateway; manual leave requests and manager review are available independently.

Rebuild Dashboard files after changing source: `node supabase/scripts/build_attendance_dashboard.mjs`. Read-only cloud audit: `node supabase/scripts/check_attendance_cloud.mjs .tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/migration.env`.

## Implemented locally

Manager navigation now includes Attendance at `/manager/attendance`, with Daily Attendance, Manage Users, Leave Requests, office settings, scan history, late highlights, and private photo viewing. New attendance tables/functions are separate from field-associate online/offline records and earnings. No existing payroll or phase workflow has been replaced.

The database starts with the user-confirmed **10:00 AM** shift and **15 minutes grace** (chosen from the requested 10–15 minute range). Change grace to 10 in Office settings if preferred. Working days and an absence cutoff must be confirmed and saved there; automatic absence is disabled until then. Existing daily policy snapshots are preserved when settings change.

The user supplied serial **AYUE22065256** and observed topic **aiface/AYUE22065256/sub/stellar**. This is `stellar`, with two l characters. The screenshot shows a `sendlog` event on that topic, so its command direction is not established. Do not publish guessed enrollment JSON there.

### Device manual and live topic verification — 8 October 2026

Read the supplied 40-page `aiface_mqtt+json_api.pdf` (revision 1.0, 2 January 2025). Page 6 documents command topic `aiface/<serial>/pub` and response topic `aiface/<serial>/sub`. This installation adds `/stellar`: a non-destructive `checklive` on `aiface/AYUE22065256/pub` received no matching reply in 12 seconds, whereas the same command on **`aiface/AYUE22065256/pub/stellar`** returned `ret: checklive`, the correct serial and `result: true` on **`aiface/AYUE22065256/sub/stellar`**. Broker login and this device round-trip were tested from the local machine, not from the hosted Edge runtime.

Page 40 documents remote enrollment with `cmd: adduser`, numeric `enrollid`, `backupnum: 50`, `admin: 0`, the employee's `name` and `flag: 10` (automatic registration). The name and department in SimKit remain database-owned; the device command does not include department. The exact template is prepared in the private MQTT file. The verified command topic is configured in Supabase; the enrollment template is deliberately not activated there until the correct person is ready at the device. No enrollment command was sent in these connectivity checks.

The manual's final adduser section does **not** document its completion reply or any echoed command UUID. Do not substitute a setuserinfo acknowledgment or declare enrollment complete from PUBACK. Capture the actual fresh registration response before implementing confirmation mapping. Page 7 documents attendance `sendlog` records (`enrollid`, local `time`, `mode`, `inout`, optional base64 `image`), with face mode 8. Native vendor payloads still need translation to the authenticated Edge Function contract; topic configuration does not establish HTTP forwarding.

### Separate receiver: live local test and VPS handoff

Added `integrations/aiface-attendance-receiver`, which reuses the untouched bridge's protocol and durable metadata queue. It subscribes to this device's exact topic, forwards face-entry records and supplied JPEG/PNG images to the existing attendance Edge Function, and sends periodic `checklive` requests. Only fresh replies from the actual device generate Supabase heartbeats. Receipt acknowledgments are sent after successful delivery and contain no door-opening controls. The existing VPS script and bridge source files were not modified.

A live receiver test on the local computer successfully delivered device heartbeats and attendance events. Supabase now has populated `last_heartbeat_at` and `last_scan_at`; 27 scan events existed at verification. This does not mean employee 9002 is registered: its enrollment remains pending, with zero command attempts. The enrollment template has not been enabled in Supabase while awaiting the correct person's readiness.

The user has no VPS access; another administrator manages it. Permanent operation is not deployed there yet. A credential-free release is prepared at `.tmp/aiface-attendance-receiver.zip`, and administrator instructions are in `integrations/aiface-attendance-receiver/README.md`. The separate private VPS environment file is `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/attendance-receiver.vps.env`; it requires only broker credentials and the dedicated webhook secret, not a Supabase management or service-role key. The current local receiver is a temporary test and should be stopped after the VPS service is confirmed. QoS 0 outages and unuploaded in-memory photos across restarts remain limitations described in the receiver guide.

### Render deployment option

The receiver now includes a Render Web Service entrypoint (`web.mjs`), a public read-only `/health` liveness endpoint, a standalone MQTT dependency lockfile, local copies of its tested helpers, and `render.yaml`. The Render entrypoint was tested locally against the real device; its health endpoint returned HTTP 200 and real heartbeats reached Supabase. Render itself has not been deployed because no Render account/repository access was supplied. Follow `integrations/aiface-attendance-receiver/RENDER_DEPLOYMENT.md`; the private environment file is `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/attendance-receiver.render.env`.

Render Free can be used for a preview, but sleeps after idle inbound HTTP traffic and discards its ephemeral queue on restarts. It does not guarantee continuous production attendance. Vercel request-limited Functions cannot host this permanent MQTT subscriber. Supabase's existing request-scoped functions and the production website remain in their current platforms; neither requires a platform change for the separate receiver.

The database, six functions, baseline attendance secrets and Cron are installed in the new Supabase project. Broker integration and inbound email-provider routing remain required for live device and automatic email use. This is not confirmation of live device connectivity.

## 1. Database

Apply `supabase/migrations/20261006150000_manager_device_attendance.sql` through your normal Supabase/Lovable database rollout. It creates only new attendance tables/RPCs and a private `attendance-photos` bucket. Use Supabase CLI migrations only after checking which older repository migrations are already applied; do not blindly push unrelated pending migrations.

Managers use the existing `supervisor` role. New employee records do not create login accounts or grant permissions. Table writes use guarded RPCs; scan/command ingestion RPCs are service-only. Client Storage policies are not created: photo access goes through a manager-authorized Edge Function.

Regenerate Supabase TypeScript definitions after live schema rollout if desired. Additive attendance calls currently use a client wrapper so existing generated types remain untouched.

## 2. Edge Functions and secrets

Deploy these functions with `supabase/config.toml`:

```text
attendance-enroll-user
attendance-device-event
attendance-command-retry
attendance-photo-access
attendance-photo-cleanup
attendance-leave-email
```

For example, run `supabase functions deploy attendance-device-event` against the verified project, and repeat for each function. The shared code lives under `supabase/functions/_shared/attendance*.ts`.

Gateway JWT verification is disabled for these endpoints because MQTT/email/Cron callers have no user JWT. The code still checks manager JWTs with `auth.getUser()` and supervisor membership, dedicated device/Cron secrets, or an email HMAC signature. Missing secrets fail closed. See [Supabase authentication headers](https://supabase.com/docs/guides/functions/auth-headers).

Configure these server secrets, using the dashboard or a secure secrets file:

| Secret | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Standard hosted function environment values; validate availability |
| `ATTENDANCE_DEVICE_ID` | `AYUE22065256` |
| `ATTENDANCE_EVENT_TOPICS` | Comma-separated exact allowlist; observed scan topic is `aiface/AYUE22065256/sub/stellar`; include real ack/heartbeat topics if different |
| `ATTENDANCE_DEVICE_WEBHOOK_SECRET` | Strong random secret shared only with the trusted MQTT gateway/bridge |
| `ATTENDANCE_PUBLISH_URL` | HTTPS adapter endpoint ending `/publish`, not MQTT port 1883 |
| `ATTENDANCE_PUBLISH_SECRET` | Strong random secret for the adapter endpoint |
| `ATTENDANCE_COMMAND_TOPIC` | Vendor-confirmed enrollment destination; leave unset until confirmed |
| `ATTENDANCE_CRON_SECRET` | Strong random secret for scheduled functions |
| `ATTENDANCE_EMAIL_WEBHOOK_SECRET` | HMAC secret for a trusted inbound-email gateway |

Do not put service-role or broker credentials in browser environment variables. Enrollment saves the employee and command even if publishing is not configured; the UI reports pending integration. Configure publishing only after checking the exact firmware command and device acknowledgment mapping.

## 3. Existing MQTT server integration

### Alternative: enrollment directly from the Edge Function, without bridge changes

The user requested an alternative that leaves the bridge scripts untouched. Set `ATTENDANCE_PUBLISH_MODE=mqtt` to select the new request-scoped MQTT enrollment path. The default HTTP adapter flow remains available when this setting is absent.

```text
Manager adds user
  -> Supabase saves employee and command
  -> enrollment Edge Function connects directly to existing MQTT broker
  -> subscribes to configured device-response topic, if acknowledgment mapping exists
  -> publishes the vendor-confirmed enrollment JSON
  -> waits up to 10 seconds total for broker/device response
  -> stores the outcome and disconnects
```

To activate only this enrollment test:

1. Apply the base attendance migration `20261006150000_manager_device_attendance.sql` if not already applied.
2. Apply the additional migration `20261006160000_attendance_direct_mqtt.sql`. This adds a service-only outcome RPC; it does not change existing attendance tables or the bridge.
3. Deploy/redeploy `attendance-enroll-user`, including its shared files and the existing function configuration. No bridge process/API is needed for this outgoing enrollment mode. Redeploy `attendance-command-retry` only if scheduled enrollment retries are used.
4. Configure these Edge Function secrets:

| Secret | Value |
| --- | --- |
| `ATTENDANCE_PUBLISH_MODE` | `mqtt` |
| `ATTENDANCE_MQTT_HOST` | `62.72.43.204` |
| `ATTENDANCE_MQTT_PORT` | `1883`, matching the supplied broker connection |
| `ATTENDANCE_MQTT_TLS` | `false` for the supplied non-TLS endpoint; use `true` only with a confirmed TLS listener/port |
| `ATTENDANCE_MQTT_USERNAME` | Existing MQTT username |
| `ATTENDANCE_MQTT_PASSWORD` | Existing MQTT password |
| `ATTENDANCE_DEVICE_ID` | `AYUE22065256` |
| `ATTENDANCE_COMMAND_TOPIC` | Confirmed device enrollment-command topic |
| `ATTENDANCE_MQTT_ENROLL_TEMPLATE` | Exact vendor-confirmed enrollment JSON, as a JSON object string with supported placeholders |
| `ATTENDANCE_MQTT_ACK_RULES` | Optional JSON acknowledgment mapping; required for automatic registration confirmation in this short session |

`ATTENDANCE_PUBLISH_URL` and `ATTENDANCE_PUBLISH_SECRET` are not used in this mode. MQTT credentials stay in Edge Function secrets. The supplied port 1883 connection is unencrypted; use the actual broker's TLS listener if available.

The enrollment template supports whole-value placeholders `{{command_id}}`, `{{device_id}}`, `{{name}}`, `{{department}}`, `{{enroll_id}}`, and explicit numeric `{{enroll_id_number}}`. The application does not guess the vendor's enrollment operation or destination. The observed `sendlog` topic is not proof of an enrollment destination.

Acknowledgment mapping example below is **illustrative only**, not a claimed device protocol:

```json
{
  "topic": "CONFIRMED_DEVICE_REPLY_TOPIC",
  "kind_path": "ret",
  "kind_value": "CONFIRMED_ENROLL_RESPONSE_KIND",
  "command_id_path": "request_id",
  "enroll_id_path": "user.id",
  "serial_path": "sn",
  "success_path": "ok",
  "success_value": true,
  "failure_value": false
}
```

Field paths support nested JSON, such as `record.0.enrollid`. Reply kind, command ID, enroll ID, serial, and success/failure value must match the configured operation. Configure acknowledgment mode only if the device accepts/echoes the command ID in the enrollment template; otherwise reliable confirmation needs a vendor-specific correlation/readback design. Retained replies and replies to other commands are ignored.

**Result meanings:** database save is Saved; broker PUBACK is Published/Pending; a matching successful device reply is Enrolled; an explicit device rejection is Failed. A timeout after publishing does not invent registration success. If the connection fails after sending and broker acceptance is unknown, automatic retries stop and the manager must check device state before retrying. Failures before sending can be retried safely.

This MQTT client uses Deno TCP/TLS APIs and the MQTT 3.1.1 protocol. See [Deno networking](https://docs.deno.com/api/deno/network/) and [MQTT specification](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html). Supabase's runtime supports outbound TCP connections, as described in its [Postgres runtime support](https://github.com/supabase/server/blob/main/docs/postgres.md); that supports this design, but actual MQTT reachability/firewall access from the deployed project still needs a live test.

This is a short enrollment session, not continuous attendance ingestion. Device replies arriving after disconnect require the existing webhook/bridge path. Continuous face scans still need that path, a native broker HTTP integration, or device HTTPS callbacks. No live broker commands or credentials were used during local testing.

Direct-mode validation: all 31 attendance tests pass, including short-session MQTT framing/confirmation, no-bridge Edge invocation, atomic registration status, and stopping uncertain retries. Focused types/lint and the production build pass. The bridge scripts were not changed for this alternative.

Reuse `62.72.43.204:1883`. Choose either the broker's native publishing/webhook features with a normalizing gateway, or the included adapter at `integrations/attendance-mqtt-bridge/`.

The Supabase publishing endpoint sends this **adapter contract**, not raw firmware JSON:

```json
{
  "command_id": "unique-uuid",
  "device_id": "AYUE22065256",
  "topic": "confirmed-command-topic",
  "operation": "enroll",
  "employee": { "name": "Rahul", "department": "software", "enroll_id": "104" }
}
```

The gateway must return 2xx only when it has accepted/published the command durably. Database status stays pending until an actual device acknowledgment. The included adapter waits for MQTT QoS 1 publication and deduplicates command IDs. Unknown publish outcomes require operator reconciliation rather than automatic duplicate commands. A missing device acknowledgment fails after ten minutes; manager retry creates a new command, so verify device state first.

### Included adapter installation

Use Node **22.15 or later**. The adapter uses Node's built-in SQLite (experimental in Node 22) and MQTT.js. Its package and lockfile are separate from the frontend dependencies.

```text
cd integrations/attendance-mqtt-bridge
npm install
copy .env.example to .env and configure values securely
npm start
```

On the broker server use the appropriate native file-copy command. Keep `.env` and the SQLite file private; they are ignored by Git. Bind the adapter to localhost behind an HTTPS reverse proxy, with a supervised service that restarts after failure. Use MQTT TLS if the server exposes it; a localhost MQTT connection is appropriate only when adapter and broker share that server. Never expose the unencrypted HTTP adapter port publicly.

The adapter subscribes only to the configured attendance topics. The screenshots show other application topics on the same broker: no wildcard subscription or changes to them are needed.

### Confirm these firmware details

- Actual enrollment command JSON, command topic, and acknowledgment topic/payload.
- Whether the firmware echoes a command ID. If not, implement reliable command correlation in the gateway before enabling enrollment confirmation; do not fabricate acknowledgments.
- Whether `mode: 8` means successful face recognition. Set `ATTENDANCE_VALID_MODES` only after confirmation.
- Whether `inout: 0` is an entry event. Set `ATTENDANCE_ENTRY_INOUT_VALUES` only after confirmation.
- Whether the timestamp is device local time in India. Adapter default offset is `+05:30`; confirm the device clock configuration.
- Exact photo field/MIME and whether images are included in scans. Configure `ATTENDANCE_PHOTO_FIELD`; it remains blank until known.
- Real heartbeat protocol, event IDs, device buffering/replay, and QoS. The observed screenshot uses **QoS 0**, which cannot guarantee delivery during outages; subscribing at QoS 1 does not upgrade QoS 0 publications.

The adapter understands the observed `sendlog` fields: `sn`, `record`, `enrollid`, `time`, `mode`, and `inout`. Unknown modes are recorded as failed recognition rather than marking attendance. The `name` sent by the device does not override the employee name registered in SimKit.

Where firmware event IDs are absent, the adapter hashes serial + enroll ID + device time + mode + in/out. This survives batch replay, but two otherwise identical scans within the same second collapse into one event. Prefer a stable firmware event ID when available. Numeric device enroll IDs cannot preserve leading zeros; use an agreed ID format consistently.

Create a vendor-confirmed enrollment template file and set `ATTENDANCE_ENROLL_TEMPLATE_FILE` to its path. Supported whole-value placeholders are `{{command_id}}`, `{{device_id}}`, `{{name}}`, `{{department}}`, `{{enroll_id}}`, and explicit numeric `{{enroll_id_number}}`. No vendor command template is shipped because the supplied screenshot does not show an enrollment operation.

The adapter also accepts already-normalized scan/ack/heartbeat JSON on allowed MQTT topics. Translate real firmware acknowledgments and heartbeat messages to the contract below in your gateway; do not substitute broker connectivity for device health.

## 4. Incoming device contracts

POST JSON to `/functions/v1/attendance-device-event` over HTTPS with `x-attendance-secret: <device webhook secret>`.

Scan example:

```json
{
  "kind": "scan",
  "device_id": "AYUE22065256",
  "topic": "aiface/AYUE22065256/sub/stellar",
  "event_id": "stable-device-event-id",
  "enroll_id": "104",
  "scanned_at": "2026-10-06T10:17:00+05:30",
  "recognized": true,
  "photo_base64": "optional-raw-base64-without-data-url-prefix",
  "photo_mime": "image/jpeg"
}
```

Use `image/jpeg` or `image/png`, maximum 2 MB. Photo links are not downloaded: normalize images to bytes in a trusted gateway. Do not allow arbitrary URL fetching. Timestamps must include an offset. Invalid clocks, unknown employee IDs, inactive employees, and failed recognition remain review events rather than valid daily attendance.

Acknowledgment example:

```json
{
  "kind": "enrollment_ack",
  "device_id": "AYUE22065256",
  "topic": "confirmed-ack-topic",
  "command_id": "same-uuid-as-original-command",
  "enroll_id": "104",
  "success": true
}
```

Device heartbeat example:

```json
{
  "kind": "heartbeat",
  "device_id": "AYUE22065256",
  "topic": "confirmed-heartbeat-topic",
  "observed_at": "current-ISO-timestamp-with-timezone"
}
```

Heartbeat timestamps must be within one minute of receipt. Historical/replayed/retained heartbeats cannot establish healthy attendance coverage. Device state becomes offline after five minutes without a heartbeat. Missing scans become absent only after confirmed cutoff with a recorded day of heartbeat coverage and no detected gap exceeding five minutes; otherwise they stay Needs review. If the device has no reliable heartbeat, automatic absence remains conservative.

Duplicate scan IDs are immutable and safe to retry. Attendance survives photo upload failure; retry the same event when the endpoint returns `503` with `photo: retry_needed`.

## 5. Retention and adapter queues

Photo expiry is **scan time + 24 hours**. Expired delayed photos are not stored. Only manager-authorized short-lived URLs are issued; URL lifetime is limited to the remaining retention. The UI closes an expired preview. Already downloaded copies cannot be revoked.

Cleanup deletes actual Storage objects through the API, keeps attendance history, retries failed deletions, and sweeps old orphaned files. Physical deletion normally occurs within the next scheduled minute, with possible delay during outages. Supabase does not automatically remove copies on the device, broker, or external systems.

Adapter metadata is queued durably in SQLite, bounded to 10,000 events, and attempted up to 20 times before a dead-letter state requiring operator review. Successful metadata is pruned after seven days or earlier under queue pressure; Supabase holds permanent attendance history. Monitor dead events and queue size. After fixing a delivery issue, requeue an affected dead event with an operator-reviewed SQLite update of status/attempts/next_at; scan deduplication makes replay safe. Do not erase unknown publishing command state until reconciled with the device.

**The adapter never persists photo bytes.** It retries a bounded number of photos from memory until expiry. Restarting the adapter can lose pending photos, while durable attendance metadata remains. UI then shows Photo unavailable. This is a deliberate retention tradeoff; reliable durable photo retries would require an additional independently enforced expiring encrypted queue.

## 6. Schedule cleanup and command retries

Create Vault secrets through the Supabase dashboard:

- `attendance_project_url`: the actual `https://<project>.supabase.co` URL, without a trailing slash.
- `attendance_cron_secret`: exactly the same value as the Edge Function `ATTENDANCE_CRON_SECRET`.

Run `supabase/scripts/setup_attendance_cron.sql`. It installs/replaces only the two attendance jobs and does not change existing schedules. See [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions).

Check both Cron job history and HTTP response status in `net._http_response`; a successful scheduled SQL call only proves the HTTP request was queued, not that cleanup succeeded. Monitor overdue undeleted rows in `attendance_photos` and failed commands in `attendance_device_commands`.

## 7. Leave email

Manual full-day leave entry, review, overlap protection, rejection, cancellation, and scan-during-leave conflicts are available immediately after database setup.

For email automation, configure an inbound email provider/mailbox gateway. It must verify the provider's original webhook signature, extract minimal fields, and sign a normalized JSON object with HMAC-SHA256. No raw email or attachment storage is needed.

Normalized body:

```json
{
  "message_id": "unique-provider-message-id",
  "sender": "rahul@example.com",
  "start_date": "2026-10-12",
  "end_date": "2026-10-13",
  "reason": "Personal leave"
}
```

Send `x-attendance-timestamp` as Unix seconds and `x-attendance-signature` as the hex HMAC of `timestamp + '.' + JSON.stringify(normalizedBody)`, using `ATTENDANCE_EMAIL_WEBHOOK_SECRET`. The endpoint rejects signatures older than five minutes and deduplicates provider message IDs. Ensure JSON key ordering/serialization matches the signed normalized body; use the included `sign-leave-email.mjs` as an example for a trusted JavaScript gateway.

Match emails only to an active employee whose email the manager has verified. Unknown sender, unclear dates, or overlap becomes Needs review and can be resolved in the manager approval form. Incoming email does not approve leave. Configure the actual provider and receiving address before claiming live email automation works.

## 8. Validation and rollout checks

Local checks:

```text
npm run test:attendance
npm run test:field-ops
node --test integrations/attendance-mqtt-bridge/bridge.test.mjs
node --test integrations/attendance-mqtt-bridge/server.test.mjs
node tests/check-attendance-types.mjs
npm run build
```

Before enabling production, test one real enrollment/ack, recognized scan, duplicate replay, late boundary at 10:15, photo viewing/expiry/cleanup, disconnected device, and leave approval. Verify unauthorized requests fail. Do not send enrollment commands while the firmware template/direction is unresolved.

Neither production Supabase nor the MQTT server was modified during local implementation. Follow the setup steps against the correct project/server to activate the feature.

Local validation completed: production build passed; 21 attendance/database/Edge handler tests passed; 5 bridge tests passed, including a local mock MQTT broker publishing test; all 20 existing field-operations tests passed. Focused lint and frontend/Edge Function type checks passed. Full-project TypeScript still reports existing errors in unrelated workflows. No real device enrollment, production database rollout, provider email routing, or browser visual QA is claimed by these checks.
