import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card-surface", className)} {...p}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, num }: { children: React.ReactNode; num?: number }) {
  return (
    <div className="mb-5 flex items-baseline gap-3 border-b border-border pb-2">
      {num !== undefined && (
        <span className="font-mono text-[10px] font-bold text-lime/60 uppercase tracking-widest">
          {String(num).padStart(2, "0")}
        </span>
      )}
      <h3 className="font-syne text-[17px] font-bold text-text-primary uppercase tracking-wide">
        {children}
      </h3>
    </div>
  );
}

export const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <label className={cn("mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-text-secondary", className)}>
    {children}
  </label>
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn("field-underline", className)} {...p} />
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full border border-border bg-surface px-3 py-2 text-sm text-text-primary rounded-[6px] outline-none transition-all focus:border-lime focus:ring-3 focus:ring-lime/15 placeholder:text-text-dim",
        className,
      )}
      {...p}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...p }, ref) => {
    return (
      <select
        ref={ref}
        className={cn("field-underline appearance-none bg-surface pr-8", className)}
        {...p}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";

export function Button({
  variant = "primary",
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  let v = "";
  if (variant === "primary") {
    v = "bg-lime text-black font-semibold hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]";
  } else if (variant === "secondary") {
    v = "bg-transparent border-[1.5px] border-border-bright text-text-primary hover:border-lime/40 hover:text-lime hover:scale-[1.02] active:scale-[0.98]";
  } else if (variant === "danger") {
    v = "bg-transparent border-[1.5px] border-coral/40 text-coral hover:bg-coral-dim active:scale-[0.98]";
  } else {
    v = "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface";
  }

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[6px] px-5 py-2.5 text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:active:scale-100 shadow-none font-sans",
        v,
        className,
      )}
      {...p}
    />
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: React.ReactNode;
  id?: string;
  disabled?: boolean;
}) {
  const inputId = id ?? React.useId();
  return (
    <label htmlFor={inputId} className={cn("inline-flex items-center gap-3 text-sm font-sans text-text-primary", disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : "cursor-pointer")}>
      <span
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 rounded-[4px] transition-all duration-150",
          checked ? "border-lime bg-lime text-bg" : "border-border-bright bg-transparent",
        )}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <input
        id={inputId}
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        disabled={disabled}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const m = {
    neutral: "border-border-bright/20 text-text-secondary bg-surface-raised",
    success: "border-mint/20 text-mint bg-mint-dim",
    warning: "border-warning/20 text-warning bg-warning/8",
    danger: "border-coral/20 text-coral bg-coral-dim",
  }[tone];
  return (
    <span className={cn("inline-flex items-center border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider rounded-[4px]", m)}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("inline-flex bg-surface border border-border p-1 rounded-[8px]", disabled && "opacity-60 cursor-not-allowed")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-4 py-1.5 text-xs font-semibold rounded-[6px] transition-all duration-150 font-sans",
            value === o.value ? "bg-lime text-primary-foreground" : "text-text-secondary hover:text-text-primary",
            disabled && "cursor-not-allowed pointer-events-none"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, text }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-dim">
      <Icon size={48} strokeWidth={1.5} />
      <p className="text-sm font-sans">{text}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-[6px]", className)} />;
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-[6px] w-full bg-border rounded-pill overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-lime to-mint rounded-pill transition-all duration-600 ease-out"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function CompleteJobRow({
  checked,
  onToggle,
  disabled,
  validate,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  validate?: () => Promise<boolean> | boolean;
}) {
  return (
    <div
      onClick={async () => {
        if (!disabled) {
          if (!checked && validate) {
            const ok = await validate();
            if (!ok) return;
          }
          onToggle();
        }
      }}
      className={cn(
        "complete-job-row flex items-center justify-between w-full mt-6 border-t border-border pt-6 select-none",
        checked && "complete",
        disabled && "opacity-50 cursor-not-allowed pointer-events-none"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors border-2 border-border-bright text-lime">
          {checked ? (
            <span className="h-2 w-2 rounded-full bg-lime" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-transparent" />
          )}
        </div>
        <div className="flex flex-col text-left">
          <span className="font-mono text-[10px] uppercase tracking-widest font-bold text-text-primary">
            Complete the Job
          </span>
          <span className="text-xs text-text-secondary">
            {checked ? "Section marked done" : "Mark this section as done"}
          </span>
        </div>
      </div>
      <div>
        <Badge tone={checked ? "success" : "neutral"}>
          {checked ? "Done ✓" : "Unlock"}
        </Badge>
      </div>
    </div>
  );
}

