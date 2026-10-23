import { test, expect } from "@playwright/test";

const associate = "00000000-0000-4000-8000-000000000002",
  site = "00000000-0000-4000-8000-000000000010",
  order = "00000000-0000-4000-8000-000000000020";
const row = (key, label, unit_price) => ({
  key,
  group_key: key.split(":")[0],
  label,
  number: 1,
  count: 1,
  model: "",
  quantity: 1,
  unit: "Nos",
  unit_price,
  received: false,
  used: false,
});

async function mock(page, manager = false) {
  const user = {
    id: manager ? "00000000-0000-4000-8000-000000000001" : associate,
    email: manager ? "nitsanghani1@gmail.com" : "associate@example.test",
    email_confirmed_at: "2026-01-01T00:00:00Z",
    role: "authenticated",
    aud: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: {},
  };
  const token = [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: "authenticated",
        role: "authenticated",
      }),
    ).toString("base64url"),
    "signature",
  ].join(".");
  await page.addInitScript(
    ({ user, token }) => {
      sessionStorage.setItem(
        "sb-finance-test-auth-token",
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
    { user, token },
  );
  const errors = [],
    calls = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const equipment = {
    legacy: false,
    required: true,
    waiting_dispatch: false,
    orders: [
      {
        id: order,
        company_name: "Factory One",
        device_id: "DM-01",
        revision: 0,
        associate_id: null,
        associate_name: null,
        confirmed_at: null,
        items: [
          row("dm:1", "Data Meter", 100),
          row("yhdcctsensor:1", "YHDC CT Sensor", 7),
          row("proximitysensor:1", "Proxy Sensor", 13),
        ],
      },
    ],
  };
  let installation = {};
  let updated = "2026-10-22T00:00:00Z";
  const factory = {
    id: site,
    name: "Factory One",
    company_name: "Factory One",
    city: "Surat",
    address: "Factory address",
    assigned_worker_id: associate,
    assigned_at: "2026-10-22T00:00:00Z",
    task_notes: `[METADATA:${JSON.stringify({ worker_ids: [associate], status: "Running", visit_status: "Panel Dispatched" })}]`,
    consultant_stage: null,
  };
  const material = {
    id: order,
    material_name: "Factory One",
    submitted: true,
    state: "In transit",
    notes: '{"logistics_status":"Transit","dm_selected":true}',
    created_at: updated,
  };
  const extraRows = () =>
    equipment.orders[0].items
      .filter((item) => item.received && !item.used)
      .map((item) => ({
        associate_id: associate,
        associate_name: "Associate A",
        group_key: item.group_key,
        label: item.label,
        model: item.model,
        unit: "Nos",
        quantity: 1,
        unit_price: item.unit_price,
        total_value: item.unit_price,
        companies: "Factory One",
      }));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.route("**/*.supabase.co/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      name = url.pathname.split("/").pop();
    let result = [];
    if (url.pathname === "/auth/v1/user") result = user;
    else if (name === "profiles")
      result = {
        id: user.id,
        name: manager ? "Manager" : "Associate A",
        email: user.email,
        is_active: true,
      };
    else if (name === "user_roles") result = [{ role: manager ? "supervisor" : "worker" }];
    else if (url.pathname.includes("/rpc/")) {
      const input = request.postDataJSON() || {};
      calls.push({ name, input });
      if (name === "field_ops_board")
        result = {
          today: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
          tracking_started: "2026-01-01",
          users: [{ id: user.id, name: "Associate A", joined: "2026-01-01", online: true }],
          attendance: [],
          rates: [],
          earnings: [],
          sites: [],
          visits: [],
          payments: [],
          date_changes: [],
        };
      else if (name === "installation_order_checklist") result = equipment;
      else if (name === "installation_confirm_order") {
        const record = equipment.orders[0];
        record.items = record.items.map((item) => ({
          ...item,
          ...input._items.find((choice) => choice.key === item.key),
        }));
        record.revision++;
        record.associate_id = associate;
        record.associate_name = "Associate A";
        record.confirmed_at = new Date().toISOString();
        result = { revision: record.revision, items: record.items };
      } else if (name === "field_associate_extra_inventory")
        result = manager
          ? [
              ...extraRows(),
              {
                associate_id: "other",
                associate_name: "Associate B",
                group_key: "towerlight",
                label: "Tower Light",
                model: "",
                quantity: 2,
                unit: "Nos",
                unit_price: 50,
                total_value: 100,
                companies: "Factory Two",
              },
            ]
          : extraRows();
      else if (name === "has_limited_manager_access") result = false;
      else if (name === "can_access_site" || name === "is_staff") result = true;
    } else if (name === "sites") result = [factory];
    else if (name === "inventory_materials") result = [material];
    else if (name === "assessment")
      result = [
        {
          site_id: site,
          data: {
            assessment_phase_submitted: true,
            factory_operations_done: true,
            mom_uploaded: true,
            media_uploaded: true,
          },
          updated_at: updated,
        },
      ];
    else if (name === "installation") {
      if (request.method() === "PATCH" || request.method() === "POST") {
        const record = request.postDataJSON();
        calls.push({ name: "installation_write", input: record });
        installation = record.data;
        updated = record.updated_at;
      }
      result = [{ site_id: site, data: installation, updated_at: updated }];
    }
    await route.fulfill({ json: result });
  });
  return { calls, errors, equipment };
}

