# Deploy the attendance receiver on Render

Use **Render Web Service** for this package. Your existing SimKit website continues on Vercel with the same URL; this is a separate receiver service.

**Free plan limitation:** Render Free sleeps after 15 minutes without inbound HTTP/WebSocket traffic. Outgoing MQTT connections and heartbeat calls are not a dependable way to prevent sleep. MQTT messages do not wake an HTTP web service. Render also discards local SQLite queue data on restart, redeploy or sleep. Free is suitable for testing this connection, but cannot guarantee complete production attendance/photos. Do not rely on an uptime-ping workaround for production reliability. See https://render.com/docs/free.

Vercel Functions have bounded execution time, so the continuous MQTT subscriber cannot be deployed as a Vercel Function. See https://vercel.com/docs/functions/limitations. Existing attendance Edge Functions remain on Supabase.

## 1. Push receiver files to GitHub

Push the changes under `integrations/aiface-attendance-receiver`, including its `vendor` folder and `package-lock.json`. Do not push `.env`, `.tmp` or SQLite files. The vendor files are unchanged copies of the existing tested bridge helpers: the original bridge source is untouched, and all runtime code is available inside this standalone receiver directory.

## 2. Create a separate Render service

Open https://dashboard.render.com, select **New → Web Service**, and connect the GitHub repository.

| Setting           | Value                                     |
| ----------------- | ----------------------------------------- |
| Name              | `simkit-aiface-attendance`                |
| Language/runtime  | Node                                      |
| Root Directory    | `integrations/aiface-attendance-receiver` |
| Build Command     | `npm ci --omit=dev --ignore-scripts`      |
| Start Command     | `npm run start:render`                    |
| Instance Type     | Free, for testing                         |
| Health Check Path | `/health`                                 |

For Blueprint deployment instead, select this directory's `render.yaml` as the Blueprint path. It creates only the separate attendance receiver, with private secret values entered in Render's dashboard. Do not use both methods to create duplicate receivers.

## 3. Add Environment values in Render

The private ready-to-copy values are in `.tmp/supabase-migration-jhhiwyvrhfhvvougkqmm/attendance-receiver.render.env`. Use Render's environment editor/Add from .env option, or enter them individually. This file contains broker credentials and the attendance webhook secret; keep it private. No Supabase management access token or service-role key is needed.

| Variable                           | Purpose/value                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `NODE_VERSION`                     | `22` (latest available Node 22 release)                                         |
| `MQTT_URL`                         | `mqtt://62.72.43.204:1883`                                                      |
| `MQTT_USERNAME`                    | Your private broker username                                                    |
| `MQTT_PASSWORD`                    | Your private broker password                                                    |
| `MQTT_CLIENT_ID`                   | `simkit-aiface-render`                                                          |
| `ATTENDANCE_DEVICE_ID`             | `AYUE22065256`                                                                  |
| `ATTENDANCE_EVENT_TOPIC`           | `aiface/AYUE22065256/sub/stellar`                                               |
| `ATTENDANCE_COMMAND_TOPIC`         | `aiface/AYUE22065256/pub/stellar`                                               |
| `ATTENDANCE_DEVICE_WEBHOOK_URL`    | `https://jhhiwyvrhfhvvougkqmm.supabase.co/functions/v1/attendance-device-event` |
| `ATTENDANCE_DEVICE_WEBHOOK_SECRET` | Existing private attendance webhook secret                                      |
| `RECEIVER_DB`                      | `/tmp/simkit-attendance/receiver.sqlite`                                        |

Render supplies `PORT`; do not hardcode it. Do not add the receiver secrets to your Vercel frontend or `VITE_` variables.

## 4. Deploy and verify

1. Deploy. Wait for **Live**.
2. Open `https://YOUR-RENDER-SERVICE.onrender.com/health`. HTTP 200 establishes process liveness only; it does not establish device connectivity.
3. Logs should show `Attendance receiver subscribed to the confirmed device topic.` and then `Device heartbeat delivered to Supabase.`
4. Refresh Manager Attendance. Its device status should show online while the receiver is running and actual device replies are received.
5. Scan an employee whose device enrollment ID is already registered in SimKit. Check entry time and supplied photo. ID `9002` still requires its separate device registration step.
6. Tell the project owner the service URL. Stop the temporary local receiver after verifying the hosted service, to avoid duplicate listeners.

No inbound scan endpoint is exposed by this Node service. Its public HTTP endpoint is only a liveness check; all device data comes through its MQTT connection and is forwarded to the existing authenticated Supabase Edge Function.

## Production deployment

For uninterrupted attendance, run this receiver on the existing VPS using `README.md`, or choose a Render service that stays running and a persistent disk for its queue. A paid instance alone still has an ephemeral filesystem without a disk; point `RECEIVER_DB` to the disk mount path. Photos remain in process memory until upload and can be lost on restart before upload, as documented in the receiver README. The observed device QoS 0 messages also cannot be recovered by MQTT while the receiver is disconnected.

Supabase can remain on Free within its quotas. GitHub/Vercel deployment of the website does not deploy this separate receiver; Render owns its service lifecycle.
