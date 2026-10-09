import { useCallback, useRef, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import { applyFinancialCommand, FinancialCommandError, FinancialSessionMismatchError, financialCommandMessage } from "@/lib/goals/client";
import { EditTransactionDescriptionCommandSchema, type EditTransactionDescriptionCommand, type FinancialResult } from "@/lib/goals/contracts";
import { refreshFinancialData } from "@/lib/refresh-financial-data";
import { normalizeTransactionDescription } from "@/lib/transactions/description";

type ReadonlyCommand = { readonly [K in keyof EditTransactionDescriptionCommand]: EditTransactionDescriptionCommand[K] };
type State = {
  isSaving: boolean;
  unresolved: boolean;
  saved: FinancialResult | null;
  error: string | null;
  errorCode: FinancialCommandError["code"] | null;
  refreshError: unknown | null;
  pendingCommand: ReadonlyCommand | null;
};
type Attempt = { requestId: string; command: ReadonlyCommand };
type Controller = { state: State; attempt: Attempt | null; listeners: Set<() => void> };

const empty = (): State => ({ isSaving: false, unresolved: false, saved: null, error: null,
  errorCode: null, refreshError: null, pendingCommand: null });
const signedOutState = empty();
const controllers = new Map<string, Controller>();

function controllerFor(userId: string): Controller {
  let controller = controllers.get(userId);
  if (!controller) {
    controller = { state: empty(), attempt: null, listeners: new Set() };
    controllers.set(userId, controller);
  }
  return controller;
}

function patch(controller: Controller, next: Partial<State>) {
  controller.state = { ...controller.state, ...next };
  controller.listeners.forEach(listener => listener());
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function refreshFailure(results: PromiseSettledResult<unknown>[]): unknown | null {
  const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (failures.length === 0) return null;
  return failures.length === 1 ? failures[0] : new AggregateError(failures, "Transaction and financial views could not refresh.");
}

export function useTransactionDescription(userId: string | null, refreshHistory: () => Promise<unknown>) {
  const { mutate: mutateCache, cache } = useSWRConfig();
  const controller = userId ? controllerFor(userId) : null;
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const subscribe = useCallback((listener: () => void) => {
    if (!controller) return () => {};
    controller.listeners.add(listener);
    return () => { controller.listeners.delete(listener); };
  }, [controller]);
  const getSnapshot = useCallback(() => controller?.state ?? signedOutState, [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(async () => {
    if (!userId || !controller) return;
    if (currentUser.current !== userId) {
      patch(controller, { refreshError: new Error("The description was saved, but its views still need a refresh for the original account.") });
      return;
    }
    const results = await Promise.allSettled([
      Promise.resolve().then(refreshHistory),
      Promise.resolve().then(() => refreshFinancialData(userId, mutateCache, cache)),
    ]);
    patch(controller, { refreshError: refreshFailure(results) });
  }, [cache, controller, mutateCache, refreshHistory, userId]);

  const run = useCallback(async () => {
    if (!userId || currentUser.current !== userId || !controller || controller.state.isSaving || !controller.attempt) return;
    const attempt = controller.attempt;
    const wasUnresolved = controller.state.unresolved;
    patch(controller, { isSaving: true, error: null, errorCode: null });
    let saved: FinancialResult;
    try {
      saved = await applyFinancialCommand(attempt.requestId, attempt.command, undefined, userId);
    } catch (error) {
      if (error instanceof FinancialSessionMismatchError && wasUnresolved) {
        patch(controller, { isSaving: false, error: error.message, errorCode: error.code });
        return;
      }
      const unknown = !(error instanceof FinancialCommandError) || error.outcome === "unknown";
      if (!unknown) controller.attempt = null;
      patch(controller, {
        isSaving: false,
        unresolved: unknown,
        pendingCommand: unknown ? attempt.command : null,
        error: unknown
          ? "The save could not be confirmed. Retry this same description edit before starting another."
          : financialCommandMessage(error, "This description edit was rejected. Review it and try again."),
        errorCode: error instanceof FinancialCommandError ? error.code : null,
      });
      return;
    }

    controller.attempt = null;
    patch(controller, { saved, unresolved: false, pendingCommand: null, error: null, errorCode: null });
    await refresh();
    patch(controller, { isSaving: false });
  }, [controller, refresh, userId]);

  const submit = useCallback(async (command: EditTransactionDescriptionCommand) => {
    if (!userId || currentUser.current !== userId || !controller || controller.attempt || controller.state.isSaving || controller.state.saved) return;
    try {
      const parsed = EditTransactionDescriptionCommandSchema.parse(command);
      const safe = freeze({
        ...parsed,
        description: normalizeTransactionDescription(parsed.description),
        expectedDescription: normalizeTransactionDescription(parsed.expectedDescription),
      });
      const attempt = { requestId: crypto.randomUUID(), command: safe };
      controller.attempt = attempt;
      patch(controller, { pendingCommand: safe, unresolved: false, error: null, errorCode: null, refreshError: null });
      await run();
    } catch (error) {
      if (controller.attempt || controller.state.isSaving) return;
      patch(controller, { error: error instanceof Error ? error.message : "Review the description edit.", errorCode: null });
    }
  }, [controller, run, userId]);

  const reset = useCallback(() => {
    if (!controller || controller.attempt || controller.state.isSaving) return;
    patch(controller, empty());
  }, [controller]);

  return { ...state, submit, retry: run, refresh, reset };
}
