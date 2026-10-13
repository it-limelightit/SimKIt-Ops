import { test, before, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import ts from "typescript";
const handlers = {};
const env = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-test",
  SUPABASE_ANON_KEY: "anon-test",
  ATTENDANCE_DEVICE_ID: "AYUE22065256",
  ATTENDANCE_EVENT_TOPICS: "scan,heartbeat,ack",
  ATTENDANCE_DEVICE_WEBHOOK_SECRET: "device-test-secret",
  ATTENDANCE_CRON_SECRET: "cron-test-secret",
  ATTENDANCE_EMAIL_WEBHOOK_SECRET: "email-test-secret",
};
let state, current;
const originalFetch = globalThis.fetch;
const originalDeno = globalThis.Deno;
const encode = (source) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
function builder(table) {
  let op = "select";
  const filters = {};
  const result = {
    select() {
      return this;
    },
    eq(k, v) {
      filters[k] = v;
      return this;
    },
    in(k, v) {
      filters[k] = v;
      return this;
    },
    neq() {
      return this;
    },
    lte() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      return this;
    },
    insert(value) {
      op = "insert";
      state.writes.push({ table, op, value });
      return this;
    },
    delete() {
      op = "delete";
      state.writes.push({ table, op });
      return this;
    },
    update(value) {
      op = "update";
      state.writes.push({ table, op, value });
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(state.table(table, op, filters)).then(resolve, reject);
    },
  };
  return result;
}
const client = {
  auth: {
    admin: {
      createUser: async (input) => { state.authOps.push({ action: "create", input }); return state.createAccount(input); },
      getUserById: async (id) => state.getAccount(id),
      updateUserById: async (id, input) => { state.authOps.push({ action: "update", id, input }); return state.updateAccount(id, input); },
      deleteUser: async (id) => { state.authOps.push({ action: "delete", id }); return { error: null }; },
    },
    getUser: async (token) => ({
      data: {
        user:
          token === "valid-manager"
            ? { id: "manager", email: state.email, email_confirmed_at: state.confirmedAt }
            : null,
      },
      error: null,
    }),
  },
  from: builder,
  rpc: async (name, args) => {
    state.calls.push({ name, args });
    return state.rpc(name, args);
  },
  storage: {
    from: () => ({
      remove: async (paths) => {
        state.removed.push(...paths);
        return state.removeResult;
      },
      upload: async () => state.uploadResult,
      list: async (_path, options) => ({ data: state.list(options), error: null }),
      createSignedUrl: async (path, seconds) => {
        state.signed.push({ path, seconds });
        return { data: { signedUrl: "https://test.supabase.co/private" }, error: null };
      },
    }),
  },
};
function reset() {
  state = {
    email: "admin@limelightit.io",
    confirmedAt: "2026-10-01T00:00:00Z",
    calls: [],
    authOps: [],
    createdAppMetadata: null,
    createAccount: (input) => { state.createdAppMetadata = input.app_metadata; return { data: { user: { id: "office-auth" } }, error: null }; },
    getAccount: () => ({ data: { user: { app_metadata: state.createdAppMetadata || {} } }, error: null }),
    updateAccount: () => ({ data: { user: {} }, error: null }),
    writes: [],
    removed: [],
    signed: [],
    list: () => [],
    table: (table, op) => ({
      data: table === "user_roles" ? [{ role: "supervisor" }] : op === "select" ? null : [],
      error: null,
    }),
    rpc: () => ({ data: null, error: null }),
    removeResult: { data: [], error: null },
    uploadResult: { data: { path: "photo.jpg" }, error: null },
  };
}
before(async () => {
  reset();
  globalThis.Deno = {
    env: { get: (name) => env[name] },
    serve: (handler) => {
      handlers[current] = handler;
    },
  };
  globalThis.__attendanceCreateClient = () => client;
  const root = new URL("../supabase/functions/", import.meta.url);
  const mqtt = encode(readFileSync(new URL("_shared/attendance-mqtt.ts", root), "utf8"));
  const common = encode(
    readFileSync(new URL("_shared/attendance.ts", root), "utf8")
      .replaceAll("./attendance-mqtt.ts", mqtt)
      .replace(
        /import \{ createClient \} from [^;]+;/,
        "const createClient = globalThis.__attendanceCreateClient;",
      ),
  );
  const validation = encode(
    readFileSync(new URL("_shared/attendance-validation.ts", root), "utf8"),
  );
  for (const name of [
    "attendance-employee-account",
    "attendance-enroll-user",
    "attendance-command-retry",
    "attendance-device-event",
    "attendance-photo-access",
    "attendance-photo-cleanup",
    "attendance-leave-email",
  ]) {
    current = name;
    const sourceUrl =
      process.env.ATTENDANCE_TEST_BUNDLES === "1"
        ? new URL(`../dashboard-deploy/${name}.ts`, root)
        : new URL(`${name}/index.ts`, root);
    const source = readFileSync(sourceUrl, "utf8")
      .replaceAll("../_shared/attendance.ts", common)
      .replaceAll("../_shared/attendance-validation.ts", validation)
      .replace(
        /import \{ createClient \} from [^;]+;/,
        "const createClient = globalThis.__attendanceCreateClient;",
      );
    await import(encode(source));
  }
});
afterEach(() => {
  reset();
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(env))
    if (
      key.startsWith("ATTENDANCE_MQTT_") ||
      key === "ATTENDANCE_PUBLISH_MODE" ||
      key === "ATTENDANCE_COMMAND_TOPIC"
    )
      delete env[key];
  delete globalThis.Deno.connect;
});
after(() => {
  globalThis.Deno = originalDeno;
  delete globalThis.__attendanceCreateClient;
});
const request = (name, input = {}, headers = {}) =>
  handlers[name](
    new Request("https://test/functions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
    }),
  );
