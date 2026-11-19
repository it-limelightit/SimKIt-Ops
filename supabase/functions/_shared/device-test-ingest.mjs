const maxBytes = 64 * 1024;
const identifier = /^[a-zA-Z0-9._:-]{1,128}$/;
const stepStatuses = new Set(["PASS", "FAIL", "SKIP"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function parseReport(value) {
  if (!record(value)) throw new Error("Expected a JSON report object");
  const mac =
    typeof value.mac === "string" ? value.mac.trim().replace(/[:-]/g, "").toUpperCase() : "";
  if (!/^[\dA-F]{12}$/.test(mac)) throw new Error("Expected a 12-digit hexadecimal MAC address");
  if (typeof value.session !== "string" || !identifier.test(value.session)) {
    throw new Error("Invalid session identifier");
  }
  if (value.overall !== "PASS" && value.overall !== "FAIL")
    throw new Error("Expected PASS or FAIL for overall");
  if (typeof value.test_fw !== "string" || !value.test_fw.trim() || value.test_fw.length > 128) {
    throw new Error("Invalid test firmware version");
  }
  if (
    value.existing_id != null &&
    (typeof value.existing_id !== "string" || value.existing_id.length > 128)
  ) {
    throw new Error("Invalid existing DM ID");
  }
  if (!Number.isFinite(value.duration_s) || value.duration_s < 0) {
    throw new Error("Invalid test duration");
  }
  if (
    !record(value.steps) ||
    !Object.keys(value.steps).length ||
    Object.entries(value.steps).some(
      ([step, status]) => !identifier.test(step) || !stepStatuses.has(status),
    )
  ) {
    throw new Error("Expected named steps with PASS, FAIL or SKIP results");
  }
  for (const field of ["notes", "readings"]) {
    if (value[field] != null && !record(value[field]))
      throw new Error(`Expected an object for ${field}`);
  }
  if (
    value.report_id != null &&
    (typeof value.report_id !== "string" || !identifier.test(value.report_id))
  ) {
    throw new Error("Invalid report ID");
  }

  const report = { ...value, mac };
  if (value.tested_at != null) {
    const timestamp =
      typeof value.tested_at === "string" &&
      /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
        value.tested_at,
      );
    const date = timestamp && new Date(`${timestamp[1]}T00:00:00Z`);
    if (
      !date ||
      !Number.isFinite(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== timestamp[1] ||
      timestamp[1].startsWith("0000") ||
      !Number.isFinite(Date.parse(value.tested_at))
    ) {
      throw new Error("Expected a valid test timestamp with a UTC offset");
    }
    const utc = new Date(value.tested_at).toISOString();
    if (!/^\d{4}-/.test(utc) || utc.startsWith("0000"))
      throw new Error("Test timestamp is out of range");
    report.tested_at = utc;
  }
  return report;
}

async function matchesSecret(configured, provided) {
  if (!provided) return false;
  const encoder = new TextEncoder();
  const digest = async (text) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  const [expected, actual] = await Promise.all([digest(configured), digest(provided)]);
  return expected.reduce((difference, byte, index) => difference | (byte ^ actual[index]), 0) === 0;
}

function reply(status, body, headers) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function readBody(request) {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return body + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
}

export async function handleDeviceTest(request, secret, saveReport) {
  if (request.method !== "POST") return reply(405, { error: "POST required" }, { Allow: "POST" });
  if (!secret) return reply(503, { error: "Device test ingest is not configured" });
  if (!(await matchesSecret(secret, request.headers.get("x-device-test-key")))) {
    return reply(401, { error: "Invalid device test key" });
  }

  let value;
  try {
    const body = await readBody(request);
    if (body === null) return reply(413, { error: "Report exceeds 64 KiB" });
    value = JSON.parse(body);
  } catch {
    return reply(400, { error: "Invalid JSON report" });
  }

  let report;
  try {
    report = parseReport(value);
  } catch (error) {
    return reply(400, { error: error.message });
  }

  let saved;
  try {
    saved = await saveReport(report);
  } catch {
    return reply(503, { error: "Could not save the report. Retry with the same payload." });
  }
  if (saved.status === "conflict") {
    return reply(409, { error: "This report ID already belongs to a different payload" });
  }
  return reply(saved.status === "created" ? 201 : 200, saved);
}
