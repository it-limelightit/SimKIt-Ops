import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button, Badge, Input, Label } from "@/components/ui-kit";
import { toast } from "sonner";

export const Route = createFileRoute("/owner/managers")({ ssr: false, component: ManagersPanel });

function ManagersPanel() {
  const [rows, setRows] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("user_roles")
      .select("user_id,role,profiles:user_id(name,email,mobile,is_active)")
      .eq("role", "supervisor");
    setRows(data ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  const setActive = async (userId: string, active: boolean) => {
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: active } as never)
      .eq("id", userId);
    if (error) toast.error(error.message);
    else {
      toast.success(active ? "Manager approved" : "Manager deactivated");
      await load();
    }
  };

  const demote = async (userId: string) => {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", "supervisor");
    if (error) toast.error(error.message);
    else {
      await supabase.from("user_roles").insert({ user_id: userId, role: "worker" } as never);
      toast.success("Demoted to Business Consultant");
      await load();
    }
  };

  const pending = rows.filter((r) => r.role === "supervisor" && !r.profiles?.is_active);

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-stone">Owner</p>
        <h1 className="mt-2 text-4xl">Managers</h1>
      </header>

      {pending.length > 0 && (
        <div className="border border-warning/40 bg-warning/5 p-5">
          <h2 className="mb-1 text-lg">Manager approvals pending</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            New managers cannot sign in until you approve them.
          </p>
          <div className="space-y-2">
            {pending.map((r) => (
              <div
                key={r.user_id}
                className="flex items-center justify-between border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="text-sm">{r.profiles?.name ?? "—"}</div>
                  <div className="font-mono text-xs text-muted-foreground">{r.profiles?.email}</div>
                </div>
                <Button onClick={() => setActive(r.user_id, true)}>Approve</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-surface">
        <h2 className="mb-4 text-xl">Promote Existing Business Consultant to Manager</h2>
        <PromoteWorker onDone={load} />
      </div>

      <div className="overflow-x-auto border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted">
            <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.user_id}-${r.role}`} className="border-b border-border last:border-0">
                <td className="px-4 py-3">{r.profiles?.name ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.profiles?.email}</td>
                <td className="px-4 py-3">
                  <Badge tone="neutral">manager</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={r.profiles?.is_active ? "success" : "warning"}>
                    {r.profiles?.is_active ? "Active" : "Pending"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {!r.profiles?.is_active ? (
                      <Button onClick={() => setActive(r.user_id, true)}>Approve</Button>
                    ) : (
                      <Button variant="secondary" onClick={() => setActive(r.user_id, false)}>
                        Deactivate
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => demote(r.user_id)}>
                      Demote
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PromoteWorker({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const promote = async () => {
    const { data } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!data) return toast.error("No user with that email");
    // Remove existing worker role, add supervisor role
    await supabase.from("user_roles").delete().eq("user_id", data.id).eq("role", "worker");
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: data.id, role: "supervisor" } as never);
    if (error) toast.error(error.message);
    else {
      await supabase.from("profiles").update({ is_active: true } as never).eq("id", data.id);
      toast.success("Promoted to manager");
      setEmail("");
      onDone();
    }
  };
  return (
    <div className="flex items-end gap-4">
      <div className="flex-1">
        <Label>Business Consultant email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Button onClick={promote}>Promote to Manager</Button>
    </div>
  );
}
