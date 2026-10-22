import { useState } from "react";
import { Building, User, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { SiteMeta } from "@/lib/site-metadata";

export type AssessorDetails = Pick<
  SiteMeta,
  "assessor_company" | "assessor_name" | "assessor_email" | "assessor_phone"
>;

export function AddAssessorDialog({
  siteName,
  onClose,
  onSave,
}: {
  siteName: string;
  onClose: () => void;
  onSave: (details: AssessorDetails) => Promise<boolean>;
}) {
  const [details, setDetails] = useState<AssessorDetails>({
    assessor_company: "",
    assessor_name: "",
    assessor_email: "",
    assessor_phone: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = [
    {
      key: "assessor_company",
      label: "Company name",
      icon: Building,
      type: "text",
      maxLength: 160,
      autoComplete: "organization",
    },
    {
      key: "assessor_name",
      label: "Person name",
      icon: User,
      type: "text",
      maxLength: 120,
      autoComplete: "name",
    },
    {
      key: "assessor_email",
      label: "Email",
      icon: Mail,
      type: "email",
      maxLength: 254,
      autoComplete: "email",
    },
    {
      key: "assessor_phone",
      label: "Mobile number",
      icon: Phone,
      type: "tel",
      maxLength: 25,
      autoComplete: "tel",
    },
  ] as const;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="w-[calc(100%_-_2rem)] max-w-lg max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-xl border-border bg-surface text-text-primary">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle>Add assessor</DialogTitle>
          <DialogDescription className="text-text-secondary">
            Save a new assessor and assign them to {siteName}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            const clean = Object.fromEntries(
              Object.entries(details).map(([key, value]) => [key, value.trim()]),
            ) as AssessorDetails;
            if (Object.values(clean).some((value) => !value)) {
              setError("Please complete all assessor details.");
              return;
            }
            const digits = clean.assessor_phone.replace(/\D/g, "");
            if (
              !/^[+\d\s().-]+$/.test(clean.assessor_phone) ||
              digits.length < 10 ||
              digits.length > 15
            ) {
              setError("Enter a valid mobile number with 10 to 15 digits.");
              return;
            }
            setSaving(true);
            setError(null);
            try {
              if (!(await onSave(clean)))
                setError("Could not save the assessor. Check the error and try again.");
            } catch {
              setError("Could not save the assessor. Please try again.");
            } finally {
              setSaving(false);
            }
          }}
        >
          <fieldset disabled={saving} className="space-y-4">
            {fields.map(({ key, label, icon: Icon, ...input }) => (
              <div key={key}>
                <label
                  htmlFor={`new-${key}`}
                  className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-secondary"
                >
                  <Icon size={14} />
                  {label}
                </label>
                <input
                  {...input}
                  id={`new-${key}`}
                  required
                  value={details[key]}
                  onChange={(event) =>
                    setDetails((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-lime disabled:opacity-60"
                />
              </div>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-coral">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving assessor…" : "Save & assign"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
