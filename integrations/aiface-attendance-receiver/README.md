# Separate aiface attendance receiver

This service runs alongside the existing VPS MQTT script. It subscribes to the one confirmed aiface device, translates its face entry logs to the existing Supabase Edge Function contract, and forwards photos when supplied. No existing bridge or broker script needs modification, no inbound HTTP port is opened, and no reverse proxy is required.

It sends `checklive` every 20 seconds. Only a matching, fresh, non-retained device reply becomes a Supabase heartbeat. Merely connecting to the MQTT broker does not mark the device online. Face entry is `mode: 8`, `inout: 0`, as documented in the supplied manual. Device local timestamps are interpreted as Asia/Kolkata; check the device's actual clock. The employee's device enrollment ID must match their SimKit record.

The receiver publishes checklive and sendlog receipt acknowledgments. It never adds, deletes or modifies device users, opens doors or changes device settings. Enrollment continues through the existing Supabase enrollment Edge Function.

## VPS administrator: install on Linux

Use the prepared `.tmp/aiface-attendance-receiver.zip` package. It includes all required helper files and no credentials. Obtain the separate private `attendance-receiver.vps.env` through a secure channel from the project owner; do not paste it into source control, tickets or chat.

1. Confirm Node **22.15 or newer**, npm and outbound access to MQTT port 1883 and HTTPS port 443. `command -v node` should match the service's `/usr/bin/node`; adjust the service if Node is installed elsewhere. Do not replace a Node version used by an existing application without checking that application's requirements.
2. Create a dedicated account and directories. Skip the user creation command if that account already exists:

   ```sh
   sudo useradd --system --home /var/lib/simkit-attendance --shell /usr/sbin/nologin simkit-attendance
   sudo install -d -m 755 /opt/simkit-attendance
   sudo install -d -m 700 -o simkit-attendance -g simkit-attendance /var/lib/simkit-attendance
   ```

3. Extract the release ZIP into `/opt/simkit-attendance`, with `receiver.mjs`, `protocol.mjs`, `queue.mjs`, `receiver-core.mjs` and `package.json` directly in that directory. Install dependencies:

   ```sh
   cd /opt/simkit-attendance
   sudo npm ci --omit=dev --ignore-scripts
   ```

4. Place the supplied private configuration at `/etc/simkit-attendance.env`, owned by root with permissions `600`. Its device/topic/project values are already prepared. Its client ID is unique to this new service. Keep its webhook secret private.
5. Install and start this one new service:

   ```sh
   sudo install -m 644 /opt/simkit-attendance/simkit-attendance.service /etc/systemd/system/simkit-attendance.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now simkit-attendance
   sudo systemctl status simkit-attendance --no-pager
   sudo journalctl -u simkit-attendance -n 30 --no-pager
   ```

Successful logs include `Device heartbeat delivered to Supabase.` Refresh Manager Attendance: the device should become online. Scan an already enrolled employee with a matching SimKit ID; logs should show `Attendance event delivered to Supabase.` Confirm entry time and photo if the device sends an image. A new SimKit employee awaiting device registration cannot be tested just by saving their name.

## Reliability and retention

Attendance metadata is deduplicated and queued in SQLite before QoS 1 acknowledgment. Delivery retries survive service restart. Photos are held only in bounded process memory and removed after upload or 24-hour expiry; queued metadata does not write biometric image bytes to disk. A restart can therefore lose an unuploaded photo while retaining its attendance metadata.

The observed device messages use QoS 0: messages sent while the receiver is disconnected cannot be guaranteed. Continuous VPS operation is required for live photos. The manual's historical log commands can help recover attendance metadata later, but do not promise photo recovery. A clock showing an old date must be corrected at the device by its operator before current-day testing.

Stopping only this service uses `sudo systemctl stop simkit-attendance`; it does not stop the broker or existing script. A local test receiver is temporary and should be stopped after the VPS receiver is verified. No Supabase management token or service-role key is needed by this receiver; only its dedicated attendance webhook secret is used.

## Source development

The receiver directory contains unchanged copies of the tested bridge protocol/queue helpers under `vendor`, so deployments do not need files outside this directory. The prepared VPS release puts those helpers in the release directory. Tests: `npm test` in this directory. Configure `.env` from `.env.example` for independent local use, or use the private local env file prepared under `.tmp`. For Render Web Service deployment, follow `RENDER_DEPLOYMENT.md` and use `npm run start:render`; Render supplies its environment values directly.
