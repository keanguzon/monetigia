"use client";

import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Calendar, CheckCircle2, Clock, Edit2, Flame, MoreHorizontal, Circle, History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { getProjection, type GoalWithProgress } from "@/hooks/use-goals";
import { toMinorUnits } from "@/lib/goals/summary";

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
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

interface GoalCardProps {
  goal: GoalWithProgress;
  onEdit: (goal: GoalWithProgress) => void;
  onDelete: (goalId: string) => void;
  onToggleComplete: (goalId: string, completed: boolean) => void;
  onContribute: (goalId: string) => void;
  onReserve: (goalId: string) => void;
  onRelease: (goalId: string) => void;
  onMove: (goalId: string) => void;
  onHistory: (goalId: string) => void;
  onClose?: (goalId: string, status: "completed" | "cancelled") => void;
  onReview?: (goalId: string) => void;
}

export function GoalCard({ goal, onEdit, onDelete, onToggleComplete, onContribute, onReserve, onRelease, onMove, onHistory, onClose, onReview }: GoalCardProps) {
  const projection = getProjection(goal);
  const progressCents = toMinorUnits(goal.financeAmounts.progress);
  const targetCents = toMinorUnits(goal.financeAmounts.target);
  const isCompleted = goal.status === "completed";
  const isCancelled = goal.status === "cancelled";
  const isActive = goal.status === "active";
  const needsReview = goal.review_state === "needs_review";
  const activeFunded = isActive && progressCents >= targetCents;
  const displayedProgress = isCompleted ? goal.spent : goal.financeAmounts.progress;
  const percent = isCompleted ? (targetCents ? Math.min(100, toMinorUnits(goal.spent) / targetCents * 100) : 0) : goal.progressPercent;
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const categoryStyle = categoryStyles[goal.category?.toLowerCase()] || categoryStyles.lifestyle;
  const formattedTargetDate = formatDate(goal.target_date);
  const formattedProjectedDate = formatDate(projection.projectedDate);
  const hasReservations = goal.walletReservations.some(wallet => toMinorUnits(wallet.amount) > 0);

  return (
    <article aria-label={`${goal.name} goal`} className={`group flex flex-col justify-between rounded-xl border p-4 sm:p-5 ${isActive ? "border-border/40 bg-card/50" : "border-border/30 bg-card/30"}`}>
      <div>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold leading-snug tracking-tight text-foreground">{goal.name}</h3>
              {goal.is_priority && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"><Flame className="h-3 w-3" />Priority</span>}
              {isCompleted && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Completed</span>}
              {isCancelled && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Cancelled</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize ${categoryStyle}`}>{goal.category || "General"}</span>
              {formattedTargetDate && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Calendar className="h-3 w-3" />Target: {formattedTargetDate}</span>}
            </div>
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`${goal.name} actions`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="z-[60] min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
                <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onHistory(goal.id)}><History className="h-4 w-4" />View history</DropdownMenu.Item>
                <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onEdit(goal)}><Edit2 className="h-4 w-4" />Edit goal</DropdownMenu.Item>
                {isActive && !needsReview && <>
                  <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onRelease(goal.id)} disabled={!hasReservations}>Release funds</DropdownMenu.Item>
                  <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onMove(goal.id)} disabled={!hasReservations}>Move reservation</DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onClose ? onClose(goal.id, "completed") : onToggleComplete(goal.id, true)}>Complete goal</DropdownMenu.Item>
                  <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onClose?.(goal.id, "cancelled")}>Cancel goal</DropdownMenu.Item>
                </>}
                {isCompleted && !needsReview && <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onToggleComplete(goal.id, false)}><Circle className="h-4 w-4" />Reopen</DropdownMenu.Item>}
                {!isActive && !needsReview && !hasReservations && <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-destructive outline-none focus:bg-accent" onSelect={() => onDelete(goal.id)}><Trash2 className="h-4 w-4" />Archive goal</DropdownMenu.Item>}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="my-3.5 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0"><span className="text-base font-bold tracking-tight text-foreground sm:text-lg">{formatCurrency(Number(displayedProgress))}</span><span className="ml-1.5 text-xs font-medium text-muted-foreground">/ {formatCurrency(goal.target_amount)}</span></div>
            <span className="text-xs font-bold tabular-nums text-foreground">{clampedPercent.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50" role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clampedPercent)}>
            <div className={`h-full rounded-full ${isCompleted || activeFunded ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${clampedPercent}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
            <p className="text-muted-foreground">Reserved <span className="font-medium text-foreground">{formatCurrency(Number(goal.reserved))}</span></p>
            <p className="text-muted-foreground">Spent <span className="font-medium text-foreground">{formatCurrency(Number(goal.spent))}</span></p>
          </div>
        </div>
      </div>

      {needsReview && <div className="mt-2 space-y-2"><p className="text-xs text-muted-foreground">Existing tags need review before they count as funding.</p><Button variant="outline" className="h-11 min-h-11 w-full" onClick={() => onReview?.(goal.id)}>Review existing funding</Button></div>}
      {isActive && !needsReview && <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="h-11 min-h-11" onClick={() => onReserve(goal.id)}>Set aside</Button>
        <Button size="sm" className="h-11 min-h-11" onClick={() => onContribute(goal.id)}>Spend from goal</Button>
      </div>}

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/30 pt-3 text-xs text-muted-foreground">
        <div className="min-w-0 flex-1">
          {isCompleted ? <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />PHP {goal.spent} spent</span>
            : isCancelled ? <span>Spending history retained</span>
            : activeFunded ? <span className="font-medium text-emerald-600 dark:text-emerald-400">Funded</span>
            : Number(goal.allocation_per_cycle) > 0 ? <div className="space-y-0.5"><span className="flex items-center gap-1 text-[11px] font-medium text-foreground"><Clock className="h-3 w-3 text-muted-foreground" />Saving · ~{projection.count} {projection.unit}</span>{formattedProjectedDate && <span className="block text-[10px] text-muted-foreground">Estimate: {formattedProjectedDate}</span>}</div>
            : <span className="text-[11px] text-muted-foreground">Saving</span>}
        </div>
        {isActive && !needsReview && !activeFunded && <Button variant="ghost" size="sm" className="h-11 min-h-11 shrink-0 px-2 text-xs" onClick={() => onClose ? onClose(goal.id, "completed") : onToggleComplete(goal.id, true)}>Complete</Button>}
        {isCompleted && !needsReview && <Button variant="ghost" size="sm" className="h-11 min-h-11 shrink-0 px-2 text-xs" onClick={() => onToggleComplete(goal.id, false)}>Reopen</Button>}
      </div>
    </article>
  );
}
