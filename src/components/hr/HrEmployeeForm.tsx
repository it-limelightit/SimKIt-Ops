import { cloneElement, useId, useState, type ReactElement } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui-kit";
import {
  hrDepartments,
  internshipEnd,
  defaultHrMentor,
  mentorSuggestions,
  termDraft,
  termPayload,
  type TermDraft,
  type HrBoard,
  type HrEmployee,
  type HrCandidate,
} from "@/lib/hr";

export const hrFieldClass =
  "h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-lime focus:ring-2 focus:ring-lime/15 disabled:opacity-60";
export function HrField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  hint?: string;
}) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  return (
    <div className="space-y-1.5 text-sm">
      <label htmlFor={id} className="block font-medium text-text-primary">
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : children.props["aria-describedby"],
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs leading-5 text-text-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}
export function TermFields({
  value,
  onChange,
  joining,
  initial = false,
}: {
  value: TermDraft;
  onChange: (next: TermDraft) => void;
  joining: string;
  initial?: boolean;
}) {
  const update = (key: keyof TermDraft, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <HrField label="Employment type">
        <Select
          className={hrFieldClass}
          value={value.employment_type}
          onChange={(e) => update("employment_type", e.target.value)}
        >
          <option value="internship">Internship</option>
          <option value="full_time">Full time</option>
        </Select>
      </HrField>
      {!initial && (
        <HrField label="Effective from">
          <Input
            className={hrFieldClass}
            type="date"
            required
            min={joining}
            max="2100-12-31"
            value={value.effective_from}
            onChange={(e) => update("effective_from", e.target.value)}
          />
        </HrField>
      )}
      <HrField
        label={
          value.employment_type === "internship"
            ? "Monthly stipend (INR)"
            : "Monthly gross salary (INR)"
        }
      >
        <Input
          className={hrFieldClass}
          type="number"
          required
          min="0"
          max="999999999"
          step="0.01"
          value={value.monthly_amount}
          onChange={(e) => update("monthly_amount", e.target.value)}
        />
      </HrField>
      {value.employment_type === "full_time" ? (
        <HrField
          label="Annual CTC / package (INR)"
          hint="Enter annual CTC separately from monthly gross salary."
        >
          <Input
            className={hrFieldClass}
            type="number"
            required
            min="0.01"
            max="999999999"
            step="0.01"
            value={value.annual_ctc}
            onChange={(e) => update("annual_ctc", e.target.value)}
          />
        </HrField>
      ) : (
        <>
          <HrField label="Internship duration (months)">
            <Input
              className={hrFieldClass}
              type="number"
              required
              min="1"
              max="60"
              step="1"
              value={value.internship_months}
              onChange={(e) =>
                onChange({
                  ...value,
                  internship_months: e.target.value,
                  internship_end: internshipEnd(joining, Number(e.target.value)),
                })
              }
            />
          </HrField>
          <HrField label="Internship end date">
            <Input
              className={hrFieldClass}
              type="date"
              required
              min={value.effective_from || joining}
              max="2100-12-31"
              value={value.internship_end}
              onChange={(e) => update("internship_end", e.target.value)}
            />
          </HrField>
        </>
      )}
    </div>
  );
}

