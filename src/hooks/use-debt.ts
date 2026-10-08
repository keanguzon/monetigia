import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";
import { createDebtAccount, fetchDebtSnapshot, SupersededDebtRequestError } from "@/lib/debt/client";
import { DebtAccountCreateInputSchema, AdoptOpeningDebtCommandSchema, CorrectDebtRowsCommandSchema,
  type DebtAccountCreateInput, type DebtAccountCreateResult, type DebtSnapshot, type CorrectDebtRowsCommand, type AdoptOpeningDebtCommand } from "@/lib/debt/contracts";
import { applyFinancialCommand, FinancialCommandError, FinancialSessionMismatchError, financialCommandMessage } from "@/lib/goals/client";
import type { FinancialResult } from "@/lib/goals/contracts";
import { refreshFinancialData } from "@/lib/refresh-financial-data";
import { createClient } from "@/lib/supabase/client";

type ReadonlyDraft<T> = T extends object ? { readonly [K in keyof T]: ReadonlyDraft<T[K]> } : T;
type CreateDraft = Omit<DebtAccountCreateInput, "requestId">;
type DebtCommand = CorrectDebtRowsCommand | AdoptOpeningDebtCommand;
type WriteState<P, R> = { isSaving: boolean; unresolved: boolean; saved: R | null; error: string | null;
  refreshError: unknown | null; pending: ReadonlyDraft<P> | null };
type Controller<P, R> = { state: WriteState<P, R>; attempt: { requestId: string; payload: P } | null; listeners: Set<() => void> };
const empty = <P, R>(): WriteState<P, R> => ({ isSaving: false, unresolved: false, saved: null, error: null, refreshError: null, pending: null });
const creations = new Map<string, Controller<CreateDraft, DebtAccountCreateResult>>();
const commands = new Map<string, Controller<DebtCommand, FinancialResult>>();
function controllerFor<P, R>(map: Map<string, Controller<P, R>>, userId: string | null): Controller<P, R> {
  const key = userId ?? "signed-out";
  let controller = map.get(key);
  if (!controller) { controller = { state: empty(), attempt: null, listeners: new Set() }; map.set(key, controller); }
  return controller;
}
function patch<P, R>(controller: Controller<P, R>, next: Partial<WriteState<P, R>>) {
  controller.state = { ...controller.state, ...next }; controller.listeners.forEach(listener => listener());
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function clearRefreshError(userId: string) {
  const creation = creations.get(userId); const command = commands.get(userId);
  if (creation) patch(creation, { refreshError: null });
  if (command) patch(command, { refreshError: null });
}

export function useDebt(userId: string | null) {
  const { mutate: mutateCache, cache } = useSWRConfig();
  const [snapshotUserId, setSnapshotUserId] = useState(userId);
  const previousUserId = useRef(userId);
  const selectedUser = useRef({ userId, revision: 0 });
  if (selectedUser.current.userId !== userId) selectedUser.current = { userId, revision: selectedUser.current.revision + 1 };
  const sessionRevision = useRef(0);
  const identityRevision = useRef(0);
  const authSession = useRef<{ userId: string; accessToken: string } | null>(null);
  const readRevision = useRef(0);
  const latestRead = useRef<{ revision: number; selectionRevision: number; userId: string | null; promise: Promise<DebtSnapshot> } | null>(null);
  const fetchForUser = useCallback(() => {
    const requestReadRevision = ++readRevision.current;
    const selection = selectedUser.current;
    const load = async () => {
      let requestSessionRevision = sessionRevision.current;
      const requestIdentityRevision = identityRevision.current;
      const isCurrent = () => readRevision.current === requestReadRevision && selectedUser.current.userId === userId && selectedUser.current.revision === selection.revision && sessionRevision.current === requestSessionRevision;
      let snapshot: DebtSnapshot;
      try { snapshot = await fetchDebtSnapshot(userId!, isCurrent); }
      catch (error) {
        if (!(error instanceof SupersededDebtRequestError) || selectedUser.current.revision !== selection.revision ||
          identityRevision.current !== requestIdentityRevision || sessionRevision.current === requestSessionRevision || authSession.current?.userId !== userId) throw error;
        requestSessionRevision = sessionRevision.current;
        snapshot = await fetchDebtSnapshot(userId!, isCurrent);
      }
      if (isCurrent()) setSnapshotUserId(userId);
      return snapshot;
    };
    const promise = load().catch(error => {
      const newer = latestRead.current;
      // SWR suppresses superseded successes, but its error path can overwrite a newer read.
      if (newer && newer.revision > requestReadRevision && newer.userId === userId && newer.selectionRevision === selection.revision && selectedUser.current.revision === selection.revision) return newer.promise;
      throw error;
    });
    latestRead.current = { revision: requestReadRevision, selectionRevision: selection.revision, userId, promise };
    return promise;
  }, [userId]);
  const { data, error, isLoading } = useSWR<DebtSnapshot>(userId ? ["debtSnapshot", userId] : null, fetchForUser);
  useEffect(() => setSnapshotUserId(userId), [userId]);
  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      const next = session ? { userId: session.user.id, accessToken: session.access_token } : null;
      const previous = authSession.current;
      const repeatedSignIn = event === "SIGNED_IN" && previous !== null && next !== null && previous.userId === next.userId && previous.accessToken === next.accessToken;
      if (event !== "INITIAL_SESSION" && !repeatedSignIn) sessionRevision.current += 1;
      if (event !== "INITIAL_SESSION" && !repeatedSignIn && !((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && next !== null && (previous === null || previous.userId === next.userId))) identityRevision.current += 1;
      authSession.current = next;
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const previous = previousUserId.current; previousUserId.current = userId;
    if (userId !== null || previous === null) return;
    void mutateCache(key => Array.isArray(key) && key[0] === "debtSnapshot", () => undefined, { populateCache: true, revalidate: false });
  }, [mutateCache, userId]);
  const refresh = useCallback(async () => {
    if (!userId) return;
    await refreshFinancialData(userId, mutateCache, cache);
    clearRefreshError(userId);
  }, [userId, mutateCache, cache]);
  return { snapshot: userId && snapshotUserId === userId ? data : undefined, isLoading, error, refresh };
}

