a9167c4 feat: add goal reservation and completion actions
 .../2026-10-06-goal-reservations/task-7-report.md  |  12 +
 src/app/(dashboard)/goals/page.tsx                 | 371 ++++++---------------
 src/components/goals/AddGoalModal.tsx              |   2 +-
 src/components/goals/GoalCard.tsx                  | 235 +++++--------
 src/components/goals/GoalCardSkeleton.tsx          |  30 +-
 src/components/goals/GoalCompletionDialog.tsx      | 173 ++++++++++
 src/components/goals/GoalFundsDialog.tsx           | 212 ++++++++++++
 src/components/goals/GoalHistoryDialog.tsx         |  95 ++++++
 src/hooks/use-goal-finance.ts                      |  19 +-
 src/hooks/use-goals.ts                             |   5 +-
 src/lib/goals/client.ts                            | 144 ++++++++
 src/lib/refresh-financial-data.ts                  |   2 +-
 tests/contributions.test.tsx                       |   6 +-
 tests/goal-actions.test.tsx                        | 366 ++++++++++++++++++++
 14 files changed, 1210 insertions(+), 462 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-7-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-7-report.md
new file mode 100644
index 0000000..2d9e491
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-7-report.md
@@ -0,0 +1,12 @@
+# Task 7 implementation report
+
+Implemented goal reservation actions, lifecycle presentation, and owner-scoped history. Set aside, release, and same-wallet goal moves use the finance snapshot and active PHP non-credit wallet metadata; error/loading states remain distinct from empty funds. Completion/cancellation requires an explicit leftover release or move when reservations remain, preserves spending history, and supports reopening. Closed goals with reservations cannot be archived. The Goals page and cards now show canonical reserved/spent/progress values and use the approved guidance. History normalizes database decimal text without floating-point conversion, displays wallet/operation labels and retained transaction references, and records deleted-transaction reversals from owner-scoped operation metadata without inventing allocation events.
+
+Verification:
+- `npx vitest run tests/goal-actions.test.tsx --reporter=dot` — 17 passed.
+- `npx tsc --noEmit` — passed.
+- `npm test -- --run` — 80 passed across 6 Vitest files, plus 2 Node tests.
+- The first full run was 79/80 because an existing contribution-page test still searched for the old “Add contribution” label. Updated only that query to “Spend from goal”; the shortcut behavior assertions remain. The final full run passed.
+- Browser visual verification is assigned to Task 11 and is not claimed here.
+
+No database migration or runtime dependency was added.
diff --git a/src/app/(dashboard)/goals/page.tsx b/src/app/(dashboard)/goals/page.tsx
index c906589..a48dbc2 100644
--- a/src/app/(dashboard)/goals/page.tsx
+++ b/src/app/(dashboard)/goals/page.tsx
@@ -1,339 +1,168 @@
 "use client";
 
 import React, { useMemo, useState } from "react";
