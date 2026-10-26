import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, History, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { Button, Card, Input, Label, Select } from "@/components/ui-kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { historyDate, loadInventoryHistory, stockQuantity, type HistoryItem, type HistoryOrder, type InventoryHistoryData } from "@/lib/inventory-history";
import "./inventory-history.css";

function ItemTable({ items, company }: { items: HistoryItem[]; company: string }) {
  return <table className="issue-table issue-detail-table" aria-label={`Items issued to ${company}`}>
    <thead><tr>{["Item / Model", "Before issue", "Issued", "After issue", "Current stock"].map(label => <th key={label} className={label === "Item / Model" ? "" : "issue-number"}>{label}</th>)}</tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td><span className="issue-primary">{item.category}</span>{item.model && <span className="issue-secondary">{item.model}</span>}</td>
      <td className="issue-number">{stockQuantity(item.stock_before, item.unit)}</td>
      <td className="issue-number issue-issued">−{stockQuantity(item.quantity, item.unit)}</td>
      <td className="issue-number">{stockQuantity(item.stock_after, item.unit)}</td>
      <td className="issue-number issue-current">{stockQuantity(item.current_stock, item.unit)}</td>
    </tr>)}</tbody>
  </table>;
}

export function InventoryHistoryPanel() {
  const [view, setView] = useState<"company" | "item">("company");
  const [company, setCompany] = useState(""); const [item, setItem] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [search, setSearch] = useState("");
  const [page, setPage] = useState(1); const [data, setData] = useState<InventoryHistoryData | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0); const [order, setOrder] = useState<HistoryOrder | null>(null);
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const invalidDates = Boolean(from && to && from > to);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    if (invalidDates) { setLoading(false); return; }
    const timer = window.setTimeout(() => {
      void loadInventoryHistory({ _view: view, _company: company, _item: item, _from: from || null, _to: to || null, _search: search.trim(), _page: page, _page_size: 20 })
        .then(next => { if (live) { setData(next); setError(""); } })
        .catch(failure => { if (live) setError(failure instanceof Error ? failure.message : "Could not load inventory history."); })
        .finally(() => { if (live) setLoading(false); });
    }, search ? 250 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [view, company, item, from, to, search, page, refresh, invalidDates]);
  useEffect(() => setOpenIssue(null), [view, company, item, from, to, search, page]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible") reload(); };
    const timer = window.setInterval(update, 60000); window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [reload]);
  const totalPages = Math.max(1, Math.ceil((data?.total_records ?? 0) / 20));
  const hasFilters = Boolean(company || item || from || to || search);
  const reset = () => { setCompany(""); setItem(""); setFrom(""); setTo(""); setSearch(""); setPage(1); };
  return <div className="inventory-history space-y-3">
    <Card className="issue-heading p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2"><History size={18} /> Inventory History</h2>
          <p className="mt-1 text-xs text-text-secondary">Company issues, product quantities and available stock.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={loading} onClick={reload}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</Button>
      </div>
      <div className="issue-summary" aria-label="History summary">
        {[{ label: "Stock issues", value: data?.issue_count }, { label: "Companies", value: data?.company_count }, { label: "Item types", value: data?.item_type_count }].map(metric => <span key={metric.label}><strong>{loading || invalidDates || error ? "—" : metric.value ?? 0}</strong> {metric.label}</span>)}
        {data && <span className="issue-recording">Recording from {historyDate(data.activated_at)} IST</span>}
      </div>
    </Card>
    <Card className="issue-filter-card space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="History view" className="inline-flex rounded-lg border border-border bg-surface-raised p-1">
          {(["company", "item"] as const).map(value => <button key={value} type="button" aria-pressed={view === value}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === value ? "bg-lime text-primary-foreground shadow-sm" : "text-text-secondary"}`}
            onClick={() => { setView(value); setPage(1); }}>{value === "company" ? "Company-wise" : "Item-wise"}</button>)}
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="relative min-w-0 max-w-sm flex-1"><Search size={14} className="absolute left-2.5 top-2.5 text-text-secondary" /><Input aria-label="Search inventory history" className="pl-8" placeholder="Search company, reference, device or item…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
          <Button variant="secondary" size="sm" aria-expanded={showFilters} aria-controls="inventory-history-filters" onClick={() => setShowFilters(value => !value)}><SlidersHorizontal size={14} /> Filters{hasFilters && <span className="h-1.5 w-1.5 rounded-full bg-lime" />}</Button>
          {hasFilters && <Button variant="ghost" size="sm" onClick={reset}>Clear filters</Button>}
        </div>
      </div>
      {showFilters && <div id="inventory-history-filters" className="grid grid-cols-2 gap-3 border-t border-border pt-3 lg:grid-cols-4">
        <div><Label htmlFor="history-company">Company</Label><Select id="history-company" value={company} onChange={e => { setCompany(e.target.value); setPage(1); }}><option value="">All companies</option>{data?.companies.map(name => <option key={name}>{name}</option>)}</Select></div>
        <div><Label htmlFor="history-product">Item / Model</Label><Select id="history-product" value={item} onChange={e => { setItem(e.target.value); setPage(1); }}><option value="">All items</option>{data?.products.map(product => <option key={product.key} value={product.key}>{product.category}{product.model ? ` · ${product.model}` : ""} · {product.unit}</option>)}</Select></div>
        <div><Label htmlFor="history-from">Issue date from (IST)</Label><Input id="history-from" type="date" value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setPage(1); }} /></div>
        <div><Label htmlFor="history-to">Issue date to (IST)</Label><Input id="history-to" type="date" value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setPage(1); }} /></div>
      </div>}
    </Card>
    {invalidDates ? <Card role="alert" className="p-5 text-coral">End date must be on or after start date.</Card>
      : error ? <Card role="alert" className="space-y-3 p-5"><p className="text-coral">{error}</p><Button onClick={reload}>Try again</Button></Card>
      : loading ? <Card role="status" className="p-8 text-center text-text-secondary">Loading inventory history…</Card>
      : !data?.total_records ? <Card className="p-10 text-center"><History size={30} className="mx-auto mb-3 text-text-secondary" /><h3 className="font-semibold">{hasFilters ? "No matching stock issues" : "No stock issues recorded yet"}</h3><p className="mx-auto mt-2 max-w-lg text-sm text-text-secondary">{hasFilters ? "Try another company, item or date range, or clear the filters." : "The first stock deduction after activation will appear here automatically. Earlier completed issues will stay outside this history."}</p></Card>
      : <>
        <div className="issue-table-shell">
          <div className="issue-table-scroll" role="region" aria-label={view === "company" ? "Company stock issues" : "Item stock movements"} tabIndex={0}>
            {view === "company" ? <table className="issue-table issue-company-table" aria-label="Company stock issues">
              <thead><tr><th className="issue-expand-cell"><span className="sr-only">Expand</span></th><th>Company</th><th>Issue / Order</th><th>Issued at (IST)</th><th className="issue-number">Items</th><th>Status</th><th>Recorded by</th></tr></thead>
              <tbody>{data.issues.map(issue => <Fragment key={issue.issue_id}>
                <tr className={openIssue === issue.issue_id ? "issue-selected" : ""}>
                  <td className="issue-expand-cell"><button type="button" className="issue-expand-button" aria-label={`${openIssue === issue.issue_id ? "Collapse" : "Expand"} items for ${issue.company_name}`} aria-expanded={openIssue === issue.issue_id} aria-controls={`issue-${issue.issue_id}`} onClick={() => setOpenIssue(openIssue === issue.issue_id ? null : issue.issue_id)}><ChevronDown size={15} className={openIssue === issue.issue_id ? "rotate-180" : ""} /></button></td>
                  <td><span className="issue-primary">{issue.company_name}</span></td>
                  <td><button type="button" className="issue-reference" aria-label={`Order details for ${issue.reference}`} onClick={() => setOrder(issue)}>{issue.reference}</button><span className="issue-secondary">{issue.device_id || "Device not assigned"}</span></td>
                  <td className="issue-date">{historyDate(issue.issued_at)}</td>
                  <td className="issue-number">{issue.items.length === Number(issue.total_item_types) ? issue.items.length : `${issue.items.length} / ${issue.total_item_types}`}</td>
                  <td><span className={`issue-status issue-status-${issue.order_exists ? issue.logistics_status.toLowerCase().replace(/\s+/g, "-") : "removed"}`}>{issue.order_exists ? issue.logistics_status : "Order removed"}</span></td>
                  <td>{issue.actor_name}</td>
                </tr>
                {openIssue === issue.issue_id && <tr className="issue-expanded-row"><td colSpan={7}><div id={`issue-${issue.issue_id}`} className="issue-detail"><div className="issue-detail-heading"><span>Items issued to <strong>{issue.company_name}</strong></span><span>Before / after are fixed · Current stock is live</span></div><ItemTable items={issue.items} company={issue.company_name} /></div></td></tr>}
              </Fragment>)}</tbody>
            </table> : <table className="issue-table issue-movements-table" aria-label="Item stock movements">
              <thead><tr>{["Item / Model", "Company", "Issue reference", "Issued at (IST)", "Before issue", "Issued", "After issue", "Current stock"].map((label,index) => <th key={label} className={index >= 4 ? "issue-number" : ""}>{label}</th>)}</tr></thead>
              <tbody>{data.item_rows.map(row => <tr key={row.id}>
                <td><span className="issue-primary">{row.category}</span>{row.model && <span className="issue-secondary">{row.model}</span>}</td>
                <td>{row.company_name}</td><td><button type="button" className="issue-reference" aria-label={`Order details for ${row.reference}`} onClick={() => setOrder(row)}>{row.reference}</button></td>
                <td className="issue-date">{historyDate(row.issued_at)}</td><td className="issue-number">{stockQuantity(row.stock_before,row.unit)}</td><td className="issue-number issue-issued">−{stockQuantity(row.quantity,row.unit)}</td><td className="issue-number">{stockQuantity(row.stock_after,row.unit)}</td><td className="issue-number issue-current">{stockQuantity(row.current_stock,row.unit)}</td>
              </tr>)}</tbody>
            </table>}
          </div>
          <div className="issue-table-hint"><span>{view === "company" ? "Expand a row to see its products. Click an issue reference for order details." : "Each row is one product issued to a company."}</span><span className="issue-swipe-hint">Swipe horizontally to see all columns.</span></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><p className="text-text-secondary">{(page-1)*20+1}–{Math.min(page*20,data.total_records)} of {data.total_records} {view === "company" ? "stock issues" : "item movements"}</p>
          <div className="flex items-center gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} aria-label="Previous history page" onClick={() => setPage(p => p-1)}><ChevronLeft size={16} /></Button><span>Page {page} of {totalPages}</span><Button variant="secondary" size="sm" disabled={page >= totalPages} aria-label="Next history page" onClick={() => setPage(p => p+1)}><ChevronRight size={16} /></Button></div>
        </div>
      </>}
    {data && !loading && !error && !invalidDates && <p className="text-xs text-text-secondary">Current stock refreshed {historyDate(data.refreshed_at)} IST. Quantities use each item's own unit; unlike units are not added together.</p>}
    <Dialog open={Boolean(order)} onOpenChange={open => { if (!open) setOrder(null); }}><DialogContent className="max-w-lg bg-surface text-text-primary"><DialogHeader><DialogTitle>Order details</DialogTitle></DialogHeader>{order && <dl className="space-y-3 text-sm">
      {[ ["Issue reference",order.reference],["Company at issue",order.company_name],["Original order ID",order.order_id],["Device ID",order.device_id || "Not assigned"],["Order source",order.order_source],["Order created",historyDate(order.order_created_at)],["Stock issued",`${historyDate(order.issued_at)} IST`],["Status when issued",order.status_at_issue],["Current logistics status",order.order_exists ? order.logistics_status : "Order removed; historical record retained"],["Recorded by",order.actor_name] ].map(([label,value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
    </dl>}</DialogContent></Dialog>
  </div>;
}
