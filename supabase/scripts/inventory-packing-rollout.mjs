export function inventoryPackingRolloutSql(migration) {
  const hash = (table, alias, exclude = "") => `(SELECT md5(coalesce(jsonb_agg(${exclude ? `(to_jsonb(${alias})-'${exclude}')` : `to_jsonb(${alias})`} ORDER BY ${alias}.${table === "inventory_dispatch_deductions" ? "order_id" : "id"})::text,'[]')) FROM public.${table} ${alias})`;
  const fingerprint = `SELECT ${hash("inventory_stock", "s")} stock,${hash("inventory_materials", "m")} orders,${hash("inventory_bom_items", "b")} bom,${hash("inventory_logs", "l")} logs,${hash("inventory_dispatch_deductions", "d", "packing_policy")} receipts`;
  const snapshot = `SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='45s';
LOCK TABLE public.inventory_materials,public.inventory_stock,public.inventory_logs,public.inventory_dispatch_deductions,public.inventory_bom_items IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE packing_before ON COMMIT DROP AS ${fingerprint};`;
  const validation = `DO $$ BEGIN
IF EXISTS(SELECT * FROM packing_before EXCEPT ${fingerprint}) THEN
RAISE EXCEPTION 'Packing rollout changed existing business data; rolling back'; END IF;
END $$;`;
  return migration.replace(/^BEGIN;/m, () => `BEGIN;\n${snapshot}`)
    .replace(/COMMIT;\s*$/, () => `${validation}\nCOMMIT;`)
    + `\nSELECT jsonb_build_object('balances_orders_bom_logs_receipts_preserved',true,'packing_activated_at',packing_activated_at,'original_cutoff',activated_at,'excluded_orders',(SELECT count(*) FROM inventory_dispatch_excluded_orders)) verification FROM inventory_dispatch_settings WHERE id=true;`;
}
