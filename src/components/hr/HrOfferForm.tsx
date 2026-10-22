import { useEffect, useState } from "react";
import { Download, Eye, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Select } from "@/components/ui-kit";
import {
  defaultOfferFields,
  employmentLabel,
  hrMoney,
  hrRpc,
  suggestedTemplate,
  templateLabel,
  type HrEmployee,
  type HrOffer,
  type HrTerm,
  type OfferFields,
  type OfferSnapshot,
  type OfferTemplate,
} from "@/lib/hr";
import { dateLabel } from "@/lib/device-attendance";
import { HrField, hrFieldClass } from "./HrEmployeeForm";

export function HrOfferForm({
  employee,
  terms,
  today,
  onSaved,
  onBusyChange,
}: {
  employee: HrEmployee;
  terms: HrTerm[];
  today: string;
  onSaved: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [template, setTemplate] = useState<OfferTemplate>(() => suggestedTemplate(employee));
  const [termId, setTermId] = useState(employee.current_term?.id || terms[0]?.id || "");
  const term = terms.find((t) => t.id === termId);
  const [fields, setFields] = useState<OfferFields>(() =>
    defaultOfferFields(employee, term!, template, today),
  );
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [template, termId, fields]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const update = <K extends keyof OfferFields>(key: K, value: OfferFields[K]) =>
    setFields((old) => ({ ...old, [key]: value }));
  async function generate(save: boolean) {
    if (!term) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const { createOfferPdf, offerFilename } = await import("@/lib/hr-offer-pdf");
      let snapshot: OfferSnapshot = { version: 1, template, employee, term, fields };
      let reference = "";
      if (save) {
        const letter = await hrRpc<HrOffer>("hr_save_offer", {
          _employee: employee.id,
          _revision: employee.revision,
          _term: term.id,
          _template: template,
          _fields: fields,
        });
        snapshot = letter.snapshot;
        reference = letter.offer_number;
        // Keep the saved snapshot available even if the subsequent download fails.
        await onSaved();
      }
      const doc = await createOfferPdf(snapshot, undefined, reference);
      if (save) {
        doc.save(offerFilename(employee.name, reference));
        toast.success("Offer letter saved and downloaded.");
      } else setPreview(URL.createObjectURL(doc.output("blob")));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not generate offer letter");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void generate(false);
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <HrField label="Offer template">
            <Select
              className={hrFieldClass}
              value={template}
              onChange={(e) => {
                const next = e.target.value as OfferTemplate;
                setTemplate(next);
                if (term) setFields(defaultOfferFields(employee, term, next, today));
              }}
            >
              {(["software", "firmware", "field_associate"] as const).map((t) => (
                <option key={t} value={t}>
                  {templateLabel(t)}
                </option>
              ))}
            </Select>
          </HrField>
          <HrField label="Employment terms">
            <Select
              className={hrFieldClass}
              value={termId}
              onChange={(e) => {
                setTermId(e.target.value);
                const next = terms.find((t) => t.id === e.target.value);
                if (next)
                  setFields((f) => ({
                    ...f,
                    initial_stipend_months: Math.min(
                      f.initial_stipend_months,
                      next.internship_months || 1,
                    ),
                  }));
              }}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {dateLabel(t.effective_from)} · {employmentLabel(t.employment_type)} ·{" "}
                  {hrMoney(t.monthly_amount)}/month
                </option>
              ))}
            </Select>
          </HrField>
          <HrField label="Offer date">
            <Input
              className={hrFieldClass}
              required
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={fields.offer_date}
              onChange={(e) => update("offer_date", e.target.value)}
            />
          </HrField>
          <HrField label="Honorific (optional)">
            <Select
              className={hrFieldClass}
              value={fields.honorific}
              onChange={(e) => update("honorific", e.target.value)}
            >
              <option value="">None</option>
              <option>Mr.</option>
              <option>Ms.</option>
              <option>Mrs.</option>
              <option>Dr.</option>
            </Select>
          </HrField>
          <HrField label="Greeting name">
            <Input
              className={hrFieldClass}
              required
              maxLength={120}
              value={fields.greeting_name}
              onChange={(e) => update("greeting_name", e.target.value)}
            />
          </HrField>
          <HrField label="Recipient location / institute">
            <Input
              className={hrFieldClass}
              required
              maxLength={500}
              value={fields.recipient_location}
              onChange={(e) => update("recipient_location", e.target.value)}
            />
          </HrField>
          <HrField label="Acceptance place">
            <Input
              className={hrFieldClass}
              required
              maxLength={120}
              value={fields.acceptance_place}
              onChange={(e) => update("acceptance_place", e.target.value)}
            />
          </HrField>
          <HrField label="Acceptance window (days)">
            <Input
              className={hrFieldClass}
              required
              type="number"
              min="1"
              max="60"
              value={fields.acceptance_days}
              onChange={(e) => update("acceptance_days", Number(e.target.value))}
            />
          </HrField>
          {term?.employment_type === "internship" && (
            <HrField
              label="Initial stipend period (months)"
              hint="After this period, the supplied template's performance-review clause applies."
            >
              <Input
                className={hrFieldClass}
                required
                type="number"
                min="1"
                max={term.internship_months || 60}
                value={fields.initial_stipend_months}
                onChange={(e) => update("initial_stipend_months", Number(e.target.value))}
              />
            </HrField>
          )}
          {template !== "field_associate" && (
            <HrField label="Office timings">
              <Input
                className={hrFieldClass}
                required
                maxLength={500}
                value={fields.office_timings}
                onChange={(e) => update("office_timings", e.target.value)}
              />
            </HrField>
          )}
        </div>
        {template === "field_associate" && (
          <div className="space-y-4 rounded-xl border border-border bg-surface-raised/40 p-4">
            <h3 className="font-semibold">Field compensation and targets</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  [
                    "incentive_per_installation",
                    "Incentive per installation (INR)",
                    0,
                    999999999,
                    "0.01",
                  ],
                  ["travel_per_km", "Travel allowance per km (INR)", 0, 999999999, "0.01"],
                  ["installation_target", "Installation target", 1, 60, "1"],
                  ["probation_months", "Probation period (months)", 1, 60, "1"],
                  ["payment_day", "Monthly payment day", 1, 31, "1"],
                  ["payroll_cutoff_day", "Certificate submission cutoff day", 1, 31, "1"],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <HrField key={key} label={label}>
                  <Input
                    className={hrFieldClass}
                    required
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={fields[key]}
                    onChange={(e) => update(key, Number(e.target.value))}
                  />
                </HrField>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs leading-5 text-text-secondary">
          <FileText size={15} className="mb-1" />
          Uses the supplied {templateLabel(template).toLowerCase()} letterhead and terms. Employee
          name, designation, mentor, dates, employment type and compensation come from the selected
          HR record. Review all pages before saving. Signature spaces remain blank for acceptance.
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-coral/10 p-3 text-sm text-coral">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={!term}>
            <Eye size={16} />
            {busy ? "Preparing…" : "Preview letter"}
          </Button>
          <Button type="button" disabled={!preview || !term} onClick={() => void generate(true)}>
            <Download size={16} />
            Save & download PDF
          </Button>
        </div>
      </fieldset>
      {preview && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            Preview · {templateLabel(template)} · {employmentLabel(term?.employment_type)}
          </p>
          <iframe
            title="Offer letter preview"
            src={preview}
            className="h-[65vh] min-h-96 w-full rounded-xl border border-border bg-white"
          />
          <a
            href={preview}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-lime underline"
          >
            Open preview in a new tab
          </a>
        </div>
      )}
    </form>
  );
}
