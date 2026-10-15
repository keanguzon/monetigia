import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig, useSWRConfig } from "swr";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getSession: vi.fn(), table: vi.fn(), writes: [] as unknown[], selects: [] as string[], listeners: new Set<(event: string, session: unknown) => void>() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getUser: state.getUser, getSession: state.getSession, onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
    state.listeners.add(callback); return { data: { subscription: { unsubscribe: () => state.listeners.delete(callback) } } };
  } },
  rpc: (...args: unknown[]) => query(() => state.rpc(...args)),
  from: (table: string) => {
    let operation = "read"; let payload: unknown; let owner: string;
    const builder = {
      select: (columns: string) => { state.selects.push(columns); return builder; },
      eq: (_column: string, value: string) => { owner = value; return builder; },
      upsert: (value: unknown, options: unknown) => { operation = "save"; payload = value; state.writes.push({ table, value, options }); return builder; },
      delete: () => { operation = "remove"; state.writes.push({ table, operation }); return builder; },
      maybeSingle: () => builder, single: () => builder,
      setHeader: (_name: string, _token: string) => builder,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(() => state.table(operation, payload, owner)).then(resolve, reject),
    }; return builder;
  },
}) }));
function query(run: () => unknown) {
  const builder = { setHeader: () => builder, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject) }; return builder;
}

import { useSpendingLimit, useSpendingLimitCommand, useSpendingSummary } from "@/hooks/use-spending";
import { parseSpendingSummary, SpendingSummaryError } from "@/lib/spending/summary";
import { applyAndRefreshFinancialCommand, refreshFinancialData } from "@/lib/refresh-financial-data";
import { useSpendingOwner } from "@/hooks/use-spending-owner";
import { useTransactionDescription } from "@/hooks/use-transaction-description";
import type { FinancialCommand } from "@/lib/goals/contracts";

const month = { kind: "month" as const, start: "2026-10-01", end: "2026-10-31" };
const today = new Date(2026, 9, 15);
let owner = "owner-a";
const session = (id: string) => ({ user: { id }, access_token: `${id}-token` });
const payload = (start = "2026-10-01", end = "2026-10-15", spent = "12.34") => ({ start, end, spent, expenses: spent, debtPayments: "0.00", income: "1.00", net: "-11.34", categories: [{ categoryId: null, name: "Uncategorized", amount: spent }], transactionCount: 2, excludedCurrencyTransactionCount: 1 });
const wrapper = ({ children }: { children: React.ReactNode }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0, revalidateOnFocus: false }}>{children}</SWRConfig>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function auth(id: string | null) { owner = id ?? ""; state.listeners.forEach(callback => callback(id ? "SIGNED_IN" : "SIGNED_OUT", id ? session(id) : null)); }
beforeEach(() => {
  owner = "owner-a"; state.listeners.clear(); state.writes = []; state.selects = [];
  state.getUser.mockReset().mockImplementation(async () => ({ data: { user: owner ? { id: owner } : null }, error: null }));
  state.getSession.mockReset().mockImplementation(async () => ({ data: { session: owner ? session(owner) : null }, error: null }));
  state.rpc.mockReset().mockImplementation(async (_name: string, args: { p_start: string; p_end: string }) => ({ data: payload(args.p_start, args.p_end), error: null }));
  state.table.mockReset().mockResolvedValue({ data: null, error: null });
});
afterEach(cleanup);

test("exact signed money survives parsing, while numeric, malformed and unsafe aggregates fail explicitly", () => {
  expect(parseSpendingSummary(payload()).net).toBe("-11.34");
  for (const value of [12.34, "NaN", "90071992547409.92"]) expect(() => parseSpendingSummary({ ...payload(), spent: value })).toThrow(SpendingSummaryError);
  expect(() => parseSpendingSummary({ ...payload(), categories: [{ name: "Food", amount: "bad" }] })).toThrow(SpendingSummaryError);
});

test("current and comparison requests use effective ranges and change with the period", async () => {
  const view = renderHook(({ period }) => useSpendingSummary(period, today), { wrapper, initialProps: { period: month } });
  await waitFor(() => expect(view.result.current.data?.spent).toBe("12.34"));
  expect(state.rpc.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining([{ p_start: "2026-10-01", p_end: "2026-10-15" }, { p_start: "2026-09-01", p_end: "2026-09-15" }]));
  view.rerender({ period: { ...month, start: "2026-09-01", end: "2026-09-30" } });
  await waitFor(() => expect(view.result.current.data?.end).toBe("2026-09-30"));
});

