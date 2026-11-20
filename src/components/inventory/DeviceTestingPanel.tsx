import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  CirclePause,
  Clock3,
  Copy,
  Cpu,
  History,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import "./device-testing.css";

type OverallStatus = "PASS" | "FAIL";
type Status = OverallStatus | "SKIP" | "PASS_m" | "NOT_RUN";
type Times = { tested_at: string | null; received_at: string };
type Device = Times & {
  mac: string;
  dm_id: string | null;
  overall: OverallStatus | "PASS_m";
  run_count: number;
};
type Run = Times & {
  id: string;
  report: {
    session: string;
    report_id?: string | null;
    existing_id?: string | null;
    overall: OverallStatus;
    test_fw: string;
    duration_s: number;
    steps: Record<string, Status>;
    original_steps?: Record<string, Status> | null;
    notes?: Record<string, unknown> | null;
    readings?: Record<string, unknown> | null;
  };
};

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Kolkata",
});
const devicePageSize = 25;
const historyPageSize = 10;
const stepLabels: Record<string, string> = {
  mqtt: "MQTT",
  vibration: "Vibration",
  encoder: "Encoder",
  proxy1: "Proxy port 1",
  proxy2: "Proxy port 2",
  ct: "CT",
  modbus: "Modbus CT / energy meter",
  state: "State detect",
  lte: "LTE modem",
  led_buzzer: "LED + buzzer",
  board: "Board check",
};

async function readRows<T>(
  name: "device_test_devices" | "device_test_history",
  args: Record<string, string | number>,
  signal: AbortSignal,
) {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .rpc(name, args)
    .abortSignal(signal);
  if (error) {
    throw new Error(
      error.code === "PGRST202" || error.code === "42883"
        ? "Device Testing requires the database migration."
        : error.code === "42501"
          ? "Inventory manager access required."
          : "Could not load device tests. Try refreshing.",
    );
  }
  return data as T[];
}

const outcomes = {
  PASS: { badge: "PASS", label: "passed", icon: CheckCircle2 },
  FAIL: { badge: "FAIL", label: "failed", icon: XCircle },
  SKIP: { badge: "SKIP", label: "skipped", icon: CircleMinus },
  PASS_m: { badge: "PASS M", label: "manually passed", icon: ListChecks },
  NOT_RUN: { badge: "NOT RUN", label: "not run", icon: CirclePause },
} as const;
const statuses = Object.keys(outcomes) as Status[];

function runResult(report: Run["report"]): Device["overall"] {
  return report.overall === "PASS" && Object.values(report.steps).includes("PASS_m")
    ? "PASS_m"
    : report.overall;
}

function Result({ status }: { status: Status }) {
  const { icon: Icon, badge, label } = outcomes[status];
  return (
    <span className="device-test-result" data-result={status} title={label}>
      <Icon size={13} aria-hidden="true" />
      {badge}
    </span>
  );
}

function RunTime({ times }: { times: Times }) {
  const time = times.tested_at ?? times.received_at;
  return (
    <span>
      {times.tested_at ? "Tested" : "Received"}{" "}
      <time dateTime={time}>{dateFormat.format(new Date(time))} IST</time>
    </span>
  );
}

