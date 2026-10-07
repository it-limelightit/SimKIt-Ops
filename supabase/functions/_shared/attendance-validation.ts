export function requiredText(value: unknown, field: string, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`Invalid ${field}`);
  return value.trim();
}
export function isoTimestamp(value: unknown): string {
  const text = requiredText(value, "scanned_at", 40);
  if (!dateOrNull(text.slice(0, 10))) throw new Error("Invalid scan date");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) ||
    !Number.isFinite(Date.parse(text))
  )
    throw new Error("scanned_at must include a timezone");
  return new Date(text).toISOString();
}
export function dateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}
export function uuid(value: unknown): string {
  const text = requiredText(value, "id", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))
    throw new Error("Invalid id");
  return text;
}
export function photoBytes(base64: unknown, mime: unknown): { bytes: Uint8Array; mime: string } {
  if (mime !== "image/jpeg" && mime !== "image/png")
    throw new Error("Only JPEG and PNG photos are accepted");
  const encoded = requiredText(base64, "photo_base64", 2800000);
  const raw = atob(encoded);
  if (!raw.length || raw.length > 2097152) throw new Error("Photo exceeds 2 MB");
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  if (mime === "image/jpeg" ? !jpeg : !png)
    throw new Error("Photo content does not match its MIME type");
  return { bytes, mime };
}
