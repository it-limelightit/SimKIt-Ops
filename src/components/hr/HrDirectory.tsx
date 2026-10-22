import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  ArrowUpDown,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  FileText,
  MoreHorizontal,
  Network,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import { Button, Input, Select } from "@/components/ui-kit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dateLabel } from "@/lib/device-attendance";
import { employmentLabel, hrMoney, type HrEmployee } from "@/lib/hr";
import "./hr-directory.css";

type Props = {
  employees: HrEmployee[];
  today: string;
  loading: boolean;
  locked: boolean;
  onView: (employee: HrEmployee) => void;
  onEdit: (employee: HrEmployee) => void;
  onRevise: (employee: HrEmployee) => void;
  onOffer: (employee: HrEmployee) => void;
  onDelete: (employee: HrEmployee) => void;
};
type Scope = "current" | "office" | "field" | "incomplete" | "left";
const title = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const departmentStyle: Record<string, string> = {
  software: "bg-violet-500/10 text-violet-600",
  firmware: "bg-sky-500/10 text-sky-600",
  hardware: "bg-sky-500/10 text-sky-600",
  field: "bg-emerald-500/10 text-emerald-600",
  logistic: "bg-amber-500/10 text-amber-600",
  manager: "bg-indigo-500/10 text-indigo-600",
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
const incomplete = (e: HrEmployee) => Boolean(e.directory_source || !e.current_term);

function Identity({ employee: e, onView }: { employee: HrEmployee; onView: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className={`hr-avatar ${departmentStyle[e.department] || "bg-surface-raised text-text-secondary"}`}
      >
        {initials(e.name)}
      </span>
      <div className="min-w-0">
        <button type="button" className="hr-name" onClick={onView}>
          {e.name}
        </button>
        <p className="mt-1 truncate text-xs text-text-secondary" title={e.email}>
          {e.email || "Email not set"}
        </p>
        <div className="hr-identity-meta">
          <span
            className={`hr-status-tag ${e.status === "active" ? "hr-status-active" : e.status === "left" ? "hr-status-left" : "hr-status-onboarding"}`}
          >
            <span aria-hidden />
            {title(e.status)}
          </span>
          {e.directory_source ? (
            <span className="hr-setup-indicator">
              <span aria-hidden />
              HR details missing
            </span>
          ) : (
            <span className="text-[10px] tracking-wide text-text-secondary">{e.employee_code}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportingManager({ name, onSelect }: { name: string; onSelect: () => void }) {
  const people = name.split(" & ");
  return (
    <button
      type="button"
      className="hr-reporting-manager"
      disabled={!name}
      title={name ? `Filter employees reporting to ${name}` : undefined}
      onClick={onSelect}
    >
      <span className="hr-manager-avatars" aria-hidden>
        {name ? (
          people.map((person, i) => (
            <span key={person} className={i ? "hr-manager-avatar-secondary" : ""}>
              {initials(person)}
            </span>
          ))
        ) : (
          <span>
            <Network size={13} />
          </span>
        )}
      </span>
      <span className="hr-manager-name">{name || "Not assigned"}</span>
      {name && <ChevronRight aria-hidden size={12} className="hr-manager-chevron" />}
    </button>
  );
}

function Team({ employee: e }: { employee: HrEmployee }) {
  return (
    <div>
      <span
        className={`hr-team-tag ${departmentStyle[e.department] || "bg-surface-raised text-text-secondary"}`}
      >
        {e.department === "field" ? "Field team" : title(e.department) || "Team not set"}
      </span>
      <p className="mt-2 max-w-44 text-xs leading-5 text-text-secondary">
        {e.designation || "Designation not set"}
      </p>
    </div>
  );
}

function Terms({ employee: e, today }: { employee: HrEmployee; today: string }) {
  const t = e.current_term;
  return (
    <div>
      <span className={`hr-type-tag ${t ? "text-text-primary" : "text-text-secondary"}`}>
        {t?.employment_type === "full_time" ? (
          <BriefcaseBusiness size={13} />
        ) : (
          <CalendarDays size={13} />
        )}
        {employmentLabel(t?.employment_type)}
      </span>
      <p className="mt-2 text-xs leading-5 text-text-secondary">
        {t?.employment_type === "internship"
          ? `${t.internship_months} months`
          : t
            ? "Permanent employment"
            : "Details pending"}
      </p>
      {t && t.effective_from > today && (
        <p className="mt-1 text-[11px] text-amber-600">From {dateLabel(t.effective_from)}</p>
      )}
    </div>
  );
}

function Compensation({ employee: e }: { employee: HrEmployee }) {
  return (
    <div>
      <p className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-text-primary">
        {e.current_term ? hrMoney(e.current_term.monthly_amount) : "Not set"}
      </p>
      <p className="mt-1.5 text-[11px] text-text-secondary">
        {e.current_term
          ? `${e.current_term.employment_type === "internship" ? "Stipend" : "Gross salary"} / month`
          : "Add compensation"}
      </p>
      {e.current_term?.annual_ctc != null && (
        <p className="mt-1.5 whitespace-nowrap text-[11px] text-text-secondary">
          {hrMoney(e.current_term.annual_ctc)} CTC / year
        </p>
      )}
    </div>
  );
}

function AttendanceSetup({ employee: e }: { employee: HrEmployee }) {
  return (
    <p className="text-[11px] leading-5 text-text-secondary">
      {e.attendance_method === "field_online"
        ? "Field attendance"
        : e.enrollment_status === "enrolled"
          ? "Face enrolled"
          : e.auth_user_id
            ? "Face setup pending"
            : "Login setup pending"}
    </p>
  );
}

function EmployeeDetails({ employee: e }: { employee: HrEmployee }) {
  const facts = [
    ["Mobile number", e.mobile || "Not set"],
    ["Joining date", e.joining_date ? dateLabel(e.joining_date) : "Not set"],
    ["Mentor / reports to", e.mentor_name || "Not set"],
    [
      "Internship end",
      e.current_term?.internship_end ? dateLabel(e.current_term.internship_end) : "—",
    ],
    [
      "Attendance",
      e.attendance_method === "field_online"
        ? "Field · Mark as online"
        : `Office device · ${e.enrollment_status || "Not set up"}`,
    ],
    ["Device enrollment ID", e.enroll_id || "—"],
    ["Address / location", e.address || "Not set"],
    ["College / institute", e.college || "Not set"],
  ];
  return (
    <dl className="hr-expanded-grid">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RowActions({
  employee: e,
  locked,
  onView,
  onEdit,
  onOffer,
  onRevise,
  onDelete,
}: Omit<Props, "employees" | "today" | "loading"> & { employee: HrEmployee }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        className={`hr-row-primary ${e.directory_source ? "hr-row-complete" : ""}`}
        aria-label={e.directory_source ? "Complete HR details" : "View profile"}
        disabled={locked && Boolean(e.directory_source)}
        onClick={() => (e.directory_source ? onEdit(e) : onView(e))}
      >
        {e.directory_source ? (
          <>
            <Pencil size={12} />
            Complete HR
          </>
        ) : (
          <>
            View profile
            <ArrowUpRight size={13} />
          </>
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hr-icon-button"
            aria-label={`Actions for ${e.name}`}
            disabled={locked}
          >
            <MoreHorizontal size={18} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="hr-directory-menu w-56">
          <DropdownMenuLabel>{e.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onView(e)}>
            <CircleUserRound />
            View profile
          </DropdownMenuItem>
          <DropdownMenuItem disabled={e.status === "left"} onSelect={() => onEdit(e)}>
            <Pencil />
            {e.directory_source ? "Complete HR details" : "Edit employee details"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={Boolean(e.directory_source) || e.status === "left"}
            onSelect={() => onRevise(e)}
          >
            <ArrowDownUp />
            Revise employment / salary
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!e.current_term || e.status === "left"}
            onSelect={() => onOffer(e)}
          >
            <FileText />
            Generate offer letter
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-coral focus:text-coral" onSelect={() => onDelete(e)}>
            <Trash2 />
            Delete employee
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function HrDirectory(props: Props) {
  const { employees, today, loading, locked, onView } = props;
  const [scope, setScope] = useState<Scope>("current");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [type, setType] = useState("all");
  const [mentor, setMentor] = useState("all");
  const [sort, setSort] = useState("name_asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const current = employees.filter((e) => e.status !== "left");
  const mentors = [...new Set(employees.map((e) => e.mentor_name).filter(Boolean))].sort();
  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))].sort();
  const filtersCount =
    Number(department !== "all") + Number(type !== "all") + Number(mentor !== "all");
  const toggle = (id: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  useEffect(() => {
    setPage(1);
  }, [scope, query, department, type, mentor, sort, pageSize]);
  const rows = useMemo(
    () =>
      employees
        .filter((e) => {
          if (scope === "left" ? e.status !== "left" : e.status === "left") return false;
          if (scope === "office" && e.app_access === "field_associate") return false;
          if (scope === "field" && e.app_access !== "field_associate") return false;
          if (scope === "incomplete" && !incomplete(e)) return false;
          if (department !== "all" && e.department !== department) return false;
          if (
            type !== "all" &&
            (type === "not_set"
              ? Boolean(e.current_term)
              : e.current_term?.employment_type !== type)
          )
            return false;
          if (mentor !== "all" && e.mentor_name !== mentor) return false;
          return `${e.name} ${e.email} ${e.mobile} ${e.department} ${e.designation} ${e.mentor_name} ${e.employee_code}`
            .toLowerCase()
            .includes(query.trim().toLowerCase());
        })
        .sort((a, b) => {
          if (sort === "pay_desc")
            return a.current_term == null
              ? b.current_term == null
                ? 0
                : 1
              : b.current_term == null
                ? -1
                : b.current_term.monthly_amount - a.current_term.monthly_amount;
          if (sort === "joined_desc")
            return (b.joining_date || "").localeCompare(a.joining_date || "");
          return (
            (sort === "name_desc" ? -1 : 1) *
            a.name.localeCompare(b.name, "en-IN", { sensitivity: "base" })
          );
        }),
    [employees, scope, query, department, type, mentor, sort],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const reset = () => {
    setDepartment("all");
    setType("all");
    setMentor("all");
    setQuery("");
    setScope("current");
  };
  const scopeItems: { value: Scope; label: string; count: number }[] = [
    { value: "current", label: "All employees", count: current.length },
    {
      value: "office",
      label: "Office team",
      count: current.filter((e) => e.app_access !== "field_associate").length,
    },
    {
      value: "field",
      label: "Field associates",
      count: current.filter((e) => e.app_access === "field_associate").length,
    },
    { value: "incomplete", label: "Needs HR details", count: current.filter(incomplete).length },
    { value: "left", label: "Left", count: employees.filter((e) => e.status === "left").length },
  ];
  return (
    <div className="hr-directory space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: "Current employees",
            count: current.length,
            note: "Across office & field teams",
            icon: Users,
            selected: scope === "current" && type === "all",
            select: () => {
              setScope("current");
              setType("all");
            },
          },
          {
            label: "Internships",
            count: current.filter((e) => e.current_term?.employment_type === "internship").length,
            note: "Learning & growing with us",
            icon: CalendarDays,
            selected: type === "internship",
            select: () => {
              setScope("current");
              setType("internship");
            },
          },
          {
            label: "Full time",
            count: current.filter((e) => e.current_term?.employment_type === "full_time").length,
            note: "Permanent team members",
            icon: BriefcaseBusiness,
            selected: type === "full_time",
            select: () => {
              setScope("current");
              setType("full_time");
            },
          },
          {
            label: "Needs HR details",
            count: current.filter(incomplete).length,
            note: "Complete employment profiles",
            icon: UserRoundCheck,
            selected: scope === "incomplete",
            select: () => {
              setScope("incomplete");
              setType("all");
            },
          },
        ].map((metric) => (
          <button
            type="button"
            key={metric.label}
            className={`hr-metric ${metric.selected ? "hr-metric-selected" : ""}`}
            aria-pressed={metric.selected}
            onClick={metric.select}
          >
            <div className="flex items-center justify-between gap-2">
              <span>{metric.label}</span>
              <span className="hr-metric-icon">
                <metric.icon size={17} />
              </span>
            </div>
            <strong>{loading && !employees.length ? "—" : metric.count}</strong>
            <small>{metric.note}</small>
          </button>
        ))}
      </div>
      <section className="hr-directory-panel" aria-label="Employee directory">
        <div className="hr-directory-heading">
          <div>
            <h2>
              Employee directory <span>{employees.length}</span>
            </h2>
            <p>Your team, reporting lines and employment details.</p>
          </div>
          <span className="hr-live-label">
            <span aria-hidden />
            Team workspace
          </span>
        </div>
        <div className="hr-scope-tabs" role="tablist" aria-label="Employee groups">
          {scopeItems.map((item) => (
            <button
              type="button"
              role="tab"
              key={item.value}
              aria-selected={scope === item.value}
              className={scope === item.value ? "is-active" : ""}
              onClick={() => setScope(item.value)}
            >
              {item.label}
              <span>{item.count}</span>
            </button>
          ))}
        </div>
        <div className="hr-directory-toolbar">
          <div className="hr-search">
            <Search size={17} />
            <Input
              aria-label="Search employees"
              placeholder="Search people, teams or managers…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                <X size={15} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={`hr-filter-toggle ${filtersOpen || filtersCount ? "is-active" : ""}`}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={16} />
            Filters{filtersCount > 0 && <span>{filtersCount}</span>}
            <ChevronDown size={14} />
          </button>
          <div className="hr-sort">
            <ArrowUpDown size={15} />
            <Select
              aria-label="Sort employees"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="name_asc">Name: A to Z</option>
              <option value="name_desc">Name: Z to A</option>
              <option value="joined_desc">Newest joining</option>
              <option value="pay_desc">Highest compensation</option>
            </Select>
          </div>
        </div>
        {filtersOpen && (
          <div className="hr-filter-panel">
            <label>
              Department
              <Select
                aria-label="Filter department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {title(d)}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Employment
              <Select
                aria-label="Filter employment type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="all">All types</option>
                <option value="internship">Internship</option>
                <option value="full_time">Full time</option>
                <option value="not_set">HR details missing</option>
              </Select>
            </label>
            <label>
              Reports to
              <Select
                aria-label="Filter reporting manager"
                value={mentor}
                onChange={(e) => setMentor(e.target.value)}
              >
                <option value="all">All managers</option>
                {mentors.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </label>
            <button type="button" onClick={reset}>
              <X size={14} />
              Reset filters
            </button>
          </div>
        )}
        {filtersCount > 0 && !filtersOpen && (
          <div className="hr-filter-chips">
            {[
              department !== "all" && title(department),
              type !== "all" && (type === "not_set" ? "HR details missing" : employmentLabel(type)),
              mentor !== "all" && `Reports to ${mentor}`,
            ]
              .filter(Boolean)
              .map((label) => (
                <span key={String(label)}>{label}</span>
              ))}
            <button type="button" onClick={reset}>
              Clear filters
            </button>
          </div>
        )}
        {loading && !employees.length ? (
          <div role="status" className="hr-empty">
            Loading employee records…
          </div>
        ) : (
          <>
            <div className="hr-table-scroll">
              <table className="hr-people-table">
                <colgroup>
                  {[3, 24, 14, 12, 14, 15, 18].map((width, i) => (
                    <col key={i} style={{ width: `${width}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="hr-expand-cell">
                      <span className="sr-only">Details</span>
                    </th>
                    <th
                      aria-sort={
                        sort === "name_asc"
                          ? "ascending"
                          : sort === "name_desc"
                            ? "descending"
                            : "none"
                      }
                    >
                      <button
                        type="button"
                        aria-label="Sort by employee name"
                        onClick={() => setSort(sort === "name_asc" ? "name_desc" : "name_asc")}
                      >
                        Employee
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th>Team & role</th>
                    <th>Employment</th>
                    <th aria-sort={sort === "pay_desc" ? "descending" : "none"}>
                      <button
                        type="button"
                        aria-label="Sort by compensation"
                        onClick={() => setSort("pay_desc")}
                      >
                        Compensation
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th>Reports to</th>
                    <th className="hr-actions-cell">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <Fragment key={e.id}>
                      <tr className={expanded.has(e.id) ? "hr-row-expanded" : ""}>
                        <td className="hr-expand-cell">
                          <button
                            type="button"
                            className="hr-expand-toggle"
                            aria-label={`${expanded.has(e.id) ? "Hide" : "Show"} details for ${e.name}`}
                            aria-expanded={expanded.has(e.id)}
                            onClick={() => toggle(e.id)}
                          >
                            <ChevronRight
                              size={15}
                              className={expanded.has(e.id) ? "rotate-90" : ""}
                            />
                          </button>
                        </td>
                        <td>
                          <Identity employee={e} onView={() => onView(e)} />
                        </td>
                        <td>
                          <Team employee={e} />
                        </td>
                        <td>
                          <Terms employee={e} today={today} />
                        </td>
                        <td>
                          <Compensation employee={e} />
                        </td>
                        <td>
                          <ReportingManager
                            name={e.mentor_name}
                            onSelect={() => setMentor(e.mentor_name)}
                          />
                        </td>
                        <td className="hr-actions-cell">
                          <RowActions {...props} employee={e} />
                        </td>
                      </tr>
                      {expanded.has(e.id) && (
                        <tr className="hr-detail-row">
                          <td colSpan={7}>
                            <EmployeeDetails employee={e} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hr-mobile-list">
              {visible.map((e) => (
                <article key={e.id} className="hr-mobile-person">
                  <div className="flex items-start justify-between gap-2">
                    <Identity employee={e} onView={() => onView(e)} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="hr-icon-button"
                          aria-label={`Actions for ${e.name}`}
                          disabled={locked}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="hr-directory-menu">
                        <DropdownMenuItem
                          onSelect={() => props.onEdit(e)}
                          disabled={e.status === "left"}
                        >
                          <Pencil />
                          {e.directory_source ? "Complete HR details" : "Edit employee details"}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-coral" onSelect={() => props.onDelete(e)}>
                          <Trash2 />
                          Delete employee
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="hr-mobile-grid">
                    <Team employee={e} />
                    <Compensation employee={e} />
                    <Terms employee={e} today={today} />
                    <div>
                      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-text-secondary">
                        Reports to
                      </p>
                      <button
                        type="button"
                        className="hr-manager-link"
                        disabled={!e.mentor_name}
                        onClick={() => setMentor(e.mentor_name)}
                      >
                        <Network size={14} />
                        <span>{e.mentor_name || "Not set"}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <AttendanceSetup employee={e} />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={locked && Boolean(e.directory_source)}
                      onClick={() => (e.directory_source ? props.onEdit(e) : onView(e))}
                    >
                      {e.directory_source ? "Complete HR details" : "View profile"}
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="hr-mobile-expand"
                    aria-expanded={expanded.has(e.id)}
                    onClick={() => toggle(e.id)}
                  >
                    {expanded.has(e.id) ? "Hide details" : "More details"}
                    <ChevronDown size={13} className={expanded.has(e.id) ? "rotate-180" : ""} />
                  </button>
                  {expanded.has(e.id) && <EmployeeDetails employee={e} />}
                </article>
              ))}
            </div>
            {!rows.length && (
              <div className="hr-empty">
                <Users size={30} />
                <h3>{employees.length ? "No matching employees" : "Your team starts here"}</h3>
                <p>
                  {employees.length
                    ? "Try another search or adjust the filters."
                    : "Existing team members will appear here. Use Add employee for a new hire."}
                </p>
                {employees.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={reset}>
                    Clear filters
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        <footer className="hr-directory-footer">
          <p>
            {rows.length
              ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, rows.length)} of ${rows.length}`
              : "0"}{" "}
            employees{rows.length !== employees.length ? ` · ${employees.length} total` : ""}
          </p>
          <div>
            <label className="hr-page-size">
              Rows
              <Select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </Select>
            </label>
            <button
              type="button"
              className="hr-icon-button"
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="hr-page-number">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="hr-icon-button"
              aria-label="Next page"
              disabled={currentPage === totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </footer>
      </section>
      <p className="flex items-center gap-2 px-1 text-xs text-text-secondary">
        <Check size={14} />
        Select a name to open the profile. Expand a row for contact, joining and attendance details.
      </p>
    </div>
  );
}
