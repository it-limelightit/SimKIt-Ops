import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Card, Input, Label, Select } from "@/components/ui-kit";
import { associateInventoryRpc, type AssociateExtraItem } from "@/lib/associate-inventory";

const price = (value: number | null) =>
  value == null
    ? "Price unavailable"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);

export function AssociateExtraInventory({ manager = false }: { manager?: boolean }) {
  const [items, setItems] = useState<AssociateExtraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [associate, setAssociate] = useState("");
  const [query, setQuery] = useState("");
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

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h2 className="font-syne text-xl font-bold">
            {manager ? "Field Associate Extra Inventory" : "My Extra Inventory"}
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Devices and sensors confirmed as received but unused during installation.
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
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border">
                  {manager && <th className="p-3">Field associate</th>}
                  <th className="p-3">Item</th>
                  <th className="p-3">Quantity</th>
                  <th className="p-3">Unit price</th>
                  <th className="p-3">Total value</th>
                  <th className="p-3">Source company</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={`${item.associate_id}:${item.group_key}:${item.model}`}
                    className="border-b border-border/50"
                  >
                    {manager && <td className="p-3 font-semibold">{item.associate_name}</td>}
                    <td className="p-3">
                      {item.label}
                      {item.model && (
                        <span className="block text-xs text-text-secondary">{item.model}</span>
                      )}
                    </td>
                    <td className="p-3">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="p-3 whitespace-nowrap">{price(item.unit_price)}</td>
                    <td className="p-3 whitespace-nowrap">{price(item.total_value)}</td>
                    <td className="p-3">{item.companies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-secondary">
            Prices come from manager inventory at dispatch or first confirmation. Values stay fixed
            for that order; mixed prices are shown as an average unit price.
          </p>
        </>
      )}
    </Card>
  );
}