function useDebtWrite<P, R>(userId: string | null, map: Map<string, Controller<P, R>>, validate: (payload: P, requestId: string) => P,
  write: (requestId: string, payload: P, owner: string) => Promise<R>) {
  const { mutate: mutateCache, cache } = useSWRConfig();
  const controller = controllerFor(map, userId);
  const currentUser = useRef(userId); currentUser.current = userId;
  const subscribe = useCallback((listener: () => void) => { controller.listeners.add(listener); return () => { controller.listeners.delete(listener); }; }, [controller]);
  const state = useSyncExternalStore(subscribe, () => controller.state, () => controller.state);
  const run = async () => {
    if (!userId || currentUser.current !== userId || controller.state.isSaving || !controller.attempt) return;
    const attempt = controller.attempt;
    const wasUnresolved = controller.state.unresolved;
    patch(controller, { isSaving: true, error: null });
    try {
      const { data: { user }, error } = await createClient().auth.getUser();
      if (error || user?.id !== userId || currentUser.current !== userId) {
        if (!wasUnresolved) controller.attempt = null;
        patch(controller, { isSaving: false, pending: wasUnresolved ? controller.state.pending : null,
          error: "Sign in to the account that started this save before retrying." });
        return;
      }
    } catch {
      if (!wasUnresolved) controller.attempt = null;
      patch(controller, { isSaving: false, pending: wasUnresolved ? controller.state.pending : null, error: "Could not verify the account for this save. Try again." });
      return;
    }
    let saved: R;
    try { saved = await write(attempt.requestId, attempt.payload, userId); }
    catch (error) {
      if (error instanceof FinancialSessionMismatchError && wasUnresolved) {
        patch(controller, { isSaving: false, error: error.message });
        return;
      }
      const unknown = !(error instanceof FinancialCommandError) || error.outcome === "unknown";
      if (!unknown) controller.attempt = null;
      patch(controller, { isSaving: false, unresolved: unknown, pending: unknown ? controller.state.pending : null,
        error: unknown ? "The save could not be confirmed. Retry this same save before starting another." : financialCommandMessage(error, "This save was rejected. Review the details and try again.") });
      return;
    }
    controller.attempt = null;
    patch(controller, { saved, unresolved: false, pending: null });
    try {
      await refreshFinancialData(userId, mutateCache, cache);
      patch(controller, { isSaving: false, refreshError: null });
    } catch (refreshError) { patch(controller, { isSaving: false, refreshError }); }
  };
  const submit = async (payload: P) => {
    if (!userId || currentUser.current !== userId || controller.attempt || controller.state.isSaving || controller.state.saved) return;
    const requestId = crypto.randomUUID();
    let safe: P;
    try { safe = freeze(validate(payload, requestId)); }
    catch (error) { patch(controller, { error: error instanceof Error ? error.message : "Review the save details." }); return; }
    controller.attempt = { requestId, payload: safe };
    patch(controller, { pending: safe as ReadonlyDraft<P>, error: null, refreshError: null });
    await run();
  };
  const reset = () => {
    if (controller.attempt || controller.state.isSaving || controller.state.refreshError) return;
    patch(controller, empty());
  };
  return { ...state, submit, retry: run, reset };
}
const validateCreate = (payload: CreateDraft, requestId: string): CreateDraft => {
  const { requestId: _requestId, ...safe } = DebtAccountCreateInputSchema.parse({ ...payload, requestId }); return safe;
};
const validateCommand = (payload: DebtCommand): DebtCommand => payload.kind === "correct_debt_rows" ? CorrectDebtRowsCommandSchema.parse(payload) : AdoptOpeningDebtCommandSchema.parse(payload);
const writeCreate = (requestId: string, payload: CreateDraft, owner: string) => createDebtAccount({ ...payload, requestId }, owner);
const writeCommand = (requestId: string, payload: DebtCommand, owner: string) => applyFinancialCommand(requestId, payload, undefined, owner);
export function useDebtAccountCreate(userId: string | null) {
  const { pending, submit, ...state } = useDebtWrite(userId, creations, validateCreate, writeCreate);
  return { ...state, pendingInput: pending, create: submit };
}
export function useDebtCommand(userId: string | null) {
  const { pending, ...state } = useDebtWrite(userId, commands, validateCommand, writeCommand);
  return { ...state, pendingCommand: pending };
}
