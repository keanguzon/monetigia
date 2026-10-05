"use client";

import React from "react";
import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Edit2,
  Flame,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { getProjection, GoalWithProgress } from "@/hooks/use-goals";

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
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return null;
  }
}

interface GoalCardProps {
  goal: GoalWithProgress;
  onEdit: (goal: GoalWithProgress) => void;
  onDelete: (goalId: string) => void;
  onToggleComplete: (goalId: string, completed: boolean) => void;
}

export function GoalCard({
  goal,
  onEdit,
  onDelete,
  onToggleComplete,
}: GoalCardProps) {
  const projection = getProjection(goal);
  const clampedPercent = Math.min(100, Math.max(0, goal.progressPercent));
  const categoryStyle = categoryStyles[goal.category?.toLowerCase()] || categoryStyles.lifestyle;
  const formattedTargetDate = formatDate(goal.target_date);
  const formattedProjectedDate = formatDate(projection.projectedDate);

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-xl border p-4.5 transition-all duration-200 ${
        goal.is_completed
          ? "border-border/40 bg-card/40 opacity-75 hover:opacity-100"
          : "border-border/60 bg-card/70 hover:border-border hover:shadow-sm"
      }`}
    >
      <div>
        {/* Header row: Name, Category Pill, Priority */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base leading-snug tracking-tight truncate">
                {goal.name}
              </h3>
              {goal.is_priority && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <Flame className="h-3 w-3" />
                  Priority
                </span>
              )}
              {goal.is_completed && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="h-3 w-3" />
                  Done
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize ${categoryStyle}`}
              >
                {goal.category || "General"}
              </span>
              {formattedTargetDate && (
                <span className="flex items-center gap-1 text-muted-foreground text-[11px]">
                  <Calendar className="h-3 w-3" />
                  Target: {formattedTargetDate}
                </span>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-1 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(goal)}
              title="Edit Goal"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(goal.id)}
              title="Delete Goal"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="my-3 space-y-1.5">
          <div className="flex justify-between items-baseline text-xs">
            <span className="font-mono tabular-nums text-foreground font-medium">
              {formatCurrency(goal.saved)}
              <span className="text-muted-foreground font-normal"> / {formatCurrency(goal.target_amount)}</span>
            </span>
            <span className="font-mono tabular-nums text-xs font-semibold text-foreground">
              {goal.progressPercent.toFixed(0)}%
            </span>
          </div>

          <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                goal.is_completed
                  ? "bg-emerald-500"
                  : goal.progressPercent >= 75
                  ? "bg-emerald-500"
                  : goal.progressPercent >= 30
                  ? "bg-primary"
                  : "bg-amber-500"
              }`}
              style={{ width: `${clampedPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Footer: Projection & Complete Toggle */}
      <div className="mt-2 pt-3 border-t border-border/30 flex items-center justify-between text-xs text-muted-foreground">
        <div className="min-w-0">
          {goal.is_completed ? (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Fully funded!
            </span>
          ) : goal.allocation_per_cycle > 0 ? (
            <div className="space-y-0.5">
              <span className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                <Clock className="h-3 w-3 text-muted-foreground" />
                ~{projection.count} {projection.unit} ({formatCurrency(projection.monthlyAmount)}/mo · {formatCurrency(projection.kinsenasAmount)}/ks)
              </span>
              {formattedProjectedDate && (
                <span className="block text-[10px] text-muted-foreground">
                  Est. completion: {formattedProjectedDate}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px] italic text-muted-foreground">No allocation set</span>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => onToggleComplete(goal.id, !goal.is_completed)}
        >
          {goal.is_completed ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Reopen
            </>
          ) : (
            <>
              <Circle className="h-3.5 w-3.5" />
              Complete
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
