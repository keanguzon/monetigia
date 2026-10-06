// Legacy tagged contributions remain in use until the finance reader and modal cutover.
export function contributionGoalId(type: string, goalId: string | null | undefined) {
  return (type === "expense" || type === "transfer") && goalId ? goalId : null;
}

export function goalFunding(goalId: string, target: number, transactions: { goal_id: string | null; type: string; amount: number | string }[]) {
  const saved = transactions.reduce((sum, tx) => contributionGoalId(tx.type, tx.goal_id) === goalId ? sum + Number(tx.amount || 0) : sum, 0);
  return { saved, progressPercent: target > 0 ? saved / target * 100 : 0 };
}
