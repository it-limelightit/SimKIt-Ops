import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

let handler, state;
const originalDeno = globalThis.Deno;
const employee = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000002";
const encode = (source) =>
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
globalThis.__hrMock = {
  async manager(req) {
    if (req.headers.get("authorization") !== "Bearer hardik") throw new Error("Sign in required");
    return { admin, user };
  },
  async body(req) {
    return req.json();
  },
  checked(value) {
    if (value.error) throw new Error(value.error.message);
    return value.data;
  },
  json(value, status = 200) {
    return Response.json(value, { status });
  },
  HttpError: class extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
  async publishPending() {
    state.published++;
    return { configured: true, sent: 1 };
  },
  serve(callback) {
    handler = async (req) => {
      try {
        return await callback(req);
      } catch (e) {
        return Response.json({ error: e.message }, { status: e.status || 400 });
      }
    };
  },
};
const admin = {
  auth: {
    admin: {
      async createUser(input) {
        state.created.push(input);
        return { data: { user: { id: accountId } }, error: null };
      },
      async deleteUser(id) {
        state.deleted.push(id);
        return { error: state.cleanupFails ? { message: "failed" } : null };
      },
    },
  },
  from() {
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async single() {
        return { data: { attendance_employee_id: employee }, error: null };
      },
      async maybeSingle() {
        return {
          data: { auth_user_id: state.committed ? accountId : null },
          error: state.verifyFails ? { message: "unknown" } : null,
        };
      },
    };
  },
};
const user = {
  async rpc(name) {
    state.rpcs.push(name);
    if (name === "hr_assert_access")
      return state.allowed
        ? { data: null, error: null }
        : { error: { message: "HR manager access required" } };
    if (name === "hr_provision_context")
      return {
        data: {
          id: employee,
          email: "employee@example.com",
          name: "Sample",
          mobile: "9876543210",
          app_access: state.workspace,
          attendance_employee_id: employee,
        },
        error: null,
      };
    if (name === "hr_attach_login")
      return state.linkFails
        ? { error: { message: "Link failed" } }
        : { data: accountId, error: null };
    return { data: "pending", error: null };
  },
};
let source = readFileSync(
  new URL("../supabase/functions/hr-employee-account/index.ts", import.meta.url),
  "utf8",
)
  .replace(
    /import\s*\{[\s\S]*?\}\s*from\s*"\.\.\/_shared\/attendance\.ts";/,
    "const {body,checked,HttpError,json,manager,publishPending,serve}=globalThis.__hrMock;",
  )
  .replace(
    'import { uuid } from "../_shared/attendance-validation.ts";',
    'const uuid=(v)=>{if(typeof v!=="string"||!/^[-0-9a-f]{36}$/.test(v))throw new Error("Invalid employee");return v;};',
  );
await import(encode(source));
after(() => {
  globalThis.Deno = originalDeno;
  delete globalThis.__hrMock;
});
function reset(extra = {}) {
  state = {
    allowed: true,
    workspace: "employee",
    created: [],
    deleted: [],
    rpcs: [],
    published: 0,
    ...extra,
  };
}
const request = (input, token = "hardik") =>
  handler(
    new Request("https://test/hr-employee-account", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        employee_id: employee,
        revision: 1,
        password: "Temporary-password-123",
        ...input,
      }),
    }),
  );

test("HR authorization is checked before creating or publishing anything", async () => {
  reset({ allowed: false });
  const response = await request({});
  assert.equal(response.status, 400);
  assert.equal(state.created.length, 0);
  assert.equal(state.published, 0);
  reset();
  assert.equal((await request({}, "other")).status, 400);
  assert.equal(state.created.length, 0);
});
test("office account creation uses server-selected identity and never starts face enrollment", async () => {
  reset();
  const response = await request({ email: "forged@example.com", role: "supervisor" });
  assert.equal(response.status, 200);
  assert.equal(state.created[0].email, "employee@example.com");
  assert.equal(state.created[0].app_metadata.office_employee, true);
  assert.equal(state.published, 0);
  assert.deepEqual(state.rpcs, ["hr_assert_access", "hr_provision_context", "hr_attach_login"]);
});
test("field account creation uses field signup and does not add office metadata", async () => {
  reset({ workspace: "field_associate" });
  assert.equal((await request({})).status, 200);
  assert.deepEqual(state.created[0].app_metadata, {});
  assert.equal(state.created[0].user_metadata.role, "worker");
  assert.equal(state.published, 0);
});
test("failed linking removes only a provably unlinked new login", async () => {
  reset({ linkFails: true });
  assert.equal((await request({})).status, 400);
  assert.deepEqual(state.deleted, [accountId]);
  reset({ linkFails: true, committed: true });
  assert.equal((await request({})).status, 200);
  assert.deepEqual(state.deleted, []);
  reset({ linkFails: true, verifyFails: true });
  assert.equal((await request({})).status, 503);
  assert.deepEqual(state.deleted, []);
});
test("device enrollment is a separate explicit action", async () => {
  reset();
  assert.equal((await request({ action: "enroll" })).status, 200);
  assert.equal(state.created.length, 0);
  assert.equal(state.published, 1);
  assert.ok(state.rpcs.includes("hr_request_enrollment"));
});
