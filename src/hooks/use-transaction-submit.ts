import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useGoals } from "@/hooks/use-goals";
import { FinancialCommandError, financialCommandMessage, quoteTransaction } from "@/lib/goals/client";
import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
import { createClient } from "@/lib/supabase/client";
import type { FinancialCommand, FinancialResult, ReleaseLine, TransactionDraft, TransactionQuote } from "@/lib/goals/contracts";

type Phase = "editing" | "quoting" | "review" | "saving" | "saved";
type Attempt = { requestId: string; command: FinancialCommand; quote: TransactionQuote };
type State = { phase: Phase; error: string | null; saved: FinancialResult | null; refreshError: unknown | null;
  transactionQuote: TransactionQuote | null; draft: TransactionDraft | null; unresolved: boolean };
type Controller = { state: State; attempt: Attempt | null; revision: number; listeners: Set<() => void> };
const empty = (): State => ({ phase: "editing", error: null, saved: null, refreshError: null, transactionQuote: null, draft: null, unresolved: false });
// An unresolved write belongs to the user, not the lifetime of a dialog.
const controllers = new Map<string, Controller>();
const signedOut: Controller = { state: empty(), attempt: null, revision: 0, listeners: new Set() };
function forUser(userId: string | null): Controller {
  if (!userId) return signedOut;
  let controller = controllers.get(userId);
  if (!controller) { controller = { state: empty(), attempt: null, revision: 0, listeners: new Set() }; controllers.set(userId, controller); }
  return controller;
}
function update(controller: Controller, patch: Partial<State>) {
  controller.state = { ...controller.state, ...patch };
  controller.listeners.forEach(listener => listener());
}
function message(error: unknown, fallback: string) {
  return error instanceof FinancialCommandError ? financialCommandMessage(error, fallback) : fallback;
}

export function useTransactionSubmit() {
  const { userId, refresh } = useGoals();
  const controller = forUser(userId);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (controller.state.phase === "quoting") {
        controller.revision += 1;
        update(controller, empty());
      }
    };
  }, [controller]);
  const subscribe = useCallback((listener: () => void) => { controller.listeners.add(listener); return () => { controller.listeners.delete(listener); }; }, [controller]);
  const state = useSyncExternalStore(subscribe, () => controller.state, () => controller.state);

  const reset = useCallback(() => {
    if (controller.attempt || controller.state.phase === "saving") return;
    controller.revision += 1;
    update(controller, empty());
  }, [controller]);

  const fetchQuote = async (draft: TransactionDraft, releases?: ReleaseLine[], requireConfirmation = false) => {
    if (!userId || currentUser.current !== userId || !alive.current || controller.attempt || controller.state.phase === "saving" || controller.state.phase === "saved") return;
    const revision = ++controller.revision;
    update(controller, { phase: "quoting", error: null, transactionQuote: null, draft });
    try {
      const next = await quoteTransaction(draft, releases);
      if (controller.revision !== revision || currentUser.current !== userId || !alive.current) return;
      update(controller, { phase: "review", transactionQuote: next });
      if (!requireConfirmation && next.releases.length === 0) await confirm();
    } catch (error) {
      if (controller.revision !== revision) return;
      update(controller, { phase: "editing", error: message(error, "Could not check this transaction. Try again.") });
    }
  };

  const confirm = async () => {
    if (!userId || currentUser.current !== userId || !alive.current || controller.state.phase !== "review") return;
    const { draft, transactionQuote } = controller.state;
    if (!draft || !transactionQuote) return;
    const wasUnresolved = controller.state.unresolved;
    const attempt = controller.attempt ?? { requestId: crypto.randomUUID(), command: { kind: "transaction", draft } as FinancialCommand, quote: transactionQuote };
    controller.attempt = attempt;
    update(controller, { phase: "saving", error: null });
    try {
      const { data: { user } } = await createClient().auth.getUser();
      if (user?.id !== userId || currentUser.current !== userId) {
        if (!wasUnresolved) controller.attempt = null;
        update(controller, { phase: wasUnresolved ? "review" : "editing", error: "Sign in to the account that started this transaction before retrying." });
        return;
      }
      const outcome = await applyAndRefreshFinancialCommand(attempt.requestId, attempt.command, attempt.quote, refresh);
      controller.attempt = null;
      update(controller, { phase: "saved", saved: outcome.saved, refreshError: outcome.refreshError, unresolved: false });
    } catch (error) {
      if (!(error instanceof FinancialCommandError) || error.outcome === "unknown") {
        update(controller, { phase: "review", unresolved: true, error: "The save could not be confirmed. Retry this same transaction before starting another." });
        return;
      }
      controller.attempt = null;
      update(controller, { phase: "editing", unresolved: false, error: message(error, "This transaction could not be saved. Review the details and try again.") });
      if (error.code === "STALE_QUOTE") {
        await fetchQuote(draft, undefined, true);
        if (controller.state.phase === "review") update(controller, { error: "Wallet reservations changed. Review the updated amounts and confirm again." });
      }
    }
  };

  return { ...state, quote: fetchQuote, confirm, reset };
}

