import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { handleDeviceTest } from "../supabase/functions/_shared/device-test-ingest.mjs";

const secret = "fixture-secret";
const report = {
  mac: "02:00:00:00:00:01",
  session: "92d857a480c9ed86",
  overall: "PASS",
  test_fw: "1.0.0",
  existing_id: "DM-200",
  duration_s: 32,
  steps: {
    mqtt: "PASS",
    vibration: "SKIP",
    encoder: "SKIP",
    proxy1: "SKIP",
    proxy2: "SKIP",
    ct: "SKIP",
    modbus: "SKIP",
    state: "SKIP",
    lte: "SKIP",
    led_buzzer: "SKIP",
    board: "SKIP",
  },
  notes: { mqtt: "Broker connected" },
  readings: { wifi_rssi: -92 },
};

function request(body, key = secret) {
  return new Request("https://example.test/functions/v1/device-test-ingest", {
    method: "POST",
    headers: { "x-device-test-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("rejects invalid or unauthorized reports before calling storage", async () => {
  const save = () => assert.fail("Invalid reports must never reach storage");
  assert.equal((await handleDeviceTest(request(report, "wrong"), secret, save)).status, 401);
  assert.equal(
    (await handleDeviceTest(request({ ...report, mac: "invalid" }), secret, save)).status,
    400,
  );
  assert.equal(
    (await handleDeviceTest(request({ ...report, steps: { mqtt: "OK" } }), secret, save)).status,
    400,
  );
  assert.equal(
    (await handleDeviceTest(request({ ...report, overall: "PASS_m" }), secret, save)).status,
    400,
  );
  const badTime = { ...report, tested_at: "2026-02-29T10:30:00+05:30" };
  assert.equal((await handleDeviceTest(request(badTime), secret, save)).status, 400);
  const largeReport = { ...report, notes: { mqtt: "a".repeat(64 * 1024) } };
  assert.equal((await handleDeviceTest(request(largeReport), secret, save)).status, 413);
  const failedStorage = () => {
    throw new Error("Database offline");
  };
  assert.equal((await handleDeviceTest(request(report), secret, failedStorage)).status, 503);
});

test("saves reports once, retains an earlier failure and restricts access to inventory managers", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE FUNCTION public.field_inventory_manager() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT current_setting('test.manager', true) = 'yes' $$;
    `);
    for (const migration of [
      "20261119120000_device_test_history.sql",
      "20261120140000_device_test_manual_pass.sql",
    ]) {
      await db.exec(
        readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"),
      );
    }

    const save = async (payload) => {
      const { rows } = await db.query("SELECT public.ingest_device_test($1) AS saved", [
        JSON.stringify(payload),
      ]);
      return rows[0].saved;
    };
    const post = (payload) => handleDeviceTest(request(payload), secret, save);
    const failed = {
      ...report,
      existing_id: "DM-OLD",
      report_id: "attempt-1",
      overall: "FAIL",
      tested_at: "2026-11-19T10:30:00+05:30",
      steps: { ...report.steps, encoder: "FAIL" },
    };
    const retest = {
      ...report,
      tested_at: "2026-11-19T05:30:00Z",
      steps: { ...report.steps, encoder: "PASS_m", modbus: "NOT_RUN" },
      original_steps: { encoder: "FAIL", modbus: "NOT_RUN" },
      notes: { encoder: "No edges on channel B" },
    };
    await db.exec("SET ROLE service_role");
    const approved = await post(retest);
    assert.equal(approved.status, 201);
    const approvedRetry = await post(retest);
    assert.equal(approvedRetry.status, 200);
    assert.equal((await approvedRetry.json()).id, (await approved.json()).id);
    const first = await post(failed);
    assert.equal(first.status, 201);
    const retry = await post({ ...failed, mac: "020000000001", tested_at: "2026-11-19T05:00:00Z" });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).id, (await first.json()).id);
    assert.equal((await post({ ...failed, existing_id: "DM-CHANGED" })).status, 409);

    const legacy = { ...report, mac: "020000000002", existing_id: "" };
    const legacyFirst = await post(legacy);
    assert.equal(legacyFirst.status, 201);
    assert.equal((await post(legacy)).status, 200);
    assert.ok((await legacyFirst.json()).received_at);

    await db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(
      db.query("SELECT * FROM public.device_test_devices()"),
      /permission denied/,
    );
    await db.exec("RESET ROLE; SET ROLE authenticated");
    await assert.rejects(db.query("SELECT * FROM public.device_test_devices()"), /manager access/);
    await assert.rejects(db.query("SELECT public.ingest_device_test('{}')"), /permission denied/);
    await db.exec("SET test.manager = 'yes'");
    await assert.rejects(db.query("SELECT * FROM public.device_test_runs"), /permission denied/);
    const { rows: devices } = await db.query("SELECT * FROM public.device_test_devices('dm-old')");
    assert.equal(devices.length, 1);
    assert.equal(devices[0].dm_id, "DM-200");
    assert.equal(devices[0].overall, "PASS_m");
    assert.equal(Number(devices[0].run_count), 2);
    const { rows: history } = await db.query("SELECT * FROM public.device_test_history($1)", [
      devices[0].mac,
    ]);
    assert.deepEqual(
      history.map(({ report }) => report.steps.encoder),
      ["PASS_m", "FAIL"],
    );
    assert.equal(history[0].report.overall, "PASS");
    assert.equal(history[0].report.steps.modbus, "NOT_RUN");
    assert.deepEqual(history[0].report.original_steps, retest.original_steps);
    assert.deepEqual(history[0].report.notes, retest.notes);
    assert.equal(history[1].report.tested_at, "2026-11-19T05:00:00.000Z");
    assert.deepEqual(history[1].report.readings, report.readings);
    assert.ok(history[1].received_at);

    const { rows: unassigned } = await db.query(
      "SELECT * FROM public.device_test_devices('02:00:00:00:00:02')",
    );
    assert.equal(unassigned[0].dm_id, null);
    assert.equal(unassigned[0].tested_at, null);
    assert.equal(unassigned[0].overall, "PASS");
  } finally {
    await db.close();
  }
});
