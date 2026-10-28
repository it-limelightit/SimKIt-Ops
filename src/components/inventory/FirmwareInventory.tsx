import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui-kit";
import {
  firmwareInventoryRpc,
  type FirmwareInventoryData,
  type FirmwareLoan,
} from "@/lib/firmware-inventory";
import { indiaDate, dateLabel } from "@/lib/device-attendance";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import "./firmware-inventory.css";

type Draft = { id: string; category: string; stock_id: string; quantity: string; reason: string };
const newDraft = (): Draft => ({
  id: crypto.randomUUID(),
  category: "",
  stock_id: "",
  quantity: "",
  reason: "",
});
const quantityLabel = (value: number, unit: string) =>
  `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${unit}`;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Could not update inventory.";

export function FirmwareInventory({ manager = false }: { manager?: boolean }) {
  const [data, setData] = useState<FirmwareInventoryData>({ products: [], loans: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [drafts, setDrafts] = useState<Draft[]>(() => [newDraft()]);
  const [takenDate, setTakenDate] = useState(indiaDate);
  const takeRequest = useRef(crypto.randomUUID());
  const returnRequest = useRef(crypto.randomUUID());
  const [returnLoan, setReturnLoan] = useState<FirmwareLoan | null>(null);
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnDate, setReturnDate] = useState(indiaDate);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const returnPanel = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(
        await firmwareInventoryRpc<FirmwareInventoryData>("firmware_inventory_data", {
          _manager: manager,
        }),
      );
    } catch (failure) {
      setError(message(failure));
    } finally {
      setLoading(false);
    }
  }, [manager]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!returnLoan) return;
    returnPanel.current?.scrollIntoView({ block: "center", behavior: "instant" });
    returnPanel.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [returnLoan]);

  function updateDraft(id: string, changes: Partial<Draft>) {
    setDrafts((rows) => rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    takeRequest.current = crypto.randomUUID();
  }
  async function take(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (new Set(drafts.map((row) => row.stock_id)).size !== drafts.length) {
      toast.error("Select each item once and enter its total quantity.");
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      await firmwareInventoryRpc("firmware_inventory_take", {
        _request: takeRequest.current,
        _date: takenDate,
        _items: drafts.map((row) => ({
          stock_id: row.stock_id,
          quantity: Number(row.quantity),
          reason: row.reason.trim(),
        })),
      });
      setDrafts([newDraft()]);
      takeRequest.current = crypto.randomUUID();
      toast.success("Inventory recorded. Central stock has been deducted.");
      await load();
    } catch (failure) {
      toast.error(message(failure));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function returnItems(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !returnLoan) return;
    busy.current = true;
    setSaving(true);
    try {
      await firmwareInventoryRpc("firmware_inventory_return", {
        _request: returnRequest.current,
        _loan: returnLoan.id,
        _quantity: Number(returnQuantity),
        _date: returnDate,
      });
      setReturnLoan(null);
      toast.success("Return recorded. Central stock has been restored.");
      await load();
    } catch (failure) {
      toast.error(message(failure));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const filtered = data.loans.filter(
    (loan) =>
      `${loan.category} ${loan.model} ${loan.owner_name} ${loan.reason}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "all" ||
        (status === "held"
          ? Number(loan.quantity) > Number(loan.returned_quantity)
          : Number(loan.quantity) === Number(loan.returned_quantity))),
  );
  const held = data.loans.filter((loan) => Number(loan.quantity) > Number(loan.returned_quantity));
  const returnCount = data.loans.reduce((sum, loan) => sum + loan.returns.length, 0);
  const selectedProducts = drafts.filter((row) => row.stock_id).length;
  const returnOutstanding = returnLoan
    ? Number((Number(returnLoan.quantity) - Number(returnLoan.returned_quantity)).toFixed(2))
    : 0;

  return (
    <div className="firmware-inventory">
      <div className="fi-hero">
        <div className="fi-heading">
          <span className="fi-hero-icon" aria-hidden="true">
            <Boxes size={24} />
          </span>
          <div className="min-w-0">
            <span className="fi-eyebrow">Firmware workspace</span>
            <h2>{manager ? "Firmware Inventory History" : "Inventory Own"}</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {manager
                ? "Track who holds testing inventory and every return to central stock."
                : "Record items taken for testing. Return some or all of an item when testing is complete."}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || saving}
          onClick={() => void load()}
        >
          <RefreshCw size={15} aria-hidden="true" className={loading ? "fi-spin" : ""} />
          Refresh
        </Button>
      </div>
      {error && (
        <div role="alert" className="fi-alert">
          <AlertCircle size={18} aria-hidden="true" />
          {error}
        </div>
      )}
      {loading ? (
        <div role="status" className="fi-loading">
          <LoaderCircle size={22} className="fi-spin" aria-hidden="true" />
          Loading inventory...
        </div>
      ) : (
        <>
          <div className="fi-stats" aria-label="Inventory summary">
            <div className="fi-stat">
              <span className="fi-stat-icon">
                <Boxes size={20} aria-hidden="true" />
              </span>
              <div>
                <p>Still held</p>
                <strong>{held.length}</strong>
                <span> {held.length === 1 ? "item record" : "item records"}</span>
              </div>
            </div>
            <div className="fi-stat">
              <span className="fi-stat-icon fi-success">
                <PackageCheck size={20} aria-hidden="true" />
              </span>
              <div>
                <p>Fully returned</p>
                <strong>{data.loans.length - held.length}</strong>
                <span>
                  {" "}
                  {data.loans.length - held.length === 1 ? "item record" : "item records"}
                </span>
              </div>
            </div>
            <div className="fi-stat">
              <span className="fi-stat-icon">
                <RotateCcw size={20} aria-hidden="true" />
              </span>
              <div>
                <p>Return activity</p>
                <strong>{returnCount}</strong>
                <span> {returnCount === 1 ? "recorded return" : "recorded returns"}</span>
              </div>
            </div>
          </div>
          {!manager && (
            <Card className="fi-panel">
              <div className="fi-panel-heading">
                <div>
                  <h3>
                    <ArrowUpRight size={19} aria-hidden="true" />
                    Take inventory for testing
                  </h3>
                  <p>Choose your items and record why you need them.</p>
                </div>
                <span className="fi-chip">Central stock</span>
              </div>
              <form onSubmit={(event) => void take(event)}>
                <fieldset disabled={saving || !!error} className="space-y-4">
                  <div className="fi-date-row">
                    <label className="fi-field fi-taken-date">
                      <span>
                        <CalendarDays size={14} aria-hidden="true" />
                        Taken date
                      </span>
                      <Input
                        aria-label="Taken date"
                        type="date"
                        required
                        max={indiaDate()}
                        value={takenDate}
                        onChange={(event) => {
                          setTakenDate(event.target.value);
                          takeRequest.current = crypto.randomUUID();
                        }}
                      />
                    </label>
                    <p>Stock is updated when you save. You can return items in parts later.</p>
                  </div>
                  {!data.products.length && !error && (
                    <p className="fi-notice">
                      No inventory items are available yet. Ask an inventory manager to add central
                      stock.
                    </p>
                  )}
                  <div className="fi-table-region" role="region" aria-label="Items to take">
                    <table className="fi-draft-table" aria-label="Items to take">
                      <thead>
                        <tr className="border-b border-border">
                          {[
                            "Category",
                            "Item name / model",
                            "Available",
                            "Quantity",
                            "Reason",
                            "Actions",
                          ].map((title, i) => (
                            <th key={i} className="p-2">
                              {title}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {drafts.map((row, index) => {
                          const product = data.products.find((p) => p.stock_id === row.stock_id);
                          return (
                            <tr key={row.id} className="border-b border-border">
                              <td data-label="Category" className="fi-draft-category">
                                <Select
                                  aria-label={`Category ${index + 1}`}
                                  required
                                  value={row.category}
                                  onChange={(event) =>
                                    updateDraft(row.id, {
                                      category: event.target.value,
                                      stock_id: "",
                                      quantity: "",
                                    })
                                  }
                                >
                                  <option value="">Choose category</option>
                                  {[...new Set(data.products.map((p) => p.category))]
                                    .sort()
                                    .map((category) => (
                                      <option key={category}>{category}</option>
                                    ))}
                                </Select>
                              </td>
                              <td data-label="Item name / model" className="fi-draft-item">
                                <Select
                                  aria-label={`Item ${index + 1}`}
                                  required
                                  disabled={!row.category}
                                  value={row.stock_id}
                                  onChange={(event) =>
                                    updateDraft(row.id, {
                                      stock_id: event.target.value,
                                      quantity: "",
                                    })
                                  }
                                >
                                  <option value="">
                                    {row.category ? "Choose item" : "Choose category first"}
                                  </option>
                                  {data.products
                                    .filter((p) => p.category === row.category)
                                    .map((p) => (
                                      <option
                                        key={p.stock_id}
                                        value={p.stock_id}
                                        disabled={Number(p.available) <= 0}
                                      >
                                        {p.category}
                                        {p.model ? ` / ${p.model}` : ""} ({p.unit})
                                      </option>
                                    ))}
                                </Select>
                              </td>
                              <td data-label="Available" className="fi-draft-available">
                                <span className="fi-availability">
                                  {product
                                    ? quantityLabel(product.available, product.unit)
                                    : "Select an item"}
                                </span>
                              </td>
                              <td data-label="Quantity" className="fi-draft-quantity">
                                <Input
                                  aria-label={`Quantity ${index + 1}`}
                                  className="fi-quantity-input"
                                  type="number"
                                  required
                                  min={product?.unit === "Meter" ? "0.01" : "1"}
                                  step={product?.unit === "Meter" ? "0.01" : "1"}
                                  max={product?.available}
                                  value={row.quantity}
                                  onChange={(event) =>
                                    updateDraft(row.id, { quantity: event.target.value })
                                  }
                                />
                              </td>
                              <td data-label="Reason" className="fi-draft-reason">
                                <Input
                                  aria-label={`Reason ${index + 1}`}
                                  required
                                  maxLength={1000}
                                  value={row.reason}
                                  onChange={(event) =>
                                    updateDraft(row.id, { reason: event.target.value })
                                  }
                                  placeholder="e.g. Sensor firmware validation"
                                />
                              </td>
                              <td className="fi-draft-remove">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={`Remove item ${index + 1}`}
                                  disabled={drafts.length === 1}
                                  onClick={() => {
                                    setDrafts((rows) =>
                                      rows.filter((draft) => draft.id !== row.id),
                                    );
                                    takeRequest.current = crypto.randomUUID();
                                  }}
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                  <span>Remove</span>
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="fi-form-footer">
                    <span className="fi-draft-count">
                      {selectedProducts} {selectedProducts === 1 ? "item" : "items"} selected
                    </span>
                    <div className="fi-form-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={drafts.length >= 50}
                        onClick={() => {
                          setDrafts((rows) => [...rows, newDraft()]);
                          takeRequest.current = crypto.randomUUID();
                        }}
                      >
                        <Plus size={16} aria-hidden="true" />
                        Add item
                      </Button>
                      <Button type="submit" disabled={!data.products.length}>
                        <CheckCircle2 size={16} aria-hidden="true" />
                        {saving ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                </fieldset>
              </form>
            </Card>
          )}
          {returnLoan && (
            <Card className="fi-panel fi-return-panel">
              <div ref={returnPanel} role="region" aria-label="Return inventory">
                <div className="fi-panel-heading">
                  <div>
                    <h3>
                      <RotateCcw size={19} aria-hidden="true" />
                      Return to central stock
                    </h3>
                    <p>Return the full balance or just the quantity ready today.</p>
                  </div>
                  <span className="fi-chip fi-success">Stock return</span>
                </div>
                <div className="fi-return-item">
                  <div>
                    <strong>{returnLoan.category}</strong>
                    <span>{returnLoan.model || "Standard item"}</span>
                  </div>
                  <div>
                    <span>Still held</span>
                    <strong>{quantityLabel(returnOutstanding, returnLoan.unit)}</strong>
                  </div>
                </div>
                <form onSubmit={(event) => void returnItems(event)}>
                  <fieldset disabled={saving || !!error} className="fi-return-form">
                    <label className="fi-field">
                      <span>Return quantity</span>
                      <Input
                        aria-label="Return quantity"
                        required
                        type="number"
                        min={returnLoan.unit === "Meter" ? "0.01" : "1"}
                        step={returnLoan.unit === "Meter" ? "0.01" : "1"}
                        max={returnOutstanding}
                        value={returnQuantity}
                        onChange={(event) => {
                          setReturnQuantity(event.target.value);
                          returnRequest.current = crypto.randomUUID();
                        }}
                      />
                    </label>
                    <label className="fi-field">
                      <span>Return date</span>
                      <Input
                        aria-label="Return date"
                        required
                        type="date"
                        min={returnLoan.returns.reduce(
                          (latest, entry) =>
                            entry.return_date > latest ? entry.return_date : latest,
                          returnLoan.taken_date,
                        )}
                        max={indiaDate()}
                        value={returnDate}
                        onChange={(event) => {
                          setReturnDate(event.target.value);
                          returnRequest.current = crypto.randomUUID();
                        }}
                      />
                    </label>
                    <div className="fi-return-preview">
                      After this return, you will hold{" "}
                      <strong>
                        {quantityLabel(
                          Math.max(0, returnOutstanding - (Number(returnQuantity) || 0)),
                          returnLoan.unit,
                        )}
                      </strong>
                      .
                    </div>
                    <div className="fi-form-actions">
                      <Button type="submit">
                        <RotateCcw size={16} aria-hidden="true" />
                        {saving ? "Saving..." : "Save return"}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setReturnLoan(null)}>
                        Cancel
                      </Button>
                    </div>
                  </fieldset>
                </form>
              </div>
            </Card>
          )}
          <Card className="fi-panel fi-history-panel">
            <div className="fi-panel-heading">
              <div>
                <h3>
                  <ClipboardList size={19} aria-hidden="true" />
                  Inventory history
                </h3>
                <p>
                  {manager
                    ? "Withdrawals and returns across the firmware team."
                    : "Your items, outstanding balances and return trail."}
                </p>
              </div>
              <span className="fi-chip">
                {filtered.length} {filtered.length === 1 ? "record" : "records"}
              </span>
            </div>
            <div className="fi-filters">
              <div className="fi-search">
                <Search size={17} aria-hidden="true" />
                <Input
                  aria-label="Search inventory history"
                  placeholder="Search item, person or reason"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Select
                aria-label="Inventory status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">All records</option>
                <option value="held">Still held / partially returned</option>
                <option value="returned">Fully returned</option>
              </Select>
            </div>
            {!!filtered.length && (
              <div
                className="fi-table-region"
                role="region"
                aria-label="Inventory records"
                tabIndex={0}
              >
                <table className="fi-history-table" aria-label="Firmware inventory history">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        "Date",
                        "Person",
                        "Category / item",
                        "Taken",
                        "Returned",
                        "Still held",
                        "Reason",
                        "Central stock at take",
                        "Action",
                      ].map((title) => (
                        <th key={title} className="p-2">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((loan) => {
                      const outstanding = Number(
                        (Number(loan.quantity) - Number(loan.returned_quantity)).toFixed(2),
                      );
                      return (
                        <Fragment key={loan.id}>
                          <tr className="fi-history-record">
                            <td data-label="Taken date" className="fi-history-date">
                              {dateLabel(loan.taken_date)}
                            </td>
                            <td data-label="Person" className="fi-history-person">
                              {loan.owner_name}
                            </td>
                            <td data-label="Item" className="fi-history-item">
                              <strong>{loan.category}</strong>
                              {loan.model && (
                                <span className="block text-text-secondary">{loan.model}</span>
                              )}
                            </td>
                            <td data-label="Taken">{quantityLabel(loan.quantity, loan.unit)}</td>
                            <td data-label="Returned">
                              {quantityLabel(loan.returned_quantity, loan.unit)}
                            </td>
                            <td data-label="Still held">
                              <strong className={outstanding ? "fi-outstanding" : "fi-success"}>
                                {quantityLabel(outstanding, loan.unit)}
                              </strong>
                            </td>
                            <td data-label="Reason" className="fi-history-reason">
                              {loan.reason}
                            </td>
                            <td data-label="Central stock at take" className="fi-history-balance">
                              {quantityLabel(loan.stock_before, loan.unit)}{" "}
                              <ArrowRight size={13} className="fi-inline-icon" aria-label="to" />{" "}
                              {quantityLabel(loan.stock_after, loan.unit)}
                            </td>
                            <td className="fi-history-action">
                              {outstanding === 0 ? (
                                <span className="fi-status fi-success">
                                  <CheckCircle2 size={14} aria-hidden="true" />
                                  Fully returned
                                </span>
                              ) : !manager ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={saving || !!error}
                                  onClick={() => {
                                    setReturnLoan(loan);
                                    setReturnQuantity(String(outstanding));
                                    setReturnDate(indiaDate());
                                    returnRequest.current = crypto.randomUUID();
                                  }}
                                >
                                  <RotateCcw size={14} aria-hidden="true" />
                                  Revert / Return
                                </Button>
                              ) : (
                                <span className="fi-status">
                                  {Number(loan.returned_quantity)
                                    ? "Partially returned"
                                    : "Held for testing"}
                                </span>
                              )}
                            </td>
                          </tr>
                          {loan.returns.map((entry) => (
                            <tr key={entry.id} className="fi-return-event">
                              <td colSpan={9}>
                                <RotateCcw
                                  size={14}
                                  className="fi-inline-icon"
                                  aria-hidden="true"
                                />{" "}
                                Returned {quantityLabel(entry.quantity, loan.unit)} on{" "}
                                {dateLabel(entry.return_date)} by {entry.actor_name}{" "}
                                <span className="fi-event-balance">
                                  {" "}
                                  · Central stock: {quantityLabel(
                                    entry.stock_before,
                                    loan.unit,
                                  )} → {quantityLabel(entry.stock_after, loan.unit)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!filtered.length && (
              <div className="fi-empty">
                <span className="fi-empty-icon">
                  <ClipboardList size={27} aria-hidden="true" />
                </span>
                <p>No inventory records found.</p>
                <span>
                  {search || status !== "all"
                    ? "Try another search or change the status filter."
                    : manager
                      ? "Firmware withdrawals will appear here when items are saved."
                      : "Items you take for testing will appear here, with every return."}
                </span>
                {(search || status !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatus("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