test("scheduled retries reject unauthenticated callers without leasing device commands", async () => {
  for (const headers of [{}, { "x-attendance-secret": "wrong" }]) {
    assert.equal((await request("attendance-command-retry", {}, headers)).status, 401);
    assert.equal(state.calls.length, 0);
  }
});
test("scheduled retries leave commands pending when MQTT credentials are incomplete", async () => {
  env.ATTENDANCE_PUBLISH_MODE = "mqtt";
  const response = await request(
    "attendance-command-retry",
    {},
    {
      "x-attendance-secret": env.ATTENDANCE_CRON_SECRET,
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { configured: false, sent: 0 });
  assert.equal(state.calls.length, 0);
});
test("enrollment can publish directly from the Edge Function without using the HTTP bridge", async () => {
  Object.assign(env, {
    ATTENDANCE_PUBLISH_MODE: "mqtt",
    ATTENDANCE_MQTT_HOST: "mqtt.test",
    ATTENDANCE_MQTT_PORT: "1883",
    ATTENDANCE_MQTT_TLS: "false",
    ATTENDANCE_MQTT_USERNAME: "user",
    ATTENDANCE_MQTT_PASSWORD: "pass",
    ATTENDANCE_COMMAND_TOPIC: "device/command",
    ATTENDANCE_MQTT_ENROLL_TEMPLATE: '{"operation":"TEST_ONLY","id":"{{enroll_id}}"}',
  });
  const employee = "00000000-0000-4000-8000-000000000004";
  state.rpc = (name) => ({
    data:
      name === "attendance_save_employee"
        ? employee
        : name === "attendance_claim_commands"
          ? [
              {
                id: employee,
                lease_token: employee,
                name: "Rahul",
                department: "software",
                enroll_id: "104",
              },
            ]
          : null,
    error: null,
  });
  const queued = [];
  let closed = false;
  let connected = false;
  globalThis.Deno.connect = async (options) => {
    assert.equal(options.hostname, "mqtt.test");
    connected = true;
    return {
      write: async (bytes) => {
        if (bytes[0] === 0x10) queued.push(Uint8Array.of(0x20, 2, 0, 0));
        if (bytes[0] === 0x32) queued.push(Uint8Array.of(0x40, 2, 0, 2));
        return bytes.length;
      },
      read: async (target) => {
        const head = queued[0];
        if (!head) return null;
        const count = Math.min(target.length, head.length);
        target.set(head.subarray(0, count));
        if (count === head.length) queued.shift();
        else queued[0] = head.subarray(count);
        return count;
      },
      close: () => {
        closed = true;
      },
    };
  };
  globalThis.fetch = async () => {
    throw new Error("HTTP bridge must not be used");
  };
  const response = await request(
    "attendance-enroll-user",
    { name: "Rahul", department: "software", enroll_id: "104" },
    { authorization: "Bearer valid-manager" },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).publishing.sent, 1);
  assert.ok(connected && closed);
  assert.equal(
    state.calls.find((c) => c.name === "attendance_mqtt_finish_command").args._outcome,
    "published",
  );
});
test("attendance endpoints reject missing/invalid JWTs and unapproved accounts", async () => {
  assert.equal((await request("attendance-enroll-user")).status, 401);
  assert.equal(
    (await request("attendance-photo-access", {}, { authorization: "Bearer invalid" })).status,
    401,
  );
  state.email = "other-manager@example.com";
  assert.equal(
    (await request("attendance-enroll-user", {}, { authorization: "Bearer valid-manager" })).status,
    403,
  );
  assert.equal(state.calls.length, 0);
});

