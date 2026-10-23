import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Card, Checkbox } from "@/components/ui-kit";
import {
  associateInventoryRpc,
  equipmentCounts,
  type InstallationEquipmentChecklist,
  type InstallationEquipmentItem,
} from "@/lib/associate-inventory";

export type InstallationChecklistHandle = { validate: () => Promise<boolean> };

export const InstallationOrderChecklist = forwardRef<
  InstallationChecklistHandle,
  { siteId: string; workerId: string }
>(function InstallationOrderChecklist({ siteId, workerId }, ref) {
  const [board, setBoard] = useState<InstallationEquipmentChecklist | null>(null);
  const [drafts, setDrafts] = useState<Record<string, InstallationEquipmentItem[]>>({});
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scope = `${siteId}:${workerId}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;

  const load = useCallback(async () => {
    const next = await associateInventoryRpc<InstallationEquipmentChecklist>(
      "installation_order_checklist",
      { _site: siteId },
    );
    if (activeScope.current !== scope) return null;
    setBoard(next);
    setDrafts(Object.fromEntries(next.orders.map((order) => [order.id, order.items])));
    setDirty({});
    setReviewed({});
    return next;
  }, [siteId, scope]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setBoard(null);
    setError("");
    void load()
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : "Could not load equipment.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  useImperativeHandle(
    ref,
    () => ({
      validate: async () => {
        if (loading || busy || !board || error) {
          toast.error("Load the device order confirmation before submitting Installation.");
          return false;
        }
        if (Object.values(dirty).some(Boolean)) {
          toast.error("Confirm your equipment changes before submitting Installation.");
          return false;
        }
        try {
          const latest = await associateInventoryRpc<InstallationEquipmentChecklist>(
            "installation_order_checklist",
            { _site: siteId },
          );
          if (activeScope.current !== scope) return false;
          if (latest.waiting_dispatch) {
            toast.error(
              "Wait for the device order to be dispatched before submitting Installation.",
            );
            return false;
          }
          if (latest.orders.some((order) => !order.confirmed_at)) {
            toast.error("Confirm received and used equipment for every order first.");
            return false;
          }
          return true;
        } catch (failure) {
          toast.error(
            failure instanceof Error ? failure.message : "Could not verify equipment confirmation.",
          );
          return false;
        }
      },
    }),
    [board, busy, dirty, error, loading, scope, siteId],
  );

  function change(orderId: string, key: string, field: "received" | "used", value: boolean) {
    setDrafts((previous) => ({
      ...previous,
      [orderId]: previous[orderId].map((item) =>
        item.key !== key
          ? item
          : {
              ...item,
              [field]: value,
              ...(field === "received" && !value ? { used: false } : {}),
            },
      ),
    }));
    setDirty((previous) => ({ ...previous, [orderId]: true }));
    setReviewed((previous) => ({ ...previous, [orderId]: false }));
  }

  return (
    <Card className="border-l-[3px] border-violet p-5 space-y-4">
      <div>
        <h3 className="font-syne font-bold text-lg">Device Order Confirmation</h3>
        <p className="text-sm text-text-secondary mt-1">
          Confirm each dispatched item. Mark Received when it arrived and Used when installed.
          Received items left unused go to your extra inventory.
        </p>
      </div>
      {loading ? (
        <p role="status">Loading dispatched equipment…</p>
      ) : error ? (
        <div role="alert" className="space-y-2">
          <p>{error}</p>
          <Button
            variant="secondary"
            onClick={async () => {
              setLoading(true);
              setError("");
              try {
                await load();
              } catch (failure) {
                setError(failure instanceof Error ? failure.message : "Could not load equipment.");
              } finally {
                setLoading(false);
              }
            }}
          >
            Retry
          </Button>
        </div>
      ) : board?.legacy ? (
        <p className="text-sm text-text-secondary">
          This installation was completed before equipment confirmation was introduced. Its records
          are unchanged.
        </p>
      ) : board?.waiting_dispatch ? (
        <p role="alert" className="text-sm text-warning">
          The device order has not been dispatched yet. Confirm its contents after dispatch, before
          submitting Installation.
        </p>
      ) : !board?.orders.length ? (
        <p className="text-sm text-text-secondary">
          No dispatched device orders are linked to this company.
        </p>
      ) : (
        board.orders.map((order) => {
          const items = drafts[order.id] || order.items;
          const counts = equipmentCounts(items);
          const canEdit = !order.associate_id || order.associate_id === workerId;
          return (
            <fieldset
              key={order.id}
              disabled={busy || !canEdit}
              className="border border-border rounded-lg p-4 space-y-4 min-w-0"
            >
              <legend className="font-semibold px-2">
                {order.company_name}
                {order.device_id ? ` · ${order.device_id}` : ""}
              </legend>
              {order.confirmed_at && (
                <p className="text-xs text-text-secondary">
                  Confirmed by {order.associate_name || "field associate"}
                  {dirty[order.id] ? " · Unsaved changes" : ""}
                </p>
              )}
              {!items.length ? (
                <p className="text-sm">No devices or sensors in this order.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="p-2">Item</th>
                        <th className="p-2 text-center">Received</th>
                        <th className="p-2 text-center">Used</th>
                        <th className="p-2">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const label = `${item.label}${item.model ? ` (${item.model})` : ""}${item.count > 1 ? ` · ${item.number} of ${item.count}` : ""}`;
                        return (
                          <tr key={item.key} className="border-b border-border/50">
                            <td className="p-2 font-medium">{label}</td>
                            <td className="p-2">
                              <div className="flex justify-center">
                                <Checkbox
                                  checked={item.received}
                                  onCheckedChange={(value) =>
                                    change(order.id, item.key, "received", value)
                                  }
                                  label={<span className="sr-only">Received {label}</span>}
                                />
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="flex justify-center">
                                <Checkbox
                                  checked={item.used}
                                  disabled={!item.received}
                                  onCheckedChange={(value) =>
                                    change(order.id, item.key, "used", value)
                                  }
                                  label={<span className="sr-only">Used {label}</span>}
                                />
                              </div>
                            </td>
                            <td className="p-2 text-xs">
                              {item.used
                                ? "Installed"
                                : item.received
                                  ? "Extra inventory"
                                  : "Not received"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-text-secondary">
                {counts.received} received · {counts.used} used · {counts.extra} extra ·{" "}
                {counts.missing} not received
              </p>
              {canEdit && (
                <>
                  <Checkbox
                    checked={!!reviewed[order.id]}
                    onCheckedChange={(value) =>
                      setReviewed((previous) => ({ ...previous, [order.id]: value }))
                    }
                    label="I have checked every item, including items not received or not used."
                  />
                  <Button
                    type="button"
                    disabled={busy || !reviewed[order.id]}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const saved = await associateInventoryRpc<{
                          revision: number;
                          items: InstallationEquipmentItem[];
                        }>("installation_confirm_order", {
                          _site: siteId,
                          _order: order.id,
                          _revision: order.revision,
                          _items: items.map((item) => ({
                            key: item.key,
                            received: item.received,
                            used: item.used,
                          })),
                        });
                        if (activeScope.current !== scope) return;
                        setBoard(
                          (previous) =>
                            previous && {
                              ...previous,
                              orders: previous.orders.map((row) =>
                                row.id !== order.id
                                  ? row
                                  : {
                                      ...row,
                                      revision: saved.revision,
                                      items: saved.items,
                                      associate_id: workerId,
                                      associate_name: row.associate_name || "you",
                                      confirmed_at: row.confirmed_at || new Date().toISOString(),
                                    },
                              ),
                            },
                        );
                        setDrafts((previous) => ({ ...previous, [order.id]: saved.items }));
                        setDirty((previous) => ({ ...previous, [order.id]: false }));
                        setReviewed((previous) => ({ ...previous, [order.id]: false }));
                        toast.success(
                          "Equipment confirmed. Received but unused items are in your extra inventory.",
                        );
                      } catch (failure) {
                        if (activeScope.current === scope)
                          toast.error(
                            failure instanceof Error
                              ? failure.message
                              : "Could not confirm equipment.",
                          );
                      } finally {
                        if (activeScope.current === scope) setBusy(false);
                      }
                    }}
                  >
                    {busy
                      ? "Saving…"
                      : order.confirmed_at
                        ? "Update Confirmation"
                        : "Confirm Received & Used Items"}
                  </Button>
                </>
              )}
            </fieldset>
          );
        })
      )}
    </Card>
  );
});
