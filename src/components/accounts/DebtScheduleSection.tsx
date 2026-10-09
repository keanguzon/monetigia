"use client";
import { Button } from "@/components/ui/button";
import type { DebtSnapshot } from "@/lib/debt/contracts";
import { summarizeDebt } from "@/lib/debt/summary";
import { DebtHistoryGroup } from "@/components/accounts/DebtHistoryGroup";
export function DebtScheduleSection({ snapshot, isLoading, error, onPayDebt, onReviewLegacy, canReviewLegacy, onCorrectionSaved }: {
  snapshot: DebtSnapshot | undefined; isLoading: boolean; error: unknown;
  onPayDebt?: (accountId?: string) => void; onReviewLegacy: (accountId: string) => void; canReviewLegacy?: (accountId: string) => boolean;
  onCorrectionSaved?: () => Promise<unknown>;
}) {
  const ready = !isLoading && !error && snapshot;
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
  return <section className="min-w-0 space-y-4" aria-busy={isLoading}>
    <div className="border-b border-border pb-3"><h2 className="font-heading text-xl font-bold">PayLater & Credit Schedule</h2><p className="mt-1 text-sm text-muted-foreground">Remaining debt by due date. Payments apply across the wallet in due-date order, regardless of the month filter.</p>
      {ready && <p className="mt-2 text-sm font-semibold tabular-nums">Outstanding total: PHP {summarizeDebt(snapshot, null).totalOutstanding}</p>}
    </div>
    {isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading debt schedule…</p> : error || !snapshot ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">Debt schedule is unavailable. Refresh to try again.</p> : <>
      {snapshot.accounts.filter(account => account.reconciliation === "needs_review").map(account => <p key={account.accountId} role="alert" className="break-words text-sm text-red-700 dark:text-red-300">Wallet {account.accountId} needs reconciliation review. Outstanding debt: PHP {account.totalOutstanding}. Scheduled payments and due-date adoption are unavailable.</p>)}
      {snapshot.accounts.filter(account => account.undatedOutstanding !== "0.00").map(account => <div key={account.accountId} className="flex flex-col gap-2 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-sm font-semibold">Needs due-date review</p><p className="break-words text-sm tabular-nums">PHP {account.undatedOutstanding} · Wallet {account.accountId}</p>{canReviewLegacy && !canReviewLegacy(account.accountId) && <p className="text-sm text-muted-foreground">Due-date review requires an active PHP wallet.</p>}</div><Button variant="outline" className="min-h-11 whitespace-normal" disabled={account.reconciliation !== "balanced" || Boolean(canReviewLegacy && !canReviewLegacy(account.accountId))} onClick={() => onReviewLegacy(account.accountId)}>Review due dates</Button></div>)}
      {months.map(month => {
        const monthRows = rows.filter(row => row.dueDate?.slice(0, 7) === month);
        const accountIds = Array.from(new Set(monthRows.map(row => row.accountId)));
        const schedule = summarizeDebt(snapshot, [month]).scheduledDebt;
        return <div key={month} className="min-w-0 space-y-2 border-b border-border py-3">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{month}</h3><p className="text-sm font-semibold tabular-nums">Scheduled debt: {schedule === null ? "Unavailable" : `PHP ${schedule}`}</p></div>
          <ul className="divide-y divide-border">{monthRows.map(row => <li key={row.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div className="min-w-0"><p className="break-words text-sm font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.source === "opening" ? "Existing debt" : "Purchase"} · Due {row.dueDate} · Row {row.ordinal}</p></div><span className="break-all text-sm tabular-nums">PHP {row.remainingAmount}</span></li>)}</ul>
          {onPayDebt && accountIds.map(accountId => snapshot.accounts.find(account => account.accountId === accountId)?.reconciliation === "balanced" && <Button key={accountId} variant="outline" className="min-h-11 whitespace-normal" onClick={() => onPayDebt(accountId)}>Pay debt{accountIds.length > 1 ? ` · ${accountId}` : ""}</Button>)}
        </div>;
      })}
      {!months.length && <p className="text-sm text-muted-foreground">No dated outstanding debt.</p>}
      {rows.filter(row => !row.dueDate).map(row => <p key={row.id} className="break-words text-sm">{row.name} · Due date unknown · PHP {row.remainingAmount}</p>)}
      {historyGroups.length > 0 && <div className="min-w-0 space-y-2 border-t border-border pt-4">
        <div><h3 className="font-semibold">Complete installment history</h3><p className="mt-1 text-sm text-muted-foreground">Paid and corrected installments stay here with their original dates and ordinals.</p></div>
        <div className="divide-y divide-border rounded-lg border border-border/60">
          {historyGroups.map(([key, groupRows]) => {
            const account = snapshot.accounts.find(candidate => candidate.accountId === groupRows[0]?.accountId);
            return account ? <DebtHistoryGroup key={key} account={account} rows={groupRows} onSaved={onCorrectionSaved ?? (async () => undefined)} /> : null;
          })}
        </div>
      </div>}
    </>}
  </section>;
}