-import {
-  Target,
-  Plus,
-  TrendingUp,
-  Coins,
-  ChevronDown,
-  ChevronUp,
-  CheckCircle2,
-} from "lucide-react";
+import { Target, Plus, TrendingUp, Coins, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { useToast } from "@/components/ui/use-toast";
 import { formatCurrency } from "@/lib/utils";
+import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";
 import { GoalWithProgress, useGoals } from "@/hooks/use-goals";
 import { GoalCard } from "@/components/goals/GoalCard";
 import { AddGoalModal } from "@/components/goals/AddGoalModal";
 import type { Goal } from "@/types/database";
 import AddTransactionModal from "@/components/transactions/AddTransactionModal";
+import { GoalFundsDialog } from "@/components/goals/GoalFundsDialog";
+import { GoalCompletionDialog } from "@/components/goals/GoalCompletionDialog";
+import { GoalHistoryDialog } from "@/components/goals/GoalHistoryDialog";
 import { GoalCardSkeleton } from "@/components/goals/GoalCardSkeleton";
 import { Skeleton } from "@/components/ui/skeleton";
 import { SummarySkeleton, summaryPanelClass } from "@/components/ui/financial-summary";
 
+type FundsAction = { goalId: string; mode: "reserve" | "release" | "move" };
+type ClosingAction = { goalId: string; status: "completed" | "cancelled" };
+
 export default function GoalsPage() {
   const { toast } = useToast();
-  const {
-    goals,
-    isLoading,
-    isError,
-    deleteGoal,
-    toggleComplete,
-  } = useGoals();
-
+  const { goals, isLoading, isError, deleteGoal, toggleComplete } = useGoals();
   const [isModalOpen, setIsModalOpen] = useState(false);
   const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
-  const [showCompleted, setShowCompleted] = useState(false);
+  const [showClosed, setShowClosed] = useState(false);
   const [contributingGoalId, setContributingGoalId] = useState<string | null>(null);
-
-  // Compute summary metrics
-  const {
-    totalTarget,
-    totalSaved,
-    totalMonthlyAllocation,
-    totalKinsenasAllocation,
-    activeGoals,
-    completedGoals,
-    globalProgress,
-  } = useMemo(() => {
-    let targetSum = 0;
-    let savedSum = 0;
-    let totalMonthlyAlloc = 0;
+  const [fundsAction, setFundsAction] = useState<FundsAction | null>(null);
+  const [closingAction, setClosingAction] = useState<ClosingAction | null>(null);
+  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
+
+  const totals = useMemo(() => {
+    let targetCents = 0;
+    let reservedCents = 0;
+    let spentCents = 0;
+    let monthlyCents = 0;
     const active: GoalWithProgress[] = [];
-    const completed: GoalWithProgress[] = [];
-
-    goals.forEach((g) => {
-      targetSum += Number(g.target_amount) || 0;
-      savedSum += Number(g.saved) || 0;
-      const isKinsenas = g.allocation_frequency === "kinsenas";
-      const alloc = Number(g.allocation_per_cycle) || 0;
-      const monthlyAlloc = isKinsenas ? alloc * 2 : alloc;
-      totalMonthlyAlloc += monthlyAlloc;
-
-      if (g.is_completed) {
-        completed.push(g);
-      } else {
-        active.push(g);
+    const closed: GoalWithProgress[] = [];
+    goals.forEach(goal => {
+      targetCents += toMinorUnits(goal.financeAmounts.target);
+      reservedCents += toMinorUnits(goal.reserved);
+      spentCents += toMinorUnits(goal.spent);
+      if (goal.status === "active") {
+        const allocationCents = toMinorUnits(goal.financeAmounts.allocationPerCycle);
+        monthlyCents += goal.allocation_frequency === "kinsenas" ? allocationCents * 2 : allocationCents;
+        active.push(goal);
       }
+      else closed.push(goal);
     });
-
-    const totalKinsenasAlloc = totalMonthlyAlloc / 2;
-    const globalProg = targetSum > 0 ? (savedSum / targetSum) * 100 : 0;
-
+    const progressCents = reservedCents + spentCents;
     return {
-      totalTarget: targetSum,
-      totalSaved: savedSum,
-      totalMonthlyAllocation: totalMonthlyAlloc,
-      totalKinsenasAllocation: totalKinsenasAlloc,
-      activeGoals: active,
-      completedGoals: completed,
-      globalProgress: globalProg,
+      target: fromMinorUnits(targetCents), reserved: fromMinorUnits(reservedCents), spent: fromMinorUnits(spentCents),
+      progress: fromMinorUnits(progressCents), monthly: fromMinorUnits(monthlyCents), kinsenas: fromMinorUnits(Math.round(monthlyCents / 2)),
+      active, closed, progressPercent: targetCents > 0 ? progressCents / targetCents * 100 : 0,
     };
   }, [goals]);
 
-  const handleOpenCreateModal = () => {
-    setEditingGoal(null);
-    setIsModalOpen(true);
-  };
-
-  const handleOpenEditModal = (goal: GoalWithProgress) => {
-    setEditingGoal(goal);
-    setIsModalOpen(true);
-  };
-
-  const handleDeleteGoal = async (goalId: string) => {
-    const target = goals.find((g) => g.id === goalId);
-    const confirmed = window.confirm(
-      `Are you sure you want to delete "${target?.name || "this goal"}"?\n\nAny tagged transactions will remain in your ledger, but will no longer be linked to this goal.`
-    );
-    if (!confirmed) return;
+  const handleOpenCreateModal = () => { setEditingGoal(null); setIsModalOpen(true); };
+  const handleOpenEditModal = (goal: GoalWithProgress) => { setEditingGoal(goal); setIsModalOpen(true); };
 
+  const handleArchiveGoal = async (goalId: string) => {
     try {
       await deleteGoal(goalId);
-      toast({
-        title: "Goal deleted",
-        description: "The goal was removed successfully.",
-      });
-    } catch (err: any) {
-      toast({
-        title: "Error deleting goal",
-        description: err.message || "Failed to delete goal.",
-        variant: "destructive",
-      });
+      toast({ title: "Goal archived", description: "Its reservation and spending history stays available." });
+    } catch (error) {
+      toast({ title: "Could not archive goal", description: error instanceof Error ? error.message : "The goal was not archived.", variant: "destructive" });
     }
   };
 
   const handleToggleComplete = async (goalId: string, completed: boolean) => {
+    if (completed) {
+      setClosingAction({ goalId, status: "completed" });
+      return;
+    }
     try {
-      await toggleComplete(goalId, completed);
-      toast({
-        title: completed ? "Goal marked complete!" : "Goal reopened",
-        description: completed
-          ? "Great job on hitting your milestone!"
-          : "The goal is back in your active roadmap.",
-      });
-    } catch (err: any) {
-      toast({
-        title: "Error updating goal",
-        description: err.message || "Failed to update completion status.",
-        variant: "destructive",
-      });
+      await toggleComplete(goalId, false);
+      toast({ title: "Goal reopened", description: "Its spending history and current progress are available again." });
+    } catch (error) {
+      toast({ title: "Could not reopen goal", description: error instanceof Error ? error.message : "The goal was not reopened.", variant: "destructive" });
     }
   };
 
+  const renderGoal = (goal: GoalWithProgress) => (
+    <GoalCard key={goal.id} goal={goal} onEdit={handleOpenEditModal} onDelete={handleArchiveGoal}
+      onToggleComplete={handleToggleComplete} onContribute={setContributingGoalId}
+      onReserve={goalId => setFundsAction({ goalId, mode: "reserve" })}
+      onRelease={goalId => setFundsAction({ goalId, mode: "release" })}
+      onMove={goalId => setFundsAction({ goalId, mode: "move" })}
+      onClose={(goalId, status) => setClosingAction({ goalId, status })}
+      onHistory={setHistoryGoalId} />
+  );
+
   return (
     <div className="space-y-8 pb-12">
-      {/* Masthead Header */}
-      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
+      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
         <div>
           <div className="flex items-center gap-2.5">
-            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
-              Goals & Sinking Funds
-            </h1>
-            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
-              {isLoading ? <Skeleton className="h-4 w-14" /> : `${activeGoals.length} Active`}
-            </span>
+            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Goals &amp; Sinking Funds</h1>
+            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{isLoading ? <Skeleton className="h-4 w-14" /> : `${totals.active.length} Active`}</span>
           </div>
-          <p className="mt-1 text-sm text-muted-foreground">
-            Plan your savings, sinking funds, and multi-year financial milestones
-          </p>
+          <p className="mt-1 text-sm text-muted-foreground">Plan your savings, sinking funds, and financial milestones.</p>
         </div>
-
-        <Button onClick={handleOpenCreateModal} className="gap-2 shadow-sm">
-          <Plus className="h-4 w-4" />
-          Add Goal
-        </Button>
+        <Button onClick={handleOpenCreateModal} className="gap-2"><Plus className="h-4 w-4" />Add Goal</Button>
       </div>
 
-      {/* Unified Editorial Masthead (No isolated chunky boxes) */}
-      {isLoading ? <SummarySkeleton /> : !isError && <div className={summaryPanelClass}>
-        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 divide-y sm:divide-y-0 sm:divide-x divide-border/30">
-          {/* Column 1: Total Target */}
-          <div className="space-y-1">
-            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
-              <Target className="h-3.5 w-3.5 text-primary" />
-              <span>Total Target</span>
-            </div>
-            <div className="text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight text-foreground pt-1">
-              {formatCurrency(totalTarget)}
-            </div>
-            <p className="text-xs text-muted-foreground pt-0.5">
-              Across {goals.length} total tracked targets
-            </p>
-          </div>
-
-          {/* Column 2: Total Funded */}
-          <div className="space-y-1 sm:pl-8 pt-4 sm:pt-0">
-            <div className="flex items-center justify-between">
-              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
-                <Coins className="h-3.5 w-3.5 text-emerald-500" />
-                <span>Total Funded</span>
-              </div>
-              <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
-                {globalProgress.toFixed(0)}%
-              </span>
+      {isLoading ? <SummarySkeleton /> : !isError && (
+        <div className={summaryPanelClass}>
+          <div className="grid grid-cols-1 gap-6 divide-y divide-border/30 sm:grid-cols-3 sm:gap-8 sm:divide-x sm:divide-y-0">
+            <div className="space-y-1">
+              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Target className="h-3.5 w-3.5 text-primary" /><span>Total Target</span></div>
+              <div className="pt-1 font-heading text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl">{formatCurrency(Number(totals.target))}</div>
+              <p className="pt-0.5 text-xs text-muted-foreground">Across {goals.length} tracked goals</p>
             </div>
-            <div className="text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 pt-1">
-              {formatCurrency(totalSaved)}
-            </div>
-            {/* Sleek Progress Track */}
-            <div className="pt-1.5">
-              <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
-                <div
-                  className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
-                  style={{ width: `${Math.min(100, Math.max(0, globalProgress))}%` }}
-                />
-              </div>
-            </div>
-          </div>
-
-          {/* Column 3: Savings Target (Dual Cadence) */}
-          <div className="space-y-1 sm:pl-8 pt-4 sm:pt-0">
-            <div className="flex items-center justify-between">
-              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
-                <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
-                <span>Savings Target</span>
+            <div className="space-y-1 pt-4 sm:pl-8 sm:pt-0">
+              <div className="flex items-center justify-between">
+                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Coins className="h-3.5 w-3.5 text-emerald-500" /><span>Total Progress</span></div>
+                <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{totals.progressPercent.toFixed(0)}%</span>
               </div>
-              <span className="text-[11px] tabular-nums text-muted-foreground font-medium">
-                ≈ {formatCurrency(totalKinsenasAllocation)}/ks
-              </span>
+              <div className="pt-1 font-heading text-2xl font-extrabold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-3xl">{formatCurrency(Number(totals.progress))}</div>
+              <div className="pt-1.5"><div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50" role="progressbar" aria-label="Total goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, totals.progressPercent))}><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, totals.progressPercent))}%` }} /></div></div>
+              <p className="pt-1 text-xs tabular-nums text-muted-foreground">Reserved {formatCurrency(Number(totals.reserved))} · Spent {formatCurrency(Number(totals.spent))}</p>
             </div>
-            <div className="text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight text-amber-600 dark:text-amber-400 pt-1">
-              {formatCurrency(totalMonthlyAllocation)}
-              <span className="text-xs font-normal text-muted-foreground ml-1">/mo</span>
+            <div className="space-y-1 pt-4 sm:pl-8 sm:pt-0">
+              <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><TrendingUp className="h-3.5 w-3.5 text-amber-500" /><span>Savings Target</span></div><span className="text-[11px] font-medium tabular-nums text-muted-foreground">≈ {formatCurrency(Number(totals.kinsenas))}/ks</span></div>
+              <div className="pt-1 font-heading text-2xl font-extrabold tabular-nums tracking-tight text-amber-600 dark:text-amber-400 sm:text-3xl">{formatCurrency(Number(totals.monthly))}<span className="ml-1 text-xs font-normal text-muted-foreground">/mo</span></div>
+              <p className="pt-0.5 text-xs text-muted-foreground">Planned across active goals</p>
             </div>
-            <p className="text-xs text-muted-foreground pt-0.5">
-              Planned savings allocated across all active goals
-            </p>
           </div>
         </div>
-      </div>
-
-      }
-      <p className="text-sm text-muted-foreground">
-        Transactions tagged with a goal automatically increase its funded amount. Monthly and kinsenas targets estimate completion only.
-      </p>
+      )}
+      <p className="text-sm text-muted-foreground">Set aside money in a wallet to fund a goal. Spending from that goal uses its reserved funds. Monthly and kinsenas targets estimate completion only.</p>
 
-      {/* Main Content Area */}
       {isLoading ? (
-        <div role="status" aria-label="Loading goals" className="space-y-4">
-          <Skeleton className="h-4 w-36" />
-          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
-          {[1, 2, 3].map((i) => (
-            <GoalCardSkeleton key={i} />
-          ))}
-          </div>
-        </div>
+        <div role="status" aria-label="Loading goals" className="space-y-4"><Skeleton className="h-4 w-36" /><div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map(index => <GoalCardSkeleton key={index} />)}</div></div>
       ) : isError ? (
-        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center text-destructive">
-          Failed to load goals. Please refresh or try again later.
-        </div>
+        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-center text-destructive">Failed to load goals. Please refresh or try again later.</div>
       ) : goals.length === 0 ? (
-        /* Open & Breathable Empty State (No heavy border or dashed outline box) */
-        <div className="py-20 px-4 text-center max-w-md mx-auto space-y-5">
-          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
-            <Target className="h-7 w-7" />
-          </div>
-          <div className="space-y-2">
-            <h3 className="text-xl font-bold tracking-tight text-foreground">
-              No active goals yet
-            </h3>
-            <p className="text-sm text-muted-foreground leading-relaxed">
-              Set savings targets for milestones like{" "}
-              <span className="text-foreground font-medium">Phone</span>,{" "}
-              <span className="text-foreground font-medium">Laptop</span>, or an{" "}
-              <span className="text-foreground font-medium">Emergency Fund</span>, and track your progress each month.
-            </p>
-          </div>
-          <Button onClick={handleOpenCreateModal} size="lg" className="gap-2 shadow-sm font-medium">
-            <Plus className="h-4 w-4" />
-            Create Your First Goal
-          </Button>
+        <div className="mx-auto max-w-md space-y-5 px-4 py-20 text-center">
+          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Target className="h-7 w-7" /></div>
+          <div className="space-y-2"><h2 className="text-xl font-bold tracking-tight text-foreground">No active goals yet</h2><p className="text-sm leading-relaxed text-muted-foreground">Set a target for a milestone such as a laptop, a trip, or emergency savings.</p></div>
+          <Button onClick={handleOpenCreateModal} size="lg" className="gap-2 font-medium"><Plus className="h-4 w-4" />Create Your First Goal</Button>
         </div>
       ) : (
         <div className="space-y-8">
-          {/* Active Goals Section */}
           <section className="space-y-4">
-            <div className="flex items-center justify-between">
-              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
-                Active Roadmap ({activeGoals.length})
-              </h2>
-            </div>
-
-            {activeGoals.length === 0 ? (
-              <div className="py-8 text-center text-muted-foreground text-sm">
-                All goals completed! Great milestone achievement.
-              </div>
-            ) : (
-              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
-                {activeGoals.map((goal) => (
-                  <GoalCard
-                    key={goal.id}
-                    goal={goal}
-                    onEdit={handleOpenEditModal}
-                    onDelete={handleDeleteGoal}
-                    onToggleComplete={handleToggleComplete}
-                    onContribute={setContributingGoalId}
-                  />
-                ))}
-              </div>
-            )}
+            <div className="flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Goals ({totals.active.length})</h2></div>
+            {totals.active.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No active goals.</p> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{totals.active.map(renderGoal)}</div>}
           </section>
-
-          {/* Completed Goals Section (Collapsible) */}
-          {completedGoals.length > 0 && (
-            <section className="space-y-3 pt-6 border-t border-border/30">
-              <button
-                type="button"
-                onClick={() => setShowCompleted(!showCompleted)}
-                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
-              >
-                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
-                <span>Completed Goals ({completedGoals.length})</span>
-                {showCompleted ? (
-                  <ChevronUp className="h-3.5 w-3.5" />
-                ) : (
-                  <ChevronDown className="h-3.5 w-3.5" />
-                )}
-              </button>
-
-              {showCompleted && (
-                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
-                  {completedGoals.map((goal) => (
-                    <GoalCard
-                      key={goal.id}
-                      goal={goal}
-                      onEdit={handleOpenEditModal}
-                      onDelete={handleDeleteGoal}
-                      onToggleComplete={handleToggleComplete}
-                      onContribute={setContributingGoalId}
-                    />
-                  ))}
-                </div>
-              )}
-            </section>
-          )}
+          {totals.closed.length > 0 && <section className="space-y-3 border-t border-border/30 pt-6">
+            <button type="button" aria-expanded={showClosed} onClick={() => setShowClosed(value => !value)} className="flex min-h-10 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
+              <CheckCircle2 className="h-4 w-4 text-emerald-500" /><span>Closed Goals ({totals.closed.length})</span>{showClosed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
+            </button>
+            {showClosed && <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2 lg:grid-cols-3">{totals.closed.map(renderGoal)}</div>}
+          </section>}
         </div>
       )}
 
-      {/* Add / Edit Goal Modal */}
       <AddTransactionModal isOpen={contributingGoalId !== null} defaultGoalId={contributingGoalId ?? undefined} onClose={() => setContributingGoalId(null)} />
-      <AddGoalModal
-        isOpen={isModalOpen}
-        onClose={() => setIsModalOpen(false)}
-        editingGoal={editingGoal}
-      />
+      <AddGoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} editingGoal={editingGoal} />
+      <GoalFundsDialog goalId={fundsAction?.goalId ?? ""} mode={fundsAction?.mode ?? "reserve"} open={fundsAction !== null} onOpenChange={open => { if (!open) setFundsAction(null); }} />
+      <GoalCompletionDialog goalId={closingAction?.goalId ?? ""} status={closingAction?.status ?? "completed"} open={closingAction !== null} onOpenChange={open => { if (!open) setClosingAction(null); }} />
+      <GoalHistoryDialog goalId={historyGoalId ?? ""} open={historyGoalId !== null} onOpenChange={open => { if (!open) setHistoryGoalId(null); }} />
     </div>
   );
 }
diff --git a/src/components/goals/AddGoalModal.tsx b/src/components/goals/AddGoalModal.tsx
index 523d053..0dd5eed 100644
--- a/src/components/goals/AddGoalModal.tsx
+++ b/src/components/goals/AddGoalModal.tsx
@@ -205,21 +205,21 @@ export function AddGoalModal({ isOpen, onClose, editingGoal }: AddGoalModalProps
         <div className="flex items-center justify-between pb-4 border-b border-border/50">
           <div className="flex items-center gap-2.5">
             <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
               <Target className="h-5 w-5" />
             </div>
             <div>
               <h2 className="text-lg font-semibold tracking-tight">
                 {editingGoal ? "Edit Goal" : "New Goal / Sinking Fund"}
               </h2>
               <p className="text-xs text-muted-foreground">
-                Track your savings targets with flexible monthly or kinsenas projections
+                Monthly and kinsenas targets estimate completion; they do not reserve money.
               </p>
             </div>
           </div>
           <Button
             variant="ghost"
             size="icon"
             className="h-8 w-8 text-muted-foreground hover:text-foreground"
             onClick={onClose}
           >
             <X className="h-4 w-4" />
diff --git a/src/components/goals/GoalCard.tsx b/src/components/goals/GoalCard.tsx
index 354c7ab..a0966fe 100644
--- a/src/components/goals/GoalCard.tsx
+++ b/src/components/goals/GoalCard.tsx
@@ -1,213 +1,128 @@
 "use client";
 
 import React from "react";
-import {
-  Calendar,
-  CheckCircle2,
-  Circle,
-  Clock,
-  Edit2,
-  Flame,
-  Trash2,
-} from "lucide-react";
+import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
+import { Calendar, CheckCircle2, Clock, Edit2, Flame, MoreHorizontal, Circle, History, Trash2 } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { formatCurrency } from "@/lib/utils";
-import { getProjection, GoalWithProgress } from "@/hooks/use-goals";
+import { getProjection, type GoalWithProgress } from "@/hooks/use-goals";
+import { toMinorUnits } from "@/lib/goals/summary";
 
 const categoryStyles: Record<string, string> = {
   lifestyle: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
   health: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
   debt: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
   milestone: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
   holiday: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
   tech: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
   travel: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
   savings: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
 };
 
 function formatDate(dateStr: string | null) {
   if (!dateStr) return null;
-  try {
-    const d = new Date(dateStr);
-    if (isNaN(d.getTime())) return null;
-    return new Intl.DateTimeFormat(undefined, {
-      month: "short",
-      day: "numeric",
-      year: "numeric",
-    }).format(d);
-  } catch {
-    return null;
-  }
+  const date = new Date(dateStr);
+  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
 }
 
 interface GoalCardProps {
   goal: GoalWithProgress;
   onEdit: (goal: GoalWithProgress) => void;
   onDelete: (goalId: string) => void;
   onToggleComplete: (goalId: string, completed: boolean) => void;
   onContribute: (goalId: string) => void;
+  onReserve: (goalId: string) => void;
+  onRelease: (goalId: string) => void;
+  onMove: (goalId: string) => void;
+  onHistory: (goalId: string) => void;
+  onClose?: (goalId: string, status: "completed" | "cancelled") => void;
 }
 
-export function GoalCard({
-  goal,
-  onEdit,
-  onDelete,
-  onToggleComplete,
-  onContribute,
-}: GoalCardProps) {
+export function GoalCard({ goal, onEdit, onDelete, onToggleComplete, onContribute, onReserve, onRelease, onMove, onHistory, onClose }: GoalCardProps) {
   const projection = getProjection(goal);
-  const clampedPercent = Math.min(100, Math.max(0, goal.progressPercent));
+  const progressCents = toMinorUnits(goal.financeAmounts.progress);
+  const targetCents = toMinorUnits(goal.financeAmounts.target);
+  const isCompleted = goal.status === "completed";
+  const isCancelled = goal.status === "cancelled";
+  const isActive = goal.status === "active";
+  const activeFunded = isActive && progressCents >= targetCents;
+  const displayedProgress = isCompleted ? goal.spent : goal.financeAmounts.progress;
+  const percent = isCompleted ? (targetCents ? Math.min(100, toMinorUnits(goal.spent) / targetCents * 100) : 0) : goal.progressPercent;
+  const clampedPercent = Math.min(100, Math.max(0, percent));
   const categoryStyle = categoryStyles[goal.category?.toLowerCase()] || categoryStyles.lifestyle;
   const formattedTargetDate = formatDate(goal.target_date);
   const formattedProjectedDate = formatDate(projection.projectedDate);
+  const hasReservations = goal.walletReservations.some(wallet => toMinorUnits(wallet.amount) > 0);
 
   return (
-    <div
-      className={`group relative flex flex-col justify-between rounded-xl border p-4 sm:p-5 transition-all duration-200 ${
-        goal.is_completed
-          ? "border-border/30 bg-card/30 opacity-75 hover:opacity-100"
-          : "border-border/40 bg-card/50 hover:bg-card/75 hover:border-border/70 hover:shadow-xs"
-      }`}
-    >
+    <article aria-label={`${goal.name} goal`} className={`group flex flex-col justify-between rounded-xl border p-4 sm:p-5 ${isActive ? "border-border/40 bg-card/50" : "border-border/30 bg-card/30"}`}>
       <div>
-        {/* Header row: Name, Category Pill, Priority */}
-        <div className="flex items-start justify-between gap-2 mb-3">
-          <div className="space-y-1.5 min-w-0 flex-1">
-            <div className="flex items-center gap-2 flex-wrap">
-              <h3 className="font-semibold text-base leading-snug tracking-tight truncate text-foreground">
-                {goal.name}
-              </h3>
-              {goal.is_priority && (
-                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20">
-                  <Flame className="h-3 w-3" />
-                  Priority
-                </span>
-              )}
-              {goal.is_completed && (
-                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
-                  <CheckCircle2 className="h-3 w-3" />
-                  Done
-                </span>
-              )}
+        <div className="mb-3 flex items-start justify-between gap-2">
+          <div className="min-w-0 flex-1 space-y-1.5">
+            <div className="flex flex-wrap items-center gap-2">
+              <h3 className="truncate text-base font-semibold leading-snug tracking-tight text-foreground">{goal.name}</h3>
+              {goal.is_priority && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"><Flame className="h-3 w-3" />Priority</span>}
+              {isCompleted && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Completed</span>}
+              {isCancelled && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Cancelled</span>}
             </div>
-            <div className="flex items-center gap-2 text-xs">
-              <span
-                className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize ${categoryStyle}`}
-              >
-                {goal.category || "General"}
-              </span>
-              {formattedTargetDate && (
-                <span className="flex items-center gap-1 text-muted-foreground text-[11px]">
-                  <Calendar className="h-3 w-3" />
-                  Target: {formattedTargetDate}
-                </span>
-              )}
+            <div className="flex flex-wrap items-center gap-2 text-xs">
+              <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize ${categoryStyle}`}>{goal.category || "General"}</span>
+              {formattedTargetDate && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Calendar className="h-3 w-3" />Target: {formattedTargetDate}</span>}
             </div>
           </div>
-
-          {/* Quick Actions */}
-          <div className="flex items-center gap-0.5 shrink-0 opacity-80 sm:opacity-40 group-hover:opacity-100 transition-opacity">
-            <Button
-              variant="ghost"
-              size="icon"
-              className="h-7 w-7 text-muted-foreground hover:text-foreground"
-              onClick={() => onEdit(goal)}
-              title="Edit Goal"
-            >
-              <Edit2 className="h-3.5 w-3.5" />
-            </Button>
-            <Button
-              variant="ghost"
-              size="icon"
-              className="h-7 w-7 text-muted-foreground hover:text-destructive"
-              onClick={() => onDelete(goal.id)}
-              title="Delete Goal"
-            >
-              <Trash2 className="h-3.5 w-3.5" />
-            </Button>
-          </div>
+          <DropdownMenu.Root>
+            <DropdownMenu.Trigger asChild>
+              <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`${goal.name} actions`}><MoreHorizontal className="h-4 w-4" /></Button>
+            </DropdownMenu.Trigger>
+            <DropdownMenu.Portal>
+              <DropdownMenu.Content align="end" sideOffset={6} className="z-[60] min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
+                <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onHistory(goal.id)}><History className="h-4 w-4" />View history</DropdownMenu.Item>
+                <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onEdit(goal)}><Edit2 className="h-4 w-4" />Edit goal</DropdownMenu.Item>
+                {isActive && <>
+                  <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onRelease(goal.id)} disabled={!hasReservations}>Release funds</DropdownMenu.Item>
+                  <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onMove(goal.id)} disabled={!hasReservations}>Move reservation</DropdownMenu.Item>
+                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
+                  <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onClose ? onClose(goal.id, "completed") : onToggleComplete(goal.id, true)}>Complete goal</DropdownMenu.Item>
+                  <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onClose?.(goal.id, "cancelled")}>Cancel goal</DropdownMenu.Item>
+                </>}
+                {isCompleted && <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onToggleComplete(goal.id, false)}><Circle className="h-4 w-4" />Reopen</DropdownMenu.Item>}
+                {!isActive && !hasReservations && <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-destructive outline-none focus:bg-accent" onSelect={() => onDelete(goal.id)}><Trash2 className="h-4 w-4" />Archive goal</DropdownMenu.Item>}
+              </DropdownMenu.Content>
+            </DropdownMenu.Portal>
+          </DropdownMenu.Root>
         </div>
 
-        {/* Progress Bar & Amounts */}
         <div className="my-3.5 space-y-2">
-          <div className="flex items-baseline justify-between">
-            <div className="flex items-baseline gap-1.5 min-w-0">
-              <span className="text-base sm:text-lg font-bold tracking-tight text-foreground tabular-nums">
-                {formatCurrency(goal.saved)}
-              </span>
-              <span className="text-xs text-muted-foreground font-medium tabular-nums">
-                / {formatCurrency(goal.target_amount)}
-              </span>
-            </div>
-            <span className="text-xs font-bold tabular-nums text-foreground">
-              {clampedPercent.toFixed(0)}%
-            </span>
+          <div className="flex items-baseline justify-between gap-2">
+            <div className="min-w-0"><span className="text-base font-bold tracking-tight text-foreground sm:text-lg">{formatCurrency(Number(displayedProgress))}</span><span className="ml-1.5 text-xs font-medium text-muted-foreground">/ {formatCurrency(goal.target_amount)}</span></div>
+            <span className="text-xs font-bold tabular-nums text-foreground">{clampedPercent.toFixed(0)}%</span>
           </div>
-
-          <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
-            <div
-              className={`h-full rounded-full transition-all duration-300 ${
-                goal.is_completed
-                  ? "bg-emerald-500"
-                  : goal.progressPercent >= 75
-                  ? "bg-emerald-500"
-                  : goal.progressPercent >= 30
-                  ? "bg-primary"
-                  : "bg-amber-500"
-              }`}
-              style={{ width: `${clampedPercent}%` }}
-            />
+          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50" role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clampedPercent)}>
+            <div className={`h-full rounded-full ${isCompleted || activeFunded ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${clampedPercent}%` }} />
+          </div>
+          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
+            <p className="text-muted-foreground">Reserved <span className="font-medium text-foreground">{formatCurrency(Number(goal.reserved))}</span></p>
+            <p className="text-muted-foreground">Spent <span className="font-medium text-foreground">{formatCurrency(Number(goal.spent))}</span></p>
           </div>
         </div>
       </div>
 
-      {!goal.is_completed && <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => onContribute(goal.id)}>Add contribution</Button>}
+      {isActive && <div className="mt-2 grid grid-cols-2 gap-2">
+        <Button variant="outline" size="sm" className="h-11 min-h-11" onClick={() => onReserve(goal.id)}>Set aside</Button>
+        <Button size="sm" className="h-11 min-h-11" onClick={() => onContribute(goal.id)}>Spend from goal</Button>
+      </div>}
 
-      {/* Footer: Projection & Complete Toggle */}
-      <div className="mt-2 pt-3 border-t border-border/30 flex items-center justify-between gap-3 text-xs text-muted-foreground">
+      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/30 pt-3 text-xs text-muted-foreground">
         <div className="min-w-0 flex-1">
-          {goal.is_completed ? (
-            <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 text-xs">
-              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Fully funded!
-            </span>
-          ) : Number(goal.allocation_per_cycle) > 0 ? (
-            <div className="space-y-0.5">
-              <span className="flex items-center gap-1 text-[11px] font-medium text-foreground">
-                <Clock className="h-3 w-3 text-muted-foreground" />
-                ~{projection.count} {projection.unit} ({formatCurrency(projection.monthlyAmount)}/mo · {formatCurrency(projection.kinsenasAmount)}/ks)
-              </span>
-              {formattedProjectedDate && (
-                <span className="block text-[10px] text-muted-foreground">
-                  Est. completion: {formattedProjectedDate}
-                </span>
-              )}
-            </div>
-          ) : (
-            <span className="text-[11px] text-muted-foreground/70">
-              No target cadence set
-            </span>
-          )}
+          {isCompleted ? <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />PHP {goal.spent} spent</span>
+            : isCancelled ? <span>Spending history retained</span>
+            : activeFunded ? <span className="font-medium text-emerald-600 dark:text-emerald-400">Funded</span>
+            : Number(goal.allocation_per_cycle) > 0 ? <div className="space-y-0.5"><span className="flex items-center gap-1 text-[11px] font-medium text-foreground"><Clock className="h-3 w-3 text-muted-foreground" />Saving · ~{projection.count} {projection.unit}</span>{formattedProjectedDate && <span className="block text-[10px] text-muted-foreground">Estimate: {formattedProjectedDate}</span>}</div>
+            : <span className="text-[11px] text-muted-foreground">Saving</span>}
         </div>
-
-        <Button
-          variant="ghost"
-          size="sm"
-          className="h-7 px-2.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground shrink-0 rounded-lg"
-          onClick={() => onToggleComplete(goal.id, !goal.is_completed)}
-        >
-          {goal.is_completed ? (
-            <>
-              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
-              Reopen
-            </>
-          ) : (
-            <>
-              <Circle className="h-3.5 w-3.5" />
-              Complete
-            </>
-          )}
-        </Button>
+        {isActive && !activeFunded && <Button variant="ghost" size="sm" className="h-11 min-h-11 shrink-0 px-2 text-xs" onClick={() => onClose ? onClose(goal.id, "completed") : onToggleComplete(goal.id, true)}>Complete</Button>}
+        {isCompleted && <Button variant="ghost" size="sm" className="h-11 min-h-11 shrink-0 px-2 text-xs" onClick={() => onToggleComplete(goal.id, false)}>Reopen</Button>}
       </div>
-    </div>
+    </article>
   );
 }
diff --git a/src/components/goals/GoalCardSkeleton.tsx b/src/components/goals/GoalCardSkeleton.tsx
index 7ed3842..f156b79 100644
--- a/src/components/goals/GoalCardSkeleton.tsx
+++ b/src/components/goals/GoalCardSkeleton.tsx
@@ -1,32 +1,18 @@
 import { Skeleton } from "@/components/ui/skeleton";
 
 export function GoalCardSkeleton() {
   return (
-    <div
-      className="flex flex-col justify-between rounded-xl border border-border/40 bg-card/50 p-4 sm:p-5"
-      aria-hidden="true"
-    >
+    <div className="flex flex-col justify-between rounded-xl border border-border/40 bg-card/50 p-4 sm:p-5" aria-hidden="true">
       <div>
-        <div className="flex items-start justify-between gap-2 mb-3">
-          <div className="space-y-1.5 flex-1">
-            <Skeleton className="h-5 w-32" />
-            <Skeleton className="h-4 w-20" />
-          </div>
-          <Skeleton className="h-7 w-14" />
+        <div className="mb-3 flex items-start justify-between gap-2">
+          <div className="flex-1 space-y-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-24" /></div>
+          <Skeleton className="h-9 w-9 rounded-md" />
         </div>
-        <div className="my-3.5 space-y-2">
-          <div className="flex justify-between items-baseline">
-            <Skeleton className="h-6 w-36" />
-            <Skeleton className="h-4 w-10" />
-          </div>
-          <Skeleton className="h-1.5 w-full" />
-        </div>
-      </div>
-      <Skeleton className="mt-2 h-9 w-full rounded-md" />
-      <div className="mt-2 pt-3 border-t border-border/30 flex items-center justify-between gap-3">
-        <Skeleton className="h-4 w-36" />
-        <Skeleton className="h-7 w-20 rounded-lg" />
+        <div className="my-3.5 space-y-2"><div className="flex justify-between"><Skeleton className="h-6 w-36" /><Skeleton className="h-4 w-10" /></div><Skeleton className="h-1.5 w-full" /></div>
+        <div className="grid grid-cols-2 gap-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-24" /></div>
       </div>
+      <div className="mt-2 grid grid-cols-2 gap-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
+      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/30 pt-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-20 rounded-md" /></div>
     </div>
   );
 }
diff --git a/src/components/goals/GoalCompletionDialog.tsx b/src/components/goals/GoalCompletionDialog.tsx
new file mode 100644
index 0000000..3da3996
--- /dev/null
+++ b/src/components/goals/GoalCompletionDialog.tsx
@@ -0,0 +1,173 @@
+"use client";
+
+import React, { useEffect, useMemo, useRef, useState } from "react";
+import * as Dialog from "@radix-ui/react-dialog";
+import { Button } from "@/components/ui/button";
+import { useGoals } from "@/hooks/use-goals";
+import { useGoalWalletMetadata } from "@/hooks/use-goal-finance";
+import { FinancialCommandError, financialCommandMessage } from "@/lib/goals/client";
+import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";
+import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
+import type { FinancialCommand, LeftoverChoice } from "@/lib/goals/contracts";
+
+interface GoalCompletionDialogProps {
+  goalId: string;
+  status: "completed" | "cancelled";
+  open: boolean;
+  onOpenChange: (open: boolean) => void;
+}
+
+export function GoalCompletionDialog({ goalId, status, open, onOpenChange }: GoalCompletionDialogProps) {
+  const { goals, userId, refresh, isLoading, isError } = useGoals();
+  const walletMetadata = useGoalWalletMetadata(userId);
+  const [choice, setChoice] = useState<"release" | "move" | "">("");
+  const [destinationGoalId, setDestinationGoalId] = useState("");
+  const [pending, setPending] = useState(false);
+  const [error, setError] = useState<string | null>(null);
+  const [refreshError, setRefreshError] = useState(false);
+  const requestId = useRef<string | null>(null);
+  const retryCommand = useRef<FinancialCommand | null>(null);
+  const unknownOutcome = useRef(false);
+  const recoveringUnknown = unknownOutcome.current && retryCommand.current !== null;
+  const opener = useRef<HTMLElement | null>(null);
+
+  const goal = goals.find(item => item.id === goalId);
+  const leftoverCents = useMemo(() => (goal?.walletReservations ?? []).reduce((sum, item) => sum + toMinorUnits(item.amount), 0), [goal?.walletReservations]);
+  const leftovers = fromMinorUnits(leftoverCents);
+  const destinations = goals.filter(item => item.id !== goalId && item.status === "active" && item.review_state === "confirmed" && item.archived_at === null);
+  const walletNames = new Map((walletMetadata.data ?? []).map(item => [item.id, item.name]));
+
+  useEffect(() => {
+    if (!open) return;
+    setChoice("");
+    setDestinationGoalId("");
+    setError(unknownOutcome.current ? "The previous save has an unknown result. Retry it to confirm the same request." : null);
+    setRefreshError(false);
+  }, [goalId, open, status]);
+
+  async function submit(event: React.FormEvent) {
+    event.preventDefault();
+    setError(null);
+    let command = retryCommand.current;
+    if (!command) {
+      if (!goal || goal.status !== "active" || goal.review_state !== "confirmed") {
+        setError("Confirm this goal before closing it.");
+        return;
+      }
+      let leftoversChoice: LeftoverChoice | null = null;
+      if (leftoverCents > 0) {
+        if (choice === "release") leftoversChoice = { mode: "release" };
+        else if (choice === "move" && destinations.some(item => item.id === destinationGoalId)) {
+          leftoversChoice = { mode: "move", goalId: destinationGoalId };
+        } else {
+          setError("Choose what to do with the remaining reserved funds.");
+          return;
+        }
+      }
+      command = { kind: "close", goalId, status, leftovers: leftoversChoice };
+      requestId.current = crypto.randomUUID();
+      retryCommand.current = command;
+    }
+    if (!requestId.current) requestId.current = crypto.randomUUID();
+    setPending(true);
+    try {
+      const { refreshError: failedRefresh } = await applyAndRefreshFinancialCommand(requestId.current, command, undefined, refresh);
+      requestId.current = null;
+      retryCommand.current = null;
+      unknownOutcome.current = false;
+      if (failedRefresh) {
+        setRefreshError(true);
+        return;
+      }
+      onOpenChange(false);
+    } catch (cause) {
+      if (cause instanceof FinancialCommandError && cause.outcome === "unknown") {
+        unknownOutcome.current = true;
+        setError("We could not confirm whether this was saved. Retry this same request before starting another one.");
+      } else {
+        requestId.current = null;
+        retryCommand.current = null;
+        unknownOutcome.current = false;
+        setError(financialCommandMessage(cause, "The goal could not be closed."));
+      }
+    } finally {
+      setPending(false);
+    }
+  }
+
+  async function retryRefresh() {
+    try {
+      await refresh();
+      setRefreshError(false);
+      onOpenChange(false);
+    } catch {
+      setRefreshError(true);
+    }
+  }
+
+  async function retryLoad() {
+    try {
+      await Promise.all([refresh(), walletMetadata.refresh()]);
+      setError(null);
+    } catch {
+      setError("Wallet details still could not load. Try again.");
+    }
+  }
+
+  const label = status === "completed" ? "Complete goal" : "Cancel goal";
+  const walletDataError = Boolean(isError || walletMetadata.error);
+  const busy = pending || walletMetadata.isLoading || isLoading;
+  const disabled = busy || goal?.status !== "active" || goal.review_state !== "confirmed" || unknownOutcome.current;
+  return (
+    <Dialog.Root open={open} onOpenChange={nextOpen => { if (!pending) onOpenChange(nextOpen); }}>
+      <Dialog.Portal>
+        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
+        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
+          <Dialog.Title className="text-lg font-semibold">{label}</Dialog.Title>
+          <Dialog.Description className="mt-1 text-sm text-muted-foreground">{goal?.name ?? "Goal"} will keep its recorded spending in history.</Dialog.Description>
+          {leftoverCents > 0 && (
+            <div className="mt-4 space-y-3 rounded-lg border border-border/70 p-3">
+              <p className="text-sm font-medium">PHP {leftovers} remains reserved</p>
+              <ul className="space-y-1 text-xs text-muted-foreground">
+                {(goal?.walletReservations ?? []).map(item => <li key={item.accountId}>{walletNames.get(item.accountId) ?? "Wallet"}: PHP {item.amount}</li>)}
+              </ul>
+              <p className="text-sm">Choose what happens to the remainder.</p>
+              <label className="flex min-h-11 items-center gap-2 text-sm">
+                <input type="radio" name="goal-leftovers" value="release" checked={choice === "release"} onChange={() => setChoice("release")} disabled={disabled || walletDataError} />
+                Release leftovers to available funds
+              </label>
+              <label className="flex min-h-11 items-center gap-2 text-sm">
+                <input type="radio" name="goal-leftovers" value="move" checked={choice === "move"} onChange={() => setChoice("move")} disabled={disabled || walletDataError} />
+                Move leftovers to another goal
+              </label>
+              {choice === "move" && (
+                <div className="space-y-1.5">
+                  <label htmlFor="goal-close-destination" className="text-sm font-medium">Move to goal</label>
+                  <select id="goal-close-destination" value={destinationGoalId} onChange={event => setDestinationGoalId(event.target.value)} disabled={disabled || walletDataError} className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
+                    <option value="">Choose a goal</option>
+                    {destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
+                  </select>
+                </div>
+              )}
+            </div>
+          )}
+          {leftoverCents === 0 && <p className="mt-4 text-sm text-muted-foreground">No reservations remain. Your recorded spending stays in history.</p>}
+          {walletDataError && leftoverCents > 0 && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive">Wallet details could not load, so the remaining funds cannot be reviewed.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => void retryLoad()}>Retry loading</Button></div>}
+          {busy && !pending && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading wallet details…</p>}
+          {error && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
+          {refreshError ? (
+            <div className="mt-4 space-y-3" role="status">
+              <p className="text-sm text-amber-700 dark:text-amber-300">Saved, but the goal summary could not refresh.</p>
+              <Button type="button" className="h-11 min-h-11" onClick={() => void retryRefresh()}>Retry refresh</Button>
+            </div>
+          ) : (
+            <form onSubmit={submit} className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
+              <Button type="button" variant="outline" className="h-11 min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
+              <Button type="submit" className="h-11 min-h-11" disabled={pending || (!recoveringUnknown && (busy || (walletDataError && leftoverCents > 0) || goal?.status !== "active" || goal.review_state !== "confirmed"))}>{pending ? "Saving…" : recoveringUnknown ? "Retry same request" : label}</Button>
+            </form>
+          )}
+        </Dialog.Content>
+      </Dialog.Portal>
+    </Dialog.Root>
+  );
+}
diff --git a/src/components/goals/GoalFundsDialog.tsx b/src/components/goals/GoalFundsDialog.tsx
new file mode 100644
index 0000000..e020180
--- /dev/null
+++ b/src/components/goals/GoalFundsDialog.tsx
@@ -0,0 +1,212 @@
+"use client";
+
+import React, { useEffect, useMemo, useRef, useState } from "react";
+import * as Dialog from "@radix-ui/react-dialog";
+import { Button } from "@/components/ui/button";
+import { Input } from "@/components/ui/input";
+import { useGoals } from "@/hooks/use-goals";
+import { useGoalWalletMetadata } from "@/hooks/use-goal-finance";
+import { FinancialCommandError, financialCommandMessage } from "@/lib/goals/client";
+import { parseMoney, toMinorUnits } from "@/lib/goals/summary";
+import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
+import type { FinancialCommand, Money } from "@/lib/goals/contracts";
+
+type GoalFundsMode = "reserve" | "release" | "move";
+
+interface GoalFundsDialogProps {
+  goalId: string;
+  mode: GoalFundsMode;
+  open: boolean;
+  onOpenChange: (open: boolean) => void;
+}
+
+const titles: Record<GoalFundsMode, string> = {
+  reserve: "Set aside",
+  release: "Release funds",
+  move: "Move reservation",
+};
+
+export function GoalFundsDialog({ goalId, mode, open, onOpenChange }: GoalFundsDialogProps) {
+  const { goals, userId, financeSnapshot, refresh, isLoading, isError } = useGoals();
+  const walletMetadata = useGoalWalletMetadata(userId);
+  const [accountId, setAccountId] = useState("");
+  const [destinationGoalId, setDestinationGoalId] = useState("");
+  const [amountText, setAmountText] = useState("");
+  const [pending, setPending] = useState(false);
+  const [error, setError] = useState<string | null>(null);
+  const [refreshError, setRefreshError] = useState(false);
+  const requestId = useRef<string | null>(null);
+  const retryCommand = useRef<FinancialCommand | null>(null);
+  const unknownOutcome = useRef(false);
+  const recoveringUnknown = unknownOutcome.current && retryCommand.current !== null;
+  const opener = useRef<HTMLElement | null>(null);
+
+  const goal = goals.find(item => item.id === goalId);
+  const wallets = useMemo(() => {
+    if (!financeSnapshot) return [];
+    return financeSnapshot.wallets.flatMap(wallet => {
+      const eligibleAmount = mode === "reserve"
+        ? wallet.available
+        : goal?.walletReservations.find(item => item.accountId === wallet.accountId)?.amount ?? "0.00";
+      if (toMinorUnits(eligibleAmount) <= 0) return [];
+      const metadata = walletMetadata.data?.find(item => item.id === wallet.accountId);
+      if (!metadata || !metadata.is_active || metadata.currency !== "PHP" || metadata.type === "credit_card") return [];
+      return [{ ...wallet, eligibleAmount, name: metadata?.name ?? "Wallet" }];
+    });
+  }, [financeSnapshot, goal?.walletReservations, mode, walletMetadata.data]);
+  const activeDestinations = goals.filter(item => item.id !== goalId && item.status === "active" && item.review_state === "confirmed" && item.archived_at === null);
+  const selectedWallet = wallets.find(wallet => wallet.accountId === accountId);
+
+  useEffect(() => {
+    if (!open) return;
+    setAccountId("");
+    setDestinationGoalId("");
+    setAmountText("");
+    setError(unknownOutcome.current ? "The previous save has an unknown result. Retry it to confirm the same request." : null);
+    setRefreshError(false);
+  }, [goalId, mode, open]);
+
+  async function retryRefresh() {
+    try {
+      await refresh();
+      setRefreshError(false);
+      onOpenChange(false);
+    } catch {
+      setRefreshError(true);
+    }
+  }
+
+  async function retryLoad() {
+    try {
+      await Promise.all([refresh(), walletMetadata.refresh()]);
+      setError(null);
+    } catch {
+      setError("Wallet balances or details still could not load. Try again.");
+    }
+  }
+
+  async function submit(event: React.FormEvent) {
+    event.preventDefault();
+    setError(null);
+    let command = retryCommand.current;
+    if (!command) {
+      if (!goal || goal.status !== "active" || goal.review_state !== "confirmed") {
+        setError("Confirm this goal before changing its reservations.");
+        return;
+      }
+      if (!selectedWallet) {
+        setError(mode === "reserve" ? "Choose a wallet with available funds." : "Choose a wallet with funds reserved for this goal.");
+        return;
+      }
+      let amount: Money;
+      try {
+        amount = parseMoney(amountText.trim());
+        if (toMinorUnits(amount) <= 0 || toMinorUnits(amount) > toMinorUnits(selectedWallet.eligibleAmount)) {
+          throw new Error(mode === "reserve" ? "Enter an amount within the wallet's available balance." : "Enter an amount within this goal's reserved balance.");
+        }
+      } catch (cause) {
+        setError(cause instanceof Error ? cause.message : "Enter a valid amount.");
+        return;
+      }
+      if (mode === "move" && !activeDestinations.some(item => item.id === destinationGoalId)) {
+        setError("Choose an active goal to receive these funds.");
+        return;
+      }
+      command = mode === "move"
+        ? { kind: "reallocate", goalId, destinationGoalId, accountId, amount }
+        : { kind: mode, goalId, accountId, amount };
+      requestId.current = crypto.randomUUID();
+      retryCommand.current = command;
+    }
+
+    if (!requestId.current) requestId.current = crypto.randomUUID();
+    setPending(true);
+    try {
+      const outcome = await applyAndRefreshFinancialCommand(requestId.current, command, undefined, refresh);
+      requestId.current = null;
+      retryCommand.current = null;
+      unknownOutcome.current = false;
+      if (outcome.refreshError) {
+        setRefreshError(true);
+        return;
+      }
+      onOpenChange(false);
+    } catch (cause) {
+      if (cause instanceof FinancialCommandError && cause.outcome === "unknown") {
+        unknownOutcome.current = true;
+        setError("We could not confirm whether this was saved. Retry this same request before starting another one.");
+      } else {
+        requestId.current = null;
+        retryCommand.current = null;
+        unknownOutcome.current = false;
+        setError(financialCommandMessage(cause, "The reservation could not be saved."));
+      }
+    } finally {
+      setPending(false);
+    }
+  }
+
+  const busy = pending || walletMetadata.isLoading || isLoading;
+  const disabledForGoal = !goal || goal.status !== "active" || goal.review_state !== "confirmed";
+  const walletDataError = Boolean(isError || walletMetadata.error);
+
+  return (
+    <Dialog.Root open={open} onOpenChange={nextOpen => { if (!pending) onOpenChange(nextOpen); }}>
+      <Dialog.Portal>
+        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
+        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
+          <Dialog.Title className="text-lg font-semibold">{titles[mode]}</Dialog.Title>
+          <Dialog.Description className="mt-1 text-sm text-muted-foreground">{goal?.name ?? "Goal"} · PHP amounts</Dialog.Description>
+
+          {error && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
+          {walletDataError && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive">Wallet balances or details could not load. Reservation options are unavailable.</p><Button type="button" variant="outline" onClick={() => void retryLoad()}>Retry loading</Button></div>}
+          {busy && !pending && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading wallet balances…</p>}
+          {refreshError ? (
+            <div className="mt-4 space-y-3" role="status">
+              <p className="text-sm text-amber-700 dark:text-amber-300">Saved, but the goal summary could not refresh.</p>
+              <Button type="button" className="h-11 min-h-11" onClick={() => void retryRefresh()}>Retry refresh</Button>
+            </div>
+          ) : (
+            <form onSubmit={submit} className="mt-5 space-y-4">
+              <fieldset disabled={busy || walletDataError || disabledForGoal || unknownOutcome.current} className="space-y-4">
+                <div className="space-y-1.5">
+                  <label htmlFor="goal-funds-wallet" className="text-sm font-medium">Wallet</label>
+                  <select id="goal-funds-wallet" value={accountId} onChange={event => setAccountId(event.target.value)} className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
+                    <option value="">Choose a wallet</option>
+                    {wallets.map(wallet => <option key={wallet.accountId} value={wallet.accountId}>{wallet.name}</option>)}
+                  </select>
+                  {selectedWallet && <p className="text-xs text-muted-foreground">{mode === "reserve" ? "Available" : "Reserved for this goal"}: PHP {selectedWallet.eligibleAmount}</p>}
+                  {!busy && !walletDataError && wallets.length === 0 && <p className="text-xs text-muted-foreground">{mode === "reserve" ? "No wallet has money available to set aside." : "This goal has no reserved funds in a wallet."}</p>}
+                </div>
+
+                {mode === "move" && (
+                  <div className="space-y-1.5">
+                    <label htmlFor="goal-funds-destination" className="text-sm font-medium">Move to goal</label>
+                    <select id="goal-funds-destination" value={destinationGoalId} onChange={event => setDestinationGoalId(event.target.value)} className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
+                      <option value="">Choose a goal</option>
+                      {activeDestinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
+                    </select>
+                  </div>
+                )}
+
+                <div className="space-y-1.5">
+                  <label htmlFor="goal-funds-amount" className="text-sm font-medium">Amount (PHP)</label>
+                  <Input id="goal-funds-amount" type="text" inputMode="decimal" autoComplete="off" value={amountText} onChange={event => setAmountText(event.target.value)} placeholder="0.00" />
+                  <p className="text-xs text-muted-foreground">Enter an amount up to PHP {selectedWallet?.eligibleAmount ?? "0.00"}.</p>
+                </div>
+                {disabledForGoal && <p className="text-sm text-amber-700 dark:text-amber-300">This goal must be active and confirmed before you can change its reservations.</p>}
+              </fieldset>
+
+              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
+                <Button type="button" variant="outline" className="h-11 min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
+                <Button type="submit" className="h-11 min-h-11" disabled={pending || (!recoveringUnknown && (busy || walletDataError || disabledForGoal || wallets.length === 0))}>
+                  {pending ? "Saving…" : recoveringUnknown ? "Retry same request" : titles[mode]}
+                </Button>
+              </div>
+            </form>
+          )}
+        </Dialog.Content>
+      </Dialog.Portal>
+    </Dialog.Root>
+  );
+}
diff --git a/src/components/goals/GoalHistoryDialog.tsx b/src/components/goals/GoalHistoryDialog.tsx
new file mode 100644
index 0000000..f4061c0
--- /dev/null
+++ b/src/components/goals/GoalHistoryDialog.tsx
@@ -0,0 +1,95 @@
+"use client";
+
+import React, { useRef } from "react";
+import * as Dialog from "@radix-ui/react-dialog";
+import { Button } from "@/components/ui/button";
+import { Skeleton } from "@/components/ui/skeleton";
+import { useGoalHistory } from "@/hooks/use-goal-finance";
+import { useGoals } from "@/hooks/use-goals";
+import type { GoalHistoryEntry } from "@/lib/goals/client";
+
+interface GoalHistoryDialogProps {
+  goalId: string;
+  open: boolean;
+  onOpenChange: (open: boolean) => void;
+}
+
+function signedAmount(value: string): string {
+  const negative = value.startsWith("-");
+  const amount = negative ? value.slice(1) : value;
+  return `${negative ? "−" : "+"}PHP ${amount}`;
+}
+
+function eventTitle(entry: GoalHistoryEntry): string {
+  if (entry.kind === "transaction_reversal") return "Transaction reversed";
+  if (entry.kind === "reversal") return "Reversal";
+  if (entry.kind === "release" && entry.operationKind === "transaction") return "Confirmed automatic release";
+  if (entry.kind === "reserve") return "Set aside";
+  if (entry.kind === "release") return "Release funds";
+  if (entry.kind === "spend" || entry.kind === "legacy_spent") return entry.kind === "legacy_spent" ? "Imported past spending" : "Spending from goal";
+  if (entry.kind === "move_in" || entry.kind === "move_out") return "Move reservation";
+  return "Goal allocation";
+}
+
+function eventAmounts(entry: GoalHistoryEntry): string[] {
+  const amounts = [];
+  if (entry.reserved_delta !== "0.00") amounts.push(`${signedAmount(entry.reserved_delta)} reserved`);
+  if (entry.spent_delta !== "0.00") amounts.push(`${signedAmount(entry.spent_delta)} spent`);
+  return amounts;
+}
+
+export function GoalHistoryDialog({ goalId, open, onOpenChange }: GoalHistoryDialogProps) {
+  const opener = useRef<HTMLElement | null>(null);
+  const { userId, goals } = useGoals();
+  const history = useGoalHistory(userId, open ? goalId : null);
+  const goal = goals.find(item => item.id === goalId);
+  const title = `${goal?.name ?? "Goal"} history`;
+  const originalKind = new Map((history.data ?? []).map(entry => [entry.id, entry.kind]));
+
+  return (
+    <Dialog.Root open={open} onOpenChange={onOpenChange}>
+      <Dialog.Portal>
+        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
+        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
+          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
+          <Dialog.Description className="mt-1 text-sm text-muted-foreground">Wallet reservations and goal spending, in time order.</Dialog.Description>
+
+          <div className="mt-5">
+            {history.isLoading ? (
+              <div role="status" aria-label="Loading goal history" className="space-y-3">
+                {[0, 1, 2].map(index => <div key={index} className="space-y-2 border-b border-border/50 pb-3"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-52" /></div>)}
+              </div>
+            ) : history.error ? (
+              <div className="space-y-3"><p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Goal history could not load.</p><Button type="button" variant="outline" className="h-11 min-h-11" onClick={() => void history.refresh()}>Retry loading</Button></div>
+            ) : (history.data ?? []).length === 0 ? (
+              <p className="py-8 text-center text-sm text-muted-foreground">No reservation or spending history yet.</p>
+            ) : (
+              <ol className="divide-y divide-border/50">
+                {history.data?.map(entry => (
+                  <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
+                    <div className="flex items-start justify-between gap-4">
+                      <div className="min-w-0 space-y-1">
+                        <p className="text-sm font-medium">{eventTitle(entry)}</p>
+                        <p className="text-xs text-muted-foreground">{entry.accountName}</p>
+                        {entry.transaction_id && <p className="text-xs text-muted-foreground">Transaction reference retained</p>}
+                        {entry.kind === "transaction_reversal" && <p className="text-xs text-muted-foreground">The linked transaction was removed; this history entry records the reversal.</p>}
+                        {entry.reversal_of && <p className="text-xs text-muted-foreground">Reversed {originalKind.get(entry.reversal_of) ?? "an earlier entry"}</p>}
+                      </div>
+                      <div className="shrink-0 text-right">
+                        {eventAmounts(entry).map(amount => <p key={amount} className="text-xs tabular-nums">{amount}</p>)}
+                        <time dateTime={entry.created_at} className="mt-1 block text-[11px] text-muted-foreground">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(entry.created_at))}</time>
+                      </div>
+                    </div>
+                  </li>
+                ))}
+              </ol>
+            )}
+          </div>
+          <div className="mt-5 flex justify-end">
+            <Button type="button" variant="outline" className="h-11 min-h-11" onClick={() => onOpenChange(false)}>Close</Button>
+          </div>
+        </Dialog.Content>
+      </Dialog.Portal>
+    </Dialog.Root>
+  );
+}
diff --git a/src/hooks/use-goal-finance.ts b/src/hooks/use-goal-finance.ts
index b72e139..5fe200a 100644
--- a/src/hooks/use-goal-finance.ts
+++ b/src/hooks/use-goal-finance.ts
@@ -1,13 +1,13 @@
 import { useCallback, useEffect, useRef, useState } from "react";
 import useSWR, { useSWRConfig } from "swr";
-import { fetchGoalFinance } from "@/lib/goals/client";
+import { fetchGoalFinance, fetchGoalHistory, fetchGoalWalletMetadata } from "@/lib/goals/client";
 import type { GoalFinanceSnapshot } from "@/lib/goals/contracts";
 import { refreshFinancialData } from "@/lib/refresh-financial-data";
 import { createClient } from "@/lib/supabase/client";
 
 export function useGoalFinance(userId: string | null) {
   const { mutate: mutateCache } = useSWRConfig();
   const { cache } = useSWRConfig();
   const [snapshotUserId, setSnapshotUserId] = useState(userId);
   const selectedUser = useRef({ userId, revision: 0 });
   if (selectedUser.current.userId !== userId) {
@@ -32,23 +32,36 @@ export function useGoalFinance(userId: string | null) {
   useEffect(() => {
     const { data: { subscription } } = createClient().auth.onAuthStateChange(event => {
       if (event !== "INITIAL_SESSION") sessionRevision.current += 1;
     });
     return () => subscription.unsubscribe();
   }, []);
 
   useEffect(() => {
     if (userId !== null) return;
     void mutateCache(
-      cacheKey => Array.isArray(cacheKey) && (cacheKey[0] === "goalFinance" || cacheKey[0] === "goalHistory"),
+      cacheKey => Array.isArray(cacheKey) && (cacheKey[0] === "goalFinance" || cacheKey[0] === "goalHistory" || cacheKey[0] === "goalWalletMetadata"),
       () => undefined,
       { populateCache: true, revalidate: false },
     );
   }, [mutateCache, userId]);
 
   const refresh = useCallback(async () => {
     if (userId === null) return;
     await refreshFinancialData(userId, mutateCache, cache);
   }, [cache, mutateCache, userId]);
 
-  return { data: snapshotUserId === userId ? cachedData : undefined, isLoading, error, refresh, mutate };
+  const data = snapshotUserId === userId ? cachedData : undefined;
+  return { data, snapshot: data, userId, isLoading, error, refresh, mutate };
+}
+
+export function useGoalWalletMetadata(userId: string | null) {
+  const key = userId ? ["goalWalletMetadata", userId] as const : null;
+  const { data, error, isLoading, mutate } = useSWR(key, ([, scopedUserId]) => fetchGoalWalletMetadata(scopedUserId));
+  return { data: userId ? data : undefined, error, isLoading, refresh: mutate };
+}
+
+export function useGoalHistory(userId: string | null, goalId: string | null) {
+  const key = userId && goalId ? ["goalHistory", userId, goalId] as const : null;
+  const { data, error, isLoading, mutate } = useSWR(key, ([, scopedUserId, scopedGoalId]) => fetchGoalHistory(scopedUserId, scopedGoalId));
+  return { data: userId && goalId ? data : undefined, error, isLoading, refresh: mutate };
 }
diff --git a/src/hooks/use-goals.ts b/src/hooks/use-goals.ts
index bb1b23f..4d96cff 100644
--- a/src/hooks/use-goals.ts
+++ b/src/hooks/use-goals.ts
@@ -57,21 +57,21 @@ export function getProjection(goal: GoalWithProgress): ProjectionResult {
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
-    is_completed: goal.status === "completed" || goal.is_completed,
+    is_completed: goal.status === "completed",
   };
 }
 
 function orderGoals(goals: GoalWithProgress[]): GoalWithProgress[] {
   return goals.filter(goal => goal.archived_at === null).sort((left, right) => {
     if (left.is_priority !== right.is_priority) return Number(right.is_priority) - Number(left.is_priority);
     if (left.target_date === null) return right.target_date === null ? 0 : 1;
     if (right.target_date === null) return -1;
     return left.target_date.localeCompare(right.target_date);
   });
@@ -143,19 +143,22 @@ export function useGoals() {
   }) => applyAndRefreshFinancialCommand(crypto.randomUUID(), command, undefined, finance.refresh);
 
   const deleteGoal = async (id: string) => runLifecycleCommand({ kind: "archive", goalId: id });
 
   const toggleComplete = async (id: string, completed: boolean) => completed
     ? runLifecycleCommand({ kind: "close", goalId: id, status: "completed", leftovers: null })
     : runLifecycleCommand({ kind: "reopen", goalId: id });
 
   return {
     goals,
+    userId,
+    financeSnapshot: finance.data,
+    refresh: finance.refresh,
     isLoading: userIsLoading || finance.isLoading,
     isError: userError ?? finance.error,
     createGoal,
     updateGoal,
     deleteGoal,
     toggleComplete,
     mutate: finance.mutate,
   };
 }
diff --git a/src/lib/goals/client.ts b/src/lib/goals/client.ts
index 56928ee..bc83ba1 100644
--- a/src/lib/goals/client.ts
+++ b/src/lib/goals/client.ts
@@ -1,23 +1,25 @@
 import { z } from "zod";
 import { createClient } from "@/lib/supabase/client";
 import {
   FinancialCommandSchema,
   FinancialErrorCodeSchema,
   FinancialResultSchema,
+  AllocationEventSchema,
   GoalFinanceSnapshotSchema,
   ReleaseLineSchema,
   TransactionDraftSchema,
   TransactionQuoteSchema,
   type FinancialCommand,
   type FinancialErrorCode,
   type FinancialResult,
+  type AllocationEvent,
   type GoalFinanceSnapshot,
   type ReleaseLine,
   type TransactionDraft,
   type TransactionQuote,
 } from "./contracts";
 
 export { parseMoney, toMinorUnits, fromMinorUnits, summarizeGoal } from "./summary";
 
 export class FinancialCommandError extends Error {
   readonly code: FinancialErrorCode | "TRANSPORT_ERROR";
@@ -32,27 +34,169 @@ export class FinancialCommandError extends Error {
     cause?: unknown;
   }) {
     super(options.message, { cause: options.cause });
     this.name = "FinancialCommandError";
     this.code = options.code ?? "TRANSPORT_ERROR";
     this.hint = options.hint ?? null;
     this.outcome = options.outcome;
   }
 }
 
+export function financialCommandMessage(error: unknown, fallback: string): string {
+  if (!(error instanceof FinancialCommandError)) return error instanceof Error ? error.message : fallback;
+  if (error.hint?.trim()) return error.hint.trim();
+  const guidance: Partial<Record<FinancialCommandError["code"], string>> = {
+    INSUFFICIENT_ACTUAL: "This wallet does not have enough money for that amount.",
+    INSUFFICIENT_AVAILABLE: "The wallet has less available money now. Review the amount and try again.",
+    INSUFFICIENT_RESERVATION: "This goal has less reserved money in that wallet now. Review the amount and try again.",
+    STALE_QUOTE: "The financial details changed. Review them and try again.",
+    NEEDS_REVIEW: "Review and confirm this goal before changing its reservations.",
+    INVALID_STATE: "This goal or wallet can no longer use that action.",
+    REQUEST_CONFLICT: "This save request conflicts with an earlier attempt. Refresh the goal and try again.",
+    NOT_ALLOWED: "That wallet or goal is not available for this action.",
+  };
+  return guidance[error.code] ?? fallback;
+}
+
 export class SupersededGoalFinanceRequestError extends Error {
   constructor() {
     super("The signed-in user changed while the goal snapshot was loading.");
     this.name = "SupersededGoalFinanceRequestError";
   }
 }
 
+export type GoalWalletMetadata = { id: string; name: string; type: string; currency: string; is_active: boolean };
+export type GoalHistoryEntry = Omit<AllocationEvent, "kind"> & {
+  kind: AllocationEvent["kind"] | "transaction_reversal";
+  accountName: string;
+  operationKind: FinancialCommand["kind"] | null;
+};
+
+function normalizeDatabaseDecimal(value: unknown): string {
+  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) {
+    throw new Error("Allocation history contains an invalid decimal amount.");
+  }
+  const negative = value.startsWith("-");
+  const unsigned = negative ? value.slice(1) : value;
+  const [whole, fraction = ""] = unsigned.split(".");
+  const normalized = `${whole}.${fraction.padEnd(2, "0")}`;
+  return negative && normalized !== "0.00" ? `-${normalized}` : normalized;
+}
+
+export async function fetchGoalWalletMetadata(userId: string): Promise<GoalWalletMetadata[]> {
+  const { data, error } = await (createClient() as any)
+    .from("accounts")
+    .select("id,name,type,currency,is_active")
+    .eq("user_id", userId)
+    .eq("is_active", true)
+    .order("display_order", { ascending: true });
+  if (error) throw error;
+  if (!Array.isArray(data) || data.some(row => typeof row?.id !== "string" || typeof row?.name !== "string" ||
+    typeof row?.type !== "string" || typeof row?.currency !== "string" || typeof row?.is_active !== "boolean")) {
+    throw new Error("Wallet details could not be read.");
+  }
+  return data.map(({ id, name, type, currency, is_active }) => ({ id, name, type, currency, is_active }));
+}
+
+export async function fetchGoalHistory(userId: string, goalId: string): Promise<GoalHistoryEntry[]> {
+  const db = createClient() as any;
+  const { data: rawEvents, error: eventError } = await db.from("goal_allocation_events")
+    .select("id,user_id,goal_id,account_id,operation_id,kind,reserved_delta::text,spent_delta::text,transaction_id,reversal_of,created_at")
+    .eq("user_id", userId)
+    .eq("goal_id", goalId)
+    .order("created_at", { ascending: false });
+  if (eventError) throw eventError;
+  if (!Array.isArray(rawEvents)) throw new Error("Goal history could not be read.");
+
+  const events = rawEvents.map((row: Record<string, unknown>) => AllocationEventSchema.parse({
+    ...row,
+    reserved_delta: normalizeDatabaseDecimal(row.reserved_delta),
+    spent_delta: normalizeDatabaseDecimal(row.spent_delta),
+  }));
+  const accountIds = Array.from(new Set(events.map(event => event.account_id)));
+  const operationIds = Array.from(new Set(events.map(event => event.operation_id)));
+  const [accountResult, sourceOperationResult] = await Promise.all([
+    accountIds.length === 0 ? Promise.resolve({ data: [], error: null }) : db.from("accounts")
+      .select("id,name,type,currency,is_active")
+      .eq("user_id", userId)
+      .in("id", accountIds),
+    operationIds.length === 0 ? Promise.resolve({ data: [], error: null }) : db.from("financial_operations")
+      .select("id,command,result,created_at")
+      .eq("user_id", userId)
+      .in("id", operationIds),
+  ]);
+  if (accountResult.error) throw accountResult.error;
+  if (sourceOperationResult.error) throw sourceOperationResult.error;
+  const accountNames = new Map<string, string>((accountResult.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name]));
+  type OperationRow = { id: string; command: { kind?: unknown; transactionId?: unknown }; result?: { transactionIds?: unknown }; created_at: string };
+  const sourceOperations = (sourceOperationResult.data ?? []) as OperationRow[];
+  const sourceOperationsById = new Map<string, OperationRow>(sourceOperations.map(row => [row.id, row]));
+  const transactionIds = Array.from(new Set(events.flatMap(event => {
+    if (event.transaction_id) return [event.transaction_id];
+    const operation = sourceOperationsById.get(event.operation_id);
+    return Array.isArray(operation?.result?.transactionIds)
+      ? operation.result.transactionIds.filter((value): value is string => typeof value === "string")
+      : [];
+  })));
+  const reversalOperationsResult = transactionIds.length === 0 ? { data: [], error: null } : await db.from("financial_operations")
+    .select("id,command,result,created_at")
+    .eq("user_id", userId)
+    .in("command->>transactionId", transactionIds);
+  if (reversalOperationsResult.error) throw reversalOperationsResult.error;
+  const reversalOperations = (reversalOperationsResult.data ?? []) as OperationRow[];
+  const operationRows = [...sourceOperations, ...reversalOperations];
+  const operationKinds = new Map<string, FinancialCommand["kind"] | null>(operationRows.map((row) => [
+    row.id,
+    typeof row.command?.kind === "string" && ["reserve", "release", "reallocate", "close", "reopen", "archive", "transaction", "delete_transaction", "adopt_legacy"].includes(row.command.kind)
+      ? row.command.kind as FinancialCommand["kind"]
+      : null,
+  ]));
+  const deleteOperationByTransactionId = new Map<string, OperationRow>();
+  for (const row of reversalOperations) {
+    const command = row.command;
+    if (command?.kind === "delete_transaction" && typeof command.transactionId === "string") {
+      deleteOperationByTransactionId.set(command.transactionId, row);
+    }
+  }
+  const rows: GoalHistoryEntry[] = events.map(event => ({
+    ...event,
+    accountName: accountNames.get(event.account_id) ?? "Wallet",
+    operationKind: operationKinds.get(event.operation_id) ?? null,
+  }));
+  const reversedEventIds = new Set(events.filter(event => event.kind === "reversal" && event.reversal_of !== null).map(event => event.reversal_of));
+  for (const event of events) {
+    if (reversedEventIds.has(event.id)) continue;
+    const source = sourceOperationsById.get(event.operation_id);
+    const linkedIds = event.transaction_id ? [event.transaction_id] : Array.isArray(source?.result?.transactionIds)
+      ? source.result.transactionIds.filter((value): value is string => typeof value === "string")
+      : [];
+    for (const transactionId of linkedIds) {
+      const deletion = deleteOperationByTransactionId.get(transactionId);
+      if (!deletion) continue;
+      rows.push({
+        ...event,
+        id: `${deletion.id}:${event.id}`,
+        operation_id: deletion.id,
+        kind: "transaction_reversal",
+        reserved_delta: "0.00",
+        spent_delta: "0.00",
+        transaction_id: transactionId,
+        reversal_of: null,
+        created_at: deletion.created_at,
+        accountName: accountNames.get(event.account_id) ?? "Wallet",
+        operationKind: "delete_transaction",
+      });
+    }
+  }
+  return rows.sort((left, right) => right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id));
+}
+
 const requestIdSchema = z.string().uuid();
 
 function readServerError(error: unknown, ambiguousOutcome = false): FinancialCommandError {
   if (typeof error === "object" && error !== null) {
     const response = error as { message?: unknown; hint?: unknown; status?: unknown };
     const message = typeof response.message === "string" ? response.message : "The server rejected the financial command.";
     const codeMatch = message.match(/\b(INSUFFICIENT_ACTUAL|INSUFFICIENT_AVAILABLE|INSUFFICIENT_RESERVATION|STALE_QUOTE|NEEDS_REVIEW|INVALID_STATE|REQUEST_CONFLICT|NOT_ALLOWED)\b/);
     const code = codeMatch ? FinancialErrorCodeSchema.parse(codeMatch[1]) : undefined;
     const status = typeof response.status === "number" ? response.status : null;
     const uncertainResponse = ambiguousOutcome && (
diff --git a/src/lib/refresh-financial-data.ts b/src/lib/refresh-financial-data.ts
index 44780db..e38562d 100644
--- a/src/lib/refresh-financial-data.ts
+++ b/src/lib/refresh-financial-data.ts
@@ -16,21 +16,21 @@ export class FinancialRefreshError extends Error {
  * exists for legacy refresh-only flows that do not return a save outcome.
  */
 export async function refreshFinancialData(userId?: string, mutateCache: ScopedMutator = mutate, cache?: Cache) {
   const matchingKeys: unknown[] = [];
   const knownKeys = new Set<string>();
   const matchesKey = (key: unknown) => {
     if (typeof key === "string") {
       return key === "goals" || key === "accounts" || key === "recentTransactions" || key.startsWith("dashboardStats-");
     }
     if (!Array.isArray(key)) return false;
-    if (key[0] === "goalFinance" || key[0] === "goalHistory") return userId === undefined || key[1] === userId;
+    if (key[0] === "goalFinance" || key[0] === "goalHistory" || key[0] === "goalWalletMetadata") return userId === undefined || key[1] === userId;
     return false;
   };
   const rememberMatchingKey = (key: unknown) => {
     if (!matchesKey(key)) return false;
     const serialized = unstable_serialize(key as Key);
     if (!knownKeys.has(serialized)) {
       knownKeys.add(serialized);
       matchingKeys.push(key);
     }
     return true;
diff --git a/tests/contributions.test.tsx b/tests/contributions.test.tsx
index 088fbb5..29745f4 100644
--- a/tests/contributions.test.tsx
+++ b/tests/contributions.test.tsx
@@ -178,31 +178,31 @@ test("legacy goal-tagged installments remain history and do not reserve funds",
   await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe("0/0"));
   view.unmount();
   render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} /></SWRConfig>);
   await screen.findByRole("option", { name: "Cash" });
   await user.type(screen.getByLabelText("Amount"), "50");
   await user.click(screen.getByRole("button", { name: "Add Transaction" }));
   await waitFor(() => expect(db.transactions).toHaveLength(4));
   expect(db.transactions[3].goal_id).toBeNull();
 });
 
-test("page fixtures render summaries and expose a working contribution shortcut", async () => {
+test("page fixtures render summaries and expose a working spend-from-goal shortcut", async () => {
   function save(name: string) {
     if (!process.env.MONETIGIA_VISUAL_FIXTURES) return;
     mkdirSync(".superpowers/visual-check", { recursive: true });
     writeFileSync(`.superpowers/visual-check/${name}.html`, document.body.innerHTML);
   }
   const user = userEvent.setup();
   const goals = render(<SWRConfig value={config}><GoalsPage /></SWRConfig>);
-  await screen.findAllByRole("button", { name: "Add contribution" });
+  await screen.findAllByRole("button", { name: "Spend from goal" });
   save("goals");
-  await user.click(screen.getAllByRole("button", { name: "Add contribution" })[0]);
+  await user.click(screen.getAllByRole("button", { name: "Spend from goal" })[0]);
   await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe(db.phoneId));
   save("contribution");
   goals.unmount();
   const dashboard = render(<DashboardPage />);
   expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
   save("dashboard");
   dashboard.unmount();
   const accounts = render(<AccountsPage />);
   save("wallets-loading");
   await screen.findAllByText("Cash", { exact: true });
diff --git a/tests/goal-actions.test.tsx b/tests/goal-actions.test.tsx
new file mode 100644
index 0000000..ef7c632
--- /dev/null
+++ b/tests/goal-actions.test.tsx
@@ -0,0 +1,366 @@
+import React from "react";
+import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
+import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
+import userEvent from "@testing-library/user-event";
+
+const state = vi.hoisted(() => ({
+  finance: null as any,
+  refresh: vi.fn(),
+  apply: vi.fn(),
+  accounts: [] as any[],
+  events: [] as any[],
+  operations: [] as any[],
+  walletError: null as any,
+  financeError: null as any,
+  historyError: null as any,
+  readCalls: [] as any[],
+}));
+
+vi.mock("@/hooks/use-goal-finance", () => ({
+  useGoalFinance: () => ({ data: state.finance, snapshot: state.finance, userId: "10000000-0000-4000-8000-000000000001", refresh: state.refresh, isLoading: false, error: null }),
+  useGoalHistory: () => ({ data: state.events, isLoading: false, error: state.historyError, refresh: state.refresh }),
+  useGoalWalletMetadata: () => ({ data: state.accounts, isLoading: false, error: state.walletError, refresh: state.refresh }),
+}));
+
+vi.mock("@/hooks/use-goals", () => ({
+  useGoals: () => ({ goals: state.finance?.goals ?? [], financeSnapshot: state.finance, userId, refresh: state.refresh, isLoading: false, isError: state.financeError }),
+  getProjection: () => ({ count: 0, unit: "months", projectedDate: null, monthlyAmount: 0, kinsenasAmount: 0 }),
+}));
+
+vi.mock("@/lib/goals/client", async importOriginal => {
+  const actual = await importOriginal<typeof import("@/lib/goals/client")>();
+  return { ...actual, applyFinancialCommand: state.apply };
+});
+
+vi.mock("@/lib/supabase/client", () => ({
+  createClient: () => ({ from: (table: string) => {
+    const builder: any = {
+      select: (columns: string) => { state.readCalls.push({ table, method: "select", columns }); return builder; },
+      eq: (column: string, value: string) => { state.readCalls.push({ table, method: "eq", column, value }); return builder; },
+      in: (column: string, values: string[]) => { state.readCalls.push({ table, method: "in", column, values }); return builder; },
+      order: (column: string) => { state.readCalls.push({ table, method: "order", column }); return builder; },
+      then: (resolve: any, reject: any) => Promise.resolve({ data: table === "accounts" ? state.accounts : table === "goal_allocation_events" ? state.events : state.operations, error: null }).then(resolve, reject),
+    };
+    return builder;
+  } }),
+}));
+
+import { GoalFundsDialog } from "@/components/goals/GoalFundsDialog";
+import { GoalCompletionDialog } from "@/components/goals/GoalCompletionDialog";
+import { GoalHistoryDialog } from "@/components/goals/GoalHistoryDialog";
+import { GoalCard } from "@/components/goals/GoalCard";
+import { FinancialCommandError, fetchGoalHistory, fetchGoalWalletMetadata } from "@/lib/goals/client";
+
+const userId = "10000000-0000-4000-8000-000000000001";
+const laptopId = "20000000-0000-4000-8000-000000000002";
+const dateId = "20000000-0000-4000-8000-000000000003";
+const gcashId = "30000000-0000-4000-8000-000000000003";
+const bankId = "30000000-0000-4000-8000-000000000004";
+const payLaterId = "30000000-0000-4000-8000-000000000005";
+const operationId = "40000000-0000-4000-8000-000000000004";
+
+function makeGoal(overrides: Record<string, unknown> = {}) {
+  return {
+    id: laptopId, user_id: userId, name: "Laptop", target_amount: "30000.00", current_amount: "0.00",
+    target_date: null, color: "#10b981", icon: "target", is_completed: false, status: "active",
+    review_state: "confirmed", completed_at: null, archived_at: null, is_priority: false,
+    category: "tech", allocation_per_cycle: "0.00", allocation_frequency: "monthly",
+    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
+    goalId: laptopId, reserved: "3000.00", spent: "2000.00", progressAmount: "5000.00",
+    remaining: "25000.00", progressPercent: 16.6667,
+    financeAmounts: { target: "30000.00", progress: "5000.00", allocationPerCycle: "0.00" },
+    walletReservations: [{ accountId: gcashId, amount: "3000.00" }], legacyTaggedAmount: null,
+    ...overrides,
+  };
+}
+
+function makeSnapshot(goals = [makeGoal()]) {
+  return {
+    goals,
+    wallets: [
+      { accountId: gcashId, actual: "30000.00", reserved: "3000.00", available: "27000.00" },
+      { accountId: bankId, actual: "10000.00", reserved: "0.00", available: "10000.00" },
+      { accountId: payLaterId, actual: "-500.00", reserved: "0.00", available: "-500.00" },
+    ],
+  };
+}
+
+function event(overrides: Record<string, unknown> = {}) {
+  return {
+    id: "50000000-0000-4000-8000-000000000005", user_id: userId, goal_id: laptopId,
+    account_id: gcashId, operation_id: operationId, kind: "reserve", reserved_delta: "10.00",
+    spent_delta: "0.00", transaction_id: null, reversal_of: null, created_at: "2026-10-01T00:00:00Z",
+    accountName: "GCash", operation: null, ...overrides,
+  };
+}
+
+beforeEach(() => {
+  state.finance = makeSnapshot();
+  state.accounts = [
+    { id: gcashId, user_id: userId, name: "GCash", type: "e_wallet", currency: "PHP", is_active: true },
+    { id: bankId, user_id: userId, name: "GoTyme", type: "bank", currency: "PHP", is_active: true },
+    { id: payLaterId, user_id: userId, name: "SPayLater", type: "credit_card", currency: "PHP", is_active: true },
+  ];
+  state.events = [];
+  state.operations = [];
+  state.walletError = null;
+  state.financeError = null;
+  state.historyError = null;
+  state.readCalls = [];
+  state.refresh.mockReset().mockResolvedValue(undefined);
+  state.apply.mockReset().mockResolvedValue({ operationId, transactionIds: [], replayed: false });
+});
+
+afterEach(() => cleanup());
+
+describe("goal reservation actions", () => {
+  test("set aside uses reservation dialog and does not quote or create an expense", async () => {
+    const user = userEvent.setup();
+    render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
+
+    const dialog = screen.getByRole("dialog", { name: /set aside/i });
+    expect(dialog.getAttribute("data-state")).toBe("open");
+    expect(within(dialog).getAllByRole("option").map(option => option.textContent)).toEqual(["Choose a wallet", "GCash", "GoTyme"]);
+    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
+    await user.type(within(dialog).getByLabelText(/amount/i), "500");
+    await user.click(within(dialog).getByRole("button", { name: /set aside/i }));
+
+    await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
+      kind: "reserve", goalId: laptopId, accountId: gcashId, amount: "500.00",
+    }, undefined));
+    expect(state.refresh).toHaveBeenCalledOnce();
+    expect(state.finance.wallets[0].actual).toBe("30000.00");
+  });
+
+  test("release changes reservations without changing actual wallet balance", async () => {
+    const user = userEvent.setup();
+    render(<GoalFundsDialog goalId={laptopId} mode="release" open onOpenChange={() => {}} />);
+    const dialog = screen.getByRole("dialog", { name: /release funds/i });
+    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
+    await user.type(within(dialog).getByLabelText(/amount/i), "1000");
+    await user.click(within(dialog).getByRole("button", { name: /release funds/i }));
+
+    await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
+      kind: "release", goalId: laptopId, accountId: gcashId, amount: "1000.00",
+    }, undefined));
+    expect(state.finance.wallets[0].actual).toBe("30000.00");
+  });
+
+  test("move lists only owned active goals and keeps the selected wallet", async () => {
+    const user = userEvent.setup();
+    state.finance = makeSnapshot([
+      makeGoal(),
+      makeGoal({ id: dateId, goalId: dateId, name: "Date", status: "active", archived_at: null }),
+      makeGoal({ id: "20000000-0000-4000-8000-000000000006", goalId: "20000000-0000-4000-8000-000000000006", name: "Cancelled", status: "cancelled" }),
+      makeGoal({ id: "20000000-0000-4000-8000-000000000007", goalId: "20000000-0000-4000-8000-000000000007", name: "Archived", status: "active", archived_at: "2026-10-02T00:00:00Z" }),
+    ]);
+    render(<GoalFundsDialog goalId={laptopId} mode="move" open onOpenChange={() => {}} />);
+    const dialog = screen.getByRole("dialog", { name: /move reservation/i });
+    const destination = within(dialog).getByLabelText(/move to goal/i);
+    expect(within(destination).getAllByRole("option").map(option => option.textContent)).toEqual(["Choose a goal", "Date"]);
+    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
+    await user.selectOptions(destination, dateId);
+    await user.type(within(dialog).getByLabelText(/amount/i), "250");
+    await user.click(within(dialog).getByRole("button", { name: /move reservation/i }));
+    await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
+      kind: "reallocate", goalId: laptopId, destinationGoalId: dateId, accountId: gcashId, amount: "250.00",
+    }, undefined));
+  });
+
+  test("changing goal or reopening clears entered amount and wallet selection", async () => {
+    const user = userEvent.setup();
+    const view = render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
+    let dialog = screen.getByRole("dialog", { name: /set aside/i });
+    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
+    await user.type(within(dialog).getByLabelText(/amount/i), "500");
+
+    view.rerender(<GoalFundsDialog goalId={dateId} mode="reserve" open onOpenChange={() => {}} />);
+    dialog = screen.getByRole("dialog", { name: /set aside/i });
+    expect((within(dialog).getByLabelText(/amount/i) as HTMLInputElement).value).toBe("");
+    expect((within(dialog).getByLabelText(/wallet/i) as HTMLSelectElement).value).toBe("");
+
+    view.rerender(<GoalFundsDialog goalId={dateId} mode="reserve" open={false} onOpenChange={() => {}} />);
+    view.rerender(<GoalFundsDialog goalId={dateId} mode="reserve" open onOpenChange={() => {}} />);
+    dialog = screen.getByRole("dialog", { name: /set aside/i });
+    expect((within(dialog).getByLabelText(/amount/i) as HTMLInputElement).value).toBe("");
+    expect((within(dialog).getByLabelText(/wallet/i) as HTMLSelectElement).value).toBe("");
+  });
+
+  test("cancel and rejected commands leave the finance snapshot untouched", async () => {
+    const user = userEvent.setup();
+    const onOpenChange = vi.fn();
+    const view = render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={onOpenChange} />);
+    const dialog = screen.getByRole("dialog", { name: /set aside/i });
+    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
+    expect(state.apply).not.toHaveBeenCalled();
+    expect(state.finance.wallets[0].reserved).toBe("3000.00");
+
+    state.apply.mockRejectedValueOnce(new Error("Could not reserve funds"));
+    view.rerender(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={onOpenChange} />);
+    const reopened = screen.getByRole("dialog", { name: /set aside/i });
+    await user.selectOptions(within(reopened).getByLabelText(/wallet/i), gcashId);
+    await user.type(within(reopened).getByLabelText(/amount/i), "500");
+    await user.click(within(reopened).getByRole("button", { name: /set aside/i }));
+    expect((await screen.findByRole("alert")).textContent).toMatch(/could not reserve funds/i);
+    expect(state.finance.wallets[0].reserved).toBe("3000.00");
+  });
+
+  test("unknown save retries the same request even after the selected goal changes", async () => {
+    const user = userEvent.setup();
+    const unknown = new FinancialCommandError({ message: "Network disconnected", outcome: "unknown" });
+    state.apply.mockRejectedValueOnce(unknown).mockResolvedValue({ operationId, transactionIds: [], replayed: true });
+    const view = render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
+    let dialog = screen.getByRole("dialog", { name: /set aside/i });
+    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
+    await user.type(within(dialog).getByLabelText(/amount/i), "125");
+    await user.click(within(dialog).getByRole("button", { name: /set aside/i }));
+    expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm whether this was saved/i);
+    const firstAttempt = state.apply.mock.calls[0];
+
+    view.rerender(<GoalFundsDialog goalId={dateId} mode="reserve" open onOpenChange={() => {}} />);
+    dialog = screen.getByRole("dialog", { name: /set aside/i });
+    await user.click(within(dialog).getByRole("button", { name: /retry same request/i }));
+    await waitFor(() => expect(state.apply).toHaveBeenCalledTimes(2));
+    expect(state.apply.mock.calls[1]).toEqual(firstAttempt);
+  });
+
+  test("wallet read errors stay distinct from an empty eligible-wallet list", () => {
+    state.walletError = new Error("metadata unavailable");
+    render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
+    const dialog = screen.getByRole("dialog", { name: /set aside/i });
+    expect(within(dialog).getByRole("alert").textContent).toMatch(/could not load/i);
+    expect(dialog.textContent).not.toMatch(/no wallet has money available/i);
+  });
+});
+
+describe("goal lifecycle presentation", () => {
+  test("active progress adds reserved and spent while showing each amount separately", () => {
+    render(<GoalCard goal={makeGoal() as any} onEdit={() => {}} onDelete={() => {}} onToggleComplete={() => {}} onContribute={() => {}} onReserve={() => {}} onRelease={() => {}} onMove={() => {}} onHistory={() => {}} />);
+    const card = screen.getByRole("article", { name: /laptop/i });
+    expect(within(card).getByText(/reserved/i).textContent).toContain("₱3,000.00");
+    expect(within(card).getByText(/spent/i).textContent).toContain("₱2,000.00");
+    expect(within(card).getByText("17%")).toBeTruthy();
+    expect(within(card).getByText("Saving")).toBeTruthy();
+  });
+
+  test("completed status comes from lifecycle, shows spending, and offers reopen and archive", async () => {
+    const user = userEvent.setup();
+    const onToggleComplete = vi.fn();
+    const onDelete = vi.fn();
+    render(<GoalCard goal={makeGoal({ status: "completed", is_completed: false, reserved: "0.00", spent: "2000.00", progressAmount: "2000.00", walletReservations: [] }) as any} onEdit={() => {}} onDelete={onDelete} onToggleComplete={onToggleComplete} onContribute={() => {}} onReserve={() => {}} onRelease={() => {}} onMove={() => {}} onHistory={() => {}} />);
+    const card = screen.getByRole("article", { name: /laptop/i });
+    expect(within(card).getByText("Completed")).toBeTruthy();
+    expect(within(card).getAllByText(/spent/i).some(element => element.textContent?.includes("₱2,000.00"))).toBe(true);
+    await user.click(within(card).getByRole("button", { name: /reopen/i }));
+    expect(onToggleComplete).toHaveBeenCalledWith(laptopId, false);
+    await user.click(within(card).getByRole("button", { name: /laptop actions/i }));
+    await user.click(screen.getByRole("menuitem", { name: /archive goal/i }));
+    expect(onDelete).toHaveBeenCalledWith(laptopId);
+  });
+
+  test("reopening retains prior spending and restored active progress", async () => {
+    const user = userEvent.setup();
+    render(<GoalCard goal={makeGoal({ status: "completed", is_completed: true, reserved: "0.00", spent: "2000.00", progressAmount: "2000.00", progressPercent: 6.6667 }) as any} onEdit={() => {}} onDelete={() => {}} onToggleComplete={() => {}} onContribute={() => {}} onReserve={() => {}} onRelease={() => {}} onMove={() => {}} onHistory={() => {}} />);
+    const card = screen.getByRole("article", { name: /laptop/i });
+    await user.click(within(card).getByRole("button", { name: /reopen/i }));
+    expect(within(card).getAllByText(/spent/i).some(element => element.textContent?.includes("₱2,000.00"))).toBe(true);
+    expect(within(card).getByText("7%")).toBeTruthy();
+  });
+});
+
+describe("goal closure and history", () => {
+  test("closure asks whether to release or move leftover reservations", async () => {
+    const user = userEvent.setup();
+    render(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
+    const dialog = screen.getByRole("dialog", { name: /complete goal/i });
+    expect(within(dialog).getByText(/remains reserved/i).textContent).toContain("3000.00");
+    expect(within(dialog).getByLabelText(/release leftovers/i)).toBeTruthy();
+    expect(within(dialog).getByLabelText(/move leftovers/i)).toBeTruthy();
+    await user.click(within(dialog).getByLabelText(/release leftovers/i));
+    await user.click(within(dialog).getByRole("button", { name: /complete goal/i }));
+    await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
+      kind: "close", goalId: laptopId, status: "completed", leftovers: { mode: "release" },
+    }, undefined));
+  });
+
+  test("history shows event labels and real wallet names, with exact decimal values", () => {
+    state.events = [
+      event({ kind: "reserve", reserved_delta: "10.00", spent_delta: "0.00", accountName: "GCash" }),
+      event({ id: "50000000-0000-4000-8000-000000000006", kind: "release", reserved_delta: "-3.00", accountName: "GCash" }),
+      event({ id: "50000000-0000-4000-8000-000000000007", kind: "spend", reserved_delta: "-2.00", spent_delta: "2.00", accountName: "Main bank", transaction_id: "60000000-0000-4000-8000-000000000006" }),
+      event({ id: "50000000-0000-4000-8000-000000000008", kind: "move_out", reserved_delta: "-1.00", accountName: "GCash" }),
+      event({ id: "50000000-0000-4000-8000-000000000009", kind: "move_in", reserved_delta: "1.00", accountName: "Main bank" }),
+      event({ id: "50000000-0000-4000-8000-000000000010", kind: "reversal", reserved_delta: "0.00", spent_delta: "-2.00", reversal_of: "50000000-0000-4000-8000-000000000007", accountName: "Main bank" }),
+      event({ id: "50000000-0000-4000-8000-000000000011", kind: "release", reserved_delta: "-4.00", operationKind: "transaction", accountName: "GCash" }),
+    ];
+    render(<GoalHistoryDialog goalId={laptopId} open onOpenChange={() => {}} />);
+    const dialog = screen.getByRole("dialog", { name: /laptop history/i });
+    expect(within(dialog).getByText("Set aside")).toBeTruthy();
+    expect(within(dialog).getByText("Release funds")).toBeTruthy();
+    expect(within(dialog).getByText("Confirmed automatic release")).toBeTruthy();
+    expect(within(dialog).getByText("Spending from goal")).toBeTruthy();
+    expect(within(dialog).getAllByText("Move reservation").length).toBeGreaterThan(0);
+    expect(within(dialog).getByText("Reversal")).toBeTruthy();
+    expect(within(dialog).getAllByText(/GCash|Main bank/).length).toBeGreaterThan(0);
+    expect(within(dialog).getByText("−PHP 3.00 reserved")).toBeTruthy();
+  });
+
+  test("history normalizes decimal text exactly and reads metadata only for the owner", async () => {
+    state.events = [event({ kind: "spend", reserved_delta: "-2.5", spent_delta: "2.5", transaction_id: "60000000-0000-4000-8000-000000000006" })];
+    state.operations = [{ id: operationId, command: { kind: "transaction" } }];
+    const history = await fetchGoalHistory(userId, laptopId);
+    expect(history[0]).toMatchObject({ reserved_delta: "-2.50", spent_delta: "2.50", accountName: "GCash", operationKind: "transaction" });
+    expect(state.readCalls).toContainEqual({ table: "goal_allocation_events", method: "eq", column: "user_id", value: userId });
+    expect(state.readCalls).toContainEqual({ table: "accounts", method: "eq", column: "user_id", value: userId });
+    expect(state.readCalls).toContainEqual({ table: "financial_operations", method: "eq", column: "user_id", value: userId });
+    expect(state.readCalls.find(call => call.table === "goal_allocation_events" && call.method === "select").columns).toContain("reserved_delta::text");
+  });
+
+  test("history rejects a database decimal with more than two places instead of rounding it", async () => {
+    state.events = [event({ reserved_delta: "1.005" })];
+    await expect(fetchGoalHistory(userId, laptopId)).rejects.toThrow(/invalid decimal/i);
+  });
+
+  test("history records deleted-transaction reversals without inventing an allocation amount", async () => {
+    const transactionId = "60000000-0000-4000-8000-000000000006";
+    const deletionOperationId = "40000000-0000-4000-8000-000000000008";
+    state.events = [event({ kind: "release", reserved_delta: "-5.00", operation_id: operationId, transaction_id: transactionId })];
+    state.operations = [
+      { id: operationId, command: { kind: "release" }, result: {} },
+      { id: deletionOperationId, command: { kind: "delete_transaction", transactionId }, created_at: "2026-10-06T00:00:00Z" },
+    ];
+    const history = await fetchGoalHistory(userId, laptopId);
+    expect(history).toHaveLength(2);
+    expect(history.find(entry => entry.kind === "transaction_reversal")).toMatchObject({
+      reserved_delta: "0.00", spent_delta: "0.00", transaction_id: transactionId,
+      operation_id: deletionOperationId, operationKind: "delete_transaction",
+    });
+  });
+
+  test("wallet metadata stays owner-scoped and includes account kinds for eligibility", async () => {
+    const wallets = await fetchGoalWalletMetadata(userId);
+    expect(wallets.find(wallet => wallet.id === bankId)).toMatchObject({ name: "GoTyme", type: "bank", currency: "PHP" });
+    expect(wallets.find(wallet => wallet.id === payLaterId)).toMatchObject({ name: "SPayLater", type: "credit_card" });
+    expect(state.readCalls).toContainEqual({ table: "accounts", method: "eq", column: "user_id", value: userId });
+  });
+
+  test("keyboard opening, tabbing, escape, and focus return work for reservation dialog", async () => {
+    const user = userEvent.setup();
+    function Harness() {
+      const [open, setOpen] = React.useState(false);
+      return <><button type="button" onClick={() => setOpen(true)}>Open set aside</button><GoalFundsDialog goalId={laptopId} mode="reserve" open={open} onOpenChange={setOpen} /></>;
+    }
+    render(<Harness />);
+    const trigger = screen.getByRole("button", { name: "Open set aside" });
+    trigger.focus();
+    expect(document.activeElement).toBe(trigger);
+    await user.click(trigger);
+    const dialog = screen.getByRole("dialog", { name: /set aside/i });
+    expect(dialog.contains(document.activeElement)).toBe(true);
+    await user.tab();
+    expect(dialog.contains(document.activeElement)).toBe(true);
+    await user.keyboard("{Escape}");
+    await waitFor(() => expect(screen.queryByRole("dialog", { name: /set aside/i })).toBeNull());
+    expect(document.activeElement).toBe(trigger);
+  });
+});
