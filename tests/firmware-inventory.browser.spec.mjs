import { test, expect } from "@playwright/test";
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";

async function fixture(
  page,
  { manager = false, firmware = true, failure = false, held = false, longText = false } = {},
) {
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "firmware@example.test",
    role: "authenticated",
    aud: "authenticated",
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email" },
    user_metadata: {},
  };
  const token = [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "authenticated",
        aud: "authenticated",
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
          refresh_token: "test",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
      localStorage.setItem("themeMode", "light");
      if ("Notification" in window)
        Object.defineProperty(Notification, "permission", { get: () => "denied" });
    },
    { user, token },
  );
  const product = {
    stock_id: "00000000-0000-4000-8000-000000000101",
    category: "Vibration Sensor",
    model: "Vibe Q",
    unit: "Nos",
    available: 10,
  };
  const loan = {
    id: "00000000-0000-4000-8000-000000000201",
    owner_name: "Firmware Engineer",
    taken_date: "2026-10-20",
    category: "Vibration Sensor",
    model: "Vibe Q",
    unit: "Nos",
    quantity: 3,
    returned_quantity: 0,
    reason: "Firmware validation",
    stock_before: 10,
    stock_after: 7,
    returns: [],
  };
  if (longText) {
    product.category = loan.category =
      "Firmware development and vibration validation sensor " + "X".repeat(60);
    product.model = loan.model = "Model-" + "V".repeat(80);
    loan.owner_name = "Firmware Engineer " + "N".repeat(90);
    loan.reason = "Long running test: " + "reason".repeat(120);
  }
  const loans = manager || held ? [structuredClone(loan)] : [];
  const calls = [],
    errors = [];
  let fail = failure;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https:\/\/fonts\./, (route) => route.abort());
  await page.route("**/*.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      name = url.pathname.split("/").pop();
    let data = [];
    if (url.pathname === "/auth/v1/user") data = user;
    else if (name === "profiles") data = { name: "Firmware Engineer", is_active: true };
    else if (name === "user_roles") data = [{ role: manager ? "supervisor" : "employee" }];
    else if (name === "attendance_my_account")
      data = { id: user.id, name: "Firmware Engineer", enroll_id: "1001", active: true };
    else if (name === "firmware_inventory_access") data = firmware;
    else if (name === "firmware_inventory_data") {
      calls.push({ name, args: req.postDataJSON() });
      if (fail) {
        fail = false;
        await route.fulfill({
          status: 500,
          json: { code: "XX000", message: "Inventory temporarily unavailable" },
        });
        return;
      }
      data = { products: [product], loans };
    } else if (name === "firmware_inventory_take") {
      const args = req.postDataJSON();
      calls.push({ name, args });
      const qty = args._items[0].quantity;
      loans.push({
        ...structuredClone(loan),
        taken_date: args._date,
        quantity: qty,
        reason: args._items[0].reason,
        stock_before: product.available,
        stock_after: product.available - qty,
      });
      product.available -= qty;
      data = null;
    } else if (name === "firmware_inventory_return") {
      const args = req.postDataJSON();
      calls.push({ name, args });
      const saved = loans.find((item) => item.id === args._loan);
      saved.returned_quantity += args._quantity;
      saved.returns.push({
        id: args._request,
        quantity: args._quantity,
        return_date: args._date,
        actor_name: "Firmware Engineer",
        stock_before: product.available,
        stock_after: product.available + args._quantity,
      });
      product.available += args._quantity;
      data = null;
    }
    await route.fulfill({ status: 200, json: data });
  });
  await page.goto(manager ? "/manager/inventory" : "/employee");
  if (firmware || manager)
    await page
      .getByRole("button", {
        name: manager ? "Firmware Inventory History" : "Inventory Own",
        exact: true,
      })
      .click();
  return { calls, errors };
}

