import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const employeeId = "00000000-0000-4000-8000-000000000006";
const userId = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const term = {
    id: "term-initial",
    employee_id: employeeId,
    revision: 1,
    employment_type: "internship",
    monthly_amount: 12000,
    annual_ctc: null,
    internship_months: 6,
    internship_end: "2027-02-04",
    effective_from: "2026-08-05",
    reason: "Initial employment terms",
    created_at: "2026-08-01T00:00:00Z",
  };
  return {
    today: "2026-10-22",
    employees: [
      {
        id: employeeId,
        employee_code: "LL-00001",
        revision: 1,
        name: "Alex Example",
        email: "alex@example.com",
        mobile: "9876543210",
        department: "software",
        designation: "Full Stack Developer Intern",
        mentor_name: "Sample Mentor",
        joining_date: "2026-08-05",
        address: "Ahmedabad, Gujarat",
        college: "",
        app_access: "employee",
        attendance_method: "office_device",
        status: "onboarding",
        auth_user_id: null,
        attendance_employee_id: null,
        enrollment_status: null,
        current_term: term,
      },
    ],
    terms: [term],
    offers: [],
    candidates: [
      {
        auth_user_id: "existing-auth",
        attendance_employee_id: "existing-attendance",
        name: "Existing Person",
        email: "existing@example.com",
        mobile: "9876543210",
        department: "firmware",
        joining_date: "2026-07-01",
        app_access: "employee",
        directory_visible: true,
        enroll_id: "00104",
        enrollment_status: "enrolled",
      },
      {
        auth_user_id: "existing-field-auth",
        attendance_employee_id: null,
        name: "Existing Field Associate",
        email: "field@example.com",
        mobile: "9876543212",
        department: null,
        joining_date: null,
        app_access: "field_associate",
        directory_visible: true,
      },
      {
        auth_user_id: "inactive-field-auth",
        attendance_employee_id: null,
        name: "Inactive Field Associate",
        email: "inactive@example.com",
        mobile: "",
        department: null,
        joining_date: null,
        app_access: "field_associate",
        directory_visible: false,
      },
    ],
  };
}
async function mock(page, email = "admin@limelightit.io") {
  const board = fixture(),
    calls = [],
    errors = [];
  const deletions = new Map();
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const user = {
    id: userId,
    email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    role: "authenticated",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
  };
  const token = [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: userId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: "authenticated",
        role: "authenticated",
      }),
    ).toString("base64url"),
    "testsignature",
  ].join(".");
  await page.addInitScript(
    ({ token, user }) => {
      sessionStorage.setItem(
        "sb-hr-test-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
      localStorage.setItem("themeMode", "light");
    },
    { token, user },
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*.supabase.co/**", async (route) => {
    const url = new URL(route.request().url()),
      name = url.pathname.split("/").pop();
    let result = [];
    if (url.pathname === "/auth/v1/user") result = user;
    else if (name === "user_roles") result = [{ role: "supervisor" }];
    else if (name === "profiles") result = { name: "Hardik", is_active: true };
    else if (url.pathname.includes("/rpc/")) {
      const input = route.request().postDataJSON();
      calls.push({ name, input });
      if (name === "hr_board") result = board;
      else if (name === "hr_save_employee") {
        const id = input._id || "new-employee";
        const existing = board.employees.find((e) => e.id === id);
        const e = {
          ...board.employees[0],
          ...input._details,
          id,
          employee_code: existing?.employee_code || "LL-00002",
          revision: (existing?.revision || 0) + 1,
        };
        if (input._initial_terms) {
          e.current_term = {
            ...input._initial_terms,
            id: `term-${id}`,
            employee_id: id,
            revision: 1,
            reason: "Initial employment terms",
          };
          board.terms.push(e.current_term);
        }
        if (existing) Object.assign(existing, e);
        else board.employees.push(e);
        result = id;
      } else if (name === "hr_delete_employee") {
        const collection = input._employee ? board.employees : board.candidates;
        const index = collection.findIndex((e) =>
          input._employee ? e.id === input._employee : e.auth_user_id === input._source_auth,
        );
        const id = `deletion-${deletions.size}`;
        deletions.set(id, { collection, index, value: collection.splice(index, 1)[0] });
        result = id;
      } else if (name === "hr_restore_employee") {
        const deleted = deletions.get(input._deletion);
        deleted.collection.splice(deleted.index, 0, deleted.value);
        deletions.delete(input._deletion);
        result = null;
      } else if (name === "hr_revise_employment") {
        const e = board.employees.find((e) => e.id === input._employee);
        const t = {
          ...input._terms,
          id: "term-revision",
          employee_id: e.id,
          revision: 2,
          reason: input._reason,
        };
        board.terms.unshift(t);
        e.current_term = t;
        e.revision++;
        result = t.id;
      } else if (name === "hr_save_offer") {
        const e = board.employees.find((e) => e.id === input._employee),
          term = board.terms.find((t) => t.id === input._term);
        const offer = {
          id: `offer-${board.offers.length}`,
          employee_id: e.id,
          offer_number: `LL-OFFER-2026-0000${board.offers.length + 1}`,
          template: input._template,
          snapshot: {
            version: 1,
            template: input._template,
            employee: structuredClone(e),
            term: structuredClone(term),
            fields: input._fields,
          },
          created_at: "2026-10-22T00:00:00Z",
        };
        board.offers.unshift(offer);
        result = offer;
      }
    } else if (url.pathname.includes("/functions/v1/")) {
      calls.push({ name, input: route.request().postDataJSON() });
      result = { status: "pending", publishing: { configured: true, sent: 1 } };
    }
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
      });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  return { board, calls, errors };
}

test("Hardik has HR/Hiring beside Salary/Expense and can add an employee without device enrollment", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/manager/hr-hiring");
  await expect(page.getByRole("heading", { name: "HR / Hiring", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Salary / Expense", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "HR / Hiring", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Attendance", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name", { exact: true }).fill("New Employee");
  await dialog.getByLabel("Email", { exact: true }).fill("new@example.com");
  await dialog.getByLabel("Mobile number", { exact: true }).fill("9876543211");
  await dialog.getByLabel("Designation", { exact: true }).fill("Developer Intern");
  await dialog.getByLabel("Mentor / reporting manager", { exact: true }).fill("Kuldeep Shrimali");
  await dialog.getByLabel("Monthly stipend (INR)").fill("10000");
  await dialog.getByRole("button", { name: "Add employee", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Employee", exact: true })).toBeVisible();
  const save = state.calls.find((c) => c.name === "hr_save_employee");
  expect(save.input._initial_terms.monthly_amount).toBe(10000);
  expect(state.calls.some((c) => c.name === "hr-employee-account")).toBe(false);
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: ".tmp/hr-browser/employee-directory.png", fullPage: true });
});

test("existing employees and field associates appear automatically and HR completion keeps one linked row", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/manager/hr-hiring");
  const existing = page.getByRole("row").filter({ hasText: "existing@example.com" });
  await expect(
    existing.getByRole("button", { name: "Existing Person", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Existing Field Associate", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inactive Field Associate", exact: true }),
  ).toHaveCount(0);
  await expect(existing).toContainText("HR details missing");
  await expect(existing).toContainText("Not set");
  expect(state.calls.some((c) => c.name === "hr_save_employee")).toBe(false);
  await existing.getByRole("button", { name: "Complete HR details", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Full name", { exact: true })).toHaveValue("Existing Person");
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue("existing@example.com");
  await expect(dialog.getByLabel("Joining date", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Joining date", { exact: true }).fill("2026-07-01");
  await dialog.getByLabel("Designation", { exact: true }).fill("Embedded System Intern");
  await dialog.getByLabel("Mentor / reporting manager", { exact: true }).fill("Sample Mentor");
  await dialog.getByLabel("Monthly stipend (INR)", { exact: true }).fill("15000");
  await dialog.getByRole("button", { name: "Complete HR details", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Existing Person", exact: true }),
  ).toBeVisible();
  const saved = state.calls.find((c) => c.name === "hr_save_employee");
  expect(saved.input._id).toBeNull();
  expect(saved.input._details.source_auth_user_id).toBe("existing-auth");
  expect(saved.input._details.source_attendance_employee_id).toBe("existing-attendance");
  expect(saved.input._initial_terms.monthly_amount).toBe(15000);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Existing Person", exact: true })).toHaveCount(1);
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: ".tmp/hr-browser/existing-employees.png", fullPage: true });
});

test("internship converts to full time with a dated salary revision and visible history", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/manager/hr-hiring");
  await page.getByRole("button", { name: "Alex Example", exact: true }).click();
  await page.getByRole("button", { name: "Revise employment / salary", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("Employment type", { exact: true }).selectOption("full_time");
  await dialog.getByLabel("Monthly gross salary (INR)").fill("30000");
  await dialog.getByLabel("Annual CTC / package (INR)", { exact: false }).fill("420000");
  await dialog
    .getByLabel("Reason for revision")
    .fill("Converted after internship performance review");
  await dialog.getByRole("button", { name: "Save employment revision" }).click();
  await page.getByRole("button", { name: "Employment history", exact: true }).click();
  await expect(page.getByText("Converted after internship performance review")).toBeVisible();
  await expect(page.getByText("Initial employment terms", { exact: true })).toBeVisible();
  expect(state.calls.find((c) => c.name === "hr_revise_employment").input._terms.annual_ctc).toBe(
    420000,
  );
  expect(state.errors).toEqual([]);
});

test("offer generation previews and downloads all three dynamic PDF formats", async ({ page }) => {
  test.setTimeout(120000);
  const state = await mock(page);
  await page.goto("/manager/hr-hiring");
  await page.getByRole("button", { name: "Alex Example", exact: true }).click();
  for (const template of ["software", "firmware", "field_associate"]) {
    await page.getByRole("button", { name: "Generate offer", exact: true }).click();
    const dialog = page.getByRole("dialog").last();
    await dialog.getByLabel("Offer template").selectOption(template);
    await expect(dialog.getByRole("button", { name: "Save & download PDF" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Preview letter", exact: true }).click();
    await expect(dialog.locator('iframe[title="Offer letter preview"]')).toBeVisible();
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Save & download PDF" }).click();
    const download = await pending;
    const task = getDocument({
      data: new Uint8Array(await readFile(await download.path())),
      useSystemFonts: true,
    });
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(template === "field_associate" ? 4 : 3);
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((i) => i.str).join(" ")).toContain("Alex Example");
    await task.destroy();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  expect(state.calls.filter((c) => c.name === "hr_save_offer")).toHaveLength(3);
  await page.getByRole("button", { name: "Offer letters", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toHaveCount(3);
  expect(state.errors).toEqual([]);
});

test("mobile directory uses readable cards without overflowing the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto("/manager/hr-hiring");
  await expect(page.getByRole("button", { name: "Alex Example", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toBeHidden();
  await page.getByRole("button", { name: "More details", exact: true }).first().click();
  await expect(
    page.getByText("Ahmedabad, Gujarat", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: ".tmp/hr-browser/mobile-directory.png", fullPage: true });
});

test("directory expands details, filters by team and manager, sorts and clears searches", async ({
  page,
}) => {
  const state = await mock(page);
  state.board.candidates[0].name = "Kuldeep Shrimali";
  state.board.candidates[0].email = "kuldeepshrimali.limelight@gmail.com";
  await page.goto("/manager/hr-hiring");
  const row = page.getByRole("row").filter({ hasText: "kuldeepshrimali.limelight@gmail.com" });
  await expect(row).toContainText("Tarun Purohit");
  await page.getByRole("button", { name: "Show details for Alex Example", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Ahmedabad, Gujarat" })).toContainText(
    "5 Aug 2026",
  );
  await page.getByRole("tab", { name: /Field associates/ }).click();
  await expect(
    page.getByRole("button", { name: "Existing Field Associate", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Alex Example", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /All employees/ }).click();
  await row.getByRole("button", { name: "Tarun Purohit", exact: true }).click();
  await expect(page.getByText("Reports to Tarun Purohit", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Alex Example", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Sort employees", exact: true })
    .selectOption("name_desc");
  await expect(page.getByRole("row").nth(1)).toContainText("Kuldeep Shrimali");
  await page
    .getByRole("textbox", { name: "Search employees", exact: true })
    .fill("no such employee");
  await expect(page.getByText("No matching employees", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page
    .getByRole("combobox", { name: "Filter reporting manager", exact: true })
    .selectOption("Tarun Purohit");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Complete HR details", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Mentor / reporting manager", { exact: true }),
  ).toHaveValue("Tarun Purohit");
  expect(state.errors).toEqual([]);
});

for (const name of ["Alex Example", "Existing Person"])
  test(`delete ${name} requires confirmation and supports Undo`, async ({ page }) => {
    if (name === "Existing Person") await page.setViewportSize({ width: 390, height: 844 });
    const state = await mock(page);
    await page.goto("/manager/hr-hiring");
    const openDelete = async () => {
      await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete employee", exact: true }).click();
    };
    await openDelete();
    await expect(page.getByRole("dialog")).toContainText(
      "Their login, attendance, salary revisions and saved offer letters are preserved.",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(state.calls.some((c) => c.name === "hr_delete_employee")).toBe(false);
    await openDelete();
    await page
      .getByRole("dialog")
      .getByLabel("Reason (optional)", { exact: true })
      .fill("Remove duplicate");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete employee", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    const call = state.calls.find((c) => c.name === "hr_delete_employee");
    expect(call.input._reason).toBe("Remove duplicate");
    if (name === "Existing Person") {
      expect(call.input._employee).toBeNull();
      expect(call.input._source_attendance).toBe("existing-attendance");
    } else {
      expect(call.input._employee).toBe(employeeId);
      expect(call.input._revision).toBe(1);
    }
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    expect(state.errors).toEqual([]);
  });

test("directory keeps row actions visible on desktop and paginates a larger team", async ({
  page,
}) => {
  const state = await mock(page);
  for (let i = 0; i < 22; i++)
    state.board.candidates.push({
      ...state.board.candidates[0],
      auth_user_id: `team-${i}`,
      attendance_employee_id: null,
      name: `Team member ${String(i).padStart(2, "0")}`,
      email: `team${i}@example.com`,
      mentor_name: "Kuldeep Shrimali",
    });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/manager/hr-hiring");
  await expect(page.getByRole("row")).toHaveCount(21);
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(6);
  await page.getByRole("combobox", { name: "Rows per page", exact: true }).selectOption("50");
  await expect(page.getByRole("row")).toHaveCount(26);
  await page.getByRole("textbox", { name: "Search employees", exact: true }).fill("Alex");
  await page.screenshot({ path: ".tmp/hr-browser/desktop-actions-wide.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const actions = page.getByRole("button", { name: "Actions for Alex Example", exact: true });
  const bounds = await actions.boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
  const managerBounds = await page
    .getByRole("row")
    .filter({ hasText: "alex@example.com" })
    .getByRole("button", { name: "Sample Mentor", exact: true })
    .boundingBox();
  const actionCellBounds = await page
    .getByRole("row")
    .filter({ hasText: "alex@example.com" })
    .locator(".hr-actions-cell")
    .boundingBox();
  expect(managerBounds.x + managerBounds.width).toBeLessThanOrEqual(actionCellBounds.x);
  await expect(actions).toBeInViewport();
  expect(
    await actions.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
  await page.screenshot({ path: ".tmp/hr-browser/desktop-actions-compact.png", fullPage: true });
  expect(state.errors).toEqual([]);
});
