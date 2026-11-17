import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth-store';
import { supabase } from '@/integrations/supabase/client';

const allowedEmails = ['tarun@limelightit.io', 'nitsanghani1@gmail.com', 'kishanvyas308@gmail.com'];
type Alert = {
 id: string; sender: string; subject: string; preview: string; received_at: string; status: 'open' | 'seen' | 'paid';
 seen_by_email: string | null; paid_by_email: string | null; paid_at: string | null;
};
type Overview = { active: Alert[]; history: Alert[]; monitor: { mailbox: string; last_checked_at: string | null } };
const api = supabase as unknown as {
 rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const date = (value: string) => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

export function PaymentAlerts() {
 const { userId, email, ready } = useAuth();
 const allowed = ready && !!userId && allowedEmails.includes(email?.trim().toLowerCase() ?? '');
 const [open, setOpen] = useState(false);
 const [tab, setTab] = useState<'active' | 'history'>('active');
 const [confirmPaid, setConfirmPaid] = useState<string | null>(null);
 const queryClient = useQueryClient();
 const key = ['payment-alerts', userId];
 const query = useQuery({
  queryKey: key, enabled: allowed, refetchInterval: 30000, refetchOnWindowFocus: true,
  queryFn: async () => {
   const { data, error } = await api.rpc('payment_alert_overview');
   if (error) throw new Error('Payment alerts could not be loaded.');
   return data as Overview;
  },
 });
 const update = useMutation({
  mutationFn: async ({ id, action }: { id: string; action: 'seen' | 'paid' }) => {
   const { error } = await api.rpc('set_payment_alert_status', { _alert_id: id, _action: action });
   if (error) throw new Error('Could not update the alert. Please retry.');
  },
  onSuccess: async () => { setConfirmPaid(null); await queryClient.invalidateQueries({ queryKey: key }); },
 });
 if (!allowed) return null;
 const active = query.data?.active ?? [];
 const lastCheck = query.data?.monitor.last_checked_at;
 const stale = !!query.data && (!lastCheck || Date.now() - Date.parse(lastCheck) > 20 * 60000);
 const records = tab === 'active' ? active : query.data?.history ?? [];
 return <>
  {active.length > 0 && <>
   <div className="payment-alert-tint" aria-hidden="true" data-testid="payment-alert-tint" />
   <span className="sr-only" role="alert">Payment requires attention. Open Payment Alerts to review.</span>
  </>}
  <button type="button" onClick={() => { setOpen(true); update.reset(); }}
   className={`z-40 flex items-center gap-2 border px-4 py-3 text-sm font-semibold shadow-lg ${active.length ? 'payment-alert-banner fixed inset-x-0 bottom-0 justify-center border-red-800 bg-red-700 text-white' : `fixed bottom-4 right-4 max-w-[calc(100vw-2rem)] rounded-lg text-left ${stale || query.isError ? 'border-amber-600 bg-amber-100 text-amber-950' : 'border-border bg-background text-foreground'}`}`}
   aria-label={active.length ? `Payment alerts: ${active.length} unpaid. Action required` : 'Payment alerts'}>
   {active.length ? <AlertTriangle size={20} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
   <span>{active.length ? `Contabo payment overdue (${active.length})` : stale ? 'Payment monitor needs attention' : query.isError ? 'Payment alerts unavailable' : 'Payment Alerts'}</span>
   {active.length > 0 && <span className="ml-2 underline">Review now</span>}
  </button>
  <Dialog open={open} onOpenChange={value => { setOpen(value); setConfirmPaid(null); }}>
   <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
    <DialogTitle>Payment Alerts</DialogTitle>
    <DialogDescription>Contabo reminders received by it@limelightit.io. Seen alerts remain active until payment is confirmed.</DialogDescription>
    <div className="flex gap-2" role="tablist" aria-label="Payment alert lists">
     <button role="tab" aria-selected={tab === 'active'} className={`rounded px-3 py-2 ${tab === 'active' ? 'bg-red-100 text-red-800' : 'bg-muted'}`} onClick={() => { setTab('active'); setConfirmPaid(null); }}>Active ({active.length})</button>
     <button role="tab" aria-selected={tab === 'history'} className={`rounded px-3 py-2 ${tab === 'history' ? 'bg-muted font-bold' : ''}`} onClick={() => { setTab('history'); setConfirmPaid(null); }}>History</button>
    </div>
    {query.isPending && <p role="status">Loading payment alerts…</p>}
    {query.isError && <p role="alert" className="text-red-700">Payment alerts unavailable. Please retry.<button className="ml-2 underline" onClick={() => void query.refetch()}>Retry</button></p>}
    {stale && <p role="alert" className="rounded border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">{lastCheck ? 'Gmail monitoring has stopped checking. Check the Google Apps Script executions.' : 'Gmail monitoring is not connected yet. Complete the Google Apps Script setup.'}</p>}
    {lastCheck && <p className="text-xs text-muted-foreground">Last Gmail check: {date(lastCheck)} IST</p>}
    {update.isError && <p role="alert" className="text-red-700">{update.error.message}</p>}
    {!query.isPending && !query.isError && records.length === 0 && <p>{tab === 'active' ? 'No active payment alerts.' : 'No completed payment alerts.'}</p>}
    {records.map(alert => <article key={alert.id} className={`space-y-3 rounded-lg border p-4 ${alert.status !== 'paid' ? 'border-red-300 bg-red-50 text-red-950' : ''}`}>
     <h3 className="font-bold">{alert.subject}</h3>
     {alert.sender && alert.sender !== 'no-reply@contabo.com' && <p className="text-xs font-bold">Test email — no real payment required.</p>}
     <p className="text-xs">Received: {date(alert.received_at)} IST</p>
     <p className="whitespace-pre-wrap break-words text-sm">{alert.preview}</p>
     {alert.seen_by_email && <p className="text-xs">Seen by {alert.seen_by_email}</p>}
     {alert.status === 'paid' ? <p className="text-sm">Payment confirmed by {alert.paid_by_email}{alert.paid_at && ` on ${date(alert.paid_at)} IST`}</p> : <>
      <div className="flex flex-wrap gap-3">
       {alert.status === 'open' && <button className="rounded border border-red-700 px-3 py-2 text-sm" disabled={update.isPending} onClick={() => update.mutate({ id: alert.id, action: 'seen' })}>Mark as seen</button>}
       <button className="rounded bg-red-700 px-3 py-2 text-sm text-white" disabled={update.isPending} onClick={() => setConfirmPaid(alert.id)}>Payment completed</button>
      </div>
      {confirmPaid === alert.id && <div className="space-y-2 border-t border-red-200 pt-3">
       <p className="text-sm">Confirm payment was made for this reminder. This clears the alert for all three accounts.</p>
       <button className="rounded bg-red-800 px-3 py-2 text-sm text-white" disabled={update.isPending} onClick={() => update.mutate({ id: alert.id, action: 'paid' })}>Confirm payment completed</button>
       <button className="ml-3 text-sm underline" onClick={() => setConfirmPaid(null)}>Cancel</button>
      </div>}
     </>}
    </article>)}
   </DialogContent>
  </Dialog>
 </>;
}
