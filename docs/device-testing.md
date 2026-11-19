# Device Testing

SimKit receives completed DataMeter factory tests over HTTPS. Managers open **Inventory → Device Testing** to search by DM ID or MAC, see the latest result, and open previous attempts. The dashboard displays the board's reported result alongside the checkpoint counts because factory firmware can report PASS with skipped steps.

## Supabase setup

The migration and `device-test-ingest` version 1 are deployed on project `jhhiwyvrhfhvvougkqmm`. Use the steps below when setting up another environment or releasing an update.

1. Apply [the Device Testing migration](../supabase/migrations/20261119120000_device_test_history.sql) to the SimKit project. For a dashboard deployment, open a new query in the [SQL Editor](https://supabase.com/dashboard/project/jhhiwyvrhfhvvougkqmm/sql/new), paste the full migration, and run it once. The migration uses the existing Inventory manager permission.
2. In [Edge Function Secrets](https://supabase.com/dashboard/project/jhhiwyvrhfhvvougkqmm/functions/secrets), set `DEVICE_TEST_INGEST_SECRET` to a long random value generated for this integration. Share it with the firmware team through a private channel.
3. Deploy the function from the repository root. The function's `verify_jwt = false` setting lets firmware call it without a user session. The function checks the dedicated secret before reading or saving a report.

   ```powershell
   npx supabase login
   npx supabase functions deploy device-test-ingest --project-ref jhhiwyvrhfhvvougkqmm
   ```

4. Verify that a sample POST receives HTTP 201, an identical retry receives HTTP 200 with the same ID, and an incorrect key receives HTTP 401. Use an agreed test board for a live test because successful reports become part of its history. Release the SimKit frontend through the existing app deployment process.

See the [Supabase deployment guide](https://supabase.com/docs/guides/functions/deploy) and [secrets guide](https://supabase.com/docs/guides/functions/secrets).

## What to give the firmware team

Send a POST after each completed PASS or FAIL, including after a retest.

```http
POST https://jhhiwyvrhfhvvougkqmm.supabase.co/functions/v1/device-test-ingest
Content-Type: application/json
X-Device-Test-Key: <dedicated secret shared privately>
```

Use the existing factory report format from the CSV's `report_json` column. This example uses an illustrative MAC and session.

```json
{
  "mac": "020000000001",
  "session": "b41abccdef123456",
  "report_id": "b41abccdef123456-1",
  "existing_id": "DM-200",
  "test_fw": "1.0.0",
  "overall": "PASS",
  "duration_s": 32,
  "tested_at": "2026-11-19T10:30:00+05:30",
  "steps": {
    "mqtt": "PASS",
    "vibration": "SKIP",
    "encoder": "SKIP",
    "proxy1": "SKIP",
    "proxy2": "SKIP",
    "ct": "SKIP",
    "modbus": "SKIP",
    "state": "SKIP",
    "lte": "SKIP",
    "led_buzzer": "SKIP",
    "board": "SKIP"
  },
  "notes": { "mqtt": "Broker connected" },
  "readings": { "wifi_rssi": -92, "proxy2_hits": 0 }
}
```

- Generate a new `report_id` for each completed attempt, even when a retest reuses the session. Keep the exact report and ID until delivery succeeds. Retry a timeout, HTTP 429, or HTTP 5xx with backoff using that same report.
- Omit `tested_at` when the board lacks a reliable clock. Otherwise send an ISO 8601 timestamp with seconds and a time zone. SimKit stores its receipt time in either case and displays times in IST.
- Send an empty string or omit `existing_id` for boards without a DM ID. The MAC is the board identity. Each attempt retains its own DM ID.
- Send `PASS`, `FAIL`, or `SKIP` for each checkpoint. Notes and readings are optional JSON objects. Keep the request body within 64 KiB.
- Legacy reports without a `report_id` are accepted. Identical legacy payloads for the same MAC count as one attempt.

| Response | Meaning                                                                                |
| -------- | -------------------------------------------------------------------------------------- |
| 201      | Saved. The response includes the stored ID and receipt time.                           |
| 200      | This report was already saved. The response includes the original ID and receipt time. |
| 400      | The report is invalid. Use the error message to fix the payload.                       |
| 401      | The ingest key is missing or incorrect.                                                |
| 409      | The same board already used this report ID with a different payload.                   |
| 413      | The report is larger than 64 KiB.                                                      |
| 503      | The report could not be saved. Retry with the same payload and ID.                     |
