import { useEffect, useState } from "react";
import { useGoalFinance } from "@/hooks/use-goal-finance";
import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
import { parseMoney, projectGoal, type ProjectionResult } from "@/lib/goals/summary";
import { createClient } from "@/lib/supabase/client";
import type { GoalFinanceGoal, Money } from "@/lib/goals/contracts";
import type { GoalInsert, GoalUpdate } from "@/types/database";

const supabase = createClient();

export type GoalWithProgress = Omit<GoalFinanceGoal, "target_amount" | "current_amount" | "allocation_per_cycle"> & {
  target_amount: number;
  current_amount: number;
  allocation_per_cycle: number;
  financeAmounts: { target: Money; progress: Money; allocationPerCycle: Money };
  saved: number;
  progressPercent: number;
};

export type { ProjectionResult } from "@/lib/goals/summary";

function moneyFromLegacyDisplay(value: number): Money {
  if (!Number.isFinite(value) || value < 0) throw new Error("Goal display amounts must be finite and nonnegative");
  return parseMoney(value.toFixed(2));
}

export function getProjection(goal: GoalWithProgress): ProjectionResult {
  const isKinsenas = goal.allocation_frequency === "kinsenas";
  const allocation = goal.allocation_per_cycle;
  const target = goal.target_amount;
  const saved = goal.saved;

  if (allocation <= 0 || target <= 0 || saved >= target) {
    return {
      count: 0,
      unit: isKinsenas ? "paydays" : "months",
      projectedDate: null,
      monthlyAmount: isKinsenas ? allocation * 2 : allocation,
      kinsenasAmount: isKinsenas ? allocation : allocation / 2,
    };
  }

  const exactAmounts = goal.financeAmounts ?? {
    target: moneyFromLegacyDisplay(target),
    progress: moneyFromLegacyDisplay(saved),
    allocationPerCycle: moneyFromLegacyDisplay(allocation),
  };
  return projectGoal({
    target: exactAmounts.target,
    progressAmount: exactAmounts.progress,
    allocationPerCycle: exactAmounts.allocationPerCycle,
    allocationFrequency: goal.allocation_frequency,
  }, new Date());
}

function toDisplayGoal(goal: GoalFinanceGoal): GoalWithProgress {
  const saved = Number(goal.progressAmount);
  return {
    ...goal,
    target_amount: Number(goal.target_amount),
    current_amount: saved,
    allocation_per_cycle: Number(goal.allocation_per_cycle),
    financeAmounts: { target: goal.target_amount, progress: goal.progressAmount, allocationPerCycle: goal.allocation_per_cycle },
    saved,
    progressPercent: goal.progressPercent,
    is_completed: goal.status === "completed" || goal.is_completed,
  };
}

function orderGoals(goals: GoalWithProgress[]): GoalWithProgress[] {
  return goals.filter(goal => goal.archived_at === null).sort((left, right) => {
    if (left.is_priority !== right.is_priority) return Number(right.is_priority) - Number(left.is_priority);
    if (left.target_date === null) return right.target_date === null ? 0 : 1;
    if (right.target_date === null) return -1;
    return left.target_date.localeCompare(right.target_date);
  });
}

export function useGoals() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userIsLoading, setUserIsLoading] = useState(true);
  const [userError, setUserError] = useState<unknown>(null);

  useEffect(() => {
    let mounted = true;
    let authRevision = 0;
    const initialRevision = authRevision;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authRevision += 1;
      if (!mounted) return;
      setUserId(session?.user.id ?? null);
      setUserIsLoading(false);
      setUserError(null);
    });
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted || authRevision !== initialRevision) return;
      setUserId(user?.id ?? null);
      setUserIsLoading(false);
    }).catch(error => {
      if (!mounted || authRevision !== initialRevision) return;
      setUserError(error);
      setUserIsLoading(false);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const finance = useGoalFinance(userId);
  const goals = orderGoals((finance.data?.goals ?? []).map(toDisplayGoal));

  const ensureUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    return user;
  };

  const createGoal = async (payload: Omit<GoalInsert, "user_id">) => {
    const user = await ensureUser();
    const { error } = await supabase.from("goals").insert({
      ...payload,
      user_id: user.id,
      current_amount: 0,
    });
    if (error) throw error;
    await finance.mutate();
  };

  const updateGoal = async (id: string, payload: GoalUpdate) => {
    if (payload.status !== undefined || payload.is_completed !== undefined || payload.completed_at !== undefined || payload.archived_at !== undefined) {
      throw new Error("Goal lifecycle changes must use a financial command.");
    }
    const user = await ensureUser();
    const { error } = await supabase.from("goals").update(payload).eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    await finance.mutate();
  };

  const runLifecycleCommand = (command: { kind: "archive" | "reopen"; goalId: string } | {
    kind: "close"; goalId: string; status: "completed"; leftovers: null;
  }) => applyAndRefreshFinancialCommand(crypto.randomUUID(), command, undefined, finance.refresh);

  const deleteGoal = async (id: string) => runLifecycleCommand({ kind: "archive", goalId: id });

  const toggleComplete = async (id: string, completed: boolean) => completed
    ? runLifecycleCommand({ kind: "close", goalId: id, status: "completed", leftovers: null })
    : runLifecycleCommand({ kind: "reopen", goalId: id });

  return {
    goals,
    isLoading: userIsLoading || finance.isLoading,
    isError: userError ?? finance.error,
    createGoal,
    updateGoal,
    deleteGoal,
    toggleComplete,
    mutate: finance.mutate,
  };
}
