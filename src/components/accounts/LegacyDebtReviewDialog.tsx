"use client";
import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { ExistingDebtFields, validateExistingDebtFields, type ExistingDebtFieldsValue } from './ExistingDebtFields';
import { useGoals } from '@/hooks/use-goals';
import { useAccounts } from '@/hooks/use-data';
import { useDebt, useDebtCommand } from '@/hooks/use-debt';
import type { AdoptOpeningDebtCommand, DebtAccountSnapshot } from '@/lib/debt/contracts';
const actionClass = "min-h-11 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-green-950 dark:hover:bg-emerald-300";
const empty = (): ExistingDebtFieldsValue => ({ enabled: true, items: [] });
export function LegacyDebtReviewDialog({ isOpen, onClose, account }: { isOpen: boolean; onClose: () => void; account: DebtAccountSnapshot | null }) {
  const { userId } = useGoals();
  const metadata = useAccounts();
  const debt = useDebt(userId);
  const write = useDebtCommand(userId);
  const [draft, setDraft] = useState<ExistingDebtFieldsValue>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<AdoptOpeningDebtCommand | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const pending = write.pendingCommand?.kind === 'adopt_opening_debt' ? write.pendingCommand : null;
  const targetId = pending?.accountId ?? account?.accountId;
  const current = debt.snapshot ? debt.snapshot.accounts.find(item => item.accountId === targetId) ?? null : account;
  const wallet = metadata.data?.find(item => item.id === targetId);
  const eligible = current?.reconciliation === 'balanced' && current.undatedOutstanding !== '0.00' && wallet?.currency === 'PHP' && wallet.type === 'credit_card' && wallet.is_active === true;
  const frozenDraft: ExistingDebtFieldsValue | null = pending ? { enabled: true, items: pending.items.map(item => ({ clientId: item.clientId, name: item.name, mode: item.mode, amountText: item.amount, firstDueDate: item.firstDueDate, countText: String(item.count) })) } : null;
  const visibleDraft = frozenDraft ?? draft;
  const validated = useMemo(() => validateExistingDebtFields(visibleDraft), [visibleDraft]);
  const blocked = !userId || !debt.snapshot || write.isSaving || write.unresolved || refreshing || refreshFailed || debt.isLoading || Boolean(debt.error) || Boolean(metadata.error) || !eligible;
  useEffect(() => { setDraft(empty()); setErrors({}); setConfirmation(null); setRefreshFailed(false); }, [account?.accountId, userId]);
  useEffect(() => { if (confirmation && current?.fingerprint !== confirmation.fingerprint) setConfirmation(null); }, [current?.fingerprint, confirmation]);
  async function refreshOnly() {
    setRefreshing(true); setRefreshFailed(false);
    try { await debt.refresh(); if (write.saved) { write.reset(); onClose(); } }
    catch { setRefreshFailed(true); setErrors({ form: 'Debt details could not refresh. Retry refresh before confirming.' }); }
    finally { setRefreshing(false); }
  }
  useEffect(() => {
    if (!write.isSaving && write.error?.includes('financial details changed')) {
      setConfirmation(null); void refreshOnly();
    }
  }, [write.error, write.isSaving]);
  useEffect(() => { if (write.saved && !write.isSaving && !write.refreshError && isOpen) { write.reset(); onClose(); } }, [write.saved, write.isSaving, write.refreshError, isOpen]);
  function close() { if (write.isSaving || refreshing) return; setConfirmation(null); if (write.saved && !write.refreshError) write.reset(); onClose(); }
  function review() {
    if (blocked || !current) return;
    if (!validated.success) { setErrors(validated.errors); return; }
    if (!visibleDraft.enabled || validated.total !== current.undatedOutstanding) { setErrors({ form: `Enter the entire undated residual: PHP ${current.undatedOutstanding}. Partial adoption is unavailable.` }); return; }
    setErrors({}); setConfirmation({ kind: 'adopt_opening_debt', accountId: current.accountId, fingerprint: current.fingerprint, items: validated.openingDebts });
  }
  return <Dialog.Root open={isOpen} onOpenChange={open => { if (!open) close(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Content data-mobile-nav-blocking="" className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl" onEscapeKeyDown={event => { if (write.isSaving || refreshing) event.preventDefault(); }} onPointerDownOutside={event => { if (write.isSaving || refreshing) event.preventDefault(); }}>
      <div className="border-b border-border p-5"><Dialog.Title className="font-heading text-lg font-semibold">Review debt due dates</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">Assign dates to the remaining debt. This keeps wallet balance, cash and recorded payments unchanged.</Dialog.Description></div>
      <div className="min-h-0 overflow-y-auto p-5 space-y-4">
        <p className="break-words text-sm tabular-nums">Needs due-date review: PHP {current?.undatedOutstanding ?? 'Unavailable'}</p>
        {(errors.form || write.error) && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errors.form || write.error}</p>}
        {!eligible && !write.unresolved && <p role="alert" className="text-sm">An active, reconciled PHP credit wallet with undated debt is required.</p>}
        {write.saved ? <p role="status" className="text-sm">Due dates saved. Refresh the summary before continuing.</p> : <>
          <ExistingDebtFields value={visibleDraft} onChange={value => { if (!blocked) { setDraft(value); setConfirmation(null); setErrors({}); } }} disabled={blocked || Boolean(confirmation)} errors={Object.fromEntries(Object.entries(errors).filter(([key]) => key !== "form"))} />
          {confirmation && <div className="space-y-2 border-t border-border pt-4"><p className="text-sm font-semibold tabular-nums">Confirm complete schedule: PHP {validated.success ? validated.total : 'Unavailable'}</p><p className="text-sm text-muted-foreground">The entire residual will receive these due dates. No payment will be recorded.</p></div>}
          {write.unresolved && <p role="status" className="text-sm">This save is unconfirmed. Retry the original due dates before starting another review.</p>}
        </>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border p-5 sm:flex-row sm:justify-end">
        <Button variant="outline" className="min-h-11" disabled={write.isSaving || refreshing} onClick={close}>Cancel</Button>
        {write.saved || refreshFailed ? <Button className={actionClass} disabled={refreshing} onClick={() => void refreshOnly()}>Retry refresh</Button> : write.unresolved ? <Button className={actionClass} disabled={write.isSaving} onClick={() => void write.retry()}>Retry same request</Button> : confirmation ? <><Button variant="outline" className="min-h-11" disabled={blocked} onClick={() => setConfirmation(null)}>Edit dates</Button><Button className={actionClass} disabled={blocked} onClick={() => { if (!blocked && current?.fingerprint === confirmation.fingerprint) void write.submit(confirmation); }}>Confirm due dates</Button></> : <Button className={actionClass} disabled={blocked} onClick={review}>Review schedule</Button>}
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}



