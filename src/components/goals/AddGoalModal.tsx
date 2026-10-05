"use client";

import React, { useEffect, useState } from "react";
import { X, Target, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { parsePositiveAmount, parseNonNegativeAmount, sanitizeColor, formatCurrency } from "@/lib/utils";
import type { Goal } from "@/types/database";
import { useGoals } from "@/hooks/use-goals";

const GOAL_CATEGORIES = [
  { value: "lifestyle", label: "Lifestyle" },
  { value: "health", label: "Health & Wellness" },
  { value: "debt", label: "Debt Payoff" },
  { value: "milestone", label: "Milestone" },
  { value: "holiday", label: "Holiday / Gifts" },
  { value: "tech", label: "Tech / Gear" },
  { value: "travel", label: "Travel / Vacation" },
  { value: "savings", label: "General Savings" },
];

const GOAL_COLORS = [
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#f43f5e", // rose
  "#6366f1", // indigo
];

interface AddGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingGoal?: Goal | null;
}

export function AddGoalModal({ isOpen, onClose, editingGoal }: AddGoalModalProps) {
  const { toast } = useToast();
  const { createGoal, updateGoal } = useGoals();

  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [allocationPerCycle, setAllocationPerCycle] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "kinsenas">("monthly");
  const [targetDate, setTargetDate] = useState("");
  const [category, setCategory] = useState("lifestyle");
  const [isPriority, setIsPriority] = useState(false);
  const [color, setColor] = useState(GOAL_COLORS[0]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (editingGoal) {
      setName(editingGoal.name || "");
      setTargetAmount(editingGoal.target_amount ? String(editingGoal.target_amount) : "");
      setAllocationPerCycle(
        editingGoal.allocation_per_cycle !== undefined
          ? String(editingGoal.allocation_per_cycle)
          : "0"
      );
      setFrequency(
        editingGoal.allocation_frequency === "kinsenas" ? "kinsenas" : "monthly"
      );
      setTargetDate(editingGoal.target_date || "");
      setCategory(editingGoal.category || "lifestyle");
      setIsPriority(Boolean(editingGoal.is_priority));
      setColor(editingGoal.color || GOAL_COLORS[0]);
    } else {
      setName("");
      setTargetAmount("");
      setAllocationPerCycle("");
      setFrequency("monthly");
      setTargetDate("");
      setCategory("lifestyle");
      setIsPriority(false);
      setColor(GOAL_COLORS[0]);
    }
  }, [editingGoal, isOpen]);

  if (!isOpen) return null;

  const handleFrequencyChange = (nextFreq: "monthly" | "kinsenas") => {
    if (nextFreq === frequency) return;
    const currentNum = parseNonNegativeAmount(allocationPerCycle);
    if (currentNum !== null && currentNum > 0) {
      if (nextFreq === "kinsenas") {
        // from monthly to kinsenas: divide by 2
        setAllocationPerCycle(String(Math.round((currentNum / 2) * 100) / 100));
      } else {
        // from kinsenas to monthly: multiply by 2
        setAllocationPerCycle(String(Math.round((currentNum * 2) * 100) / 100));
      }
    }
    setFrequency(nextFreq);
  };

  const parsedAllocNum = parseNonNegativeAmount(allocationPerCycle) || 0;
  const liveEquivalent = parsedAllocNum > 0
    ? frequency === "monthly"
      ? `≈ ${formatCurrency(parsedAllocNum / 2)} every kinsenas (cutoff)`
      : `≈ ${formatCurrency(parsedAllocNum * 2)} per month`
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const trimmedName = name.trim();
      if (!trimmedName) {
        toast({
          title: "Goal name required",
          description: "Please enter a descriptive name for your goal.",
          variant: "destructive",
        });
        return;
      }

      if (trimmedName.length > 60) {
        toast({
          title: "Name too long",
          description: "Goal name must be 60 characters or fewer.",
          variant: "destructive",
        });
        return;
      }

      const parsedTarget = parsePositiveAmount(targetAmount);
      if (!parsedTarget) {
        toast({
          title: "Invalid target amount",
          description: "Target amount must be a number greater than 0.",
          variant: "destructive",
        });
        return;
      }

      const parsedAllocation = allocationPerCycle.trim() === ""
        ? 0
        : parseNonNegativeAmount(allocationPerCycle);

      if (parsedAllocation === null) {
        toast({
          title: "Invalid allocation",
          description: "Savings target must be a non-negative number.",
          variant: "destructive",
        });
        return;
      }

      const payload = {
        name: trimmedName,
        target_amount: parsedTarget,
        allocation_per_cycle: parsedAllocation,
        allocation_frequency: frequency,
        target_date: targetDate || null,
        category,
        is_priority: isPriority,
        color: sanitizeColor(color) || GOAL_COLORS[0],
      };

      if (editingGoal) {
        await updateGoal(editingGoal.id, payload);
        toast({
          title: "Goal updated",
          description: `"${trimmedName}" was updated successfully.`,
        });
      } else {
        await createGoal({
          ...payload,
          icon: "target",
          is_completed: false,
        });
        toast({
          title: "Goal created",
          description: `"${trimmedName}" is now active in your goals tracker.`,
        });
      }

      onClose();
    } catch (err: any) {
      toast({
        title: "Error saving goal",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal dialog */}
      <div className="relative w-full max-w-lg rounded-2xl border border-border/70 bg-card p-6 shadow-xl transition-all">
        {/* Header */}
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
                Track your savings targets with flexible monthly or kinsenas projections
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
          </Button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Goal Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Goal Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Phone, Laptop, Emergency Fund, Travel"
              maxLength={60}
              required
              autoFocus
            />
          </div>

          {/* Target Amount & Savings Allocation (2 columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center min-h-[26px] mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Target Amount (₱)
                </label>
              </div>
              <Input
                type="number"
                step="0.01"
                min="1"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder="10000"
                required
              />
            </div>

            <div>
              <div className="flex w-full items-center justify-between gap-3 min-h-[26px] mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  Savings Target
                </label>
                {/* Cadence Segmented Pill */}
                <div className="inline-flex items-center rounded-md bg-muted/60 p-0.5 text-[10px] font-medium gap-0.5 shrink-0 ml-auto">
                  <button
                    type="button"
                    onClick={() => handleFrequencyChange("monthly")}
                    className={`rounded px-2 py-0.5 transition-all ${
                      frequency === "monthly"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFrequencyChange("kinsenas")}
                    className={`rounded px-2 py-0.5 transition-all ${
                      frequency === "kinsenas"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Kinsenas
                  </button>
                </div>
              </div>

              <Input
                type="number"
                step="0.01"
                min="0"
                value={allocationPerCycle}
                onChange={(e) => setAllocationPerCycle(e.target.value)}
                placeholder={frequency === "monthly" ? "3000 (per month)" : "1500 (per cutoff)"}
              />
              <span className="block mt-1 text-[10px] text-muted-foreground">
                {liveEquivalent ? liveEquivalent : frequency === "monthly" ? "Target amount saved every month" : "Target amount saved every payday"}
              </span>
            </div>
          </div>

          {/* Category & Target Date (2 columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {GOAL_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Target Date (Optional)
              </label>
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="appearance-none block min-w-full bg-background"
              />
            </div>
          </div>

          {/* Color Tag Selection */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Accent Color
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {GOAL_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition-all ${
                    color === c ? "border-foreground scale-110 shadow-sm" : "border-transparent opacity-80 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Priority Checkbox */}
          <div className="pt-2">
            <label className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-border/30 bg-muted/20 p-3 hover:bg-muted/40 transition-colors">
              <input
                type="checkbox"
                checked={isPriority}
                onChange={(e) => setIsPriority(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <div className="flex-1">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <Flame className="h-4 w-4 text-amber-500" />
                  Mark as High Priority
                </span>
                <span className="block text-xs text-muted-foreground">
                  Pins this goal to the top of your active roadmap
                </span>
              </div>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 flex items-center justify-end gap-2 border-t border-border/50">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : editingGoal ? "Save Changes" : "Create Goal"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
