import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { jsPDF } from "jspdf";

const staff = "00000000-0000-4000-8000-000000000003",
  employee = "00000000-0000-4000-8000-000000000006";
const calendar = Array.from({ length: 30 }, (_, i) => {
  const date = `2026-06-${String(i + 1).padStart(2, "0")}`;
  const working = new Date(`${date}T12:00:00Z`).getUTCDay() !== 0 && i !== 1;
  const units = working ? (i === 2 ? 0.5 : 1) : 0;
  return {
    date,
    working_day: working,
    status: working ? (i === 2 ? "late" : "present") : "off_day",
    automatic_units: units,
    units,
    late_minutes: i === 2 ? 10 : 0,
  };
});
function fixture(role) {
  return {
    role,
    today: "2026-10-16",
    people: [{ id: staff, name: "Staff Member", email: "staff@test.io", field: false }],
    employees: [
      {
        id: employee,
        name: "Staff Member",
        email: "staff@test.io",
        auth_user_id: staff,
        active: true,
      },
    ],
    salaries: [
      {
        id: "salary-one",
        employee_id: employee,
        month: "2026-06-01",
        base_salary: 15000,
        amount: 14700,
        working_days: 25,
        payable_days: 24.5,
        days: calendar,
        overrides: {},
        revision: 1,
        status: "draft",
        paid_at: null,
        hardik_at: null,
        tarun_at: null,
      },
    ],
    files: [],
    events: [],
    claims: [
      {
        id: "expense-one",
        owner_id: staff,
        owner_name: "Staff Member",
        owner_email: "staff@test.io",
        expense_date: "2026-06-10",
        settlement_month: "2026-06-01",
        title: "Site travel",
        category: "travel",
        amount: 500,
        description: "Travel for site visit",
        attachment_ids: [],
        revision: 1,
        status: "hardik_pending",
        created_at: "2026-06-11T08:00:00Z",
        updated_at: "2026-06-11T08:00:00Z",
        hardik_decision: null,
        hardik_at: null,
        hardik_reason: null,
        tarun_decision: null,
        tarun_at: null,
        tarun_reason: null,
        paid_at: null,
      },
    ],
  };
}
async function mock(page, financeRole = "hardik", workspaceRole) {
  const user = {
    id:
      financeRole === "hardik"
        ? "00000000-0000-4000-8000-000000000001"
        : financeRole === "tarun"
          ? "00000000-0000-4000-8000-000000000002"
          : staff,
    email:
      financeRole === "hardik"
        ? "admin@limelightit.io"
        : financeRole === "tarun"
          ? "tarun@limelightit.io"
          : "staff@test.io",
    email_confirmed_at: "2026-01-01T00:00:00Z",
    role: "authenticated",
    aud: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: {},
  };
  const token = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: "authenticated",
        role: "authenticated",
      }),
    ).toString("base64url"),
    "testsignature",
  ].join(".");
  await page.addInitScript(
    ({ token, user }) => {
      const session = JSON.stringify({
        access_token: token,
        refresh_token: "test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
      sessionStorage.setItem("sb-finance-test-auth-token", session);
      localStorage.setItem("themeMode", "light");
    },
    { token, user },
  );
  const board = fixture(financeRole);
  const calls = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split("/").pop();
    let result = {};
    if (url.pathname === "/auth/v1/user") result = user;
    else if (name === "user_roles")
      result = [
        {
          role:
            workspaceRole ??
            (financeRole === "hardik"
              ? "supervisor"
              : financeRole === "tarun"
                ? "worker"
                : "employee"),
        },
      ];
    else if (name === "profiles")
      result = {
        name:
          financeRole === "hardik" ? "Hardik" : financeRole === "tarun" ? "Tarun" : "Staff Member",
        is_active: true,
      };
    else if (url.pathname.includes("/rpc/")) {
      const input = route.request().postDataJSON();
      calls.push({ name, input });
      if (name === "finance_board") result = board;
      else if (name === "field_ops_board")
        result = {
          today: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
          tracking_started: "2026-01-01",
          users: [{ id: user.id, name: "Staff Member", joined: "2026-01-01", online: true }],
          attendance: [],
          rates: [],
          earnings: [],
          sites: [],
          visits: [],
          payments: [],
          date_changes: [],
        };
      else if (name === "attendance_my_account")
        result = { id: employee, name: "Staff Member", enroll_id: "TEST", active: true };
      else if (
        [
          "attendance_my_history",
          "attendance_my_leave_requests",
          "attendance_leave_review_queue",
          "attendance_late_requests",
        ].includes(name)
      )
        result = [];
      else if (name === "attendance_my_wfh_eligibility") result = false;
      else if (name === "attendance_my_calendar")
        result = { month: input._month, today: "2026-10-16", days: [] };
      else if (name === "finance_calendar") result = calendar;
      else if (name === "salary_save") {
        const salary = board.salaries[0];
        salary.base_salary = input._base;
        salary.overrides = input._overrides;
        salary.revision++;
        salary.payable_days = 25;
        salary.amount = 15000;
        result = salary.id;
      } else if (name === "expense_review_batch" || name === "expense_batch_action") {
        for (const item of input._claims) {
          const claim = board.claims.find((claim) => claim.id === item.id);
          const action = input._action ?? "approve";
          if (action === "reject") claim.tarun_reason = input._reason;
          claim.status =
            action === "forward"
              ? "tarun_pending"
              : action === "reject"
                ? "rejected"
                : financeRole === "hardik"
                  ? "hardik_verified"
                  : "approved";
          claim.revision++;
        }
        result = null;
      } else if (name === "expense_save") {
        board.claims.push({
          ...board.claims[0],
          id: "new-expense",
          title: input._title,
          amount: input._amount,
        });
        result = "new-expense";
      } else if (name === "expense_action") {
        const claim = board.claims.find((claim) => claim.id === input._id);
        claim.status =
          input._action === "approve"
            ? financeRole === "hardik"
              ? "hardik_verified"
              : "approved"
            : input._action === "forward"
              ? "tarun_pending"
              : "rejected";
        claim.revision++;
        result = null;
      }
    } else if (name === "sites") result = [];
    else if (name === "expense-files") {
      calls.push({ name });
      result = { id: "uploaded-receipt" };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
      headers: { "access-control-allow-origin": "*" },
    });
  });
  return { board, calls, errors };
}
test("calendar-month incentives use month-end keys and payment opens on the next month's 7th", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-07-06T18:29:30Z") });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const { board, calls, errors } = await mock(page);
  const fieldId = "00000000-0000-4000-8000-000000000009";
  board.people.push({ id: fieldId, name: "Field Member", email: "field@test.io", field: true });
  await page.route("**/rest/v1/rpc/finance_field_board", (route) =>
    route.fulfill({
      json: {
        earnings: [
          {
            id: "field-work",
            date: "2026-06-30",
            phase: "assessment",
            company: "Factory",
            amount: 1200,
            paid: false,
          },
        ],
        review: {
          revision: 2,
          status: "approved",
          hardik_at: "2026-07-01T06:00:00Z",
          tarun_at: "2026-07-02T06:00:00Z",
        },
        rates: { assessment: 1200, commissioning: 2000 },
        payments: [],
        calendar: [],
        leaves: [],
      },
    }),
  );
  await page.goto("/manager/salary-expense");
  await page.getByLabel("Settlement month", { exact: true }).fill("2026-06");
  await page.getByRole("button", { name: "Field associates", exact: true }).click();
  await page.getByRole("button", { name: /Field Member.*Open details/ }).click();
  await expect(page.getByText("2026-06-01 → 2026-06-30", { exact: true })).toBeVisible();
  const pay = page.getByRole("button", { name: "Record incentive payment", exact: true });
  await expect(pay).toBeDisabled();
  await expect(pay).toHaveAttribute("title", /2026-07-07/);
  await page.clock.setFixedTime(new Date("2026-07-06T18:30:30Z"));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(pay).toBeEnabled();
  await pay.click();
  await page.getByLabel("Payment reference / method", { exact: true }).fill("BANK-MONTHLY");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(() =>
      calls.some(
        (call) =>
          call.name === "finance_field_action" &&
          call.input._end === "2026-06-30" &&
          call.input._action === "pay",
      ),
    )
    .toBeTruthy();
  expect(errors).toEqual([]);
});