test("All time and future periods suppress both requests", async () => {
  const view = renderHook(({ period }) => useSpendingSummary(period, today), { wrapper, initialProps: { period: null as typeof month | null } });
  await waitFor(() => expect(state.getUser).toHaveBeenCalled());
  view.rerender({ period: { ...month, start: "2026-11-01", end: "2026-11-30" } });
  await act(async () => {});
  expect(state.rpc).not.toHaveBeenCalled(); expect(view.result.current.data).toBeUndefined(); expect(view.result.current.comparison).toBeUndefined();
});

test("comparison failure leaves current data intact and retry recovers both", async () => {
  state.rpc.mockImplementation(async (_name: string, args: { p_start: string; p_end: string }) => ({ data: args.p_start === "2026-09-01" ? {} : payload(args.p_start, args.p_end), error: null }));
  const view = renderHook(() => useSpendingSummary(month, today), { wrapper });
  await waitFor(() => expect(view.result.current.comparisonError).toBeInstanceOf(SpendingSummaryError));
  expect(view.result.current.data?.spent).toBe("12.34"); expect(view.result.current.comparison).toBeUndefined();
  state.rpc.mockImplementation(async (_name: string, args: { p_start: string; p_end: string }) => ({ data: payload(args.p_start, args.p_end), error: null }));
  await act(async () => { await view.result.current.retry(); });
  expect(view.result.current.comparison?.spent).toBe("12.34"); expect(view.result.current.comparisonError).toBeUndefined();
});

test("late initial identity and old owner responses cannot overwrite a newer owner", async () => {
  const identity = deferred<{ data: { user: { id: string } }; error: null }>();
  state.getUser.mockReturnValue(identity.promise);
  const late = deferred<{ data: ReturnType<typeof payload>; error: null }>();
  state.rpc.mockImplementation(() => owner === "owner-a" ? late.promise : Promise.resolve({ data: { ...payload(), income: "9.00" }, error: null }));
  const view = renderHook(() => useSpendingSummary(month, today), { wrapper });
  await act(async () => { auth("owner-a"); });
  await waitFor(() => expect(state.rpc).toHaveBeenCalled());
  await act(async () => { auth("owner-b"); });
  await waitFor(() => expect(view.result.current.data?.income).toBe("9.00"));
  await act(async () => { identity.resolve({ data: { user: { id: "owner-a" } }, error: null }); late.resolve({ data: payload(), error: null }); });
  expect(view.result.current.data?.income).toBe("9.00");
  await act(async () => { auth(null); }); expect(view.result.current.data).toBeUndefined();
});

test("Strict Mode's abandoned identity lookup cannot override its replacement lookup", async () => {
  const abandoned = deferred<{ data: { user: { id: string } }; error: null }>();
  state.getUser.mockReturnValueOnce(abandoned.promise).mockResolvedValue({ data: { user: { id: "owner-b" } }, error: null });
  const strictWrapper = ({ children }: { children: React.ReactNode }) => <React.StrictMode>{children}</React.StrictMode>;
  const view = renderHook(() => useSpendingOwner(), { wrapper: strictWrapper });
  await waitFor(() => expect(view.result.current.userId).toBe("owner-b"));
  await act(async () => { abandoned.resolve({ data: { user: { id: "owner-a" } }, error: null }); });
  expect(view.result.current.userId).toBe("owner-b");
});

test("malformed current data exposes a load error while valid comparison remains available", async () => {
  state.rpc.mockImplementation(async (_name: string, args: { p_start: string; p_end: string }) => ({ data: args.p_start === "2026-10-01" ? { ...payload(), spent: "90071992547409.92" } : payload(args.p_start, args.p_end), error: null }));
  const view = renderHook(() => useSpendingSummary(month, today), { wrapper });
  await waitFor(() => expect(view.result.current.error).toBeInstanceOf(SpendingSummaryError));
  expect(view.result.current.data).toBeUndefined(); expect(view.result.current.comparison?.spent).toBe("12.34");
});

