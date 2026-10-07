"use client";

import { useGoals } from "@/hooks/use-goals";

export function GoalSelector({ value, onChange, disabled = false, meaning = "spend", debtOnly = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; meaning?: "spend" | "carry" | "purchase"; debtOnly?: boolean }) {
  const { goals, isLoading, isError } = useGoals();
  return <div>
    <label htmlFor="transaction-goal" className="block text-sm font-medium mb-2">Goal (Optional)</label>
    <select id="transaction-goal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || isLoading || !!isError}
      className="w-full rounded-lg border bg-background px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <option value="">{isLoading ? "Loading goals..." : "No goal"}</option>
      {goals.filter(goal => goal.status === "active" && goal.review_state === "confirmed" && goal.archived_at === null && (!debtOnly || goal.category === "debt")).map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}
    </select>
    <p className="mt-2 text-xs text-muted-foreground">{isError ? "Goals could not be loaded. Close and reopen to try again." : meaning === "purchase" ? "Informational purchase history only. This credit purchase does not fund the goal or use its cash reservation." : meaning === "carry" ? "Carry the amount entered below to the destination wallet. This moves an existing reservation; it does not add funding." : "Spend money already reserved for this goal in the selected wallet."}</p>
  </div>;
}