test("photo and enrollment access requires one of the three verified email accounts", async () => {
  for (const email of [
    "admin@limelightit.com",
    "other@example.com",
    "patidarnit21@gmail.com",
    "admin@limelightit.io.attacker.test",
    "patidarnit21+other@gmail.com",
  ]) {
    state.email = email;
    for (const endpoint of ["attendance-photo-access", "attendance-enroll-user"])
      assert.equal(
        (await request(endpoint, {}, { authorization: "Bearer valid-manager" })).status,
        403,
      );
  }
  state.email = "admin@limelightit.io";
  state.confirmedAt = null;
  assert.equal(
    (await request("attendance-photo-access", {}, { authorization: "Bearer valid-manager" }))
      .status,
    403,
  );
  assert.equal(state.signed.length, 0);
  assert.equal(state.calls.length, 0);
  state.confirmedAt = "2026-10-01T00:00:00Z";
  for (const email of ["nitsanghani1@gmail.com", "ADMIN@LIMELIGHTIT.IO", "tarun@limelightit.io"]) {
    state.email = email;
    // Authentication passes, then the missing event ID is rejected by input validation.
    assert.equal(
      (await request("attendance-photo-access", {}, { authorization: "Bearer valid-manager" }))
        .status,
      400,
    );
  }
});
test("device ingestion fails closed for bad credentials, device, or topic", async () => {
  assert.equal((await request("attendance-device-event")).status, 401);
  assert.equal(
    (
      await request(
        "attendance-device-event",
        { device_id: "other" },
        { "x-attendance-secret": env.ATTENDANCE_DEVICE_WEBHOOK_SECRET },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "attendance-device-event",
        { device_id: env.ATTENDANCE_DEVICE_ID, topic: "other" },
        { "x-attendance-secret": env.ATTENDANCE_DEVICE_WEBHOOK_SECRET },
      )
    ).status,
    403,
  );
  assert.equal(state.calls.length, 0);
});
test("historical heartbeats cannot create live health evidence", async () => {
  const data = {
    device_id: env.ATTENDANCE_DEVICE_ID,
    topic: "heartbeat",
    kind: "heartbeat",
    observed_at: new Date(Date.now() - 3600000).toISOString(),
  };
  const headers = { "x-attendance-secret": env.ATTENDANCE_DEVICE_WEBHOOK_SECRET };
  assert.equal((await request("attendance-device-event", data, headers)).status, 400);
  assert.equal(state.calls.length, 0);
  data.observed_at = new Date().toISOString();
  assert.equal((await request("attendance-device-event", data, headers)).status, 200);
  assert.equal(state.calls[0].name, "attendance_heartbeat");
});
test("device profile confirms only a matched employee and does not store an enrollment photo", async () => {
  const input = {
    kind: "device_profile",
    device_id: env.ATTENDANCE_DEVICE_ID,
    topic: "ack",
    enroll_id: "9003",
    observed_at: new Date().toISOString(),
  };
  const headers = { "x-attendance-secret": env.ATTENDANCE_DEVICE_WEBHOOK_SECRET };
  state.rpc = () => ({ data: true, error: null });
  const response = await request("attendance-device-event", input, headers);
  assert.deepEqual(await response.json(), { accepted: true, confirmed: true });
  assert.equal(state.calls[0].name, "attendance_confirm_device_profile");
  assert.equal(state.calls[0].args._source, "profile");
  assert.equal(state.writes.length, 0);
  state.rpc = () => ({ data: false, error: null });
  assert.equal(
    (await (await request("attendance-device-event", input, headers)).json()).confirmed,
    false,
  );
});
test("only validated scans can confirm enrollment; rejected scans remain reviewable", async () => {
  const input = {
    kind: "scan",
    device_id: env.ATTENDANCE_DEVICE_ID,
    topic: "scan",
    event_id: "evidence",
    enroll_id: "9003",
    recognized: true,
    scanned_at: new Date().toISOString(),
  };
  const headers = { "x-attendance-secret": env.ATTENDANCE_DEVICE_WEBHOOK_SECRET };
  state.rpc = (name) => ({
    data:
      name === "attendance_ingest_scan"
        ? { id: "event", state: "valid", expires_at: new Date().toISOString() }
        : true,
    error: null,
  });
  assert.equal((await request("attendance-device-event", input, headers)).status, 200);
  assert.equal(state.calls[1].args._source, "scan");
  state.calls = [];
  state.rpc = () => ({ data: { id: "event", state: "failed_recognition" }, error: null });
  assert.equal((await request("attendance-device-event", input, headers)).status, 200);
  assert.equal(state.calls.length, 1);
});
test("attendance is saved even when image upload fails; same event is retryable", async () => {
  const id = "00000000-0000-4000-8000-000000000004";
  state.rpc = () => ({
    data: {
      id,
      state: "valid",
      duplicate: false,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    },
    error: null,
  });
  state.uploadResult = { data: null, error: { message: "upload failed" } };
  const input = {
    device_id: env.ATTENDANCE_DEVICE_ID,
    topic: "scan",
    kind: "scan",
    event_id: "stable-id",
    enroll_id: "104",
    recognized: true,
    scanned_at: new Date().toISOString(),
    photo_mime: "image/jpeg",
    photo_base64: Buffer.from([255, 216, 255, 0]).toString("base64"),
  };
  const response = await request("attendance-device-event", input, {
    "x-attendance-secret": env.ATTENDANCE_DEVICE_WEBHOOK_SECRET,
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).photo, "retry_needed");
  assert.equal(state.calls[0].name, "attendance_ingest_scan");
  assert.ok(state.writes.some((w) => w.table === "attendance_photos" && w.op === "insert"));
});
test("expired delayed photos are not uploaded, and expired photo access is denied", async () => {
  state.rpc = () => ({
    data: { id: "event", state: "valid", expires_at: new Date(Date.now() - 1000).toISOString() },
    error: null,
  });
  const response = await request(
    "attendance-device-event",
    {
      device_id: env.ATTENDANCE_DEVICE_ID,
      topic: "scan",
      kind: "scan",
      event_id: "old",
      enroll_id: "104",
      recognized: true,
      scanned_at: new Date().toISOString(),
      photo_base64: "old",
    },
    { "x-attendance-secret": env.ATTENDANCE_DEVICE_WEBHOOK_SECRET },
  );
  assert.equal((await response.json()).photo, "not_stored");
  assert.equal(state.writes.length, 0);
  state.table = (table) => ({
    data:
      table === "user_roles"
        ? { role: "supervisor" }
        : {
            status: "available",
            storage_path: "expired.jpg",
            expires_at: new Date(Date.now() - 1000).toISOString(),
          },
    error: null,
  });
  assert.equal(
    (
      await request(
        "attendance-photo-access",
        { event_id: "00000000-0000-4000-8000-000000000004" },
        { authorization: "Bearer valid-manager" },
      )
    ).status,
    410,
  );
  assert.equal(state.signed.length, 0);
});
test("photo URL lifetime is capped by remaining photo retention", async () => {
  state.table = (table) => ({
    data:
      table === "user_roles"
        ? { role: "supervisor" }
        : {
            status: "available",
            storage_path: "photo.jpg",
            expires_at: new Date(Date.now() + 12000).toISOString(),
          },
    error: null,
  });
  assert.equal(
    (
      await request(
        "attendance-photo-access",
        { event_id: "00000000-0000-4000-8000-000000000004" },
        { authorization: "Bearer valid-manager" },
      )
    ).status,
    200,
  );
  assert.ok(state.signed[0].seconds <= 12 && state.signed[0].seconds > 0);
});
test("cleanup only marks photos deleted after Storage removal succeeds", async () => {
  state.table = (table, op) => ({
    data:
      op === "select" && !state.writes.length
        ? [{ event_id: "event", storage_path: "expired.jpg" }]
        : [],
    error: null,
  });
  state.removeResult = { data: null, error: { message: "Storage unavailable" } };
  const response = await request(
    "attendance-photo-cleanup",
    {},
    { "x-attendance-secret": env.ATTENDANCE_CRON_SECRET },
  );
  assert.equal(response.status, 503);
  assert.equal(state.writes.length, 0);
  state.removeResult = { data: [], error: null };
  assert.equal(
    (
      await request(
        "attendance-photo-cleanup",
        {},
        { "x-attendance-secret": env.ATTENDANCE_CRON_SECRET },
      )
    ).status,
    200,
  );
  assert.equal(state.writes[0].value.status, "deleted");
});
test("nightly cleanup processes every expired batch without modifying attendance tables", async () => {
  const photos = Array.from({ length: 260 }, (_, i) => ({
    event_id: String(i),
    storage_path: `${i}.jpg`,
  }));
  state.table = (_table, op) => ({
    data:
      op === "select"
        ? photos.filter((p) => !state.removed.includes(p.storage_path)).slice(0, 100)
        : [],
    error: null,
  });
  const response = await request(
    "attendance-photo-cleanup",
    {},
    { "x-attendance-secret": env.ATTENDANCE_CRON_SECRET },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, 260);
  assert.equal(state.removed.length, 260);
  assert.ok(state.writes.every((w) => w.table === "attendance_photos"));
});