type DeleteState = { isDeleting: boolean; pendingTransactionId: string | null; savedTransactionId: string | null; error: string | null; refreshError: unknown | null };
type DeleteController = { state: DeleteState; requestId: string | null; listeners: Set<() => void> };
const deletions = new Map<string, DeleteController>();
export function useTransactionDelete(refreshList: () => Promise<unknown>) {
  const { userId, refresh } = useGoals();
  const key = userId ?? "signed-out";
  if (!deletions.has(key)) deletions.set(key, { state: { isDeleting: false, pendingTransactionId: null, savedTransactionId: null, error: null, refreshError: null }, requestId: null, listeners: new Set() });
  const controller = deletions.get(key)!;
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const subscribe = useCallback((listener: () => void) => { controller.listeners.add(listener); return () => { controller.listeners.delete(listener); }; }, [controller]);
  const state = useSyncExternalStore(subscribe, () => controller.state, () => controller.state);
  const patch = (values: Partial<DeleteState>) => { controller.state = { ...controller.state, ...values }; controller.listeners.forEach(listener => listener()); };
  const remove = async (transactionId: string) => {
    if (!userId || currentUser.current !== userId || controller.state.isDeleting || controller.state.savedTransactionId === transactionId || (controller.state.pendingTransactionId && controller.state.pendingTransactionId !== transactionId)) return;
    const wasUnresolved = controller.requestId !== null;
    controller.requestId ??= crypto.randomUUID();
    patch({ isDeleting: true, pendingTransactionId: transactionId, error: null, savedTransactionId: null, refreshError: null });
    try {
      const { data: { user } } = await createClient().auth.getUser();
      if (user?.id !== userId || currentUser.current !== userId) {
        if (!wasUnresolved) controller.requestId = null;
        patch({ isDeleting: false, pendingTransactionId: wasUnresolved ? transactionId : null, error: "Sign in to the account that started this deletion before retrying." });
        return;
      }
      const outcome = await applyAndRefreshFinancialCommand(controller.requestId, { kind: "delete_transaction", transactionId }, undefined, async () => {
        const results = await Promise.allSettled([refresh(), refreshList()]);
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      });
      controller.requestId = null;
      patch({ isDeleting: false, pendingTransactionId: null, savedTransactionId: transactionId, refreshError: outcome.refreshError });
    } catch (error) {
      const unknown = !(error instanceof FinancialCommandError) || error.outcome === "unknown";
      if (!unknown) controller.requestId = null;
      patch({ isDeleting: false, pendingTransactionId: unknown ? transactionId : null,
        error: unknown ? "The deletion could not be confirmed. Retry the same deletion before deleting another transaction." : message(error, "This transaction could not be deleted. Review its wallet and reservations.") });
    }
  };
  return { ...state, remove };
}
