import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SWRConfig, unstable_serialize, useSWRConfig } from "swr";
const state = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getSession: vi.fn(), listeners: [] as any[] }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getUser: state.getUser, getSession: state.getSession, onAuthStateChange: (listener: any) => {
    state.listeners.push(listener); return { data: { subscription: { unsubscribe() {} } } };
  } },
  rpc: (...args: unknown[]) => {
    const promise = Promise.resolve().then(() => state.rpc(...args));
    return { setHeader: () => promise, then: promise.then.bind(promise) };
  },
}) }));
import * as hooks from "@/hooks/use-debt";
import { refreshFinancialData } from "@/lib/refresh-financial-data";
const accountId = "20000000-0000-4000-8000-000000000002";
let serial = 0;
let owner: string;
let cache: Map<any, any>;
let wrapper: ({ children }: { children: React.ReactNode }) => React.ReactElement;
const input = () => ({ account: { name: "Card", type: "credit_card" as const, currency: "PHP" as const, color: null, icon: null,
  is_savings: false as const, interest_rate: 0 as const, include_in_networth: true, display_order: 0 },
  openingDebts: [{ clientId: "a", name: "Original", mode: "single" as const, amount: "12.30", firstDueDate: "2026-10-08", count: 1 }] });
const command = () => ({ kind: "adopt_opening_debt" as const, accountId, fingerprint: "a".repeat(64), items: input().openingDebts });
const savedCreate = { accountId, debtItemIds: [], replayed: false };
const savedCommand = { operationId: accountId, transactionIds: [], replayed: false };
beforeEach(() => {
  owner = `10000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
  state.rpc.mockReset(); state.listeners = [];
  state.getUser.mockReset().mockImplementation(async () => ({ data: { user: { id: owner } }, error: null }));
  state.getSession.mockReset().mockImplementation(async () => ({ data: { session: { user: { id: owner }, access_token: "token" } }, error: null }));
  cache = new Map(); wrapper = ({ children }) => <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>{children}</SWRConfig>;
});
afterEach(cleanup);
for (const mode of ["create", "command"] as const) {
  const useWrite = (id: string | null) => mode === "create" ? hooks.useDebtAccountCreate(id) : hooks.useDebtCommand(id);
  const send = (api: any, payload: any) => mode === "create" ? api.create(payload) : api.submit(payload);
  const payload = () => mode === "create" ? input() : command();
  const result = () => mode === "create" ? savedCreate : savedCommand;
  test(`${mode}: unknown attempt survives unmount and freezes original payload for explicit same-ID retry`, async () => {
    state.rpc.mockRejectedValue(new Error("network"));
    const view = renderHook(() => useWrite(owner), { wrapper }); const draft = payload();
    await act(async () => { await send(view.result.current, draft); });
    expect(view.result.current.unresolved).toBe(true);
    const original = structuredClone(state.rpc.mock.calls[0][1]);
    if ("items" in draft) draft.items[0].name = "Changed"; else draft.openingDebts[0].name = "Changed";
    await act(async () => { view.result.current.reset(); await send(view.result.current, payload()); });
    expect(state.rpc).toHaveBeenCalledTimes(1); view.unmount();
    const reopened = renderHook(() => useWrite(owner), { wrapper });
    const pending = mode === "create" ? (reopened.result.current as any).pendingInput : (reopened.result.current as any).pendingCommand;
    expect((pending.items ?? pending.openingDebts)[0].name).toBe("Original");
    expect(Object.isFrozen((pending.items ?? pending.openingDebts)[0])).toBe(true);
    state.rpc.mockResolvedValue({ data: result(), error: null });
    await act(async () => { await reopened.result.current.retry(); });
    expect(state.rpc.mock.calls[1][1]).toEqual(original); expect(reopened.result.current.saved).toEqual(result());
    expect(reopened.result.current.unresolved).toBe(false);
  });
  test(`${mode}: simultaneous submits and reset cannot replace a saving attempt`, async () => {
    let resolve!: (value: unknown) => void;
    state.rpc.mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = renderHook(() => useWrite(owner), { wrapper });
    let first!: Promise<void>;
    act(() => { first = send(view.result.current, payload()); });
    await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
    await act(async () => { view.result.current.reset(); await send(view.result.current, payload()); await view.result.current.retry(); });
    expect(view.result.current.isSaving).toBe(true); expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ data: result(), error: null }); await first; });
  });
  test(`${mode}: another owner cannot see or resend unresolved work, original owner can recover`, async () => {
    state.rpc.mockRejectedValue(new Error("network"));
    const originalOwner = owner;
    const view = renderHook(({ id }) => useWrite(id), { wrapper, initialProps: { id: owner as string | null } });
    await act(async () => { await send(view.result.current, payload()); });
    owner = accountId; view.rerender({ id: owner }); expect(view.result.current.unresolved).toBe(false);
    await act(async () => { await view.result.current.retry(); }); expect(state.rpc).toHaveBeenCalledTimes(1);
    view.rerender({ id: originalOwner });
    await act(async () => { await view.result.current.retry(); }); expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(view.result.current.unresolved).toBe(true);
    owner = originalOwner; state.rpc.mockResolvedValue({ data: result(), error: null });
    await act(async () => { await view.result.current.retry(); }); expect(view.result.current.saved).toEqual(result());
  });
  test(`${mode}: known request conflict releases attempt for editing`, async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "REQUEST_CONFLICT" } });
    const view = renderHook(() => useWrite(owner), { wrapper });
    await act(async () => { await send(view.result.current, payload()); });
    expect(view.result.current.unresolved).toBe(false); expect(view.result.current.error).toBeTruthy();
    state.rpc.mockResolvedValue({ data: result(), error: null });
    await act(async () => { await send(view.result.current, payload()); });
    expect(state.rpc.mock.calls[0][1].p_request_id).not.toBe(state.rpc.mock.calls[1][1].p_request_id);
  });
  test(`${mode}: saved refresh failure allows refresh-only recovery and blocks another write`, async () => {
    let failRefresh = false;
    state.rpc.mockImplementation(async (name: string) => name === "debt_snapshot"
      ? { data: failRefresh ? null : { accounts: [], rows: [] }, error: failRefresh ? { message: "unavailable" } : null }
      : { data: result(), error: null });
    const view = renderHook(() => ({ debt: hooks.useDebt(owner), write: useWrite(owner) }), { wrapper });
    await waitFor(() => expect(view.result.current.debt.snapshot).toBeDefined());
    failRefresh = true;
    await act(async () => { await send(view.result.current.write, payload()); });
    expect(view.result.current.write.saved).toEqual(result());
    expect(view.result.current.write.refreshError).toBeTruthy();
    expect(view.result.current.write.unresolved).toBe(false);
    const count = state.rpc.mock.calls.filter(([name]) => name !== "debt_snapshot").length;
    await act(async () => { view.result.current.write.reset(); await view.result.current.write.retry(); await send(view.result.current.write, payload()); });
    expect(state.rpc.mock.calls.filter(([name]) => name !== "debt_snapshot")).toHaveLength(count);
    failRefresh = false;
    await act(async () => { await view.result.current.debt.refresh(); });
    expect(view.result.current.write.refreshError).toBeNull();
    expect(view.result.current.write.saved).toEqual(result());
    expect(state.rpc.mock.calls.filter(([name]) => name !== "debt_snapshot")).toHaveLength(count);
  });
  test(`${mode}: delayed owner verification cannot send after the selected owner changes`, async () => {
    let resolve!: (value: unknown) => void;
    state.getUser.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const originalOwner = owner;
    const view = renderHook(({ id }) => useWrite(id), { wrapper, initialProps: { id: owner } });
    let pending!: Promise<void>;
    act(() => { pending = send(view.result.current, payload()); });
    owner = accountId; view.rerender({ id: owner });
    await act(async () => { resolve({ data: { user: { id: originalOwner } }, error: null }); await pending; });
    expect(state.rpc).not.toHaveBeenCalled();
    view.rerender({ id: originalOwner });
    expect(view.result.current.isSaving).toBe(false); expect(view.result.current.unresolved).toBe(false);
  });
  test(`${mode}: session mismatch after owner check preserves an already unknown attempt`, async () => {
    state.rpc.mockRejectedValue(new Error("network"));
    const view = renderHook(() => useWrite(owner), { wrapper });
    await act(async () => { await send(view.result.current, payload()); });
    const original = structuredClone(state.rpc.mock.calls[0][1]);
    state.getSession.mockResolvedValueOnce({ data: { session: { user: { id: accountId }, access_token: "other" } }, error: null });
    await act(async () => { await view.result.current.retry(); });
    expect(view.result.current.unresolved).toBe(true); expect(state.rpc).toHaveBeenCalledTimes(1);
    state.rpc.mockResolvedValue({ data: result(), error: null });
    await act(async () => { await view.result.current.retry(); });
    expect(state.rpc.mock.calls[1][1]).toEqual(original);
  });
}
test("snapshot owner switch discards out-of-order data and signout clears debt cache", async () => {
  let resolve!: (value: unknown) => void;
  state.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValue({ data: { accounts: [], rows: [] }, error: null });
  const view = renderHook(({ id }) => hooks.useDebt(id), { wrapper, initialProps: { id: owner as string | null } });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  const firstOwner = owner; owner = accountId; view.rerender({ id: owner });
  await waitFor(() => expect(view.result.current.snapshot).toEqual({ accounts: [], rows: [] }));
  await act(async () => { resolve({ data: { accounts: [], rows: [] }, error: null }); });
  expect(cache.get(unstable_serialize(["debtSnapshot", firstOwner]))?.data).toBeUndefined();
  view.rerender({ id: null }); await waitFor(() => expect(view.result.current.snapshot).toBeUndefined());
  await waitFor(() => expect(cache.get(unstable_serialize(["debtSnapshot", owner]))?.data).toBeUndefined());
});
test("same-user token renewal recovers the superseded snapshot without an identity change", async () => {
  let token = "old"; let resolve!: (value: unknown) => void;
  state.getSession.mockImplementation(async () => ({ data: { session: { user: { id: owner }, access_token: token } }, error: null }));
  state.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue({ data: { accounts: [], rows: [] }, error: null });
  const view = renderHook(() => hooks.useDebt(owner), { wrapper });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  await act(async () => {
    state.listeners.forEach(listener => listener("INITIAL_SESSION", { user: { id: owner }, access_token: token }));
    token = "renewed";
    state.listeners.forEach(listener => listener("TOKEN_REFRESHED", { user: { id: owner }, access_token: token }));
    resolve({ data: { accounts: [], rows: [] }, error: null });
  });
  await waitFor(() => expect(view.result.current.snapshot).toEqual({ accounts: [], rows: [] }));
  expect(state.rpc).toHaveBeenCalledTimes(2);
});
test("financial refresh matches exactly the selected owner's debt snapshot and reports its scoped error", async () => {
  const other = accountId;
  const seen: string[] = [];
  const error = new Error("debt unavailable");
  const selected = ["debtSnapshot", owner]; const foreign = ["debtSnapshot", other];
  cache.set(unstable_serialize(selected), { _k: selected, data: { accounts: [], rows: [] } });
  cache.set(unstable_serialize(foreign), { _k: foreign, data: { accounts: [], rows: [] } });
  const view = renderHook(() => useSWRConfig(), { wrapper });
  const mutateCache = (async (filter: any, ...args: any[]) => {
    for (const key of [selected, foreign]) if (filter(key) && args.length === 0) {
      seen.push(key[1]); cache.set(unstable_serialize(key), { _k: key, error });
    }
  }) as any;
  await expect(refreshFinancialData(owner, mutateCache, view.result.current.cache)).rejects.toMatchObject({ failures: [error] });
  expect(seen).toEqual([owner]);
});
test("correction submits exact account, selected row IDs and fingerprint through financial dispatcher", async () => {
  state.rpc.mockResolvedValue({ data: savedCommand, error: null });
  const view = renderHook(() => hooks.useDebtCommand(owner), { wrapper });
  const correction = { kind: "correct_debt_rows" as const, accountId, rowIds: [accountId], fingerprint: "b".repeat(64) };
  await act(async () => { await view.result.current.submit(correction); });
  expect(state.rpc.mock.calls[0]).toEqual(["goal_finance_apply", { p_request_id: expect.any(String), p_command: correction, p_quote: null }]);
  expect(view.result.current.saved).toEqual(savedCommand);
});