test("02:00 IST cleanup removes yesterday's orphan photos across pages and keeps today's photos", async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-10-10T02:00:00+05:30");
  try {
    const files = [
      ...Array.from({ length: 105 }, (_, i) => ({
        name: `old-${i}.jpg`,
        created_at: "2026-10-09T23:59:59+05:30",
      })),
      { name: "today.jpg", created_at: "2026-10-10T00:01:00+05:30" },
    ];
    state.table = () => ({ data: [], error: null });
    state.list = ({ offset, limit }) =>
      files.filter((f) => !state.removed.includes(f.name)).slice(offset, offset + limit);
    const response = await request(
      "attendance-photo-cleanup",
      {},
      { "x-attendance-secret": env.ATTENDANCE_CRON_SECRET },
    );
    assert.equal(response.status, 200);
    assert.equal(state.removed.length, 105);
    assert.ok(!state.removed.includes("today.jpg"));
  } finally {
    Date.now = originalNow;
  }
});

test("email gateway signatures and freshness are verified before leave writes", async () => {
  const input = {
    message_id: "mail-1",
    sender: "a@example.test",
    start_date: "2026-10-12",
    end_date: "2026-10-13",
    reason: "Leave",
  };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", env.ATTENDANCE_EMAIL_WEBHOOK_SECRET)
    .update(`${timestamp}.${JSON.stringify(input)}`)
    .digest("hex");
  assert.equal(
    (
      await request("attendance-leave-email", input, {
        "x-attendance-timestamp": timestamp,
        "x-attendance-signature": "0".repeat(64),
      })
    ).status,
    401,
  );
  assert.equal(state.calls.length, 0);
  assert.equal(
    (
      await request("attendance-leave-email", input, {
        "x-attendance-timestamp": timestamp,
        "x-attendance-signature": signature,
      })
    ).status,
    200,
  );
  assert.equal(state.calls[0].name, "attendance_email_leave");
});

