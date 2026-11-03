import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronRight, Boxes } from "lucide-react";
import { Button, Card, Input, Label, Select } from "@/components/ui-kit";
import {
  associateInventoryRpc,
  type AssociateExtraItem,
  type AssociateExtraCompany,
  type AssociateExtraUsage,
} from "@/lib/associate-inventory";

const price = (value: number | null) =>
  value == null
    ? "Price unavailable"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const formatDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dateFormatter.format(parsed);
};

// Prefer the structured array; fall back to splitting the comma-joined string.
const companyList = (item: AssociateExtraItem): string[] => {
  const list = Array.isArray(item.company_list)
    ? item.company_list.filter((name): name is string => Boolean(name && name.trim()))
    : [];
  if (list.length) return list;
  return (item.companies ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
};

// Per-company quantity breakdown. When the backend breakdown isn't available
// yet (migration not applied), fall back to the plain company list with an
// unknown quantity so the UI still lists the companies.
const companyBreakdown = (item: AssociateExtraItem): AssociateExtraCompany[] => {
  if (Array.isArray(item.company_breakdown) && item.company_breakdown.length) {
    return item.company_breakdown.filter((row) => row && row.company);
  }
  return companyList(item).map((company) => ({
    company,
    quantity: NaN,
    total_value: null,
    last_confirmed_at: item.last_confirmed_at ?? null,
  }));
};

// What happened to units logistics assigned from extra stock to a later order,
// based on that order's installation confirmation.
function reuseOutcome(use: AssociateExtraUsage, unit: string) {
  const installed = use.installed ?? use.quantity;
  const returned = use.returned ?? 0;
  switch (use.outcome) {
    case "pending":
      return {
        label: `🕓 Assigned to this order · awaiting installation`,
        change: `−${use.quantity} ${unit}`,
        tone: "text-text-secondary",
      };
    case "returned":
      return {
        label: `↩ Not used here · returned to extra stock`,
        change: null,
        tone: "text-lime",
      };
    case "partial":
      return {
        label: `✅ ${installed} installed · ↩ ${returned} not used, returned to extra stock`,
        change: `−${installed} ${unit}`,
        tone: "text-warning",
      };
    default:
      return {
        label: `✅ Installed here`,
        change: `−${installed} ${unit}`,
        tone: "text-warning",
      };
  }
}

// Detail table: one row per sensor/item, with its source company and the date
// it was confirmed/sent.
function ItemsTable({ items }: { items: AssociateExtraItem[] }) {
  return (
    <div className="overflow-x-auto rounded-[8px] border border-border">
      <table className="w-full min-w-[820px] text-sm text-left">
        <thead>
          <tr className="border-b border-border bg-surface-raised/40 font-mono text-[10px] uppercase tracking-widest text-text-secondary">
            <th className="px-3 py-2.5 font-semibold">Item</th>
            <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
            <th className="px-3 py-2.5 text-right font-semibold">Unit price</th>
            <th className="px-3 py-2.5 text-right font-semibold">Total value</th>
            <th className="px-3 py-2.5 font-semibold">Sent / confirmed</th>
            <th className="px-3 py-2.5 font-semibold">Source company</th>
            <th className="px-3 py-2.5 font-semibold">Reuse history</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const breakdown = companyBreakdown(item);
            const confirmedOn = formatDate(item.last_confirmed_at);
            return (
              <tr
                key={`${item.associate_id}:${item.group_key}:${item.model}`}
                className="border-b border-border/50 align-top last:border-0 hover:bg-surface-raised/30"
              >
                <td className="px-3 py-3">
                  <span className="font-medium text-text-primary">{item.label}</span>
                  {item.model && (
                    <span className="block text-xs text-text-secondary">{item.model}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap font-semibold">
                  {item.quantity}
                  <span className="ml-1 text-xs font-normal text-text-secondary">{item.unit}</span>
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap">{price(item.unit_price)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap font-semibold">
                  {price(item.total_value)}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-text-secondary">
                  {confirmedOn ?? "—"}
                </td>
                <td className="px-3 py-3">
                  {breakdown.length ? (
                    <div className="space-y-1">
                      {breakdown.map((row) => (
                        <div
                          key={row.company}
                          className="flex items-center justify-between gap-3 rounded-[4px] bg-surface-raised px-2 py-1"
                        >
                          <span className="min-w-0 text-xs text-text-primary" title={row.company}>
                            {row.company}
                          </span>
                          <span className="shrink-0 whitespace-nowrap font-mono text-xs font-semibold text-lime">
                            {Number.isNaN(row.quantity) ? "—" : `${row.quantity} ${item.unit}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {item.usage_history?.length ? (
                    <div className="space-y-1">
                      {item.usage_history.map((use) => {
                        const outcome = reuseOutcome(use, item.unit);
                        return (
                          <div
                            key={use.order_id}
                            className="rounded-[4px] bg-surface-raised px-2 py-1 text-xs"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="min-w-0 text-text-primary" title={use.company}>
                                {use.company}
                                {use.device_id ? ` · ${use.device_id}` : ""}
                              </span>
                              {outcome.change && (
                                <span
                                  className={`shrink-0 whitespace-nowrap font-mono font-semibold ${outcome.tone}`}
                                >
                                  {outcome.change}
                                </span>
                              )}
                            </div>
                            <span className={`block text-[11px] font-medium ${outcome.tone}`}>
                              {outcome.label}
                            </span>
                            <span className="block text-[10px] text-text-secondary">
                              Assigned {formatDate(use.used_at) ?? "—"} · by {use.selected_by}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AssociateExtraInventory({ manager = false }: { manager?: boolean }) {
  const [items, setItems] = useState<AssociateExtraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [associate, setAssociate] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void associateInventoryRpc<AssociateExtraItem[]>("field_associate_extra_inventory")
      .then((result) => {
        if (active) setItems(result);
      })
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : "Could not load extra inventory.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const associates = [
    ...new Map(items.map((item) => [item.associate_id, item.associate_name])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = items.filter(
    (item) =>
      (!associate || item.associate_id === associate) &&
      `${item.associate_name} ${item.label} ${item.model} ${item.companies}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const units = filtered.reduce((sum, item) => sum + Number(item.quantity), 0);
  const total = filtered.every((item) => item.total_value != null)
    ? filtered.reduce((sum, item) => sum + Number(item.total_value), 0)
    : null;

  // Field associate-wise roll-up: each associate with their item count, total
  // units and total amount. Expanding one reveals the per-sensor detail.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        items: AssociateExtraItem[];
        units: number;
        total: number;
        totalKnown: boolean;
      }
    >();
    for (const item of filtered) {
      let group = map.get(item.associate_id);
      if (!group) {
        group = {
          id: item.associate_id,
          name: item.associate_name,
          items: [],
          units: 0,
          total: 0,
          totalKnown: true,
        };
        map.set(item.associate_id, group);
      }
      group.items.push(item);
      group.units += Number(item.quantity);
      if (item.total_value == null) group.totalKnown = false;
      else group.total += Number(item.total_value);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h2 className="font-syne text-xl font-bold">
            {manager ? "Field Associate Extra Inventory" : "My Extra Inventory"}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Devices and sensors confirmed as received but unused during installation, less any units
            logistics reused on later orders.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw size={14} className={loading ? "animate-spin mr-2" : "mr-2"} />
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="extra-inventory-search">Search inventory</Label>
          <Input
            id="extra-inventory-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Item, model, company, or associate"
          />
        </div>
        {manager && (
          <div>
            <Label htmlFor="extra-inventory-associate">Field associate</Label>
            <Select
              id="extra-inventory-associate"
              value={associate}
              onChange={(event) => setAssociate(event.target.value)}
            >
              <option value="">All field associates</option>
              {associates.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      {loading ? (
        <p role="status">Loading extra inventory…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !filtered.length ? (
        <p className="text-sm text-text-secondary">
          {items.length ? "No matching extra items." : "No extra devices or sensors recorded yet."}
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold">
            {units} extra {units === 1 ? "item" : "items"} · Total value: {price(total)}
            {manager && (
              <span className="text-text-secondary font-normal">
                {" "}
                · {groups.length} field {groups.length === 1 ? "associate" : "associates"}
              </span>
            )}
          </p>

          {manager ? (
            <div className="space-y-2.5">
              {groups.map((group) => {
                const open = expanded.has(group.id);
                return (
                  <div
                    key={group.id}
                    className="rounded-[8px] border border-border overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(group.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised/40"
                    >
                      <ChevronRight
                        size={16}
                        className={`shrink-0 text-text-secondary transition-transform ${open ? "rotate-90" : ""}`}
                      />
                      <Boxes size={16} className="shrink-0 text-lime" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-text-primary">
                          {group.name}
                        </span>
                        <span className="block text-xs text-text-secondary">
                          {group.units} {group.units === 1 ? "item" : "items"} ·{" "}
                          {group.items.filter((item) => Number(item.quantity) > 0).length}{" "}
                          {group.items.filter((item) => Number(item.quantity) > 0).length === 1
                            ? "type"
                            : "types"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold text-text-primary">
                          {price(group.totalKnown ? group.total : null)}
                        </span>
                        <span className="block font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                          {open ? "Hide details" : "View details"}
                        </span>
                      </span>
                    </button>
                    {open && (
                      <div className="border-t border-border bg-surface-raised/20 p-3">
                        <ItemsTable items={group.items} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <ItemsTable items={filtered} />
          )}

          <p className="text-xs text-text-secondary">
            Prices come from manager inventory at dispatch or first confirmation. Values stay fixed
            for that order; mixed prices are shown as an average unit price.
          </p>
        </>
      )}
    </Card>
  );
}