function Pagination({
  page,
  hasNext,
  setPage,
  label,
}: {
  page: number;
  hasNext: boolean;
  setPage: (page: number) => void;
  label: string;
}) {
  if (!page && !hasNext) return null;
  return (
    <nav aria-label={label} className="device-test-pagination">
      <Button
        variant="secondary"
        size="sm"
        type="button"
        aria-label="Previous page"
        disabled={!page}
        onClick={() => setPage(page - 1)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </Button>
      <span>Page {page + 1}</span>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        aria-label="Next page"
        disabled={!hasNext}
        onClick={() => setPage(page + 1)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </Button>
    </nav>
  );
}

function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: Error | null;
  retry: () => void;
}) {
  if (error)
    return (
      <div role="alert" className="device-test-feedback">
        <AlertCircle size={18} aria-hidden="true" />
        <span>{error.message}</span>
        <Button variant="secondary" size="sm" type="button" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  if (loading)
    return (
      <p role="status" className="device-test-feedback">
        <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />
        Loading…
      </p>
    );
  return null;
}

function ReportValues({
  title,
  values,
}: {
  title: string;
  values?: Record<string, unknown> | null;
}) {
  const entries = Object.entries(values ?? {});
  if (!entries.length) return null;
  return (
    <section className="device-test-values">
      <h5>{title}</h5>
      <dl>
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TestRun({ run }: { run: Run }) {
  const [filter, setFilter] = useState<Status | null>(null);
  const { report } = run;
  const counts: Record<Status, number> = { PASS: 0, FAIL: 0, SKIP: 0, PASS_m: 0, NOT_RUN: 0 };
  for (const status of Object.values(report.steps)) counts[status] += 1;
  const stepOrder = [...new Set([...Object.keys(stepLabels), ...Object.keys(report.steps)])];
  const visibleSteps = stepOrder.filter(
    (step) => Object.hasOwn(report.steps, step) && (!filter || report.steps[step] === filter),
  );

  return (
    <section className="device-test-report" aria-labelledby="device-test-report-heading">
      <div className="device-test-report-heading">
        <div>
          <h4 id="device-test-report-heading">Test result</h4>
          <p>
            <Clock3 size={14} aria-hidden="true" />
            <RunTime times={run} />
          </p>
        </div>
        <Result status={runResult(report)} />
      </div>

      <section>
        <div className="device-test-section-heading">
          <h5>Checkpoints</h5>
          {filter && (
            <button
              type="button"
              className="device-test-text-button"
              onClick={() => setFilter(null)}
            >
              Show all checkpoints
            </button>
          )}
        </div>
        <div className="device-test-metrics" role="group" aria-label="Filter checkpoints">
          {statuses.map((status) => {
            if (status === "NOT_RUN" && counts[status] === 0) return null;
            const { icon: Icon, label } = outcomes[status];
            return (
              <button
                key={status}
                type="button"
                data-result={status}
                aria-pressed={filter === status}
                disabled={counts[status] === 0}
                onClick={() => setFilter(filter === status ? null : status)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>
                  <strong>{counts[status]}</strong> {label}
                </span>
              </button>
            );
          })}
        </div>
        <ul className="device-test-checkpoints">
          {visibleSteps.map((step) => (
            <li key={step}>
              <span>
                {Object.hasOwn(stepLabels, step) ? stepLabels[step] : step.replaceAll("_", " ")}
                {report.steps[step] === "PASS_m" && report.original_steps?.[step] === "FAIL" && (
                  <small className="device-test-original-result">Originally failed</small>
                )}
              </span>
              <Result status={report.steps[step]} />
            </li>
          ))}
        </ul>
      </section>

      <dl className="device-test-metadata">
        <div>
          <dt>DM ID at test</dt>
          <dd>{report.existing_id || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Test firmware</dt>
          <dd>{report.test_fw}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{report.duration_s} s</dd>
        </div>
        {run.tested_at && (
          <div>
            <dt>Received at</dt>
            <dd>
              <time dateTime={run.received_at}>
                {dateFormat.format(new Date(run.received_at))} IST
              </time>
            </dd>
          </div>
        )}
      </dl>

      {(Object.keys(report.notes ?? {}).length > 0 ||
        Object.keys(report.readings ?? {}).length > 0) && (
        <div className="device-test-report-values">
          <ReportValues title="Notes" values={report.notes} />
          <ReportValues title="Readings" values={report.readings} />
        </div>
      )}

      <details className="device-test-identifiers">
        <summary>
          Report identifiers <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <dl className="device-test-metadata">
          <div>
            <dt>Session</dt>
            <dd className="font-mono">{report.session}</dd>
          </div>
          {report.report_id && (
            <div>
              <dt>Report ID</dt>
              <dd className="font-mono">{report.report_id}</dd>
            </div>
          )}
        </dl>
      </details>
    </section>
  );
}

function DeviceHistory({ device, onBack }: { device: Device; onBack: () => void }) {
  const { userId } = useAuth();
  const [page, setPage] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["device-testing", userId, "history", device.mac, page],
    queryFn: ({ signal }) =>
      readRows<Run>(
        "device_test_history",
        { _mac: device.mac, _offset: page * historyPageSize },
        signal,
      ),
    gcTime: 0,
  });
  const runs = history.data?.slice(0, historyPageSize) ?? [];
  const activeRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];

  async function copyMac() {
    try {
      await navigator.clipboard.writeText(device.mac);
      toast.success("MAC address copied.");
    } catch {
      toast.error("Could not copy the MAC address.");
    }
  }

  return (
    <Card className="device-test-detail">
      <button type="button" onClick={onBack} className="device-test-back">
        <ArrowLeft size={17} aria-hidden="true" /> Back to devices
      </button>
      <header className="device-test-detail-heading">
        <span className="device-test-icon">
          <Cpu size={22} aria-hidden="true" />
        </span>
        <div>
          <h3>{device.dm_id || "Unassigned DataMeter"}</h3>
          <div className="device-test-device-meta">
            <span className="font-mono">{device.mac}</span>
            <button
              type="button"
              className="device-test-copy"
              aria-label="Copy MAC address"
              onClick={() => void copyMac()}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <section className="device-test-history" aria-labelledby="device-test-history-heading">
        <div className="device-test-section-heading">
          <h4 id="device-test-history-heading">
            <History size={17} aria-hidden="true" /> Test history
          </h4>
          <span>
            {device.run_count} {device.run_count === 1 ? "run" : "runs"}
          </span>
        </div>
        <LoadState
          loading={history.isPending}
          error={history.error}
          retry={() => void history.refetch()}
        />
        {history.data?.length === 0 && (
          <p className="device-test-feedback">No runs on this page.</p>
        )}
        {runs.length > 0 && (
          <ul className="device-test-attempts">
            {runs.map((run, index) => (
              <li key={run.id}>
                <button
                  type="button"
                  aria-pressed={activeRun.id === run.id}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <span>
                    <RunTime times={run} />
                    {page === 0 && index === 0 && <small>Latest run</small>}
                  </span>
                  <Result status={runResult(run.report)} />
                  <ChevronRight size={16} className="device-test-chevron" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Pagination
          page={page}
          hasNext={(history.data?.length ?? 0) > historyPageSize}
          setPage={(nextPage) => {
            setPage(nextPage);
            setSelectedRunId(null);
          }}
          label="Test history pages"
        />
      </section>
      {activeRun && <TestRun key={activeRun.id} run={activeRun} />}
    </Card>
  );
}

export function DeviceTestingPanel() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const queryPrefix = ["device-testing", userId];
  const fetching = useIsFetching({ queryKey: queryPrefix }) > 0;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Device | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const searchField = useRef<HTMLInputElement>(null);
  const detailPanel = useRef<HTMLDivElement>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  const devices = useQuery({
    queryKey: [...queryPrefix, "devices", deferredSearch, page],
    queryFn: ({ signal }) =>
      readRows<Device>(
        "device_test_devices",
        { _search: deferredSearch, _offset: page * devicePageSize },
        signal,
      ),
    gcTime: 0,
  });
  const rows = devices.data?.slice(0, devicePageSize) ?? [];
  const active = selected && (rows.find((device) => device.mac === selected.mac) ?? selected);

  useEffect(() => {
    if (!window.matchMedia("(width < 64rem)").matches) return;
    if (selected) {
      detailPanel.current?.focus();
      detailPanel.current?.scrollIntoView({ block: "start" });
    } else if (returnFocus.current) {
      (selectedButton.current?.isConnected ? selectedButton.current : searchField.current)?.focus();
      returnFocus.current = false;
    }
  }, [selected]);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(0);
    setSelected(null);
  }

  return (
    <section
      className="device-testing"
      aria-labelledby="device-testing-title"
      data-device-open={Boolean(active)}
    >
      <header className="device-test-header">
        <span className="device-test-icon">
          <Activity size={23} aria-hidden="true" />
        </span>
        <h2 id="device-testing-title">Device Testing</h2>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={fetching}
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: queryPrefix });
          }}
        >
          <RefreshCw
            size={15}
            className={fetching ? "motion-safe:animate-spin" : ""}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </header>

      <div className="device-test-layout">
        <Card className="device-test-list">
          <div className="device-test-list-heading">
            <h3>Tested devices</h3>
            <div className="device-test-search">
              <Search size={17} aria-hidden="true" />
              <input
                ref={searchField}
                type="search"
                aria-label="Search by DM ID or MAC address"
                placeholder="Search by DM ID or MAC"
                maxLength={128}
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    updateSearch("");
                    searchField.current?.focus();
                  }}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <LoadState
            loading={devices.isPending}
            error={devices.error}
            retry={() => void devices.refetch()}
          />
          {devices.data?.length === 0 && (
            <p className="device-test-feedback" role="status">
              {page
                ? "No devices on this page."
                : deferredSearch
                  ? "No devices match your search."
                  : "No test reports received yet."}
            </p>
          )}
          {rows.length > 0 && (
            <ul className="device-test-devices">
              {rows.map((device) => (
                <li key={device.mac}>
                  <button
                    type="button"
                    aria-pressed={active?.mac === device.mac}
                    onClick={(event) => {
                      selectedButton.current = event.currentTarget;
                      setSelected(device);
                    }}
                  >
                    <span className="device-test-row-content">
                      <strong>{device.dm_id || "Unassigned DataMeter"}</strong>
                      <span>
                        <span className="font-mono">{device.mac}</span> · {device.run_count}{" "}
                        {device.run_count === 1 ? "run" : "runs"}
                      </span>
                      <span>
                        <RunTime times={device} />
                      </span>
                    </span>
                    <Result status={device.overall} />
                    <ChevronRight size={16} className="device-test-chevron" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            page={page}
            hasNext={(devices.data?.length ?? 0) > devicePageSize}
            setPage={(nextPage) => {
              setPage(nextPage);
              setSelected(null);
            }}
            label="Tested device pages"
          />
        </Card>
        <div
          className="device-test-selection"
          ref={detailPanel}
          tabIndex={-1}
          aria-label="Device test details"
        >
          {active ? (
            <DeviceHistory
              key={active.mac}
              device={active}
              onBack={() => {
                returnFocus.current = true;
                setSelected(null);
              }}
            />
          ) : (
            <Card className="device-test-placeholder">
              <span className="device-test-icon">
                <Cpu size={24} aria-hidden="true" />
              </span>
              <h3>Select a device</h3>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