test("a response started before sign-out stays superseded after the same owner signs back in", async () => {
  const old = deferred<{ data: ReturnType<typeof payload>; error: null }>();
  state.rpc.mockReturnValue(old.promise);
  const view = renderHook(() => useSpendingSummary(month, today), { wrapper });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
  await act(async () => { auth(null); });
  await act(async () => { auth("owner-a"); old.resolve({ data: payload(), error: null }); });
  expect(view.result.current.data).toBeUndefined();
});

test("unresolved limit commands and mismatched returned owners cannot report a saved limit", async () => {
  const identity = deferred<{ data: { user: { id: string } }; error: null }>(); state.getUser.mockReturnValue(identity.promise);
  const view = renderHook(() => useSpendingLimitCommand(), { wrapper });
  await act(async () => { await expect(view.result.current.save("1.00", "month")).rejects.toThrow(); }); expect(state.writes).toHaveLength(0);
  await act(async () => { identity.resolve({ data: { user: { id: owner } }, error: null }); });
  state.table.mockResolvedValue({ data: { user_id: "owner-b", amount: "1.00", cadence: "month" }, error: null });
  await act(async () => { await expect(view.result.current.save("1.00", "month")).rejects.toThrow("different account"); });
  expect(view.result.current.error).toBeTruthy(); expect(state.table).toHaveBeenCalledTimes(1);
});

test("identity failures are errors and signed out is an absent reader", async () => {
  state.getUser.mockResolvedValue({ data: { user: null }, error: new Error("identity unavailable") });
  const view = renderHook(() => useSpendingLimit(), { wrapper });
  await waitFor(() => expect(view.result.current.error).toBeTruthy()); expect(state.table).not.toHaveBeenCalled();
  await act(async () => { auth(null); }); expect(view.result.current.error).toBeNull(); expect(view.result.current.limit).toBeNull();
});

test("limit reads request decimal text and keep read failures distinct from absent rows", async () => {
  state.table.mockResolvedValue({ data: { user_id: owner, amount: "6000.01", cadence: "cutoff" }, error: null });
  const view = renderHook(() => useSpendingLimit(), { wrapper });
  await waitFor(() => expect(view.result.current.limit).toEqual({ amount: "6000.01", cadence: "cutoff" }));
  expect(state.selects[0]).toContain("amount::text");
  await act(async () => { auth("owner-b"); });
  state.table.mockResolvedValue({ data: null, error: new Error("read failed") });
  await waitFor(() => expect(view.result.current.error).toBeTruthy()); expect(view.result.current.limit).toBeUndefined();
});

test("limit save returns a confirmed receipt even when refresh fails and never repeats the write", async () => {
  let reads = 0;
  state.table.mockImplementation(async (operation: string, value: unknown) => operation === "save" ? { data: value, error: null } : ++reads > 1 ? { data: null, error: new Error("refresh offline") } : { data: null, error: null });
  const view = renderHook(() => ({ reader: useSpendingLimit(), command: useSpendingLimitCommand() }), { wrapper });
  await waitFor(() => expect(view.result.current.reader.isLoading).toBe(false));
  let outcome: unknown;
  await act(async () => { outcome = await view.result.current.command.save("6000.01", "cutoff"); });
  expect(outcome).toMatchObject({ saved: { amount: "6000.01", cadence: "cutoff" }, refreshError: expect.anything() });
  expect(state.writes).toEqual([{ table: "spending_limits", value: { user_id: "owner-a", amount: "6000.01", cadence: "cutoff" }, options: { onConflict: "user_id" } }]);
  expect(state.selects.every(select => select.includes("amount::text"))).toBe(true);
});

test("old callbacks and a changed owner during save validation cannot write another owner's limit", async () => {
  const view = renderHook(() => useSpendingLimitCommand(), { wrapper });
  await waitFor(() => expect(state.getUser).toHaveBeenCalled()); await act(async () => {});
  const staleSave = view.result.current.save; const staleRemove = view.result.current.remove;
  const token = deferred<{ data: { session: ReturnType<typeof session> }; error: null }>(); state.getSession.mockReturnValue(token.promise);
  let pending!: Promise<unknown>;
  act(() => { pending = staleSave("10.00", "month").catch(error => error); });
  await act(async () => { auth("owner-b"); token.resolve({ data: { session: session("owner-b") }, error: null }); await pending; });
  await act(async () => { await staleRemove().catch(() => {}); await staleSave("10.00", "month").catch(() => {}); });
  expect(state.writes).toHaveLength(0);
});

