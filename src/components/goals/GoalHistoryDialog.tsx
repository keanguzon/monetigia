"use client";

import React, { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGoalHistory } from "@/hooks/use-goal-finance";
import { useGoals } from "@/hooks/use-goals";
import type { GoalHistoryEntry } from "@/lib/goals/client";

interface GoalHistoryDialogProps {
  goalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function signedAmount(value: string): string {
  const negative = value.startsWith("-");
  const amount = negative ? value.slice(1) : value;
  return `${negative ? "−" : "+"}PHP ${amount}`;
}

function eventTitle(entry: GoalHistoryEntry): string {
  if (entry.kind === "transaction_reversal") return "Transaction reversed";
  if (entry.kind === "reversal") return "Reversal";
  if (entry.kind === "release" && entry.operationKind === "transaction") return "Confirmed automatic release";
  if (entry.kind === "reserve") return "Reserved for goal";
  if (entry.kind === "release") return "Release funds";
  if (entry.kind === "spend" || entry.kind === "legacy_spent") return entry.kind === "legacy_spent" ? "Imported past spending" : "Spending from goal";
  if (entry.kind === "move_in" || entry.kind === "move_out") return "Move reservation";
  return "Goal allocation";
}

function eventAmounts(entry: GoalHistoryEntry): string[] {
  const amounts = [];
  if (entry.reserved_delta !== "0.00") amounts.push(`${signedAmount(entry.reserved_delta)} reserved`);
  if (entry.spent_delta !== "0.00") amounts.push(`${signedAmount(entry.spent_delta)} spent`);
  return amounts;
}

export function GoalHistoryDialog({ goalId, open, onOpenChange }: GoalHistoryDialogProps) {
  const opener = useRef<HTMLElement | null>(null);
  const { userId, goals } = useGoals();
  const history = useGoalHistory(userId, open ? goalId : null);
  const goal = goals.find(item => item.id === goalId);
  const title = `${goal?.name ?? "Goal"} history`;
  const originalKind = new Map((history.data ?? []).map(entry => [entry.id, entry.kind]));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">Wallet reservations and goal spending, in time order.</Dialog.Description>

          <div className="mt-5">
            {history.isLoading ? (
              <div role="status" aria-label="Loading goal history" className="space-y-3">
                {[0, 1, 2].map(index => <div key={index} className="space-y-2 border-b border-border/50 pb-3"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-52" /></div>)}
              </div>
            ) : history.error ? (
              <div className="space-y-3"><p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">Goal history could not load.</p><Button type="button" variant="outline" className="h-11 min-h-11" onClick={() => void history.refresh()}>Retry loading</Button></div>
            ) : (history.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No reservation or spending history yet.</p>
            ) : (
              <ol className="divide-y divide-border/50">
                {history.data?.map(entry => (
                  <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium">{eventTitle(entry)}</p>
                        <p className="text-xs text-muted-foreground">{entry.accountName}</p>
                        {entry.transaction_id && <p className="text-xs text-muted-foreground">Transaction reference retained</p>}
                        {entry.kind === "transaction_reversal" && <p className="text-xs text-muted-foreground">The linked transaction was removed; this history entry records the reversal.</p>}
                        {entry.reversal_of && <p className="text-xs text-muted-foreground">Reversed {originalKind.get(entry.reversal_of) ?? "an earlier entry"}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        {eventAmounts(entry).map(amount => <p key={amount} className="text-xs tabular-nums">{amount}</p>)}
                        <time dateTime={entry.created_at} className="mt-1 block text-[11px] text-muted-foreground">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(entry.created_at))}</time>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="mt-5 flex justify-end">
            <Button type="button" variant="outline" className="h-11 min-h-11" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
