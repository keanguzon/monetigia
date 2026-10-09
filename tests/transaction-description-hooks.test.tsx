import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), headers: [] as string[] }));
const financeRefresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getSession: state.getSession },
  rpc: (...args: unknown[]) => {
    const promise = Promise.resolve().then(() => state.rpc(...args));
    return {
      setHeader: (name: string, value: string) => { state.headers.push(`${name}: ${value}`); return promise; },
      then: promise.then.bind(promise),
    };
  },
}) }));
vi.mock("@/lib/refresh-financial-data", () => ({ refreshFinancialData: financeRefresh }));

import { useTransactionDescription } from "@/hooks/use-transaction-description";

let owner = "10000000-0000-4000-8000-000000000001";
let otherOwner = "10000000-0000-4000-8000-000000000002";
let ownerSerial = 0;
const transactionId = "20000000-0000-4000-8000-000000000003";
const savedResult = { operationId: "30000000-0000-4000-8000-000000000004", transactionIds: [transactionId], replayed: false };
const edit = (description = "Updated") => ({ kind: "edit_transaction_description" as const,
  transactionId, groupId: null, description, expectedDescription: "Original" });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const wrapper = ({ children }: { children: React.ReactNode }) =>
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>{children}</SWRConfig>;

beforeEach(() => {
  ownerSerial += 1;
  owner = `10000000-0000-4000-8000-${String(ownerSerial).padStart(12, "0")}`;
  otherOwner = `20000000-0000-4000-8000-${String(ownerSerial).padStart(12, "0")}`;
  state.rpc.mockReset();
  state.getSession.mockReset().mockImplementation(async () => ({
    data: { session: { user: { id: owner }, access_token: "owner-token" } }, error: null,
  }));
  state.headers = [];
  financeRefresh.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

test("an unknown or malformed response keeps the immutable command and UUID across unmount for the same owner", async () => {
  state.rpc.mockResolvedValueOnce({ data: { operationId: "bad", transactionIds: [], replayed: false }, error: null });
  const refreshHistory = vi.fn().mockResolvedValue(undefined);
  const first = renderHook(() => useTransactionDescription(owner, refreshHistory), { wrapper });
  await act(async () => { await first.result.current.submit(edit("  New title  ")); });
  expect(first.result.current.unresolved).toBe(true);
  expect(first.result.current.pendingCommand).toEqual({ ...edit("New title"), expectedDescription: "Original" });
  expect(Object.isFrozen(first.result.current.pendingCommand)).toBe(true);
  const originalRequest = state.rpc.mock.calls[0][1];
  first.unmount();

  state.rpc.mockResolvedValueOnce({ data: savedResult, error: null });
  const reopened = renderHook(() => useTransactionDescription(owner, refreshHistory), { wrapper });
  await act(async () => { await reopened.result.current.retry(); });

  expect(state.rpc).toHaveBeenCalledTimes(2);
  expect(state.rpc.mock.calls[1][1]).toEqual(originalRequest);
  expect(state.headers).toEqual(["Authorization: Bearer owner-token", "Authorization: Bearer owner-token"]);
  expect(reopened.result.current.saved).toEqual(savedResult);
  expect(reopened.result.current.pendingCommand).toBeNull();
});

test("known stale rejection exposes its code and clears only that attempt", async () => {
  state.rpc.mockResolvedValueOnce({ data: null, error: { message: "STALE_QUOTE" } });
  const view = renderHook(() => useTransactionDescription(owner, vi.fn()), { wrapper });

  await act(async () => { await view.result.current.submit(edit()); });

  expect(view.result.current.unresolved).toBe(false);
  expect(view.result.current.pendingCommand).toBeNull();
  expect(view.result.current.errorCode).toBe("STALE_QUOTE");
  expect(view.result.current.error).toContain("changed");
});

test("other owners cannot see or retry the pending command, while the original owner can", async () => {
  state.rpc.mockRejectedValueOnce(new Error("network"));
  const view = renderHook(({ id }) => useTransactionDescription(id, vi.fn()), {
    wrapper, initialProps: { id: owner as string | null },
  });
  await act(async () => { await view.result.current.submit(edit()); });
  expect(view.result.current.unresolved).toBe(true);

  view.rerender({ id: otherOwner });
  expect(view.result.current.pendingCommand).toBeNull();
  await act(async () => { await view.result.current.retry(); });
  expect(state.rpc).toHaveBeenCalledTimes(1);

  view.rerender({ id: owner });
  state.rpc.mockResolvedValueOnce({ data: savedResult, error: null });
  await act(async () => { await view.result.current.retry(); });
  expect(state.rpc).toHaveBeenCalledTimes(2);
  expect(view.result.current.saved).toEqual(savedResult);
});

test("overlapping submits, retry, and reset cannot replace an in-flight request", async () => {
  const response = deferred<{ data: typeof savedResult; error: null }>();
  state.rpc.mockReturnValueOnce(response.promise);
  const view = renderHook(() => useTransactionDescription(owner, vi.fn()), { wrapper });
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.submit(edit("First")); });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));

  await act(async () => {
    await view.result.current.submit(edit("Second"));
    await view.result.current.retry();
    view.result.current.reset();
  });
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(view.result.current.pendingCommand?.description).toBe("First");

  await act(async () => { response.resolve({ data: savedResult, error: null }); await pending; });
});

test("an owner switch during a successful write keeps the original owner's refresh recovery visible", async () => {
  const response = deferred<{ data: typeof savedResult; error: null }>();
  state.rpc.mockReturnValueOnce(response.promise);
  const refreshHistory = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(({ id }) => useTransactionDescription(id, refreshHistory), {
    wrapper, initialProps: { id: owner as string | null },
  });
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.submit(edit()); });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));

  view.rerender({ id: otherOwner });
  await act(async () => { response.resolve({ data: savedResult, error: null }); await pending; });
  expect(view.result.current.saved).toBeNull();
  expect(refreshHistory).not.toHaveBeenCalled();
  expect(financeRefresh).not.toHaveBeenCalled();

  view.rerender({ id: owner });
  expect(view.result.current.saved).toEqual(savedResult);
  expect(view.result.current.refreshError).toBeInstanceOf(Error);
  await act(async () => { await view.result.current.refresh(); });
  expect(view.result.current.refreshError).toBeNull();
  expect(refreshHistory).toHaveBeenCalledTimes(1);
  expect(financeRefresh).toHaveBeenCalledTimes(1);
  expect(state.rpc).toHaveBeenCalledTimes(1);
});

test("saved status survives read failures and refresh recovery never submits again", async () => {
  const historyRefresh = vi.fn().mockRejectedValueOnce(new Error("history offline")).mockResolvedValue(undefined);
  financeRefresh.mockRejectedValueOnce(new Error("finance offline"));
  state.rpc.mockResolvedValueOnce({ data: savedResult, error: null });
  const view = renderHook(() => useTransactionDescription(owner, historyRefresh), { wrapper });

  await act(async () => { await view.result.current.submit(edit()); });
  expect(view.result.current.saved).toEqual(savedResult);
  expect(view.result.current.pendingCommand).toBeNull();
  expect(view.result.current.refreshError).toBeInstanceOf(AggregateError);
  expect(historyRefresh).toHaveBeenCalledTimes(1);
  expect(financeRefresh).toHaveBeenCalledTimes(1);

  await act(async () => { await view.result.current.refresh(); });
  expect(view.result.current.refreshError).toBeNull();
  expect(view.result.current.saved).toEqual(savedResult);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(historyRefresh).toHaveBeenCalledTimes(2);
  expect(financeRefresh).toHaveBeenCalledTimes(2);
});
