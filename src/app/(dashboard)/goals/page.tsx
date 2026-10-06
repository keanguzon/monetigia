"use client";

import React, { useMemo, useState } from "react";
import {
  Target,
  Plus,
  TrendingUp,
  Coins,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { GoalWithProgress, useGoals } from "@/hooks/use-goals";
import { GoalCard } from "@/components/goals/GoalCard";
import { AddGoalModal } from "@/components/goals/AddGoalModal";
import type { Goal } from "@/types/database";
import AddTransactionModal from "@/components/transactions/AddTransactionModal";
import { GoalCardSkeleton } from "@/components/goals/GoalCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SummarySkeleton, summaryPanelClass } from "@/components/ui/financial-summary";

export default function GoalsPage() {
  const { toast } = useToast();
  const {
    goals,
    isLoading,
    isError,
    deleteGoal,
    toggleComplete,
  } = useGoals();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [contributingGoalId, setContributingGoalId] = useState<string | null>(null);

  // Compute summary metrics
  const {
    totalTarget,
    totalSaved,
    totalMonthlyAllocation,
    totalKinsenasAllocation,
    activeGoals,
    completedGoals,
    globalProgress,
  } = useMemo(() => {
    let targetSum = 0;
    let savedSum = 0;
    let totalMonthlyAlloc = 0;
    const active: GoalWithProgress[] = [];
    const completed: GoalWithProgress[] = [];

    goals.forEach((g) => {
      targetSum += Number(g.target_amount) || 0;
      savedSum += Number(g.saved) || 0;
      const isKinsenas = g.allocation_frequency === "kinsenas";
      const alloc = Number(g.allocation_per_cycle) || 0;
      const monthlyAlloc = isKinsenas ? alloc * 2 : alloc;
      totalMonthlyAlloc += monthlyAlloc;

      if (g.is_completed) {
        completed.push(g);
      } else {
        active.push(g);
      }
    });

    const totalKinsenasAlloc = totalMonthlyAlloc / 2;
    const globalProg = targetSum > 0 ? (savedSum / targetSum) * 100 : 0;

    return {
      totalTarget: targetSum,
      totalSaved: savedSum,
      totalMonthlyAllocation: totalMonthlyAlloc,
      totalKinsenasAllocation: totalKinsenasAlloc,
      activeGoals: active,
      completedGoals: completed,
      globalProgress: globalProg,
    };
  }, [goals]);

  const handleOpenCreateModal = () => {
    setEditingGoal(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (goal: GoalWithProgress) => {
    setEditingGoal(goal);
    setIsModalOpen(true);
  };

  const handleDeleteGoal = async (goalId: string) => {
    const target = goals.find((g) => g.id === goalId);
    const confirmed = window.confirm(
      `Are you sure you want to delete "${target?.name || "this goal"}"?\n\nAny tagged transactions will remain in your ledger, but will no longer be linked to this goal.`
    );
    if (!confirmed) return;

    try {
      await deleteGoal(goalId);
      toast({
        title: "Goal deleted",
        description: "The goal was removed successfully.",
      });
    } catch (err: any) {
      toast({
        title: "Error deleting goal",
        description: err.message || "Failed to delete goal.",
        variant: "destructive",
      });
    }
  };

  const handleToggleComplete = async (goalId: string, completed: boolean) => {
    try {
      await toggleComplete(goalId, completed);
      toast({
        title: completed ? "Goal marked complete!" : "Goal reopened",
        description: completed
          ? "Great job on hitting your milestone!"
          : "The goal is back in your active roadmap.",
      });
    } catch (err: any) {
      toast({
        title: "Error updating goal",
        description: err.message || "Failed to update completion status.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Masthead Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Goals & Sinking Funds
            </h1>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {isLoading ? <Skeleton className="h-4 w-14" /> : `${activeGoals.length} Active`}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan your savings, sinking funds, and multi-year financial milestones
          </p>
        </div>

        <Button onClick={handleOpenCreateModal} className="gap-2 shadow-sm">
          <Plus className="h-4 w-4" />
          Add Goal
        </Button>
      </div>

      {/* Unified Editorial Masthead (No isolated chunky boxes) */}
      {isLoading ? <SummarySkeleton /> : !isError && <div className={summaryPanelClass}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 divide-y sm:divide-y-0 sm:divide-x divide-border/30">
          {/* Column 1: Total Target */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Target className="h-3.5 w-3.5 text-primary" />
              <span>Total Target</span>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight text-foreground pt-1">
              {formatCurrency(totalTarget)}
            </div>
            <p className="text-xs text-muted-foreground pt-0.5">
              Across {goals.length} total tracked targets
            </p>
          </div>

          {/* Column 2: Total Funded */}
          <div className="space-y-1 sm:pl-8 pt-4 sm:pt-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Coins className="h-3.5 w-3.5 text-emerald-500" />
                <span>Total Funded</span>
              </div>
              <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {globalProgress.toFixed(0)}%
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 pt-1">
              {formatCurrency(totalSaved)}
            </div>
            {/* Sleek Progress Track */}
            <div className="pt-1.5">
              <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, globalProgress))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Column 3: Savings Target (Dual Cadence) */}
          <div className="space-y-1 sm:pl-8 pt-4 sm:pt-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
                <span>Savings Target</span>
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground font-medium">
                ≈ {formatCurrency(totalKinsenasAllocation)}/ks
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight text-amber-600 dark:text-amber-400 pt-1">
              {formatCurrency(totalMonthlyAllocation)}
              <span className="text-xs font-normal text-muted-foreground ml-1">/mo</span>
            </div>
            <p className="text-xs text-muted-foreground pt-0.5">
              Planned savings allocated across all active goals
            </p>
          </div>
        </div>
      </div>

      }
      <p className="text-sm text-muted-foreground">
        Transactions tagged with a goal automatically increase its funded amount. Monthly and kinsenas targets estimate completion only.
      </p>

      {/* Main Content Area */}
      {isLoading ? (
        <div role="status" aria-label="Loading goals" className="space-y-4">
          <Skeleton className="h-4 w-36" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <GoalCardSkeleton key={i} />
          ))}
          </div>
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center text-destructive">
          Failed to load goals. Please refresh or try again later.
        </div>
      ) : goals.length === 0 ? (
        /* Open & Breathable Empty State (No heavy border or dashed outline box) */
        <div className="py-20 px-4 text-center max-w-md mx-auto space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Target className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold tracking-tight text-foreground">
              No active goals yet
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Set savings targets for milestones like{" "}
              <span className="text-foreground font-medium">Phone</span>,{" "}
              <span className="text-foreground font-medium">Laptop</span>, or an{" "}
              <span className="text-foreground font-medium">Emergency Fund</span>, and track your progress each month.
            </p>
          </div>
          <Button onClick={handleOpenCreateModal} size="lg" className="gap-2 shadow-sm font-medium">
            <Plus className="h-4 w-4" />
            Create Your First Goal
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Active Goals Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Active Roadmap ({activeGoals.length})
              </h2>
            </div>

            {activeGoals.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                All goals completed! Great milestone achievement.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onEdit={handleOpenEditModal}
                    onDelete={handleDeleteGoal}
                    onToggleComplete={handleToggleComplete}
                    onContribute={setContributingGoalId}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Completed Goals Section (Collapsible) */}
          {completedGoals.length > 0 && (
            <section className="space-y-3 pt-6 border-t border-border/30">
              <button
                type="button"
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>Completed Goals ({completedGoals.length})</span>
                {showCompleted ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>

              {showCompleted && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                  {completedGoals.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      onEdit={handleOpenEditModal}
                      onDelete={handleDeleteGoal}
                      onToggleComplete={handleToggleComplete}
                      onContribute={setContributingGoalId}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Add / Edit Goal Modal */}
      <AddTransactionModal isOpen={contributingGoalId !== null} defaultGoalId={contributingGoalId ?? undefined} onClose={() => setContributingGoalId(null)} />
      <AddGoalModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        editingGoal={editingGoal}
      />
    </div>
  );
}