test("Installation requires confirmation, separates missing items from extras, and shows the associate's inventory", async ({
  page,
}) => {
  const { calls, errors } = await mock(page);
  await page.goto("/business-consultant");
  await page.getByRole("button", { name: /Total/ }).click();
  await page.getByRole("button", { name: "Start / Continue" }).click();
  await page
    .getByRole("button", { name: /Installation/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Device Order Confirmation" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Used Data Meter", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Submit Installation Phase", exact: true }).click();
  await expect(
    page.getByText("Confirm received and used equipment for every order first.").first(),
  ).toBeVisible();
  expect(
    calls.some(
      (call) => call.name === "installation_write" && call.input.data.installation_phase_submitted,
    ),
  ).toBeFalsy();
  await page
    .getByRole("checkbox", { name: "Received Data Meter", exact: true })
    .locator("..")
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Received Data Meter", exact: true }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Used Data Meter", exact: true }).locator("..").click();
  await page
    .getByRole("checkbox", { name: "Received YHDC CT Sensor", exact: true })
    .locator("..")
    .click();
  await page
    .getByRole("checkbox", { name: /I have checked every item/ })
    .locator("..")
    .click();
  await page.getByRole("button", { name: "Confirm Received & Used Items" }).click();
  await expect(
    page
      .getByText("Equipment confirmed. Received but unused items are in your extra inventory.")
      .first(),
  ).toBeVisible();
  const confirmation = calls.find((call) => call.name === "installation_confirm_order");
  expect(confirmation.input._items).toEqual([
    { key: "dm:1", received: true, used: true },
    { key: "yhdcctsensor:1", received: true, used: false },
    { key: "proximitysensor:1", received: false, used: false },
  ]);
  await page.getByRole("button", { name: "Submit Installation Phase", exact: true }).click();
  await expect.poll(() => calls.some(call => call.name === "installation_write" && call.input.data.installation_phase_submitted)).toBeTruthy();
  await page.getByRole("button", { name: "My Inventory", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Extra Inventory" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "YHDC CT Sensor", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Proxy Sensor", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("manager can filter field associate extra inventory with quantities and prices", async ({
  page,
}) => {
  const { errors, equipment } = await mock(page, true);
  equipment.orders[0].items[1].received = true;
  await page.goto("/manager/inventory");
  await page.getByRole("button", { name: "Field Associate Inventory", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Field Associate Extra Inventory" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Associate A", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Associate B", exact: true })).toBeVisible();
  await page.getByLabel("Field associate", { exact: true }).selectOption(associate);
  await expect(page.getByRole("cell", { name: "Associate B", exact: true })).toHaveCount(0);
  await expect(page.getByText("1 extra item · Total value: ₹7.00")).toBeVisible();
  expect(errors).toEqual([]);
});
