import { useState } from "react";
import { Checkbox, Input, Label, Select, Button } from "@/components/ui-kit";

export type UpscaleDeviceDraft = {
  machine_name: string;
  vibration_model: string;
  components: Record<string, boolean>;
};

const componentOptions = [
  ["dm", "DM (Data Meter)"],
  ["without_cavli", "Without Cavli"],
  ["antenna", "Antenna Kit"],
  ["proxy1", "Proxy 1 (Inductive)"],
  ["proxy2", "Proxy 2 (Inductive)"],
  ["encoder", "Encoder"],
  ["vibration", "Vibration Sensor"],
  ["tower_light", "Tower Light"],
  ["energy_meter", "Energy Meter"],
  ["plc", "PLC"],
] as const;

function blankDevice(): UpscaleDeviceDraft {
  return { machine_name: "", vibration_model: "", components: { dm: true } };
}

export function UpscaleConversionDialog({
  companyName,
  initialComment,
  alreadyConverted = false,
  busy,
  onClose,
  onSubmit,
}: {
  companyName: string;
  initialComment: string;
  alreadyConverted?: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (comment: string, devices: UpscaleDeviceDraft[]) => Promise<void>;
}) {
  const [countText, setCountText] = useState("1");
  const [devices, setDevices] = useState<UpscaleDeviceDraft[]>([blankDevice()]);
  const [entryModes, setEntryModes] = useState<Array<"manual" | "previous">>(["manual"]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [comment, setComment] = useState(initialComment);
  const [error, setError] = useState("");
  const active = devices[activeIndex];

  const updateDevice = (patch: Partial<UpscaleDeviceDraft>, markManual = false) => {
    setDevices((current) =>
      current.map((item, index) => (index === activeIndex ? { ...item, ...patch } : item)),
    );
    if (markManual) {
      setEntryModes((current) => current.map((mode, index) => index === activeIndex ? "manual" : mode));
    }
    setError("");
  };
  const setComponent = (key: string, checked: boolean) => {
    const components = { ...active.components, [key]: checked };
    if (key === "dm" && !checked) components.without_cavli = false;
    updateDevice({
      components,
      ...(key === "vibration" && !checked ? { vibration_model: "" } : {}),
    }, true);
  };
  const copyPreviousDevice = () => {
    if (activeIndex === 0) return;
    const previous = devices[activeIndex - 1];
    updateDevice({
      components: { ...previous.components },
      vibration_model: previous.vibration_model,
    });
    setEntryModes((current) => current.map((mode, index) => index === activeIndex ? "previous" : mode));
  };
  const startManualDevice = () => {
    if (entryModes[activeIndex] === "manual") return;
    const blank = blankDevice();
    updateDevice({ components: blank.components, vibration_model: blank.vibration_model });
    setEntryModes((current) => current.map((mode, index) => index === activeIndex ? "manual" : mode));
  };
  const changeCount = (value: string) => {
    setCountText(value);
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) return;
    setDevices((current) =>
      Array.from({ length: parsed }, (_, index) => current[index] ?? blankDevice()),
    );
    setEntryModes((current) =>
      Array.from({ length: parsed }, (_, index) => current[index] ?? "manual"),
    );
    setActiveIndex((index) => Math.min(index, parsed - 1));
    setError("");
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const count = Number(countText);
    if (!Number.isInteger(count) || count < 1 || count > 200 || devices.length !== count) {
      setError("Enter a device count between 1 and 200.");
      return;
    }
    if (!comment.trim()) {
      setError(alreadyConverted ? "An order comment is required." : "A conversion comment is required.");
      return;
    }
    const seen = new Set<string>();
    for (let index = 0; index < devices.length; index++) {
      const device = devices[index];
      const machine = device.machine_name.trim();
      if (!machine || machine.length > 120) {
        setActiveIndex(index);
        setError(`Device ${index + 1} needs a machine name of 1 to 120 characters.`);
        return;
      }
      if (seen.has(machine.toLocaleLowerCase())) {
        setActiveIndex(index);
        setError(`Machine name "${machine}" is repeated.`);
        return;
      }
      seen.add(machine.toLocaleLowerCase());
      if (device.components.vibration && !device.vibration_model) {
        setActiveIndex(index);
        setError(`Select a vibration model for device ${index + 1}.`);
        return;
      }
      if (
        !Object.entries(device.components).some(
          ([key, selected]) => selected && key !== "without_cavli",
        )
      ) {
        setActiveIndex(index);
        setError(`Select at least one component for device ${index + 1}.`);
        return;
      }
    }
    setError("");
    await onSubmit(
      comment.trim(),
      devices.map((item) => ({ ...item, machine_name: item.machine_name.trim() })),
    );
  };

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-bg/95 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={alreadyConverted ? `Create Upscale device order for ${companyName}` : `Convert ${companyName} to Upscale`}
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="mx-auto max-w-6xl space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-2xl sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-lime">
              Company Tracker / Upscale
            </p>
            <h2 className="mt-1 font-syne text-2xl font-bold text-text-primary">
              {alreadyConverted ? `Create Upscale device order for ${companyName}` : `Convert ${companyName}`}
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              {alreadyConverted
                ? "Complete an Upscale order for every client machine."
                : "Complete an order for every client machine before converting this company."} The machine name is separate from our DM name.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xl text-text-secondary hover:text-text-primary"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="upscale-device-count">Number of devices *</Label>
            <Input
              id="upscale-device-count"
              type="number"
              min={1}
              max={200}
              step={1}
              required
              value={countText}
              onChange={(event) => changeCount(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="upscale-conversion-comment">{alreadyConverted ? "Order comment *" : "Conversion comment *"}</Label>
            <Input
              id="upscale-conversion-comment"
              required
              maxLength={1000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Device forms">
          {devices.map((device, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${activeIndex === index ? "border-lime bg-lime/10 text-lime" : "border-border text-text-secondary hover:border-lime/50"}`}
            >
              {index + 1}. {device.machine_name.trim() || "Machine name needed"}
            </button>
          ))}
        </div>
        <section className="space-y-4 rounded-xl border border-border bg-surface-raised/30 p-4">
          <h3 className="font-syne text-lg font-bold text-text-primary">
            Device {activeIndex + 1} of {devices.length}
          </h3>
          {activeIndex > 0 && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="mb-2 text-xs font-semibold text-text-primary">How do you want to fill this device?</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Device ${activeIndex + 1} setup`}>
                <button
                  type="button"
                  onClick={copyPreviousDevice}
                  aria-pressed={entryModes[activeIndex] === "previous"}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet ${entryModes[activeIndex] === "previous" ? "border-lime bg-lime/10 text-lime" : "border-border text-text-secondary hover:border-lime/50"}`}
                >
                  Same as previous device
                </button>
                <button
                  type="button"
                  onClick={startManualDevice}
                  aria-pressed={entryModes[activeIndex] === "manual"}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet ${entryModes[activeIndex] === "manual" ? "border-lime bg-lime/10 text-lime" : "border-border text-text-secondary hover:border-lime/50"}`}
                >
                  Enter manually
                </button>
              </div>
              <p className="mt-2 text-xs text-text-secondary">Previous setup copies components and vibration model. Enter a unique machine name below; copied selections can be edited.</p>
            </div>
          )}
          <div>
            <Label htmlFor="upscale-machine-name">Client machine name *</Label>
            <Input
              id="upscale-machine-name"
              maxLength={120}
              value={active.machine_name}
              onChange={(event) => updateDevice({ machine_name: event.target.value })}
              placeholder="Name used by the client for this machine"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2">
              <Label>CT supply phase</Label>
              <div className="mt-2 flex flex-wrap gap-3 sm:gap-4">
                <Checkbox
                  id={`upscale-ct-single-phase-${activeIndex}`}
                  label="Single-phase — 1 CT sensor"
                  checked={!!active.components.ct1}
                  disabled={busy}
                  onCheckedChange={(checked) => updateDevice({ components: { ...active.components, ct1: checked, ct2: false, ct3: false } }, true)}
                />
                <Checkbox
                  id={`upscale-ct-three-phase-${activeIndex}`}
                  label="Three-phase — 3 CT sensors"
                  checked={!!active.components.ct3}
                  disabled={busy}
                  onCheckedChange={(checked) => updateDevice({ components: { ...active.components, ct1: false, ct2: false, ct3: checked } }, true)}
                />
              </div>
            </div>
            {componentOptions.map(([key, label]) => (
              <Checkbox
                key={key}
                id={`upscale-${key}-${activeIndex}`}
                label={label}
                checked={!!active.components[key]}
                disabled={key === "without_cavli" && !active.components.dm}
                onCheckedChange={(checked) => setComponent(key, checked)}
              />
            ))}
          </div>
          {active.components.vibration && (
            <div className="max-w-sm">
              <Label htmlFor="upscale-vibration-model">Vibration model *</Label>
              <Select
                id="upscale-vibration-model"
                required
                value={active.vibration_model}
                onChange={(event) => updateDevice({ vibration_model: event.target.value }, true)}
              >
                <option value="">Select model</option>
                <option value="renke">Renke</option>
                <option value="witmotion">WitMotion</option>
                <option value="vibe-q">Vibe Q</option>
              </Select>
            </div>
          )}
        </section>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex((index) => index - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={activeIndex === devices.length - 1}
              onClick={() => setActiveIndex((index) => index + 1)}
            >
              Next
            </Button>
          </div>
          <Button type="submit" disabled={busy}>
            {busy
              ? "Saving device orders..."
              : alreadyConverted ? `Submit ${devices.length} device orders` : `Submit ${devices.length} device orders and convert`}
          </Button>
        </div>
      </form>
    </div>
  );
}