test("late arrival supports half-day requests and blocks today's application after the deadline", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-22T02:29:00Z") });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const { errors } = await mock(page, null, "employee");
  const submitted = [];
  const lateRows = [];
  await page.route("**/rest/v1/rpc/attendance_late_requests", (route) =>
    route.fulfill({ json: lateRows }),
  );
  await page.route("**/rest/v1/rpc/attendance_submit_my_late_request", async (route) => {
    const input = route.request().postDataJSON();
    submitted.push(input);
    lateRows.push({
      id: "late-test",
      request_type: "late",
      is_half_day: input._half_day,
      expected_arrival: input._expected_arrival,
      start_date: input._date,
      end_date: input._date,
      reason: input._description,
      status: "pending",
      created_at: "2026-10-22T02:29:00Z",
      approver_emails: ["kuldeepshrimali.limelight@gmail.com", "tarun@limelightit.io"],
      days: [{ leave_date: input._date, status: "pending" }],
    });
    await route.fulfill({ json: "late-test" });
  });
  await page.goto("/employee");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.getByRole("button", { name: "Late / half-day arrival", exact: true }).click();
  await page.getByLabel("Expected arrival time (IST)").fill("12:30");
  await page.getByLabel("Arrival type", { exact: true }).selectOption("half");
  await page.getByLabel("Reason category").selectOption("Other");
  await page.getByLabel("Tell your manager more").fill("A medical appointment before work");
  await page.getByRole("button", { name: "Submit half-day arrival request", exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toMatchObject({
    _date: "2026-10-22",
    _expected_arrival: "12:30",
    _half_day: true,
    _category: "Other",
  });
  await expect(page.getByRole("row").filter({ hasText: "Half-day arrival" })).toBeVisible();
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.clock.setFixedTime(new Date("2026-10-22T02:30:01Z"));
  await page.clock.runFor(1000);
  await expect(
    page.getByRole("button", { name: "Deadline passed for this date", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/Applications for this date are closed/)).toBeVisible();
  expect(submitted).toHaveLength(1);
  await page.getByLabel("Arrival date", { exact: true }).fill("2026-10-23");
  await expect(
    page.getByRole("button", { name: "Submit late arrival request", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("late arrival appears in the review counter and an authorized manager can reject it", async ({
  page,
}) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const { errors } = await mock(page, "tarun", "employee");
  const row = {
    id: "late-review",
    request_type: "late",
    start_date: "2026-10-23",
    end_date: "2026-10-23",
    expected_arrival: "11:30:00",
    is_half_day: false,
    employee_name: "Team Member",
    department: "firmware",
    reason: "Transport delay",
    category: "Transport delay",
    created_at: "2026-10-22T01:00:00Z",
    status: "pending",
    days: [{ leave_date: "2026-10-23", status: "pending" }],
  };
  const decisions = [];
  await page.route("**/rest/v1/rpc/attendance_late_requests", (route) =>
    route.fulfill({ json: row.status === "pending" ? [row] : [] }),
  );
  await page.route("**/rest/v1/rpc/attendance_decide_late_request", async (route) => {
    const input = route.request().postDataJSON();
    decisions.push(input);
    row.status = input._decision;
    await route.fulfill({ json: null });
  });
  await page.goto("/employee");
  await expect(page.getByRole("button", { name: /Req Leave/ })).toContainText("1 pending");
  await page.getByRole("button", { name: /Req Leave/ }).click();
  await expect(page.getByText("Expected: 11:30 AM IST", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review dates", exact: true }).click();
  await page.getByRole("button", { name: "Select all reject", exact: true }).click();
  await page.getByRole("button", { name: "Save decisions", exact: true }).click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toMatchObject({ _request: "late-review", _decision: "rejected" });
  await expect(page.getByText("Team Member", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("receipt thumbnails stay compact and open images and PDFs in a dialog", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    // Reproduce browsers without the newer typed-array hex helpers.
    delete Uint8Array.prototype.toHex;
    delete Uint8Array.fromHex;
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const { board, errors } = await mock(page);
  const requests = [];
  const downloads = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  const document = new jsPDF();
  document.text("Receipt preview first page", 20, 30);
  document.addPage();
  document.text("Receipt preview second page", 20, 30);
  board.files = [
    {
      id: "image-receipt",
      claim_id: "expense-one",
      filename: "travel-receipt.png",
      mime_type: "image/png",
      size_bytes: 12000,
    },
    {
      id: "pdf-receipt",
      claim_id: "expense-one",
      filename: "invoice.pdf",
      mime_type: "application/pdf",
      size_bytes: 24000,
    },
  ];
  board.claims[0].attachment_ids = board.files.map((file) => file.id);
  await page.route("**/functions/v1/expense-files", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    if (input.id === "pdf-receipt" && input.download === true) {
      return route.fulfill({
        contentType: "application/octet-stream",
        headers: { "Content-Disposition": 'attachment; filename="invoice.pdf"' },
        body: Buffer.from(document.output("arraybuffer")),
      });
    }
    await route.fulfill({ json: { url: `http://127.0.0.1:4181/receipt-preview/${input.id}` } });
  });
  await page.route("**/receipt-preview/image-receipt", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.goto("/manager/salary-expense");
  await page.getByRole("button", { name: "All expense requests", exact: true }).click();
  await page.getByRole("button", { name: "Review expenses for Staff Member", exact: true }).click();
  const image = page.getByRole("button", { name: "Open receipt travel-receipt.png", exact: true });
  await expect(image.getByRole("img")).toBeVisible();
  await expect
    .poll(() => image.getByRole("img").evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(0);
  const pdf = page.getByRole("button", { name: "Open receipt invoice.pdf", exact: true });
  await expect(pdf).toContainText("PDF");
  await expect(pdf.getByRole("img")).toHaveCount(0);
  expect(requests).toEqual([{ id: "image-receipt", preview: true }]);
  await image.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "travel-receipt.png", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/manager\/salary-expense/);
  expect(context.pages()).toHaveLength(1);
  expect(requests.at(-1)).toEqual({ id: "image-receipt", preview: true });
  await page.keyboard.press("Escape");
  const thumbnail = await image.boundingBox();
  expect(thumbnail.height).toBeLessThanOrEqual(65);
  await pdf.click();
  const pdfPage = dialog.getByRole("img", { name: "PDF page 1", exact: true });
  await expect(pdfPage).toHaveAttribute("data-rendered", "true", { timeout: 30000 });
  // Assert real page content was painted, rather than only checking a viewer URL.
  expect(
    await pdfPage.evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          pixels[index] < 100 &&
          pixels[index + 1] < 100 &&
          pixels[index + 2] < 100 &&
          pixels[index + 3] > 0
        )
          ink++;
      }
      return ink;
    }),
  ).toBeGreaterThan(20);
  await dialog.getByRole("button", { name: "Next PDF page", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "PDF page 2", exact: true })).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(dialog.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  expect(requests.at(-1)).toEqual({ id: "pdf-receipt", download: true });
  expect(downloads).toEqual([]);
  await expect(page).toHaveURL(/\/manager\/salary-expense/);
  await page.screenshot({ path: ".tmp/finance-pdf-receipt-preview.png", fullPage: true });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("Overview adds an assessor from an empty dropdown, preserves metadata and reuses the contact", async ({
  page,
}) => {
  const { errors } = await mock(page, null, "supervisor");
  const original = {
    status: "Not Started Yet",
    worker_ids: [staff],
    c1_name: "Existing client",
    custom_note: "Keep this value",
  };
  const sites = ["Acme Factory", "Beta Factory"].map((name, index) => ({
    id: `site-${index}`,
    name,
    company_name: name,
    city: "Ahmedabad",
    assigned_worker_id: staff,
    assigned_at: "2026-10-01T08:00:00Z",
    created_at: "2026-10-01T08:00:00Z",
    task_notes: `[METADATA:${JSON.stringify(original)}]Keep these notes`,
  }));
  const writes = [];
  await page.route("**/rest/v1/*?*", async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split("/").pop();
    if (name === "user_roles" && url.searchParams.get("select") === "role") return route.fallback();
    if (name === "profiles" && url.searchParams.get("select")?.includes("whatsapp"))
      return route.fallback();
    let result = [];
    if (name === "sites") {
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      const site = sites.find((entry) => entry.id === id);
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        writes.push(body);
        Object.assign(site, body);
        result = [{ id: site.id, task_notes: site.task_notes }];
      } else result = id ? site : sites;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/manager");
  const dropdown = page.getByLabel("Select assessor for Acme Factory", { exact: true });
  await expect(dropdown).toBeEnabled({ timeout: 15000 });
  await dropdown.selectOption("add-assessor");
  const dialog = page.getByRole("dialog", { name: "Add assessor", exact: true });
  await dialog.getByLabel("Company name", { exact: true }).fill("New Assessment Co");
  await dialog.getByLabel("Person name", { exact: true }).fill("New Assessor");
  await dialog.getByLabel("Email", { exact: true }).fill("assessor@example.com");
  await dialog.getByLabel("Mobile number", { exact: true }).fill("9876543210");
  await dialog.getByRole("button", { name: "Save & assign", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View assessor details for Acme Factory" }),
  ).toContainText("New Assessment Co");
  expect(writes).toHaveLength(1);
  expect(writes[0].task_notes).toContain('"custom_note":"Keep this value"');
  expect(writes[0].task_notes).toContain("Keep these notes");
  expect(writes[0].task_notes).toContain('"assessor_email":"assessor@example.com"');
  await page.getByRole("button", { name: "View assessor details for Acme Factory" }).click();
  await expect(page.getByRole("dialog")).toContainText("assessor@example.com");
  await page.keyboard.press("Escape");
  await page.getByLabel("Select assessor for Beta Factory", { exact: true }).selectOption("site-0");
  await expect(
    page.getByRole("button", { name: "View assessor details for Beta Factory" }),
  ).toContainText("New Assessment Co");
  expect(writes).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("Employee expense dialog stays light and keeps submit controls visible on small screens", async ({
  page,
}) => {
  const { errors } = await mock(page, null);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/employee");
  await page.evaluate(() => document.documentElement.classList.remove("light-theme"));
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  await page.getByRole("button", { name: "Add Expense", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const checkFooter = async () => {
    const button = page.getByRole("button", { name: "Submit to Hardik", exact: true });
    await expect(button).toBeVisible();
    await expect
      .poll(() =>
        button.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth
          );
        }),
      )
      .toBeTruthy();
  };
  await checkFooter();
  await page.screenshot({ path: ".tmp/employee-expense-dialog-desktop.png" });
  await page.setViewportSize({ width: 390, height: 640 });
  await checkFooter();
  await page.locator(".finance-editor-body").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await checkFooter();
  await page.screenshot({ path: ".tmp/employee-expense-dialog-mobile.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Employee opens expenses within the employee portal and switches tabs on mobile", async ({
  page,
}) => {
  const { errors } = await mock(page, null);
  await page.goto("/employee");
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My expenses", exact: true })).toBeVisible();
  await expect(page.getByText("Employee portal", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/employee$/);
  await expect(page.getByRole("link", { name: "Back to workspace" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Add Expense", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.getByRole("button", { name: "My attendance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My expenses", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My expenses", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/employee$/);
  expect(errors).toEqual([]);
});

test("Field associate opens expenses within the field workspace", async ({ page }) => {
  const { errors } = await mock(page, null, "worker");
  await page.goto("/business-consultant");
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My expenses", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/business-consultant$/);
  await expect(page.getByRole("navigation", { name: "Field associate navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Assignments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My expenses", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Tarun sees expenses first and has no personal expense entry point", async ({ page }) => {
  const { errors } = await mock(page, "tarun");
  await page.goto("/manager/salary-expense");
  await expect(page.getByRole("link", { name: "Expense", exact: true })).toHaveCount(0);
  await expect(page.locator(".finance-section-tabs button").first()).toHaveAttribute(
    "aria-label",
    "All expense requests",
  );
  await expect(page.locator(".finance-section-tabs button").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goto("/expenses");
  await expect(page).toHaveURL(/\/manager\/salary-expense$/);
  await expect(page.getByRole("heading", { name: "My expenses", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Salary / Expense", exact: true })).toBeVisible();
  await page.goto("/business-consultant");
  await expect(page.getByRole("navigation", { name: "Field associate navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expense", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Hardik sees only finance, edits automatic half-day salary and verifies expenses", async ({
  page,
}) => {
  const { board, calls, errors } = await mock(page);
  board.events.push({
    id: "salary-history",
    entity_id: "salary-one",
    entity_type: "salary",
    action: "save",
    actor_role: "hardik",
    occurred_at: "2026-06-30T12:00:00Z",
    reason: "Monthly salary calculation",
    before_data: null,
    after_data: {},
  });
  board.claims.push({
    ...board.claims[0],
    id: "already-sent",
    title: "Courier",
    amount: 200,
    status: "tarun_pending",
  });
  board.claims.push({
    ...board.claims[0],
    id: "other-person",
    owner_id: "other-person",
    owner_name: "Other Person",
    amount: 700,
  });
  await page.goto("/manager/salary-expense");
  await expect(page.getByRole("heading", { name: "Salary / Expense", exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("link", { name: "Inventory Management", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "Attendance", exact: true })).toHaveCount(0);
  await page.getByLabel("Settlement month", { exact: true }).fill("2026-06");
  await page.getByRole("button", { name: "Office staff", exact: true }).click();
  await page.getByLabel("Search people").fill("nobody matches");
  await expect(page.getByText("No matching people", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByLabel("Filter people").selectOption("review");
  await expect(page.getByRole("button", { name: /Staff Member staff@test.io/ })).toBeVisible();
  await page.screenshot({ path: ".tmp/finance-overview-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".tmp/finance-overview-mobile.png", fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole("button", { name: /Staff Member staff@test.io/ }).click();
  await expect(page.getByText(/Calculation & approval history/)).toHaveCount(0);
  await expect(page.getByText("₹14,700.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Note (optional)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Salary deduction for 2026-06-03", { exact: true })).toHaveCount(0);
  await page.getByLabel("Late days without deduction", { exact: true }).selectOption("1");
  await expect(page.getByText("₹15,000.00", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Save salary", exact: true }).click();
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.name === "salary_save" &&
          c.input._overrides["2026-06-03"]?.units === 1 &&
          c.input._reason === "Monthly salary calculation",
      ),
    )
    .toBeTruthy();
  await page.screenshot({ path: ".tmp/finance-salary-calendar.png", fullPage: true });
  await page.getByRole("button", { name: "All staff", exact: true }).click();
  await page.getByRole("button", { name: "All expense requests", exact: true }).click();
  const personRow = page.getByRole("row").filter({ hasText: "Staff Member" });
  await expect(personRow).toContainText("₹700.00");
  await expect(page.getByLabel("Expense status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Verify selected", exact: true })).toHaveCount(0);
  await expect(
    personRow.getByRole("button", {
      name: "Send verified expenses to Tarun for Staff Member",
      exact: true,
    }),
  ).toBeDisabled();
  await page.screenshot({ path: ".tmp/finance-hardik-expenses.png", fullPage: true });
  await personRow
    .getByRole("button", { name: "Review expenses for Staff Member", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText("Expense history");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: ".tmp/finance-hardik-person-details.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: ".tmp/finance-hardik-person-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole("button", { name: "All people", exact: true }).click();
  await personRow
    .getByRole("button", { name: "Verify all expenses for Staff Member", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(personRow).toContainText("Ready to send");
  expect(
    calls.some((c) => c.name === "expense_batch_action" && c.input._action === "forward"),
  ).toBe(false);
  await personRow
    .getByRole("button", { name: "Send verified expenses to Tarun for Staff Member", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("1 expenses");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(() =>
      calls.some((c) => c.name === "expense_batch_action" && c.input._action === "forward"),
    )
    .toBeTruthy();
  await expect(personRow).toContainText("Sent to Tarun");
  expect(board.claims.find((claim) => claim.id === "other-person").status).toBe("hardik_pending");
  expect(
    calls.find((call) => call.name === "expense_batch_action" && call.input._action === "forward")
      .input._claims,
  ).toHaveLength(1);
  await page.screenshot({ path: ".tmp/finance-manager-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
for (const reviewer of ["hardik", "tarun"]) {
  for (const rejectedBy of ["hardik", "tarun"]) {
    test(`${reviewer} sees reapplied highlights only as allowed after ${rejectedBy} rejection`, async ({
      page,
    }) => {
      const highlighted = reviewer === "hardik" || rejectedBy === "tarun";
      const { board, errors } = await mock(page, reviewer);
      board.claims[0].status = reviewer === "hardik" ? "hardik_pending" : "tarun_pending";
      board.claims[0].revision = 4;
      board.claims.push({ ...board.claims[0], id: "first-submission", title: "First submission" });
      board.events.push({
        id: "reapply-event",
        entity_type: "expense",
        entity_id: "expense-one",
        action: "reapplied",
        occurred_at: "2026-10-19T08:00:00Z",
        before_data: {
          status: "rejected",
          [`${rejectedBy}_reason`]:
            "Receipt is unreadable.\nPlease upload a clear invoice showing the total.",
          [`${rejectedBy}_at`]: "2026-10-18T08:00:00Z",
        },
        after_data: { status: "hardik_pending" },
      });
      await page.goto("/manager/salary-expense");
      const group = page.getByRole("row").filter({ hasText: "Staff Member" });
      await expect(group).toHaveAttribute("data-reapplied", String(highlighted));
      if (highlighted) await expect(group).toContainText("1 reapplied expense");
      else await expect(group.locator(".finance-reapplied-badge")).toHaveCount(0);
      await group.getByRole("button", { name: "Review expenses for Staff Member" }).click();
      const details = page.getByLabel("Person expense details");
      const reapplied = details.getByRole("row").filter({ hasText: "Site travel" });
      await expect(reapplied).toHaveAttribute("data-reapplied", String(highlighted));
      if (highlighted) {
        await expect(reapplied).toContainText(
          `Previously rejected by ${rejectedBy === "hardik" ? "Hardik" : "Tarun"}`,
        );
        await expect(reapplied).toContainText("Receipt is unreadable.");
        await expect(reapplied).toContainText("Please upload a clear invoice showing the total.");
        await expect(reapplied).toContainText("Resubmitted");
        await expect(reapplied.locator(".finance-reapply-reason p")).toHaveCSS(
          "white-space",
          "pre-wrap",
        );
      } else {
        await expect(reapplied.locator(".finance-reapplication")).toHaveCount(0);
        await expect(reapplied).not.toContainText("Receipt is unreadable.");
      }
      await expect(
        details.getByRole("row").filter({ hasText: "First submission" }),
      ).toHaveAttribute("data-reapplied", "false");
      await page.screenshot({
        path: `.tmp/finance-${reviewer}-reapplied-after-${rejectedBy}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
}

test("employee submits a new expense with evidence and can scroll the table on mobile", async ({
  page,
}) => {
  const { calls, errors } = await mock(page, null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "My expenses", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add Expense", exact: true }).click();
  await page.getByLabel("Expense name", { exact: true }).fill("Courier delivery");
  await page.getByLabel("Amount (INR)", { exact: true }).fill("250");
  await page.getByLabel("Category", { exact: true }).selectOption("courier");
  await page.locator('input[type="file"]').setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 test"),
  });
  await page.screenshot({ path: ".tmp/finance-expense-form-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Submit to Hardik", exact: true }).click();
  await expect
    .poll(() =>
      calls.some((c) => c.name === "expense_save" && c.input._files[0] === "uploaded-receipt"),
    )
    .toBeTruthy();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Courier delivery", { exact: true })).toBeVisible();
  expect(
    await page.locator(".finance-table-scroll").evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBeTruthy();
  await page.screenshot({ path: ".tmp/finance-expense-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("monthly backup downloads a ZIP containing records, manifest and professional PDF", async ({
  page,
}) => {
  const { board, errors } = await mock(page);
  // A large JSON entry used to trigger asynchronous compression in a blob worker.
  board.events.push({
    id: "archive-event",
    entity_id: "archived-item",
    reason: "Evidence ".repeat(25000),
  });
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() {
        throw new Error("Workers blocked by browser policy");
      }
    };
  });
  const receipt = Buffer.from("%PDF-1.7 receipt evidence");
  board.files.push({
    id: "receipt-one",
    claim_id: "expense-one",
    filename: "receipt.pdf",
    mime_type: "application/pdf",
    size_bytes: receipt.length,
    sha256: createHash("sha256").update(receipt).digest("hex"),
    object_key: "expenses/staff/receipt-one",
  });
  await page.route("**/functions/v1/expense-files", (route) => {
    expect(route.request().postDataJSON()).toEqual({ id: "receipt-one", download: true });
    return route.fulfill({ contentType: "application/octet-stream", body: receipt });
  });
  const directReceiptRequests = [];
  await page.route("**/*.r2.cloudflarestorage.com/**", (route) => {
    directReceiptRequests.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  await page.goto("/manager/salary-expense");
  await expect(page.getByRole("heading", { name: "Salary / Expense", exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel("Settlement month", { exact: true }).fill("2026-06");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download monthly ZIP", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("SimKit-salary-expense-2026-06.zip");
  const entries = unzipSync(new Uint8Array(await readFile(await download.path())));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  expect(manifest.verified).toBe(true);
  expect(manifest.claims).toBe(1);
  expect(manifest.salaries).toBe(1);
  expect(manifest.field_cycle_start).toBe("2026-06-01");
  expect(manifest.field_cycle_end).toBe("2026-06-30");
  expect(manifest.field_payment_due).toBe("2026-07-07");
  expect(manifest.files).toHaveLength(1);
  expect(Buffer.from(entries[manifest.files[0].path])).toEqual(receipt);
  const pdf = entries[`statements/${staff}.pdf`];
  expect(strFromU8(pdf.subarray(0, 5))).toBe("%PDF-");
  expect(strFromU8(pdf)).toContain("SALARY + EXPENSES TOTAL");
  expect(strFromU8(entries["expenses.csv"])).toContain("Site travel");
  expect(directReceiptRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("Tarun can enter finance from a field account and approve verified claims", async ({
  page,
}) => {
  const { board, calls, errors } = await mock(page, "tarun");
  board.claims[0].status = "tarun_pending";
  board.claims[0].hardik_decision = "approve";
  board.claims.push({
    ...board.claims[0],
    id: "second-expense",
    title: "Hotel stay",
    amount: 2500,
  });
  board.claims.push({
    ...board.claims[0],
    id: "other-person",
    owner_id: "other-person",
    owner_name: "Other Person",
    amount: 700,
  });
  await page.goto("/manager/salary-expense");
  await expect(page.getByRole("heading", { name: "Salary / Expense", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All expense requests", exact: true }).click();
  await page.screenshot({ path: ".tmp/finance-tarun-expenses.png", fullPage: true });
  const summary = page.getByRole("row").filter({ hasText: "Staff Member" });
  await expect(summary).toContainText("₹3,000.00");
  await expect(
    page.getByRole("button", { name: "Approve all pending expenses", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await summary.getByRole("button", { name: "Review expenses for Staff Member" }).click();
  await expect(page.getByLabel("Person expense details")).toContainText("2026-06-10");
  const decision = page.getByRole("button", { name: "Approve", exact: true }).first();
  expect(
    await decision.evaluate((button) => button.getBoundingClientRect().right <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: ".tmp/finance-tarun-person-details.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: ".tmp/finance-tarun-person-mobile.png", fullPage: true });
  expect(
    await page
      .getByLabel("Person expense details")
      .evaluate((element) => getComputedStyle(element).overflowX === "auto"),
  ).toBeTruthy();
  await expect(page.getByRole("button", { name: "Approve all expenses", exact: true })).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole("button", { name: "All people", exact: true }).click();
  await summary
    .getByRole("button", { name: "Approve all expenses for Staff Member", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Staff Member");
  await expect(page.getByRole("dialog")).toContainText("₹3,000.00");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(() =>
      calls.some(
        (call) =>
          call.name === "expense_batch_action" &&
          call.input._action === "approve" &&
          call.input._claims.length === 2,
      ),
    )
    .toBeTruthy();
  expect(board.claims.find((c) => c.id === "other-person").status).toBe("tarun_pending");
  await expect(
    summary.getByRole("button", { name: "Approve all expenses for Staff Member", exact: true }),
  ).toBeDisabled();
  await summary.getByRole("button", { name: "Review expenses for Staff Member" }).click();
  await expect(
    page.getByRole("button", { name: "Record payment", exact: true }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Tarun rejects an individual expense and approves only the remaining pending expenses", async ({
  page,
}) => {
  const { board, calls, errors } = await mock(page, "tarun");
  board.claims[0].status = "tarun_pending";
  board.claims.push({
    ...board.claims[0],
    id: "second-expense",
    title: "Hotel stay",
    amount: 2500,
  });
  await page.goto("/manager/salary-expense");
  await page.getByRole("button", { name: "Review expenses for Staff Member" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Site travel" })
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await page.getByLabel("Rejection reason", { exact: true }).fill("Receipt unclear");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Rejection reason: Receipt unclear")).toBeVisible();
  await page.getByRole("button", { name: "All people", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve all expenses for Staff Member", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("₹2,500.00");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.name === "expense_batch_action" &&
          c.input._action === "approve" &&
          c.input._claims.length === 1 &&
          c.input._claims[0].id === "second-expense",
      ),
    )
    .toBeTruthy();
  expect(board.claims[0].status).toBe("rejected");
  expect(errors).toEqual([]);
});

test("claimant can inspect a rejection timeline and reopen an eligible claim", async ({ page }) => {
  const { board, errors } = await mock(page, null);
  Object.assign(board.claims[0], {
    status: "rejected",
    settlement_month: "2026-10-01",
    hardik_decision: "reject",
    hardik_at: "2026-10-15T08:00:00Z",
    hardik_reason: "Please attach a readable receipt.",
  });
  await page.goto("/expenses");
  await expect(page.getByText("1 expense needs your attention", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Please attach a readable receipt.");
  await expect(page.getByRole("dialog")).toContainText("Hardik verification");
  await page.screenshot({ path: ".tmp/finance-claim-timeline.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page
    .locator(".finance-action-required")
    .getByRole("button", { name: "Edit & Reapply", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Keeps settlement month 2026-10");
  await expect(page.getByLabel("Expense name", { exact: true })).toHaveValue("Site travel");
  expect(errors).toEqual([]);
});
