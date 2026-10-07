"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useGoals } from "@/hooks/use-goals";
import { useGoalWalletMetadata } from "@/hooks/use-goal-finance";
import { FinancialCommandError, financialCommandMessage } from "@/lib/goals/client";
import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";
import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
import type { FinancialCommand, LeftoverChoice } from "@/lib/goals/contracts";

interface GoalCompletionDialogProps {
  goalId: string;
  status: "completed" | "cancelled";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GoalCompletionDialog({ goalId, status, open, onOpenChange }: GoalCompletionDialogProps) {
  const { goals, userId, refresh, isLoading, isError } = useGoals();
  const walletMetadata = useGoalWalletMetadata(userId);
  const [choice, setChoice] = useState<"release" | "move" | "">("");
  const [destinationGoalId, setDestinationGoalId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const requestId = useRef<string | null>(null);
  const retryCommand = useRef<FinancialCommand | null>(null);
  const unknownOutcome = useRef(false);
  const recoveringUnknown = unknownOutcome.current && retryCommand.current !== null;
  const opener = useRef<HTMLElement | null>(null);

  const goal = goals.find(item => item.id === goalId);
  const leftoverCents = useMemo(() => (goal?.walletReservations ?? []).reduce((sum, item) => sum + toMinorUnits(item.amount), 0), [goal?.walletReservations]);
  const leftovers = fromMinorUnits(leftoverCents);
  const destinations = goals.filter(item => item.id !== goalId && item.status === "active" && item.review_state === "confirmed" && item.archived_at === null);
  const walletNames = new Map((walletMetadata.data ?? []).map(item => [item.id, item.name]));

  useEffect(() => {
    if (!open) return;
    setChoice("");
    setDestinationGoalId("");
    setError(unknownOutcome.current ? "The previous save has an unknown result. Retry it to confirm the same request." : null);
    setRefreshError(false);
  }, [goalId, open, status]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let command = retryCommand.current;
    if (!command) {
      if (!goal || goal.status !== "active" || goal.review_state !== "confirmed") {
        setError("Confirm this goal before closing it.");
        return;
      }
      let leftoversChoice: LeftoverChoice | null = null;
      if (leftoverCents > 0) {
        if (choice === "release") leftoversChoice = { mode: "release" };
        else if (choice === "move" && destinations.some(item => item.id === destinationGoalId)) {
          leftoversChoice = { mode: "move", goalId: destinationGoalId };
        } else {
          setError("Choose what to do with the remaining reserved funds.");
          return;
        }
      }
      command = { kind: "close", goalId, status, leftovers: leftoversChoice };
      requestId.current = crypto.randomUUID();
      retryCommand.current = command;
    }
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setPending(true);
    try {
      const { refreshError: failedRefresh } = await applyAndRefreshFinancialCommand(requestId.current, command, undefined, refresh);
      requestId.current = null;
      retryCommand.current = null;
      unknownOutcome.current = false;
      if (failedRefresh) {
        setRefreshError(true);
        return;
      }
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof FinancialCommandError && cause.outcome === "unknown") {
        unknownOutcome.current = true;
        setError("We could not confirm whether this was saved. Retry this same request before starting another one.");
      } else {
        requestId.current = null;
        retryCommand.current = null;
        unknownOutcome.current = false;
        setError(financialCommandMessage(cause, "The goal could not be closed."));
      }
    } finally {
      setPending(false);
    }
  }

  async function retryRefresh() {
    try {
      await refresh();
      setRefreshError(false);
      onOpenChange(false);
    } catch {
      setRefreshError(true);
    }
  }

  async function retryLoad() {
    try {
      await Promise.all([refresh(), walletMetadata.refresh()]);
      setError(null);
    } catch {
      setError("Wallet details still could not load. Try again.");
    }
  }

  const label = status === "completed" ? "Complete goal" : "Cancel goal";
  const walletDataError = Boolean(isError || walletMetadata.error);
  const busy = pending || walletMetadata.isLoading || isLoading;
  const disabled = busy || goal?.status !== "active" || goal.review_state !== "confirmed" || unknownOutcome.current;
  return (
    <Dialog.Root open={open} onOpenChange={nextOpen => { if (!pending) onOpenChange(nextOpen); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
          <Dialog.Title className="text-lg font-semibold">{label}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">{goal?.name ?? "Goal"} will keep its recorded spending in history.</Dialog.Description>
          {leftoverCents > 0 && (
            <div className="mt-4 space-y-3 rounded-lg border border-border/70 p-3">
              <p className="text-sm font-medium">PHP {leftovers} remains reserved</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {(goal?.walletReservations ?? []).map(item => <li key={item.accountId}>{walletNames.get(item.accountId) ?? "Wallet"}: PHP {item.amount}</li>)}
              </ul>
              <p className="text-sm">Choose what happens to the remainder.</p>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="goal-leftovers" value="release" checked={choice === "release"} onChange={() => setChoice("release")} disabled={disabled || walletDataError} />
                Release leftovers to available funds
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name="goal-leftovers" value="move" checked={choice === "move"} onChange={() => setChoice("move")} disabled={disabled || walletDataError} />
                Move leftovers to another goal
              </label>
              {choice === "move" && (
                <div className="space-y-1.5">
                  <label htmlFor="goal-close-destination" className="text-sm font-medium">Move to goal</label>
                  <select id="goal-close-destination" value={destinationGoalId} onChange={event => setDestinationGoalId(event.target.value)} disabled={disabled || walletDataError} className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="">Choose a goal</option>
                    {destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          {leftoverCents === 0 && <p className="mt-4 text-sm text-muted-foreground">No reservations remain. Your recorded spending stays in history.</p>}
          {walletDataError && leftoverCents > 0 && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive">Wallet details could not load, so the remaining funds cannot be reviewed.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => void retryLoad()}>Retry loading</Button></div>}
          {busy && !pending && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading wallet details…</p>}
          {error && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {refreshError ? (
            <div className="mt-4 space-y-3" role="status">
              <p className="text-sm text-amber-700 dark:text-amber-300">Saved, but the goal summary could not refresh.</p>
              <Button type="button" className="h-11 min-h-11" onClick={() => void retryRefresh()}>Retry refresh</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="h-11 min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="h-11 min-h-11" disabled={pending || (!recoveringUnknown && (busy || (walletDataError && leftoverCents > 0) || goal?.status !== "active" || goal.review_state !== "confirmed"))}>{pending ? "Saving…" : recoveringUnknown ? "Retry same request" : label}</Button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
