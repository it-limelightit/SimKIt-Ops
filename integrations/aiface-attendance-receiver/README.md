# Separate aiface attendance receiver

This service runs alongside the existing VPS MQTT script. It subscribes to the one confirmed aiface device, translates its face entry logs to the existing Supabase Edge Function contract, and forwards photos when supplied. No existing bridge or broker script needs modification, no inbound HTTP port is opened, and no reverse proxy is required.

It sends `checklive` every 20 seconds. Only a matching, fresh, non-retained device reply becomes a Supabase heartbeat. Merely connecting to the MQTT broker does not mark the device online. Face entry is `mode: 8`, `inout: 0`, as documented in the supplied manual. Attendance uses the VPS clock at MQTT receipt, stored as UTC and interpreted as Asia/Kolkata for the work date and late calculation. The device date/time is not used for attendance. The employee's device enrollment ID must match their SimKit record.

The receiver publishes checklive and sendlog receipt acknowledgments. It also handles non-retained face-profile uploads (`senduser`, `backupnum: 50`): it forwards only device ID, enrollment ID and observation time, and acknowledges the profile after Supabase confirms a matching active employee. Enrollment images and device names are not persisted or used as attendance photos. It never adds, deletes or modifies device users, opens doors or changes device settings. Enrollment continues through the existing Supabase enrollment Edge Function. Valid recognized scans also confirm an employee's device profile independently of command acknowledgments.

## VPS deployment: existing root PM2 instance

The production receiver runs on `62.72.43.204` as `simkit-attendance` in the existing root PM2 instance (`PM2_HOME=/root/.pm2`). The checked-in `ecosystem.root.config.cjs` matches the deployed configuration:

- Application: `/opt/simkit-attendance/receiver.mjs`.
- Private Node 22 interpreter: `/opt/simkit-attendance-node/bin/node` (22.15 or newer within Node 22).
- Private environment: `/etc/simkit-attendance.env`, owned by root with permissions `600`.
- Persistent metadata queue: `/var/lib/simkit-attendance/receiver.sqlite`.
- Logs: `/var/lib/simkit-attendance/pm2/attendance-out.log` and `attendance-error.log`.

The existing `pm2-root.service` provides reboot startup. The former `simkit-attendance.service` stays stopped and disabled; its checked-in unit is a legacy rollback template. Run one receiver instance only. Keep any former hosted or temporary local subscriber stopped to avoid duplicate acknowledgments and heartbeat delivery. The saved VPS deployment record confirmed fresh heartbeats, scan delivery and profile confirmation on 9 October 2026; it did not confirm shutdown of the former hosted subscriber.

### Update the receiver

As the VPS administrator, copy the receiver source, `vendor/`, `package.json`, `package-lock.json` and `ecosystem.root.config.cjs` from this directory into `/opt/simkit-attendance`. Keep the private environment and queue outside the release. The source is standalone; no helper files from another integration are required. Use the existing PM2 installation and private Node runtime; leave other applications' runtimes unchanged.

Run these commands as root in the shell where the existing `pm2` command is available:

```sh
export PM2_HOME=/root/.pm2
export PATH=/opt/simkit-attendance-node/bin:$PATH
cd /opt/simkit-attendance
/opt/simkit-attendance-node/bin/node --version
install -d -m 700 /var/lib/simkit-attendance/pm2
npm ci --omit=dev --ignore-scripts
pm2 restart /opt/simkit-attendance/ecosystem.root.config.cjs --only simkit-attendance
pm2 save
chmod 600 /root/.pm2/dump.pm2
```

For initial setup only, after installing the private environment and confirming no receiver is already running, use `pm2 start /opt/simkit-attendance/ecosystem.root.config.cjs --only simkit-attendance` instead of restart. The environment file must configure a unique `MQTT_CLIENT_ID` and the persistent `RECEIVER_DB` path above. Do not start the old systemd unit alongside PM2.

### Verify after deployment

```sh
pm2 describe simkit-attendance
pm2 logs simkit-attendance --lines 50 --nostream
systemctl is-active pm2-root.service
systemctl is-enabled pm2-root.service
systemctl is-active simkit-attendance.service
systemctl is-enabled simkit-attendance.service
```

Expect PM2 online, the root PM2 boot service active/enabled, and the former receiver unit inactive/disabled (the last two checks normally return a nonzero status). Confirm other PM2 applications retain their status and restart counts. No HTTP health endpoint or inbound web port is required.

Successful logs include `Device heartbeat delivered to Supabase.` Only a fresh real device reply establishes connectivity. Refresh Manager Attendance and confirm the device becomes online. Scan an already enrolled employee with a matching SimKit ID; expect `Attendance event delivered to Supabase.` and the correct entry time and photo when supplied. A matching fresh face-profile upload logs `Device enrollment profile confirmed in Supabase.`; it confirms registration without creating an attendance entry. Verify the VPS clock is synchronized before attendance testing.

## Attendance time

The receiver captures one timestamp when each MQTT packet arrives and persists it as `scanned_at` in the metadata queue. Supabase stores that same timestamp and derives entry time, work date, lateness and photo expiry at 02:00 IST on the next calendar day from it. Database `received_at` separately records arrival at Supabase. Retries and queued duplicate messages keep the original receipt timestamp. Raw device time is used only as part of the fallback event identity, so replay deduplication remains stable. Where the device supplies no event ID, otherwise identical records with the same raw clock value collapse into one event.

Buffered records arriving after an outage are counted at receipt time, including all records in a batch. Previously stored attendance and already queued records keep their existing timestamps; this change applies to new MQTT messages after deployment. Keep the VPS system clock synchronized.

## Reliability and retention

Attendance metadata is deduplicated and queued in SQLite before QoS 1 acknowledgment. Delivery retries survive service restart. Photos are held only in bounded process memory and removed after upload or the next-day 02:00 IST cutoff; queued metadata does not write biometric image bytes to disk. A restart can therefore lose an unuploaded photo while retaining its attendance metadata.

The observed device messages use QoS 0: messages sent while the receiver is disconnected cannot be guaranteed. Continuous VPS operation is required for live photos. The manual's historical log commands can help recover attendance metadata later, but do not promise photo recovery. An incorrect device clock no longer controls attendance time.

Stopping only this receiver uses `PM2_HOME=/root/.pm2 pm2 stop simkit-attendance` as root; it does not stop the broker or existing scripts. Run `pm2 save` if the stopped state should persist after reboot. A local test receiver is temporary and should be stopped after the VPS receiver is verified. No Supabase management token or service-role key is needed by this receiver; only its dedicated attendance webhook secret is used.

## Source development

The receiver directory contains local protocol/queue helpers under `vendor`, including profile confirmation queue support. Tests: `npm test` in this directory. Configure `.env` from `.env.example` and use `npm start` for an independent local test only. Production runs `receiver.mjs` directly through PM2 with the private environment file; `npm run start:vps` is available for foreground VPS troubleshooting while the PM2 receiver is stopped. No Supabase management token or service-role key is needed.

Photo cleanup runs once daily at **02:00 Asia/Kolkata**, deleting the previous day?s photos and any older overdue photos. Today?s photos are retained until the next day at 02:00. Photos can therefore remain for about 2?26 hours depending on arrival time. Attendance entries and scan history are preserved. Supabase uses a UTC cron schedule of `30 20 * * *`; the enrollment retry schedule stays unchanged. The cleanup paginates through expired files so it does not stop after 100 photos.
