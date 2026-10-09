"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DebtSnapshot, DebtDueRow } from "@/lib/debt/contracts";
import { summarizeDebt } from "@/lib/debt/summary";
import { DebtHistoryGroup } from "@/components/accounts/DebtHistoryGroup";
import { formatCurrency } from "@/lib/utils";

type View = "Outstanding" | "Needs review" | "History";
export function DebtScheduleSection({ snapshot, isLoading, error, onPayDebt, onReviewLegacy, canReviewLegacy, onCorrectionSaved, wallets = [], preview = false }: {
  snapshot: DebtSnapshot | undefined; isLoading: boolean; error: unknown;
  onPayDebt?: (accountId?: string) => void; onReviewLegacy: (accountId: string) => void;
  canReviewLegacy?: (accountId: string) => boolean; onCorrectionSaved?: () => Promise<unknown>;
  wallets?: ReadonlyArray<{ id: string; name: string }>; preview?: boolean;
}) {
  const [view, setView] = useState<View>("Outstanding");
  const [search, setSearch] = useState("");
  const [wallet, setWallet] = useState("");
  const [limit, setLimit] = useState(20);
  const walletName = (id: string) => wallets.find(item => item.id === id)?.name ?? "Credit wallet";
  const money = (value: string) => formatCurrency(Number(value));
  const ready = !error && snapshot;
  const owned = new Set(snapshot?.accounts.map(account => account.accountId));
  const rows = ready ? snapshot.rows.filter(row => owned.has(row.accountId)) : [];
  const groups = Array.from(rows.reduce((result, row) => {
    const key = `${row.accountId}:${row.groupId}:${row.source}`;
    const items = result.get(key) ?? [];
    items.push(row);
    result.set(key, items);
    return result;
  }, new Map<string, DebtDueRow[]>()).entries());
  const needsReview = snapshot?.accounts.filter(account => account.reconciliation === "needs_review" || account.undatedOutstanding !== "0.00") ?? [];
  const upcoming = rows.filter(row => row.remainingAmount !== "0.00" && row.dueDate && snapshot?.accounts.find(account => account.accountId === row.accountId)?.reconciliation === "balanced")
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.ordinal - b.ordinal || a.id.localeCompare(b.id)).slice(0, 3);
  const visibleGroups = groups.filter(([, items]) => {
    const account = snapshot?.accounts.find(item => item.accountId === items[0].accountId);
    const matchesView = view === "History" || (view === "Needs review"
      ? account?.reconciliation === "needs_review" || items.some(row => row.dueDate === null && row.remainingAmount !== "0.00")
      : items.some(row => row.remainingAmount !== "0.00"));
    return matchesView && (!wallet || items[0].accountId === wallet) && `${items[0].name} ${walletName(items[0].accountId)}`.toLowerCase().includes(search.trim().toLowerCase());
  }).sort(([, a], [, b]) => {
    const firstDue = (items: DebtDueRow[]) => items.filter(row => row.remainingAmount !== "0.00" && row.dueDate).map(row => row.dueDate!).sort()[0] ?? "9999-12-31";
    return firstDue(a).localeCompare(firstDue(b)) || a[0].id.localeCompare(b[0].id);
  });

  return <section className="min-w-0 space-y-4" aria-busy={isLoading}>
    <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0"><h2 className="font-heading text-xl font-bold">{preview ? "PayLater & Credit Schedule" : "Debt activity"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{preview ? "Upcoming installments and debt needing review." : "Payments apply in due-date order across the wallet."}</p>
        {ready && !isLoading && <p className="mt-2 text-sm font-semibold tabular-nums sm:text-base">Outstanding total: {money(summarizeDebt(snapshot, null).totalOutstanding)}</p>}
      </div>
      {preview && <Link href="/accounts/debt" className="inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">See all</Link>}
    </div>
    {isLoading && !snapshot ? <p role="status" className="text-sm text-muted-foreground">Loading debt schedule…</p> : error || !snapshot ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">Debt schedule is unavailable. Refresh to try again.</p> : <>
      {isLoading && <p role="status" className="text-sm text-muted-foreground">Refreshing debt schedule…</p>}
      {preview ? <>
        {needsReview.length > 0 && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{needsReview.length} {needsReview.length === 1 ? "wallet needs" : "wallets need"} debt review. Open See all for details.</p>}
        {upcoming.length ? <ul className="divide-y divide-border rounded-xl border border-border">{upcoming.map(row => {
          const group = groups.find(([, items]) => items.some(item => item.id === row.id))?.[1] ?? [row];
          return <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{row.name}</p><p className="mt-1 text-xs text-muted-foreground">{walletName(row.accountId)} · {row.source === "opening" ? "Existing debt" : "Purchase"} · Due {row.dueDate} · Installment {row.ordinal}/{Math.max(...group.map(item => item.ordinal))}</p></div><span className="shrink-0 text-sm font-semibold tabular-nums sm:text-base">{money(row.remainingAmount)}</span></li>;
        })}</ul> : <p className="text-sm text-muted-foreground">No dated outstanding debt.</p>}
      </> : <>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Debt views">{(["Outstanding", "Needs review", "History"] as const).map(item => <Button key={item} variant={view === item ? "default" : "ghost"} aria-pressed={view === item} onClick={() => { setView(item); setLimit(20); }}>{item}</Button>)}</div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row"><label className="relative min-w-0"><Search aria-hidden="true" className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"/><input type="search" aria-label="Search debt" placeholder="Search debt…" value={search} onChange={event => { setSearch(event.target.value); setLimit(20); }} className="min-h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label>
            <select aria-label="Filter debt by wallet" value={wallet} onChange={event => { setWallet(event.target.value); setLimit(20); }} className="min-h-11 max-w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><option value="">All wallets</option>{snapshot.accounts.map(account => <option key={account.accountId} value={account.accountId}>{walletName(account.accountId)}</option>)}</select>
          </div>
        </div>
        {needsReview.filter(account => !wallet || account.accountId === wallet).length > 0 && <div role="alert" className="space-y-2 rounded-lg border border-border p-4 text-sm">{needsReview.filter(account => !wallet || account.accountId === wallet).map(account => <div key={account.accountId} className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 flex-1 break-words">{walletName(account.accountId)}: {account.reconciliation === "needs_review" ? `Debt reconciliation review required. Wallet outstanding: ${money(account.totalOutstanding)}. Historical rows are unverified.` : `Assign due dates to ${money(account.undatedOutstanding)}.${canReviewLegacy && !canReviewLegacy(account.accountId) ? " Due-date review requires an active PHP wallet." : ""}`}</p>{account.undatedOutstanding !== "0.00" && <Button variant="outline" disabled={isLoading || account.reconciliation !== "balanced" || Boolean(canReviewLegacy && !canReviewLegacy(account.accountId))} onClick={() => onReviewLegacy(account.accountId)}>Review due dates</Button>}</div>)}</div>}
        {onPayDebt && <div className="flex flex-wrap gap-2">{snapshot.accounts.filter(account => account.reconciliation === "balanced" && account.totalOutstanding !== "0.00" && (!wallet || account.accountId === wallet)).map(account => <Button key={account.accountId} variant="outline" disabled={isLoading} onClick={() => onPayDebt(account.accountId)}>Pay debt · {walletName(account.accountId)}</Button>)}</div>}
        <p className="text-xs text-muted-foreground">Showing {Math.min(limit, visibleGroups.length)} of {visibleGroups.length} debt groups{view === "History" ? ". Includes paid and corrected installments." : ". Expand a group for its installment details."}</p>
        {visibleGroups.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border/60 bg-card">{visibleGroups.slice(0, limit).map(([key, items]) => {
          const account = snapshot.accounts.find(item => item.accountId === items[0].accountId)!;
          return <DebtHistoryGroup key={key} feed busy={isLoading} walletName={walletName(account.accountId)} account={account} rows={items} onSaved={onCorrectionSaved ?? (async () => undefined)} />;
        })}</div> : <p role="status" className="py-8 text-center text-sm text-muted-foreground">No debt matches this view.</p>}
        {visibleGroups.length > limit && <Button variant="outline" onClick={() => setLimit(value => value + 20)}>Show more</Button>}
      </>}
    </>}
  </section>;
}
