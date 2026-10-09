"use client";
import { Button } from "@/components/ui/button";
import type { DebtSnapshot } from "@/lib/debt/contracts";
import { summarizeDebt } from "@/lib/debt/summary";
import { DebtHistoryGroup } from "@/components/accounts/DebtHistoryGroup";
import { formatCurrency } from "@/lib/utils";
export function DebtScheduleSection({ snapshot, isLoading, error, onPayDebt, onReviewLegacy, canReviewLegacy, onCorrectionSaved, wallets = [] }: {
  snapshot: DebtSnapshot | undefined; isLoading: boolean; error: unknown;
  onPayDebt?: (accountId?: string) => void; onReviewLegacy: (accountId: string) => void; canReviewLegacy?: (accountId: string) => boolean;
  onCorrectionSaved?: () => Promise<unknown>;
  wallets?: ReadonlyArray<{ id: string; name: string }>;
}) {
  const walletName = (id: string) => wallets.find(wallet => wallet.id === id)?.name ?? "Credit wallet";
  const money = (amount: string) => formatCurrency(Number(amount));
  const ready = !error && snapshot;
  const owned = new Set(snapshot?.accounts.map(account => account.accountId));
  const historyRows = ready ? snapshot.rows.filter(row => owned.has(row.accountId)) : [];
  const rows = historyRows.filter(row => row.remainingAmount !== "0.00");
  const months = Array.from(new Set(rows.flatMap(row => row.dueDate ? [row.dueDate.slice(0, 7)] : []))).sort();
  const historyGroups = Array.from(historyRows.reduce((groups, row) => {
    const key = `${row.accountId}:${row.groupId}:${row.source}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
    return groups;
  }, new Map<string, typeof historyRows>()).entries());
  const installmentTotals = new Map(historyGroups.map(([key, groupRows]) =>
    [key, Math.max(...groupRows.map(row => row.ordinal))]));
  return <section className="min-w-0 space-y-4" aria-busy={isLoading}>
    <div className="border-b border-border pb-3"><h2 className="font-heading text-xl font-bold">PayLater & Credit Schedule</h2><p className="mt-1 text-sm text-muted-foreground">Remaining debt by due date. Payments apply across the wallet in due-date order, regardless of the month filter.</p>
      {ready && !isLoading && <p className="mt-2 text-sm font-semibold tabular-nums sm:text-base">Outstanding total: {money(summarizeDebt(snapshot, null).totalOutstanding)}</p>}
    </div>
    {isLoading && !snapshot ? <p role="status" className="text-sm text-muted-foreground">Loading debt schedule…</p> : error || !snapshot ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">Debt schedule is unavailable. Refresh to try again.</p> : <>
      {isLoading && <p role="status" className="text-sm text-muted-foreground">Refreshing debt schedule…</p>}
      {snapshot.accounts.filter(account => account.reconciliation === "needs_review").map(account => <p key={account.accountId} role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{walletName(account.accountId)} needs reconciliation review. Outstanding debt: {money(account.totalOutstanding)}. Scheduled payments and due-date adoption are unavailable.</p>)}
      {snapshot.accounts.filter(account => account.undatedOutstanding !== "0.00").map(account => <div key={account.accountId} className="flex flex-col gap-2 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-sm font-semibold">Needs due-date review</p><p className="break-words text-sm tabular-nums">{money(account.undatedOutstanding)} · {walletName(account.accountId)}</p>{canReviewLegacy && !canReviewLegacy(account.accountId) && <p className="text-sm text-muted-foreground">Due-date review requires an active PHP wallet.</p>}</div><Button variant="outline" className="min-h-11 whitespace-normal" disabled={isLoading || account.reconciliation !== "balanced" || Boolean(canReviewLegacy && !canReviewLegacy(account.accountId))} onClick={() => onReviewLegacy(account.accountId)}>Review due dates</Button></div>)}
      {months.map(month => {
        const monthRows = rows.filter(row => row.dueDate?.slice(0, 7) === month);
        const accountIds = Array.from(new Set(monthRows.map(row => row.accountId)));
        const schedule = summarizeDebt(snapshot, [month]).scheduledDebt;
        return <div key={month} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3"><h3 className="font-semibold">{new Date(`${month}-01T12:00:00`).toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</h3><p className="text-sm font-semibold tabular-nums text-muted-foreground sm:text-base">{schedule === null ? "Total needs review" : money(schedule)}</p></div>
          {accountIds.map(accountId => <div key={accountId} className="border-b border-border px-4 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3"><p className="min-w-0 break-words text-sm font-semibold">{walletName(accountId)}</p>{onPayDebt && snapshot.accounts.find(account => account.accountId === accountId)?.reconciliation === "balanced" && <Button variant="outline" size="sm" disabled={isLoading} className="min-h-11 shrink-0" onClick={() => onPayDebt(accountId)}>Pay debt</Button>}</div>
            <ul className="divide-y divide-border">{monthRows.filter(row => row.accountId === accountId).map(row => <li key={row.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{row.name}</p><p className="mt-1 text-xs text-muted-foreground">{row.source === "opening" ? "Existing debt" : "Purchase"} · Due {new Date(`${row.dueDate}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} · Installment {row.ordinal}/{installmentTotals.get(`${row.accountId}:${row.groupId}:${row.source}`)}</p></div><span className="shrink-0 text-sm font-semibold tabular-nums sm:text-base">{money(row.remainingAmount)}</span></li>)}</ul>
          </div>)}
        </div>;
      })}
      {!months.length && <p className="text-sm text-muted-foreground">No dated outstanding debt.</p>}
      {rows.filter(row => !row.dueDate).map(row => <p key={row.id} className="break-words text-sm">{row.name} · Due date unknown · {money(row.remainingAmount)}</p>)}
      {historyGroups.length > 0 && <div className="min-w-0 space-y-2 border-t border-border pt-4">
        <div><h3 className="font-semibold">Complete installment history</h3><p className="mt-1 text-sm text-muted-foreground">Paid and corrected installments stay here with their original dates and ordinals.</p></div>
        <div className="divide-y divide-border rounded-lg border border-border/60">
          {historyGroups.map(([key, groupRows]) => {
            const account = snapshot.accounts.find(candidate => candidate.accountId === groupRows[0]?.accountId);
            return account ? <DebtHistoryGroup key={key} busy={isLoading} walletName={walletName(account.accountId)} account={account} rows={groupRows} onSaved={onCorrectionSaved ?? (async () => undefined)} /> : null;
          })}
        </div>
      </div>}
    </>}
  </section>;
}