export function HrEmployeeForm({
  employee,
  initialSource,
  candidates,
  today,
  busy,
  onSave,
}: {
  employee?: HrEmployee;
  initialSource?: HrCandidate;
  candidates: HrBoard["candidates"];
  today: string;
  busy: boolean;
  onSave: (
    details: Record<string, unknown>,
    initial: Record<string, unknown> | null,
  ) => Promise<void>;
}) {
  const formId = useId();
  const [sources] = useState(candidates);
  const [source, setSource] = useState(() => {
    const index = initialSource
      ? sources.findIndex(
          (c) =>
            c === initialSource ||
            Boolean(c.auth_user_id && c.auth_user_id === initialSource.auth_user_id) ||
            Boolean(
              c.attendance_employee_id &&
              c.attendance_employee_id === initialSource.attendance_employee_id,
            ),
        )
      : -1;
    return index >= 0 ? String(index) : "";
  });
  const [value, setValue] = useState({
    name: employee?.name || initialSource?.name || "",
    email: employee?.email || initialSource?.email || "",
    mobile: employee?.mobile || initialSource?.mobile || "",
    department:
      employee?.department ||
      initialSource?.department ||
      (initialSource?.app_access === "field_associate"
        ? "field"
        : initialSource?.app_access === "manager"
          ? "manager"
          : "software"),
    designation: employee?.designation || "",
    mentor_name:
      employee?.mentor_name ||
      initialSource?.mentor_name ||
      (initialSource ? defaultHrMentor(initialSource) : ""),
    joining_date: employee?.joining_date || (initialSource ? "" : today),
    address: employee?.address || "",
    college: employee?.college || "",
    app_access: employee?.app_access || initialSource?.app_access || "employee",
    attendance_method:
      employee?.attendance_method ||
      (initialSource?.app_access === "field_associate" ? "field_online" : "office_device"),
  });
  const [terms, setTerms] = useState(() => termDraft(null, value.joining_date));
  const locked = Boolean(employee?.auth_user_id || employee?.attendance_employee_id || source);
  const update = (key: keyof typeof value, next: string) =>
    setValue((v) => ({ ...v, [key]: next }));
  function chooseSource(next: string) {
    setSource(next);
    if (!next) return;
    const c = sources[Number(next)];
    const joining = c.joining_date || today;
    setValue((v) => ({
      ...v,
      name: c.name,
      email: c.email,
      mobile: c.mobile,
      department:
        c.app_access === "field_associate"
          ? "field"
          : c.department || (c.app_access === "manager" ? "manager" : "software"),
      app_access: c.app_access,
      attendance_method: c.app_access === "field_associate" ? "field_online" : "office_device",
      joining_date: joining,
      mentor_name: c.mentor_name || defaultHrMentor(c),
    }));
    setTerms((v) => ({
      ...v,
      effective_from: joining,
      internship_end: internshipEnd(joining, Number(v.internship_months)),
    }));
  }
  return (
    <form
      id={formId}
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        const c = source ? sources[Number(source)] : null;
        void onSave(
          {
            ...value,
            source_auth_user_id: c?.auth_user_id || null,
            source_attendance_employee_id: c?.attendance_employee_id || null,
          },
          employee ? null : termPayload({ ...terms, effective_from: value.joining_date }),
        );
      }}
    >
      <fieldset disabled={busy} className="space-y-6">
        {!employee && (
          <HrField
            label="Employee source"
            hint="Choose an existing person to keep their current login and attendance history linked."
          >
            <Select
              className={hrFieldClass}
              value={source}
              disabled={Boolean(initialSource)}
              onChange={(e) => chooseSource(e.target.value)}
            >
              <option value="">New employee</option>
              {sources.map((c, index) => (
                <option key={`${c.auth_user_id}:${c.attendance_employee_id}`} value={String(index)}>
                  {c.name || c.email} — {c.email}
                </option>
              ))}
            </Select>
          </HrField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <HrField label="Full name">
            <Input
              className={hrFieldClass}
              required
              maxLength={120}
              value={value.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </HrField>
          <HrField label="Email">
            <Input
              className={hrFieldClass}
              type="email"
              required
              maxLength={254}
              readOnly={locked}
              value={value.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </HrField>
          <HrField label="Mobile number">
            <Input
              className={hrFieldClass}
              type="tel"
              required
              pattern="\+?[0-9 \(\)\-]{7,25}"
              maxLength={25}
              value={value.mobile}
              onChange={(e) => update("mobile", e.target.value)}
            />
          </HrField>
          <HrField
            label="Joining date"
            hint={
              initialSource?.joining_date
                ? `Existing attendance starts on ${initialSource.joining_date}. Enter the employee's actual joining date.`
                : initialSource
                  ? "Enter the employee's actual joining date."
                  : undefined
            }
          >
            <Input
              className={hrFieldClass}
              type="date"
              required
              min="2000-01-01"
              max="2100-12-31"
              value={value.joining_date}
              onChange={(e) => {
                update("joining_date", e.target.value);
                setTerms((v) => ({
                  ...v,
                  effective_from: e.target.value,
                  internship_end: internshipEnd(e.target.value, Number(v.internship_months)),
                }));
              }}
            />
          </HrField>
          <HrField label="Department">
            <Select
              className={hrFieldClass}
              value={value.department}
              onChange={(e) => update("department", e.target.value)}
            >
              {[
                ...new Set([
                  ...hrDepartments,
                  ...(value.department === "hardware" ? ["hardware"] : []),
                ]),
              ]
                .filter((d) => value.app_access === "field_associate" || d !== "field")
                .map((d) => (
                  <option key={d} value={d}>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </option>
                ))}
            </Select>
          </HrField>
          <HrField label="Designation">
            <Input
              className={hrFieldClass}
              required
              maxLength={120}
              value={value.designation}
              onChange={(e) => update("designation", e.target.value)}
              placeholder={
                value.department === "firmware"
                  ? "Embedded System Intern"
                  : value.department === "field"
                    ? "Business Consultant"
                    : "Full Stack Developer Intern"
              }
            />
          </HrField>
          <HrField label="Mentor / reporting manager">
            <Input
              className={hrFieldClass}
              required
              maxLength={120}
              value={value.mentor_name}
              list={`${formId}-mentors`}
              onChange={(e) => update("mentor_name", e.target.value)}
            />
          </HrField>
          <datalist id={`${formId}-mentors`}>
            {mentorSuggestions.map((mentor) => (
              <option key={mentor} value={mentor} />
            ))}
          </datalist>
          <HrField label="App workspace">
            <Select
              className={hrFieldClass}
              disabled={locked}
              value={value.app_access}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  app_access: e.target.value as typeof v.app_access,
                  department:
                    e.target.value === "field_associate"
                      ? "field"
                      : v.department === "field"
                        ? "software"
                        : v.department,
                  attendance_method:
                    e.target.value === "field_associate" ? "field_online" : "office_device",
                }))
              }
            >
              <option value="employee">Office employee</option>
              <option value="field_associate">Field associate</option>
              {value.app_access === "manager" && <option value="manager">Existing manager</option>}
            </Select>
          </HrField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <HrField label="Address / location (optional)">
            <Textarea
              maxLength={500}
              rows={2}
              value={value.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </HrField>
          <HrField label="College / institute (optional)">
            <Textarea
              maxLength={300}
              rows={2}
              value={value.college}
              onChange={(e) => update("college", e.target.value)}
            />
          </HrField>
        </div>
        {!employee && (
          <div className="space-y-4 border-t border-border pt-5">
            <h3 className="font-semibold">Employment and compensation</h3>
            <TermFields value={terms} onChange={setTerms} joining={value.joining_date} initial />
          </div>
        )}
        <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs leading-5 text-text-secondary">
          {employee
            ? "Use Revise employment / salary to change compensation, internship duration or employment type with a dated history."
            : source
              ? "The existing account will be linked when you save. Office face registration stays linked to its current device ID."
              : value.attendance_method === "field_online"
                ? "Save the HR record first, then create or link the field login. Attendance uses the field workspace's Mark as online flow."
                : "Save the HR record first, then create or link the login. Start face enrollment separately when the employee is at the office device. Hardik does not need a webcam."}
        </div>
        <Button type="submit" className="w-full">
          {busy
            ? "Saving…"
            : employee
              ? "Save employee details"
              : initialSource
                ? "Complete HR details"
                : "Add employee"}
        </Button>
      </fieldset>
    </form>
  );
}

export function HrRevisionForm({
  employee,
  today,
  busy,
  onSave,
}: {
  employee: HrEmployee;
  today: string;
  busy: boolean;
  onSave: (terms: Record<string, unknown>, reason: string) => Promise<void>;
}) {
  const [value, setValue] = useState(() =>
    termDraft(employee.current_term, today < employee.joining_date ? employee.joining_date : today),
  );
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(termPayload(value), reason);
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <TermFields value={value} onChange={setValue} joining={employee.joining_date} />
        <HrField label="Reason for revision">
          <Textarea
            required
            maxLength={2000}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Stipend increase, internship extension, conversion to full time…"
          />
        </HrField>
        <p className="text-xs leading-5 text-text-secondary">
          A future effective date schedules the change. Previous amounts and employment types remain
          in the history.
        </p>
        <Button type="submit" className="w-full">
          {busy ? "Saving…" : "Save employment revision"}
        </Button>
      </fieldset>
    </form>
  );
}
