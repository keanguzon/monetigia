"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGoals } from "@/hooks/use-goals";
import { useGoalWalletMetadata } from "@/hooks/use-goal-finance";
import { FinancialCommandError, financialCommandMessage } from "@/lib/goals/client";
import { parseMoney, toMinorUnits } from "@/lib/goals/summary";
import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
import type { FinancialCommand, Money } from "@/lib/goals/contracts";

type GoalFundsMode = "reserve" | "release" | "move";

interface GoalFundsDialogProps {
  goalId: string;
  mode: GoalFundsMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const titles: Record<GoalFundsMode, string> = {
  reserve: "Set aside",
  release: "Release funds",
  move: "Move reservation",
};

export function GoalFundsDialog({ goalId, mode, open, onOpenChange }: GoalFundsDialogProps) {
  const { goals, userId, financeSnapshot, refresh, isLoading, isError } = useGoals();
  const walletMetadata = useGoalWalletMetadata(userId);
  const [accountId, setAccountId] = useState("");
  const [destinationGoalId, setDestinationGoalId] = useState("");
  const [amountText, setAmountText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const requestId = useRef<string | null>(null);
  const retryCommand = useRef<FinancialCommand | null>(null);
  const unknownOutcome = useRef(false);
  const recoveringUnknown = unknownOutcome.current && retryCommand.current !== null;
  const opener = useRef<HTMLElement | null>(null);

  const goal = goals.find(item => item.id === goalId);
  const wallets = useMemo(() => {
    if (!financeSnapshot) return [];
    return financeSnapshot.wallets.flatMap(wallet => {
      const eligibleAmount = mode === "reserve"
        ? wallet.available
        : goal?.walletReservations.find(item => item.accountId === wallet.accountId)?.amount ?? "0.00";
      if (toMinorUnits(eligibleAmount) <= 0) return [];
      const metadata = walletMetadata.data?.find(item => item.id === wallet.accountId);
      if (!metadata || !metadata.is_active || metadata.currency !== "PHP" || metadata.type === "credit_card") return [];
      return [{ ...wallet, eligibleAmount, name: metadata?.name ?? "Wallet" }];
    });
  }, [financeSnapshot, goal?.walletReservations, mode, walletMetadata.data]);
  const activeDestinations = goals.filter(item => item.id !== goalId && item.status === "active" && item.review_state === "confirmed" && item.archived_at === null);
  const selectedWallet = wallets.find(wallet => wallet.accountId === accountId);

  useEffect(() => {
    if (!open) return;
    setAccountId("");
    setDestinationGoalId("");
    setAmountText("");
    setError(unknownOutcome.current ? "The previous save has an unknown result. Retry it to confirm the same request." : null);
    setRefreshError(false);
  }, [goalId, mode, open]);

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
      setError("Wallet balances or details still could not load. Try again.");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let command = retryCommand.current;
    if (!command) {
      if (!goal || goal.status !== "active" || goal.review_state !== "confirmed") {
        setError("Confirm this goal before changing its reservations.");
        return;
      }
      if (!selectedWallet) {
        setError(mode === "reserve" ? "Choose a wallet with available funds." : "Choose a wallet with funds reserved for this goal.");
        return;
      }
      let amount: Money;
      try {
        amount = parseMoney(amountText.trim());
        if (toMinorUnits(amount) <= 0 || toMinorUnits(amount) > toMinorUnits(selectedWallet.eligibleAmount)) {
          throw new Error(mode === "reserve" ? "Enter an amount within the wallet's available balance." : "Enter an amount within this goal's reserved balance.");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Enter a valid amount.");
        return;
      }
      if (mode === "move" && !activeDestinations.some(item => item.id === destinationGoalId)) {
        setError("Choose an active goal to receive these funds.");
        return;
      }
      command = mode === "move"
        ? { kind: "reallocate", goalId, destinationGoalId, accountId, amount }
        : { kind: mode, goalId, accountId, amount };
      requestId.current = crypto.randomUUID();
      retryCommand.current = command;
    }

    if (!requestId.current) requestId.current = crypto.randomUUID();
    setPending(true);
    try {
      const outcome = await applyAndRefreshFinancialCommand(requestId.current, command, undefined, refresh);
      requestId.current = null;
      retryCommand.current = null;
      unknownOutcome.current = false;
      if (outcome.refreshError) {
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
        setError(financialCommandMessage(cause, "The reservation could not be saved."));
      }
    } finally {
      setPending(false);
    }
  }

  const busy = pending || walletMetadata.isLoading || isLoading;
  const disabledForGoal = !goal || goal.status !== "active" || goal.review_state !== "confirmed";
  const walletDataError = Boolean(isError || walletMetadata.error);

  return (
    <Dialog.Root open={open} onOpenChange={nextOpen => { if (!pending) onOpenChange(nextOpen); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
          <Dialog.Title className="text-lg font-semibold">{titles[mode]}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">{goal?.name ?? "Goal"} · PHP amounts</Dialog.Description>

          {error && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {walletDataError && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive">Wallet balances or details could not load. Reservation options are unavailable.</p><Button type="button" variant="outline" onClick={() => void retryLoad()}>Retry loading</Button></div>}
          {busy && !pending && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading wallet balances…</p>}
          {refreshError ? (
            <div className="mt-4 space-y-3" role="status">
              <p className="text-sm text-amber-700 dark:text-amber-300">Saved, but the goal summary could not refresh.</p>
              <Button type="button" className="h-11 min-h-11" onClick={() => void retryRefresh()}>Retry refresh</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-4">
              <fieldset disabled={busy || walletDataError || disabledForGoal || unknownOutcome.current} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="goal-funds-wallet" className="text-sm font-medium">Wallet</label>
                  <select id="goal-funds-wallet" value={accountId} onChange={event => setAccountId(event.target.value)} className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="">Choose a wallet</option>
                    {wallets.map(wallet => <option key={wallet.accountId} value={wallet.accountId}>{wallet.name}</option>)}
                  </select>
                  {selectedWallet && <p className="text-xs text-muted-foreground">{mode === "reserve" ? "Available" : "Reserved for this goal"}: PHP {selectedWallet.eligibleAmount}</p>}
                  {!busy && !walletDataError && wallets.length === 0 && <p className="text-xs text-muted-foreground">{mode === "reserve" ? "No wallet has money available to set aside." : "This goal has no reserved funds in a wallet."}</p>}
                </div>

                {mode === "move" && (
                  <div className="space-y-1.5">
                    <label htmlFor="goal-funds-destination" className="text-sm font-medium">Move to goal</label>
                    <select id="goal-funds-destination" value={destinationGoalId} onChange={event => setDestinationGoalId(event.target.value)} className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="">Choose a goal</option>
                      {activeDestinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="goal-funds-amount" className="text-sm font-medium">Amount (PHP)</label>
                  <Input id="goal-funds-amount" type="text" inputMode="decimal" autoComplete="off" value={amountText} onChange={event => setAmountText(event.target.value)} placeholder="0.00" />
                  <p className="text-xs text-muted-foreground">Enter an amount up to PHP {selectedWallet?.eligibleAmount ?? "0.00"}.</p>
                </div>
                {disabledForGoal && <p className="text-sm text-amber-700 dark:text-amber-300">This goal must be active and confirmed before you can change its reservations.</p>}
              </fieldset>

              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="h-11 min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" className="h-11 min-h-11" disabled={pending || (!recoveringUnknown && (busy || walletDataError || disabledForGoal || wallets.length === 0))}>
                  {pending ? "Saving…" : recoveringUnknown ? "Retry same request" : titles[mode]}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