test("firmware employee saves testing inventory and makes partial then full returns", async ({
  page,
}) => {
  const { calls, errors } = await fixture(page);
  await page.getByLabel("Taken date").fill("2026-10-20");
  await page.getByLabel("Category 1", { exact: true }).selectOption("Vibration Sensor");
  await page
    .getByLabel("Item 1", { exact: true })
    .selectOption("00000000-0000-4000-8000-000000000101");
  await page.getByLabel("Quantity 1", { exact: true }).fill("3");
  await page.getByLabel("Reason 1", { exact: true }).fill("Firmware validation");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Firmware Engineer", exact: true })).toBeVisible();
  expect(calls.find((c) => c.name === "firmware_inventory_take").args._items[0]).toMatchObject({
    quantity: 3,
    reason: "Firmware validation",
  });
  await page.getByRole("button", { name: "Revert / Return" }).click();
  await page.getByLabel("Return quantity", { exact: true }).fill("1");
  await page.getByLabel("Return date", { exact: true }).fill("2026-10-21");
  await page.getByRole("button", { name: "Save return", exact: true }).click();
  await expect(page.getByRole("cell", { name: /Returned 1 Nos on/ })).toContainText(
    "Firmware Engineer",
  );
  await page.getByRole("button", { name: "Revert / Return" }).click();
  await expect(page.getByLabel("Return quantity", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Save return", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Fully returned", exact: true })).toBeVisible();
  await page.screenshot({ path: ".tmp/firmware-inventory-browser/returned.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("manager can inspect and filter firmware inventory without taking or returning stock", async ({
  page,
}) => {
  const { calls, errors } = await fixture(page, { manager: true });
  await expect(page.getByRole("cell", { name: "Firmware Engineer", exact: true })).toBeVisible();
  expect(calls.find((c) => c.name === "firmware_inventory_data").args._manager).toBe(true);
  await expect(page.getByRole("button", { name: "Revert / Return" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Take inventory for testing" })).toHaveCount(0);
  await page.getByLabel("Search inventory history").fill("Someone else");
  await expect(page.getByText("No inventory records found.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile form stays within viewport and a failed load can be refreshed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await fixture(page, { failure: true });
  await expect(page.getByRole("alert")).toContainText("Inventory temporarily unavailable");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Take inventory for testing" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: ".tmp/firmware-inventory-browser/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  for (const manager of [false, true]) {
    test(`${manager ? "manager" : "employee"} inventory is responsive at ${width}px with long records`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 960 });
      const { errors } = await fixture(page, { manager, held: true, longText: true });
      await expect(
        page.getByRole("table", { name: "Firmware inventory history", exact: true }),
      ).toBeVisible();
      const assertNoOverflow = async () => {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const root = page.locator(".firmware-inventory");
        const bounds = await root.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      };
      await assertNoOverflow();
      if (!manager) {
        await page.getByLabel("Category 1", { exact: true }).selectOption({ index: 1 });
        await page.getByLabel("Item 1", { exact: true }).selectOption({ index: 1 });
        await page.getByLabel("Quantity 1", { exact: true }).fill("2");
        await page.getByLabel("Reason 1", { exact: true }).fill("Testing across screen sizes");
        if (width < 1200) {
          for (const label of ["Category 1", "Item 1", "Quantity 1", "Reason 1"]) {
            const box = await page.getByLabel(label, { exact: true }).boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
            if (width < 768 && label !== "Quantity 1")
              expect(box.width).toBeGreaterThan(width - 160);
          }
        }
        await page.getByRole("button", { name: "Revert / Return" }).click();
        await expect(page.getByLabel("Return quantity", { exact: true })).toBeFocused();
        await expect(page.getByLabel("Return quantity", { exact: true })).toBeInViewport();
        await page.getByLabel("Return quantity", { exact: true }).fill("1");
        await expect(page.getByText("After this return, you will hold")).toContainText("2 Nos");
        await assertNoOverflow();
      }
      await page.screenshot({
        path: `.tmp/firmware-inventory-browser/${manager ? "manager" : "employee"}-${width}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
}

test("other departments do not see Inventory Own", async ({ page }) => {
  await fixture(page, { firmware: false });
  await expect(page.getByRole("button", { name: "My attendance", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inventory Own", exact: true })).toHaveCount(0);
});
