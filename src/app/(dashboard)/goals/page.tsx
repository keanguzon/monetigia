"use client";

import React, { useMemo, useState } from "react";
import { Target, Plus, TrendingUp, Coins, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";
import { GoalWithProgress, useGoals } from "@/hooks/use-goals";
import { GoalCard } from "@/components/goals/GoalCard";
import { AddGoalModal } from "@/components/goals/AddGoalModal";
import type { Goal } from "@/types/database";
import AddTransactionModal from "@/components/transactions/AddTransactionModal";
import { GoalFundsDialog } from "@/components/goals/GoalFundsDialog";
import { GoalCompletionDialog } from "@/components/goals/GoalCompletionDialog";
import { GoalHistoryDialog } from "@/components/goals/GoalHistoryDialog";
import { LegacyGoalReviewDialog } from "@/components/goals/LegacyGoalReviewDialog";
import { GoalCardSkeleton } from "@/components/goals/GoalCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SummarySkeleton, summaryPanelClass } from "@/components/ui/financial-summary";

type FundsAction = { goalId: string; mode: "reserve" | "release" | "move" };
type ClosingAction = { goalId: string; status: "completed" | "cancelled" };

export default function GoalsPage() {
  const { toast } = useToast();
  const { goals, isLoading, isError, deleteGoal, toggleComplete } = useGoals();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [contributingGoalId, setContributingGoalId] = useState<string | null>(null);
  const [fundsAction, setFundsAction] = useState<FundsAction | null>(null);
  const [closingAction, setClosingAction] = useState<ClosingAction | null>(null);
  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
  const [reviewGoalId, setReviewGoalId] = useState<string | null>(null);

  const totals = useMemo(() => {
    let targetCents = 0;
    let reservedCents = 0;
    let spentCents = 0;
    let monthlyCents = 0;
    const active: GoalWithProgress[] = [];
    const closed: GoalWithProgress[] = [];
    goals.forEach(goal => {
      targetCents += toMinorUnits(goal.financeAmounts.target);
      reservedCents += toMinorUnits(goal.reserved);
      spentCents += toMinorUnits(goal.spent);
      if (goal.status === "active") {
        const allocationCents = toMinorUnits(goal.financeAmounts.allocationPerCycle);
        monthlyCents += goal.allocation_frequency === "kinsenas" ? allocationCents * 2 : allocationCents;
        active.push(goal);
      }
      else closed.push(goal);
    });
    const progressCents = reservedCents + spentCents;
    return {
      target: fromMinorUnits(targetCents), reserved: fromMinorUnits(reservedCents), spent: fromMinorUnits(spentCents),
      progress: fromMinorUnits(progressCents), monthly: fromMinorUnits(monthlyCents), kinsenas: fromMinorUnits(Math.round(monthlyCents / 2)),
      active, closed, progressPercent: targetCents > 0 ? progressCents / targetCents * 100 : 0,
    };
  }, [goals]);

  const handleOpenCreateModal = () => { setEditingGoal(null); setIsModalOpen(true); };
  const handleOpenEditModal = (goal: GoalWithProgress) => { setEditingGoal(goal); setIsModalOpen(true); };

  const handleArchiveGoal = async (goalId: string) => {
    try {
      await deleteGoal(goalId);
      toast({ title: "Goal archived", description: "Its reservation and spending history stays available." });
    } catch (error) {
      toast({ title: "Could not archive goal", description: error instanceof Error ? error.message : "The goal was not archived.", variant: "destructive" });
    }
  };

  const handleToggleComplete = async (goalId: string, completed: boolean) => {
    if (completed) {
      setClosingAction({ goalId, status: "completed" });
      return;
    }
    try {
      await toggleComplete(goalId, false);
      toast({ title: "Goal reopened", description: "Its spending history and current progress are available again." });
    } catch (error) {
      toast({ title: "Could not reopen goal", description: error instanceof Error ? error.message : "The goal was not reopened.", variant: "destructive" });
    }
  };

  const renderGoal = (goal: GoalWithProgress) => (
    <GoalCard key={goal.id} goal={goal} onEdit={handleOpenEditModal} onDelete={handleArchiveGoal}
      onToggleComplete={handleToggleComplete} onContribute={setContributingGoalId}
      onReserve={goalId => setFundsAction({ goalId, mode: "reserve" })}
      onRelease={goalId => setFundsAction({ goalId, mode: "release" })}
      onMove={goalId => setFundsAction({ goalId, mode: "move" })}
      onClose={(goalId, status) => setClosingAction({ goalId, status })}
      onHistory={setHistoryGoalId} onReview={setReviewGoalId} />
  );

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Goals &amp; Sinking Funds</h1>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{isLoading ? <Skeleton className="h-4 w-14" /> : `${totals.active.length} Active`}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Plan your savings, sinking funds, and financial milestones.</p>
        </div>
        <Button onClick={handleOpenCreateModal} className="gap-2"><Plus className="h-4 w-4" />Add Goal</Button>
      </div>

      {isLoading ? <SummarySkeleton /> : !isError && (
        <div className={summaryPanelClass}>
          <div className="grid grid-cols-1 gap-6 divide-y divide-border/30 sm:grid-cols-3 sm:gap-8 sm:divide-x sm:divide-y-0">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Target className="h-3.5 w-3.5 text-primary" /><span>Total Target</span></div>
              <div className="pt-1 font-heading text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl">{formatCurrency(Number(totals.target))}</div>
              <p className="pt-0.5 text-xs text-muted-foreground">Across {goals.length} tracked goals</p>
            </div>
            <div className="space-y-1 pt-4 sm:pl-8 sm:pt-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Coins className="h-3.5 w-3.5 text-emerald-500" /><span>Total Progress</span></div>
                <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{totals.progressPercent.toFixed(0)}%</span>
              </div>
              <div className="pt-1 font-heading text-2xl font-extrabold tabular-nums tracking-tight text-primary sm:text-3xl">{formatCurrency(Number(totals.progress))}</div>
              <div className="pt-1.5"><div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50" role="progressbar" aria-label="Total goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, totals.progressPercent))}><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, totals.progressPercent))}%` }} /></div></div>
              <p className="pt-1 text-xs tabular-nums text-muted-foreground">Reserved {formatCurrency(Number(totals.reserved))} · Spent {formatCurrency(Number(totals.spent))}</p>
            </div>
            <div className="space-y-1 pt-4 sm:pl-8 sm:pt-0">
              <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><TrendingUp className="h-3.5 w-3.5 text-amber-500" /><span>Savings Target</span></div><span className="text-[11px] font-medium tabular-nums text-muted-foreground">≈ {formatCurrency(Number(totals.kinsenas))}/ks</span></div>
              <div className="pt-1 font-heading text-2xl font-extrabold tabular-nums tracking-tight text-amber-600 dark:text-amber-400 sm:text-3xl">{formatCurrency(Number(totals.monthly))}<span className="ml-1 text-xs font-normal text-muted-foreground">/mo</span></div>
              <p className="pt-0.5 text-xs text-muted-foreground">Planned across active goals</p>
            </div>
          </div>
        </div>
      )}
      <p className="text-sm text-muted-foreground">Reserve money from a wallet for a goal. It stays in the wallet, but becomes unavailable for other spending. Spending from the goal uses its reserved funds. Monthly and kinsenas targets estimate completion only.</p>

      {isLoading ? (
        <div role="status" aria-label="Loading goals" className="space-y-4"><Skeleton className="h-4 w-36" /><div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map(index => <GoalCardSkeleton key={index} />)}</div></div>
      ) : isError ? (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center text-destructive">Failed to load goals. Please refresh or try again later.</div>
      ) : goals.length === 0 ? (
        <div className="mx-auto max-w-md space-y-5 px-4 py-20 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Target className="h-7 w-7" /></div>
          <div className="space-y-2"><h2 className="text-xl font-bold tracking-tight text-foreground">No active goals yet</h2><p className="text-sm leading-relaxed text-muted-foreground">Set a target for a milestone such as a laptop, a trip, or emergency savings.</p></div>
          <Button onClick={handleOpenCreateModal} size="lg" className="gap-2 font-medium"><Plus className="h-4 w-4" />Create Your First Goal</Button>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-4">
            <div className="flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Goals ({totals.active.length})</h2></div>
            {totals.active.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No active goals.</p> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{totals.active.map(renderGoal)}</div>}
          </section>
          {totals.closed.length > 0 && <section className="space-y-3 border-t border-border/30 pt-6">
            <button type="button" aria-expanded={showClosed} onClick={() => setShowClosed(value => !value)} className="flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /><span>Closed Goals ({totals.closed.length})</span>{showClosed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showClosed && <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2 lg:grid-cols-3">{totals.closed.map(renderGoal)}</div>}
          </section>}
        </div>
      )}

      <AddTransactionModal isOpen={contributingGoalId !== null} defaultGoalId={contributingGoalId ?? undefined} onClose={() => setContributingGoalId(null)} />
      <AddGoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} editingGoal={editingGoal} />
      <GoalFundsDialog goalId={fundsAction?.goalId ?? ""} mode={fundsAction?.mode ?? "reserve"} open={fundsAction !== null} onOpenChange={open => { if (!open) setFundsAction(null); }} />
      <GoalCompletionDialog goalId={closingAction?.goalId ?? ""} status={closingAction?.status ?? "completed"} open={closingAction !== null} onOpenChange={open => { if (!open) setClosingAction(null); }} />
      <GoalHistoryDialog goalId={historyGoalId ?? ""} open={historyGoalId !== null} onOpenChange={open => { if (!open) setHistoryGoalId(null); }} />
      <LegacyGoalReviewDialog goalId={reviewGoalId ?? ""} open={reviewGoalId !== null} onOpenChange={open => { if (!open) setReviewGoalId(null); }} />
    </div>
  );
}
