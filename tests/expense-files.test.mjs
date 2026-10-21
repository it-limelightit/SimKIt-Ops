import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
let handler, state;
const oldDeno = globalThis.Deno;
const secrets = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test",
  EXPENSE_R2_ACCOUNT_ID: "account",
  EXPENSE_R2_BUCKET: "receipts",
  EXPENSE_R2_ACCESS_KEY_ID: "key",
  EXPENSE_R2_SECRET_ACCESS_KEY: "secret",
};
globalThis.Deno = {
  env: { get: (key) => (state?.missing === key ? undefined : secrets[key]) },
  serve: (fn) => {
    handler = fn;
  },
};
globalThis.financeFileMocks = {
  createClient: () => ({
    auth: {
      getUser: async (token) => ({
        data: {
          user:
            token === "valid"
              ? {
                  id: "user-one",
                  email: state.email,
                  email_confirmed_at: state.verified ? "now" : null,
                }
              : null,
        },
        error: null,
      }),
    },
    from: (table) => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () =>
        table === "profiles"
          ? { data: { is_active: state.active, name: state.name }, error: null }
          : table === "expense_claims"
            ? { data: state.claim, error: null }
            : { data: state.file, error: null },
      insert: async (value) => {
        state.saved = value;
        return { error: state.saveFails ? { message: "Failed" } : null };
      },
    }),
  }),
  AwsClient: class {
    async fetch(url, options) {
      state.r2.push({ url, options });
      if (options.method === "GET")
        return new Response(state.receipt ?? "%PDF-1.7 receipt", {
          status: state.downloadFails ? 503 : 200,
        });
      return new Response(null, { status: state.uploadFails ? 503 : 200 });
    }
    async sign(request) {
      state.signed = request.url;
      return request;
    }
  },
};
const source = readFileSync(
  new URL("../supabase/functions/expense-files/index.ts", import.meta.url),
  "utf8",
).replace(/^import .*;\r?\n/gm, "");
const js = ts.transpileModule(
  "const {createClient,AwsClient}=globalThis.financeFileMocks;\n" + source,
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText;
await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
beforeEach(() => {
  state = {
    email: "staff@example.test",
    verified: true,
    active: true,
    name: "Mayank Patel",
    r2: [],
    file: null,
    saveFails: false,
    uploadFails: false,
  };
});
after(() => {
  globalThis.Deno = oldDeno;
  delete globalThis.financeFileMocks;
});
const request = (body, token = "valid") =>
  handler(
    new Request("https://example.test/expense-files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  );
const upload = (bytes, type = "application/pdf", name = "receipt.pdf") => {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return request(form);
};
test("file API authenticates verified active sessions", async () => {
  assert.equal((await request({ id: "a" }, "invalid")).status, 401);
  state.verified = false;
  assert.equal((await request({ id: "a" })).status, 401);
  state.verified = true;
  state.active = false;
  assert.equal((await request({ id: "a" })).status, 403);
  assert.equal(state.r2.length, 0);
});
test("file upload validates content and maximum size before storage", async () => {
  assert.equal((await upload(new TextEncoder().encode("not PDF"))).status, 400);
  assert.equal((await upload(new Uint8Array(5000001))).status, 400);
  assert.equal((await upload(new TextEncoder().encode("%PDF-1.7 test"), "image/png")).status, 400);
  assert.equal(state.r2.length, 0);
});
test("upload uses a private owner key, stores hash and does not expose credentials", async () => {
  const response = await upload(new TextEncoder().encode("%PDF-1.7 test"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(Object.keys(result), ["id"]);
  assert.equal(state.saved.owner_id, "user-one");
  assert.match(
    state.saved.object_key,
    /^expenses\/mayank-patel_user-one\/[a-f0-9-]+_receipt\.pdf$/,
  );
  assert.match(state.saved.sha256, /^[a-f0-9]{64}$/);
  assert.equal(state.saved.size_bytes, 13);
});

test("upload folders use the authenticated profile name and readable sanitized filenames", async () => {
  state.name = "  Mayank / Patel ..  ";
  const form = new FormData();
  form.set(
    "file",
    new File(["%PDF-1.7 invoice"], "../Invoice Mayank.pdf", { type: "application/pdf" }),
  );
  form.set("name", "another-user");
  assert.equal((await request(form)).status, 200);
  assert.match(
    state.saved.object_key,
    /^expenses\/mayank-patel_user-one\/[a-f0-9-]+_.._Invoice_Mayank\.pdf$/,
  );
  assert.doesNotMatch(state.saved.object_key, /another-user|\.\.\//);
  assert.equal(state.r2[0].url.endsWith(state.saved.object_key), true);
});

test("missing profile names fall back to email while preserving the unique owner ID", async () => {
  state.name = "";
  state.email = "mayank@example.test";
  assert.equal((await upload(new TextEncoder().encode("%PDF-1.7 test"))).status, 200);
  assert.match(state.saved.object_key, /^expenses\/mayank_user-one\//);
});
test("metadata failure cleans up its newly uploaded object", async () => {
  state.saveFails = true;
  assert.equal((await upload(new TextEncoder().encode("%PDF-1.7"))).status, 500);
  assert.equal(state.r2.length, 2);
  assert.equal(state.r2[1].options.method, "DELETE");
});
test("storage failures do not create attachment metadata", async () => {
  state.uploadFails = true;
  assert.equal((await upload(new TextEncoder().encode("%PDF-1.7"))).status, 502);
  assert.equal(state.saved, undefined);
});
test("reviewer personal file upload stays unavailable until its approval flow is decided", async () => {
  state.email = "tarun@limelightit.io";
  assert.equal((await upload(new TextEncoder().encode("%PDF-1.7"))).status, 403);
  assert.equal(state.r2.length, 0);
});
test("file downloads enforce owner/reviewer access and sign only recorded keys", async () => {
  state.file = {
    owner_id: "another",
    claim_id: "claim",
    object_key: "expenses/another/saved",
    filename: "a.pdf",
  };
  assert.equal((await request({ id: "a", object_key: "injected" })).status, 404);
  assert.equal(state.signed, undefined);
  state.email = "admin@limelightit.io";
  const response = await request({ id: "a", object_key: "injected" });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.url, /expenses\/another\/saved/);
  assert.doesNotMatch(result.url, /injected/);
  assert.match(result.url, /X-Amz-Expires=60/);
  state.file.claim_id = null;
  assert.equal((await request({ id: "a" })).status, 404);
});
test("missing storage configuration returns a controlled failure", async () => {
  state.missing = "EXPENSE_R2_BUCKET";
  assert.equal((await request({ id: "a" })).status, 503);
  assert.equal(state.r2.length, 0);
});

test("receipt proxy returns authenticated bytes with CORS instead of an R2 browser URL", async () => {
  state.file = {
    owner_id: "user-one",
    claim_id: "claim",
    object_key: "expenses/user-one/saved",
    filename: 'receipt".pdf',
  };
  const response = await request({ id: "receipt", download: true, object_key: "injected" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "%PDF-1.7 receipt");
  assert.match(state.r2[0].url, /expenses\/user-one\/saved$/);
  assert.equal(state.r2[0].options.method, "GET");
  assert.equal(state.signed, undefined);
});

test("receipt proxy preserves ownership checks and fails closed on missing or oversized objects", async () => {
  state.file = {
    owner_id: "other",
    claim_id: "claim",
    object_key: "receipt.pdf",
    filename: "receipt.pdf",
  };
  assert.equal((await request({ id: "receipt", download: true })).status, 404);
  assert.equal(state.r2.length, 0);
  state.file.owner_id = "user-one";
  state.downloadFails = true;
  const failed = await request({ id: "receipt", download: true });
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("access-control-allow-origin"), "*");
  state.downloadFails = false;
  state.receipt = new Uint8Array(5000001);
  assert.equal((await request({ id: "receipt", download: true })).status, 413);
});

test("Tarun cannot download receipts until Hardik explicitly sends the expense", async () => {
  state.email = "tarun@limelightit.io";
  state.file = {
    owner_id: "other",
    claim_id: "claim",
    object_key: "receipt.pdf",
    filename: "receipt.pdf",
  };
  state.claim = { sent_to_tarun_at: null };
  assert.equal((await request({ id: "a" })).status, 404);
  assert.equal((await request({ id: "a", download: true })).status, 404);
  assert.equal(state.r2.length, 0);
  assert.equal(state.signed, undefined);
  state.claim.sent_to_tarun_at = "2026-10-19T00:00:00Z";
  assert.equal((await request({ id: "a" })).status, 200);
  assert.equal((await request({ id: "a", download: true })).status, 200);
});
