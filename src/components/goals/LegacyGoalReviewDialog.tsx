"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGoals } from "@/hooks/use-goals";
import { useGoalWalletMetadata } from "@/hooks/use-goal-finance";
import { createClient } from "@/lib/supabase/client";
import { FinancialCommandError, financialCommandMessage } from "@/lib/goals/client";
import { parseMoney, toMinorUnits } from "@/lib/goals/summary";
import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
import type { FinancialCommand, GoalStatus } from "@/lib/goals/contracts";

type HistoricalTransaction = { id: string; account_id: string; transfer_to_account_id: string | null; type: string; amount: number | string; description: string | null; date: string };
type ReviewCommand = Extract<FinancialCommand, { kind: "adopt_legacy" }>;

export function LegacyGoalReviewDialog({ goalId, open, onOpenChange }: { goalId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { goals, userId, financeSnapshot, refresh, isLoading, isError } = useGoals();
  const metadata = useGoalWalletMetadata(userId);
  const goal = goals.find(item => item.id === goalId);
  const [status, setStatus] = useState<GoalStatus>("active");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoricalTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const retry = useRef<{ requestId: string; command: ReviewCommand; userId: string; goalName: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (retry.current && retry.current.userId !== userId) { retry.current = null; setUnknown(false); }
    if (!retry.current) { setStatus(goal?.status ?? "active"); setAmounts({}); setSelectedIds([]); setError(null); setSaved(false); }
  }, [open, goalId, userId, goal?.status]);

  useEffect(() => {
    if (!open || !userId) return;
    let current = true;
    setHistoryLoading(true); setHistoryError(false); setHistory([]);
    const db = createClient() as any;
    void Promise.all([
      db.from("transactions").select("id,account_id,transfer_to_account_id,type,amount,description,date").eq("user_id", userId).order("date", { ascending: false }),
      db.from("goal_allocation_events").select("kind,transaction_id").eq("user_id", userId),
    ]).then(([transactions, events]) => {
      if (!current) return;
      if (transactions.error || events.error || !Array.isArray(transactions.data) || !Array.isArray(events.data)) throw new Error("History unavailable");
      const used = new Set(events.data.filter((event: any) => event.kind === "spend" || event.kind === "legacy_spent").map((event: any) => event.transaction_id));
      setHistory(transactions.data.filter((transaction: HistoricalTransaction) => !used.has(transaction.id)));
    }).catch(() => { if (current) setHistoryError(true); }).finally(() => { if (current) setHistoryLoading(false); });
    return () => { current = false; };
  }, [open, userId, loadRevision]);

  const wallets = useMemo(() => (financeSnapshot?.wallets ?? []).flatMap(wallet => {
    const account = metadata.data?.find(item => item.id === wallet.accountId);
    return account?.is_active && account.currency === "PHP" && account.type !== "credit_card" ? [{ ...wallet, name: account.name }] : [];
  }), [financeSnapshot, metadata.data]);
  const eligibleHistory = useMemo(() => history.filter(transaction => {
    const source = metadata.data?.find(account => account.id === transaction.account_id);
    if (!source?.is_active || source.currency !== "PHP" || source.type === "credit_card" || !Number.isFinite(Number(transaction.amount)) || Number(transaction.amount) <= 0) return false;
    if (transaction.type === "expense") return !transaction.transfer_to_account_id;
    const destination = metadata.data?.find(account => account.id === transaction.transfer_to_account_id);
    return goal?.category === "debt" && transaction.type === "transfer" && destination?.is_active && destination.type === "credit_card" && destination.currency === "PHP";
  }), [history, metadata.data, goal?.category]);
  const loadError = Boolean(isError || metadata.error || historyError);
  const loading = isLoading || metadata.isLoading || historyLoading;
  const eligibleGoal = goal?.review_state === "needs_review" && goal.archived_at === null;

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (pending) return;
    setError(null);
    let attempt = retry.current;
    if (!attempt) {
      if (!eligibleGoal || !userId || loading || loadError) return;
      try {
        const reservations: ReviewCommand["reservations"] = [];
        if (status === "active") for (const wallet of wallets) {
          const text = amounts[wallet.accountId]?.trim(); if (!text) continue;
          const amount = parseMoney(text);
          if (toMinorUnits(amount) === 0) continue;
          if (toMinorUnits(amount) > toMinorUnits(wallet.available)) throw new Error(`${wallet.name} has only PHP ${wallet.available} available.`);
          reservations.push({ accountId: wallet.accountId, amount });
        }
        if (selectedIds.some(id => !eligibleHistory.some(transaction => transaction.id === id))) throw new Error("Review the selected spending again.");
        attempt = { requestId: crypto.randomUUID(), userId, goalName: goal?.name ?? "Goal", command: { kind: "adopt_legacy", goalId, status, reservations, spentTransactionIds: selectedIds } };
        retry.current = attempt;
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Enter valid PHP amounts."); return; }
    }
    if (attempt.userId !== userId) { setError("Sign in as the original user before retrying this review."); return; }
    setPending(true);
    try {
      const outcome = await applyAndRefreshFinancialCommand(attempt.requestId, attempt.command, undefined, refresh);
      retry.current = null; setUnknown(false); setSaved(true);
      if (!outcome.refreshError) onOpenChange(false);
    } catch (cause) {
      if (cause instanceof FinancialCommandError && cause.outcome === "unknown") { setUnknown(true); setError("We could not confirm whether the review was saved. Retry the same request before starting another review."); }
      else { retry.current = null; setUnknown(false); setError(financialCommandMessage(cause, "The funding review could not be saved.")); }
    } finally { setPending(false); }
  }

  return <Dialog.Root open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
        <Dialog.Title className="text-lg font-semibold">Review existing funding</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-muted-foreground">{unknown && retry.current ? `${retry.current.goalName}: pending review. Retry its original selections before reviewing another goal.` : `${goal?.name ?? "Goal"}: confirm money currently reserved and past spending that belongs to this goal.`}</Dialog.Description>
        <p className="mt-4 text-sm text-muted-foreground">Old goal tags are kept as history. They do not reserve money in a wallet. Selecting past spending records progress without charging your wallet again.</p>
        <p className="mt-3 text-sm text-muted-foreground">If an old expense was used as fake savings, use a normal transaction correction from Transactions first. This review does not reverse it or create money that is no longer available.</p>
        {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
        {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading balances and spending history…</p>}
        {loadError && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-red-700 dark:text-red-300">Balances or spending history could not load. Confirmation is unavailable.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => { setLoadRevision(value => value + 1); void Promise.all([refresh(), metadata.refresh()]).catch(() => setError("Could not reload wallet details.")); }}>Retry loading</Button></div>}
        {saved ? <div role="status" className="mt-4 space-y-3"><p>Review saved. The summary could not refresh; do not submit it again.</p><Button className="min-h-11 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => { void refresh().then(() => onOpenChange(false)).catch(() => setError("The summary still could not refresh.")); }}>Retry refresh</Button></div> : <form className="mt-5 space-y-4" onSubmit={submit}>
          <fieldset disabled={pending || loading || loadError || !eligibleGoal || unknown} className="space-y-4">
            <div className="space-y-1.5"><label htmlFor="legacy-status" className="text-sm font-medium">Goal status</label><select id="legacy-status" value={status} onChange={event => setStatus(event.target.value as GoalStatus)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>
            {status === "active" ? <div className="space-y-3"><p className="text-sm font-medium">Current wallet reservations</p>{wallets.map(wallet => <div key={wallet.accountId} className="space-y-1.5"><label htmlFor={`legacy-${wallet.accountId}`} className="text-sm">Reserved in {wallet.name} (PHP)</label><Input id={`legacy-${wallet.accountId}`} className="min-h-11" inputMode="decimal" value={amounts[wallet.accountId] ?? ""} onChange={event => setAmounts(current => ({ ...current, [wallet.accountId]: event.target.value }))} placeholder="0.00" /><p className="text-xs text-muted-foreground">Available: PHP {wallet.available}</p></div>)}{!wallets.length && !loading && <p className="text-sm text-muted-foreground">No eligible PHP wallet is available. You can confirm with no reservation.</p>}</div> : <p className="text-sm text-muted-foreground">Closed goals add no new reservations.</p>}
            <div className="space-y-2"><p className="text-sm font-medium">Past spending (optional)</p><p className="text-xs text-muted-foreground">Select actual cash expenses{goal?.category === "debt" ? " or cash payments to a credit card" : ""}. Leave fake savings expenses unchecked.</p>{eligibleHistory.map(transaction => <label key={transaction.id} className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" checked={selectedIds.includes(transaction.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, transaction.id] : ids.filter(id => id !== transaction.id))} /><span className="min-w-0 break-words">{transaction.description || "Cash spending"} · {transaction.date} · PHP {Number(transaction.amount).toFixed(2)}</span></label>)}{!loading && !eligibleHistory.length && <p className="text-sm text-muted-foreground">No eligible past spending. An empty selection is valid.</p>}</div>
          </fieldset>
          {!eligibleGoal && !unknown && <p className="text-sm text-muted-foreground">This goal has already been reviewed or is unavailable.</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" className="min-h-11 bg-primary text-primary-foreground hover:bg-primary/90" disabled={pending || (!unknown && (loading || loadError || !eligibleGoal))}>{pending ? "Saving…" : unknown ? "Retry same request" : "Confirm funding review"}</Button></div>
        </form>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