const officeInput = { action: 'create', name: 'Office Employee', department: 'software', enroll_id: '9901', email: 'office@example.test', password: 'test-password-only', employment_start: '2026-10-01', email_verified: true };
test('office account endpoint rejects unauthorized requests and invalid credentials before Auth writes', async () => {
  assert.equal((await request('attendance-employee-account',officeInput)).status,401);
  for(const changes of [{email:''},{password:''},{password:'short'},{employment_start:'2030-01-01'},{department:'hardware'}]){
    assert.equal((await request('attendance-employee-account',{...officeInput,...changes},{authorization:'Bearer valid-manager'})).status,400);
  }
  assert.equal(state.authOps.length,0);
});
test('office account creation links server-owned metadata and never stores password in employee RPC', async () => {
  const response=await request('attendance-employee-account',officeInput,{authorization:'Bearer valid-manager'});
  assert.equal(response.status,200);
  const saved=state.calls.find(c=>c.name==='attendance_save_employee_account');
  assert.equal(saved.args._auth_user,'office-auth');
  assert.equal(state.authOps[0].input.app_metadata.office_employee,true);
  assert.equal(state.authOps[0].input.app_metadata.attendance_employee_id,saved.args._employee);
  assert.equal(JSON.stringify(state.calls).includes(officeInput.password),false);
  assert.equal(JSON.stringify(await response.json()).includes(officeInput.password),false);
});
test('failed employee save cleans up only the newly created office login', async () => {
  state.rpc=()=>({data:null,error:{message:'Duplicate enrollment ID'}});
  assert.equal((await request('attendance-employee-account',officeInput,{authorization:'Bearer valid-manager'})).status,400);
  assert.deepEqual(state.authOps.map(o=>o.action),['create','delete']);
});
test('duplicate Auth email does not reset an existing account or write employee records', async () => {
  state.createAccount=()=>({data:{user:null},error:{message:'Email exists'}});
  assert.equal((await request('attendance-employee-account',officeInput,{authorization:'Bearer valid-manager'})).status,409);
  assert.equal(state.calls.length,0);
  assert.deepEqual(state.authOps.map(o=>o.action),['create']);
});
test('editing linked office login keeps blank password and does not send enrollment commands', async () => {
  const employeeId='00000000-0000-4000-8000-000000000010';
  state.table=()=>({data:{auth_user_id:'office-auth',enroll_id:'9901',deleted_at:null},error:null});
  state.getAccount=()=>({data:{user:{app_metadata:{office_employee:true,attendance_employee_id:employeeId}}},error:null});
  assert.equal((await request('attendance-employee-account',{...officeInput,action:'update',employee_id:employeeId,password:''},{authorization:'Bearer valid-manager'})).status,200);
  assert.equal('password' in state.authOps[0].input,false);
  assert.deepEqual(state.calls.map(c=>c.name),['attendance_save_employee_account']);
});
test('office editing refuses to modify a linked field associate login', async () => {
  state.table=()=>({data:{auth_user_id:'field-auth',enroll_id:'9901',deleted_at:null},error:null});
  state.getAccount=()=>({data:{user:{app_metadata:{}}},error:null});
  assert.equal((await request('attendance-employee-account',{...officeInput,action:'update',employee_id:'00000000-0000-4000-8000-000000000010'},{authorization:'Bearer valid-manager'})).status,409);
  assert.equal(state.authOps.length,0); assert.equal(state.calls.length,0);
});
test('linking an existing manager preserves its password and all existing roles', async () => {
  const employeeId='00000000-0000-4000-8000-000000000030';
  const accountId='00000000-0000-4000-8000-000000000031';
  state.table=(table,op)=>({
    data:table==='profiles'?[{id:accountId,email:'info@limelightit.io',is_active:true}]
      :table==='attendance_employees'?{auth_user_id:null,department:'manager',deleted_at:null}
      :table==='user_roles'?[{role:'supervisor'}]:op==='select'?null:[],error:null,
  });
  state.getAccount=()=>({data:{user:{id:accountId,email:'info@limelightit.io',email_confirmed_at:'2026-10-01T00:00:00Z',app_metadata:{role:'manager'}}},error:null});
  state.updateAccount=(_id,input)=>({data:{user:{id:accountId,app_metadata:input.app_metadata}},error:null});
  const response=await request('attendance-employee-account',{
    action:'link_manager',employee_id:employeeId,email:'info@limelightit.io',
  },{authorization:'Bearer valid-manager'});
  assert.equal(response.status,200);
  assert.deepEqual(state.calls.map(c=>c.name),['attendance_link_manager_login']);
  assert.equal(state.calls[0].args._auth_user,accountId);
  assert.equal(state.authOps.length,1);
  assert.deepEqual(Object.keys(state.authOps[0].input),['app_metadata']);
  assert.equal(state.authOps[0].input.app_metadata.role,'manager');
  assert.equal(state.authOps[0].input.app_metadata.attendance_employee_id,employeeId);
  assert.equal(state.writes.some(w=>w.table==='user_roles'),false);
});
