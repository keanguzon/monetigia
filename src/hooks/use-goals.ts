import useSWR from "swr";
import { goalFunding } from "@/lib/goal-funding";
import { parseMoney, projectGoal, type ProjectionResult } from "@/lib/goals/summary";
import { createClient } from "@/lib/supabase/client";
import type { Goal, GoalInsert, GoalUpdate } from "@/types/database";

const supabase = createClient();

export interface GoalWithProgress extends Goal {
  saved: number;
  progressPercent: number;
}

export type { ProjectionResult } from "@/lib/goals/summary";

export function getProjection(goal: GoalWithProgress): ProjectionResult {
  const isKinsenas = goal.allocation_frequency === "kinsenas";
  const allocation = Number(goal.allocation_per_cycle) || 0;
  const target = Number(goal.target_amount) || 0;
  const saved = Number(goal.saved) || 0;

  if (allocation <= 0 || target <= 0 || saved >= target) {
    return {
      count: 0,
      unit: isKinsenas ? "paydays" : "months",
      projectedDate: null,
      monthlyAmount: isKinsenas ? allocation * 2 : allocation,
      kinsenasAmount: isKinsenas ? allocation : allocation / 2,
    };
  }

  // The legacy reader still sums floats; this adapter lasts until decimal snapshot cutover.
  return projectGoal({ target: parseMoney(target.toFixed(2)), progressAmount: parseMoney(saved.toFixed(2)),
    allocationPerCycle: parseMoney(allocation.toFixed(2)), allocationFrequency: goal.allocation_frequency }, new Date());
}

export function useGoals() {
  const { data, error, isLoading, mutate } = useSWR<GoalWithProgress[]>(
    "goals",
    async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const [goalsRes, txRes] = await Promise.all([
        supabase
          .from("goals")
          .select("*")
          .eq("user_id", user.id)
          .order("is_priority", { ascending: false })
          .order("target_date", { ascending: true, nullsFirst: false }),
        supabase
          .from("transactions")
          .select("goal_id, amount, type")
          .eq("user_id", user.id)
          .not("goal_id", "is", null),
      ]);

      if (goalsRes.error) throw goalsRes.error;
      if (txRes.error) throw txRes.error;

      const goalsList: GoalWithProgress[] = (goalsRes.data || []).map((goal) => {
        const target = Number(goal.target_amount) || 0;
        const { saved, progressPercent } = goalFunding(goal.id, target, txRes.data || []);
        const isAutoCompleted = target > 0 && saved >= target;
        const isCompleted = goal.is_completed || isAutoCompleted;

        // Sync auto-completion to database if not already marked
        if (isAutoCompleted && !goal.is_completed) {
          supabase
            .from("goals")
            .update({ is_completed: true })
            .eq("id", goal.id)
            .eq("user_id", user.id)
            .then();
        }

        return {
          ...goal,
          target_amount: target,
          current_amount: saved,
          allocation_per_cycle: Number(goal.allocation_per_cycle) || 0,
          saved,
          progressPercent,
          is_completed: isCompleted,
        };
      });

      return goalsList;
    }
  );

  const createGoal = async (payload: Omit<GoalInsert, "user_id">) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { error: insertError } = await supabase.from("goals").insert({
      ...payload,
      user_id: user.id,
      current_amount: 0,
    });

    if (insertError) throw insertError;
    await mutate();
  };

  const updateGoal = async (id: string, payload: GoalUpdate) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { error: updateError } = await supabase
      .from("goals")
      .update(payload)
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) throw updateError;
    await mutate();
  };

  const deleteGoal = async (id: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { error: deleteError } = await supabase
      .from("goals")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (deleteError) throw deleteError;
    await mutate();
  };

  const toggleComplete = async (id: string, completed: boolean) => {
    await updateGoal(id, { is_completed: completed });
  };

  return {
    goals: data || [],
    isLoading,
    isError: error,
    createGoal,
    updateGoal,
    deleteGoal,
    toggleComplete,
    mutate,
  };
}
