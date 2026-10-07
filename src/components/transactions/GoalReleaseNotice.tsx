"use client";

import { useState } from "react";
import { parseMoney, toMinorUnits } from "@/lib/goals/summary";
import type { GoalFinanceSnapshot, ReleaseLine, TransactionDraft, TransactionQuote } from "@/lib/goals/contracts";
import { formatCurrency } from "@/lib/utils";

export function GoalReleaseNotice({ quote, draft, snapshot, disabled, onChange, onConfirm, onCancel }: {
  quote: TransactionQuote; draft: TransactionDraft; snapshot?: GoalFinanceSnapshot; disabled: boolean;
  onChange: (releases: ReleaseLine[]) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(quote.releases.map(line => [line.goalId, line.amount])));
  const [error, setError] = useState("");
  const goalName = (id: string) => snapshot?.goals.find(goal => goal.id === id)?.name ?? "Goal";
  const eligible = (snapshot?.goals ?? []).filter(goal => goal.status === "active" && goal.review_state === "confirmed" && goal.archived_at === null && goal.id !== draft.goalId &&
    goal.walletReservations.some(line => line.accountId === draft.accountId && toMinorUnits(line.amount) > 0));
  const applyCustom = () => {
    try {
      const releases = eligible.flatMap(goal => {
        const amount = parseMoney(amounts[goal.id] || "0");
        return amount === "0.00" ? [] : [{ goalId: goal.id, accountId: draft.accountId, amount }];
      });
      if (releases.reduce((total, line) => total + toMinorUnits(line.amount), 0) !== quote.releases.reduce((total, line) => total + toMinorUnits(line.amount), 0)) {
        setError("Release amounts must add up to the shortfall shown above."); return;
      }
      setError(""); onChange(releases);
    } catch { setError("Enter amounts with no more than two decimal places."); }
  };
  return <section aria-labelledby="release-heading" className="mx-6 mb-6 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
    <h3 id="release-heading" className="font-semibold">Review goal releases</h3>
    <p className="text-sm">This transaction needs money set aside for goals. Saving will release:</p>
    <ul className="space-y-1 text-sm">{quote.releases.map(line => <li key={line.goalId}>{goalName(line.goalId)}: {formatCurrency(Number(line.amount))}</li>)}</ul>
    <p className="text-xs text-muted-foreground">Actual {formatCurrency(Number(quote.actual))} · Reserved {formatCurrency(Number(quote.reserved))} · Available {formatCurrency(Number(quote.available))}</p>
    <p className="text-sm">These goals will have less reserved money. This release does not count as goal spending.</p>
    {eligible.length > 1 && <button type="button" disabled={disabled} onClick={() => setCustom(!custom)} className="min-h-11 px-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">{custom ? "Use proposed releases" : "Choose release amounts"}</button>}
    {custom && <div className="space-y-3">
      {eligible.map(goal => <div key={goal.id}><label htmlFor={`release-${goal.id}`} className="block text-sm mb-1">Release from {goal.name}</label><input id={`release-${goal.id}`} type="number" step="0.01" min="0" disabled={disabled} value={amounts[goal.id] ?? ""} onChange={event => { setAmounts({ ...amounts, [goal.id]: event.target.value }); setError(""); }} className="min-h-11 w-full rounded-lg border bg-background px-3 focus-visible:ring-2 focus-visible:ring-primary" /></div>)}
      <button type="button" disabled={disabled} onClick={applyCustom} className="min-h-11 px-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Review these releases</button>
    </div>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    <div className="flex flex-col sm:flex-row gap-3">
      <button type="button" disabled={disabled} onClick={onCancel} className="min-h-11 flex-1 px-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Keep reservations</button>
      <button type="button" disabled={disabled || custom} onClick={onConfirm} className="min-h-11 flex-1 px-3 rounded-lg bg-emerald-700 text-white dark:bg-emerald-400 dark:text-slate-950 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary">Release funds and save</button>
    </div>
  </section>;
}
