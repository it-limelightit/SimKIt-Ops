# Firmware testing inventory

Apply `supabase/migrations/20261028120000_firmware_inventory.sql` to the application database before deploying the frontend. It requires the existing inventory dispatch, packing, attendance employee accounts and field inventory migrations. Applying this migration creates empty firmware ledgers and functions; it does not deduct existing stock or create historical transactions.

Active linked office accounts in the `firmware` department see **Inventory Own** in the employee portal. They can save up to 50 distinct products at once, with a taken date, quantity and reason for each item. Availability combines real stock receipts for the same component, model and unit, excludes bulk purchase plans, and deducts receipts in FIFO order. Save either commits every item or commits nothing.

Each person sees their own records and can use **Revert / Return** to return some or all of the outstanding quantity. Every return has its own date, quantity, actor and stock balances. Return dates cannot precede the taken date or previous return events, or be in the future. Quantities use whole items except meters, which support two decimal places. Request IDs prevent repeated saves from applying twice.

Inventory managers can use **Manager → Inventory → Firmware Inventory History** to view and search all holders and filter outstanding or fully returned items. Central inventory and dispatch use the same actual stock balances. Managers have read access to firmware history; returns are recorded by the holder.

Receipt allocations retain references to original stock rows, so those rows cannot be deleted. If an original receipt's category, model or unit is changed while a person holds stock, restore its original identity before returning that stock. This prevents a return from crediting a different product.

Validation:

- `npm run test:inventory`
- `npx playwright test --config playwright.firmware-inventory.config.mjs`

Browser tests use mocked API responses; database tests execute the migration and RPCs in PostgreSQL via PGlite, including the existing dispatch trigger.