test("limit removal checks returned owner and refreshes only after confirmed deletion", async () => {
  state.table.mockImplementation(async (operation: string) => ({ data: operation === "remove" ? [{ user_id: owner, amount: "10.00", cadence: "month" }] : null, error: null }));
  const view = renderHook(() => ({ reader: useSpendingLimit(), command: useSpendingLimitCommand() }), { wrapper });
  await waitFor(() => expect(view.result.current.reader.isLoading).toBe(false));
  await act(async () => { expect(await view.result.current.command.remove()).toEqual({ saved: null, refreshError: null }); });
  expect(state.writes).toEqual([{ table: "spending_limits", operation: "remove" }]);
});

test("shared financial refresh revalidates spending and dashboard keys only for the requested owner", async () => {
  let value = 1;
  const view = renderHook(() => ({ config: useSWRConfig(), own: useSWR(["spending-summary", "owner-a", "2026-10-01", "2026-10-15"], () => value), dashboard: useSWR(["dashboardStats", "owner-a", "start", "end", "previousStart", "previousEnd"], () => value), other: useSWR(["spending-summary", "owner-b", "start", "end"], () => value) }), { wrapper });
  await waitFor(() => expect(view.result.current.own.data).toBe(1)); value = 2;
  await act(async () => { await refreshFinancialData("owner-a", view.result.current.config.mutate, view.result.current.config.cache); });
  expect(view.result.current.own.data).toBe(2); expect(view.result.current.dashboard.data).toBe(2); expect(view.result.current.other.data).toBe(1);
});

test("confirmed expense, debt payment and reversal commands refresh spending, while a rejected save does not", async () => {
  const id = "20000000-0000-4000-8000-000000000001";
  const otherId = "20000000-0000-4000-8000-000000000002";
  const draft = { type: "expense" as const, accountId: id, transferToAccountId: null, categoryId: null, goalId: null, amount: "1.00", description: null, date: "2026-10-15", installments: null, reservationMoves: [] };
  const commands: FinancialCommand[] = [{ kind: "transaction", draft }, { kind: "transaction", draft: { ...draft, type: "transfer", transferToAccountId: otherId } }, { kind: "delete_transaction", transactionId: id }];
  const quote = { fingerprint: "current", actual: "10.00", reserved: "0.00", available: "10.00", releases: [] };
  let version = 1;
  const view = renderHook(() => ({ config: useSWRConfig(), summary: useSWR(["spending-summary", owner, "start", "end"], () => version) }), { wrapper });
  await waitFor(() => expect(view.result.current.summary.data).toBe(1));
  state.rpc.mockResolvedValue({ data: { operationId: id, transactionIds: [id], replayed: false }, error: null });
  const refresh = () => refreshFinancialData(owner, view.result.current.config.mutate, view.result.current.config.cache);
  for (const command of commands) {
    version += 1;
    await act(async () => { await applyAndRefreshFinancialCommand(id, command, command.kind === "transaction" ? quote : undefined, refresh); });
    expect(view.result.current.summary.data).toBe(version);
  }
  state.rpc.mockResolvedValue({ data: null, error: { message: "INSUFFICIENT_AVAILABLE" } }); version += 1;
  await act(async () => { await expect(applyAndRefreshFinancialCommand(id, commands[0], quote, refresh)).rejects.toBeTruthy(); });
  expect(view.result.current.summary.data).toBe(4);
});

test("supported transaction date and category metadata edits refresh the shared spending cache", async () => {
  const id = "20000000-0000-4000-8000-000000000003";
  let value = "2026-10-14 / Food";
  const view = renderHook(() => ({ summary: useSWR(["spending-summary", owner, "start", "end"], () => value), editor: useTransactionDescription(owner, async () => {}) }), { wrapper });
  await waitFor(() => expect(view.result.current.summary.data).toBe("2026-10-14 / Food"));
  state.rpc.mockImplementation(async () => { value = "2026-10-15 / Uncategorized"; return { data: { operationId: id, transactionIds: [id], replayed: false }, error: null }; });
  await act(async () => { await view.result.current.editor.submit({ kind: "edit_transaction_description", transactionId: id, groupId: null, description: "Lunch", expectedDescription: "Lunch", metadata: { date: "2026-10-15", categoryId: null, expectedDate: "2026-10-14", expectedCategoryId: id } }); });
  expect(view.result.current.summary.data).toBe("2026-10-15 / Uncategorized");
});
