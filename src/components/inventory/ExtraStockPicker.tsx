import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Boxes, RefreshCw } from "lucide-react";
import { Button, Input, Label } from "@/components/ui-kit";
import { associateInventoryRpc, type ExtraStockOptions } from "@/lib/associate-inventory";

// Logistics chooses, before In Packing, how many units of each device/sensor
// come from the ordering field associate's extra stock instead of central stock.
export function ExtraStockPicker({
  orderId,
  editable,
  refreshKey,
}: {
  orderId: string;
  editable: boolean;
  refreshKey?: string | null;
}) {
  const [options, setOptions] = useState<ExtraStockOptions | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const apply = useCallback((next: ExtraStockOptions) => {
    setOptions(next);
    setDraft(Object.fromEntries(next.items.map((item) => [item.group_key, item.selected])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      apply(
        await associateInventoryRpc<ExtraStockOptions>("logistics_extra_stock_options", {
          _order: orderId,
        }),
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not load field associate extra stock.",
      );
    } finally {
      setLoading(false);
    }
  }, [apply, orderId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <p role="status" className="text-xs text-text-secondary">
        Checking field associate extra stock…
      </p>
    );
  }
  if (error) {
    if (!editable) return null;
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3 text-xs"
      >
        <span>{error}</span>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void load()}
          className="h-7 px-2.5 text-[10px]"
        >
          Retry
        </Button>
      </div>
    );
  }
  if (!options || !options.items.length) {
    if (options && !options.eligible && options.reason && !options.locked) return null;
    return options?.locked ? null : (
      <p className="text-[10px] text-text-secondary">
        {options?.associate_name || "The field associate"} has no extra stock that matches this
        order.
      </p>
    );
  }

  const changed = options.items.some((item) => (draft[item.group_key] ?? 0) !== item.selected);
  const canEdit = editable && !options.locked && options.eligible;
  const maxFor = (item: ExtraStockOptions["items"][number]) =>
    Math.min(item.required, item.available);

  async function save() {
    if (!options) return;
    setSaving(true);
    try {
      const next = await associateInventoryRpc<ExtraStockOptions>("logistics_set_extra_stock", {
        _order: orderId,
        _items: options.items.map((item) => ({
          group_key: item.group_key,
          quantity: draft[item.group_key] ?? 0,
        })),
      });
      apply(next);
      toast.success("Extra stock choice saved. It is applied when the order is marked In Packing.");
    } catch (failure) {
      toast.error(
        failure instanceof Error ? failure.message : "Could not save extra stock choice.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-lime/40 bg-lime/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Boxes size={16} className="mt-0.5 shrink-0 text-lime" />
          <div>
            <Label className="text-text-primary font-bold text-xs uppercase tracking-wider">
              {options.locked
                ? "Used from field associate's extra stock"
                : "Field associate extra stock"}
            </Label>
            <p className="text-[10px] text-text-secondary mt-0.5">
              {options.locked
                ? `These units were taken from ${options.associate_name}'s extra inventory, not central stock.`
                : `${options.associate_name} already holds these items. Choose how many to use instead of central stock. Save before marking In Packing.`}
            </p>
          </div>
        </div>
        {!options.locked && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void load()}
            disabled={saving}
            className="h-7 px-2 shrink-0"
            aria-label="Refresh extra stock"
          >
            <RefreshCw size={12} />
          </Button>
        )}
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        {options.items.map((item) => {
          const chosen = draft[item.group_key] ?? 0;
          const fromStock = Math.max(item.required - chosen, 0);
          const label = `${item.label}${item.model ? ` (${item.model})` : ""}`;
          return (
            <div
              key={item.group_key}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface p-3"
            >
              <div className="min-w-0 space-y-0.5">
                <span className="block text-xs font-extrabold text-text-primary">{label}</span>
                <span className="block text-[10px] text-text-secondary">
                  {options.locked
                    ? `${item.selected} from associate's extra stock`
                    : `Need ${item.required} · Associate has ${item.available} extra`}
                </span>
                {!options.locked && (
                  <span className="block text-[10px] font-mono text-success">
                    {fromStock} from stock{chosen > 0 ? ` + ${chosen} from extra stock` : ""}
                  </span>
                )}
              </div>
              {canEdit ? (
                <Input
                  type="number"
                  min={0}
                  max={maxFor(item)}
                  step={1}
                  value={chosen}
                  aria-label={`Units of ${label} from extra stock`}
                  onChange={(event) => {
                    const value = Math.floor(Number(event.target.value) || 0);
                    setDraft((previous) => ({
                      ...previous,
                      [item.group_key]: Math.min(Math.max(value, 0), maxFor(item)),
                    }));
                  }}
                  className="w-16 shrink-0 text-center"
                />
              ) : (
                <span className="shrink-0 font-mono text-sm font-bold text-lime">
                  {item.selected}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || !changed}
            className="h-8 px-3 text-xs"
          >
            {saving && <RefreshCw size={12} className="animate-spin mr-1.5" />}
            Save Extra Stock Choice
          </Button>
        </div>
      )}
    </div>
  );
}
