import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.0";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: cors });
const secret = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error("Expense file storage is not configured");
  return value;
};
const maximum = 5_000_000;
function contentType(bytes: Uint8Array) {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-")
    return "application/pdf";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  return null;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401);
    const admin = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(authorization.slice(7));
    if (error || !user?.email_confirmed_at)
      return json({ error: "Verified session required" }, 401);
    const reviewer = ["admin@limelightit.io", "tarun@limelightit.io"].includes(
      user.email?.toLowerCase() || "",
    );
    const account = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (account.error || !account.data?.is_active)
      return json({ error: "Active account required" }, 403);
    const r2 = new AwsClient({
      accessKeyId: secret("EXPENSE_R2_ACCESS_KEY_ID"),
      secretAccessKey: secret("EXPENSE_R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    });
    const endpoint = `https://${secret("EXPENSE_R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${encodeURIComponent(secret("EXPENSE_R2_BUCKET"))}/`;
    if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (reviewer)
        return json({ error: "Personal expense submission for this reviewer is unavailable" }, 403);
      // Bound the stream before multipart parsing; Content-Length alone is untrusted.
      const reader = req.body?.getReader();
      if (!reader) return json({ error: "File required" }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maximum + 65536) {
          await reader.cancel();
          return json({ error: "Maximum file size is 5 MB" }, 413);
        }
        chunks.push(value);
      }
      const raw = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        raw.set(chunk, offset);
        offset += chunk.length;
      }
      const form = await new Response(raw, {
        headers: { "Content-Type": req.headers.get("content-type")! },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size < 1 || file.size > maximum)
        return json({ error: "Attach one file, maximum 5 MB" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = contentType(bytes);
      if (!mime || mime !== file.type)
        return json({ error: "Use a valid PDF, JPG or PNG file" }, 400);
      const id = crypto.randomUUID();
      const key = `expenses/${user.id}/${id}`;
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const stored = await r2.fetch(endpoint + key, {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": mime },
      });
      if (!stored.ok) return json({ error: "File upload failed. Please retry." }, 502);
      const saved = await admin.from("expense_files").insert({
        id,
        owner_id: user.id,
        object_key: key,
        filename: file.name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 180),
        mime_type: mime,
        size_bytes: bytes.length,
        sha256: hash,
      });
      if (saved.error) {
        await r2.fetch(endpoint + key, { method: "DELETE" });
        return json({ error: "File record could not be saved. Please retry." }, 500);
      }
      return json({ id });
    }
    if (Number(req.headers.get("content-length") || 0) > 4096)
      return json({ error: "Request too large" }, 413);
    const input = await req.json();
    const { data: file, error: lookup } = await admin
      .from("expense_files")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (
      lookup ||
      !file ||
      (!reviewer && file.owner_id !== user.id) ||
      (!file.claim_id && file.owner_id !== user.id)
    )
      return json({ error: "Attachment unavailable" }, 404);
    if (user.email?.toLowerCase() === "tarun@limelightit.io" && file.owner_id !== user.id) {
      const claim = await admin
        .from("expense_claims")
        .select("sent_to_tarun_at")
        .eq("id", file.claim_id)
        .maybeSingle();
      if (claim.error || !claim.data?.sent_to_tarun_at)
        return json({ error: "Attachment unavailable" }, 404);
    }
    const url = new URL(endpoint + file.object_key);
    url.searchParams.set("X-Amz-Expires", "60");
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename="${file.filename.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`,
    );
    const signed = await r2.sign(new Request(url), { aws: { signQuery: true } });
    return json({ url: signed.url });
  } catch {
    return json(
      { error: "Expense file request failed. Check storage configuration or retry." },
      503,
    );
  }
});
