import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useTransactionHistory } from "@/hooks/use-transaction-history";
import { defaultHistoryQuery } from "@/lib/transactions/history-query";
import type { FilteredHistoryPage } from "@/lib/transactions/history-filtered";

const mocks = vi.hoisted(() => ({ owner: {} as any, read: vi.fn(), options: vi.fn(), capture: vi.fn() }));
vi.mock("@/hooks/use-spending-owner", () => ({ useSpendingOwner: () => mocks.owner, SpendingOwnerChangedError: class extends Error {} }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/transactions/history-filtered", () => ({ loadFilteredHistoryPage: (...args: any[]) => mocks.read(...args), loadHistoryFilterOptions: (...args: any[]) => mocks.options(...args) }));
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function page(name = "first", nextOffset: number | null = null): FilteredHistoryPage {
  return { entries: [{ kind: "transaction", key: name, transaction: { id: name } as any, matchingRowIds: [name], recordedAmount: "1.00", currency: "PHP", transactionDate: null, createdAt: "2026-01-01T00:00:00Z", sortId: name }], nextOffset, totalMatchingEntries: nextOffset === null ? 1 : 51, excludedCurrencyEntryCount: 0, invalidAmountEntryCount: 0 };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.owner = { userId: "owner-a", status: "authenticated", error: null, generation: 1, isLoading: false, isCurrent: () => true, capture: mocks.capture };
  mocks.capture.mockImplementation(async () => { const identity = mocks.owner; return { userId: identity.userId, accessToken: `token-${identity.userId}`, isCurrent: () => mocks.owner === identity, assertCurrent: () => { if (mocks.owner !== identity) throw new Error("owner changed"); } }; });
  mocks.options.mockResolvedValue({ wallets: [], categories: [] });
  mocks.read.mockResolvedValue(page());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
test("loads initial rows and preserves failed load-more rows and query for Retry", async () => {
  mocks.read.mockResolvedValueOnce(page("first", 50)).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(page("second"));
  const query = { ...defaultHistoryQuery(), walletIds: ["10000000-0000-4000-8000-000000000001"], sort: "amount_asc" as const };
  const { result } = renderHook(() => useTransactionHistory(query));
  expect(result.current.totalMatchingEntries).toBeNull();
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  await act(async () => { await expect(result.current.loadMore()).rejects.toThrow("offline"); });
  expect(result.current.entries[0].key).toBe("first");
  expect(result.current.error).toBeTruthy();
  await act(async () => { await result.current.retry(); });
  expect(result.current.entries.map(value => value.key)).toEqual(["first", "second"]);
  expect(mocks.read.mock.calls[2][2]).toEqual({ ...query, offset: 50 });
});
test("invalidates stale receipts during search debounce and clears search immediately", async () => {
  vi.useFakeTimers();
  const old = deferred<FilteredHistoryPage>(); mocks.read.mockReturnValueOnce(old.promise);
  const { result, rerender } = renderHook(({ search }) => useTransactionHistory({ ...defaultHistoryQuery(), search }), { initialProps: { search: "" } });
  await act(async () => {});
  rerender({ search: "coffee" });
  await act(async () => { old.resolve(page("stale")); });
  expect(result.current.entries).toEqual([]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(299); });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(mocks.read.mock.calls[1][2].search).toBe("coffee");
  rerender({ search: "" });
  await act(async () => {});
  expect(mocks.read.mock.calls[2][2].search).toBe("");
});
test("late pages cannot publish after filters, owner transitions or unmount", async () => {
  const old = deferred<FilteredHistoryPage>(); mocks.read.mockReturnValueOnce(old.promise);
  const { result, rerender, unmount } = renderHook(({ type }) => useTransactionHistory({ ...defaultHistoryQuery(), type }), { initialProps: { type: "all" as "all" | "expense" } });
  await act(async () => {});
  rerender({ type: "expense" });
  await waitFor(() => expect(result.current.entries[0]?.key).toBe("first"));
  await act(async () => old.resolve(page("stale")));
  expect(result.current.entries[0].key).toBe("first");
  mocks.owner = { ...mocks.owner, userId: null, status: "error", generation: 2, error: new Error("auth unavailable"), isCurrent: () => false };
  rerender({ type: "expense" });
  expect(result.current.entries).toEqual([]);
  expect(result.current.totalMatchingEntries).toBeNull();
  expect(result.current.error).toBe(mocks.owner.error);
  unmount();
});
test("refresh replaces all loaded pages using one owner capture and preserves full query", async () => {
  mocks.read.mockResolvedValueOnce(page("deleted", 50)).mockResolvedValueOnce(page("old-second"));
  const query = { ...defaultHistoryQuery(), categoryIds: ["10000000-0000-4000-8000-000000000001"], start: "2026-01-01", end: "2026-12-31" };
  const { result } = renderHook(() => useTransactionHistory(query));
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  await act(async () => { await result.current.loadMore(); });
  const captures = mocks.capture.mock.calls.length;
  mocks.read.mockResolvedValueOnce(page("moved", 50)).mockResolvedValueOnce(page("replacement"));
  await act(async () => { await result.current.refresh(); });
  expect(mocks.capture.mock.calls.length - captures).toBe(1);
  expect(result.current.entries.map(value => value.key)).toEqual(["moved", "replacement"]);
  expect(mocks.read.mock.calls.slice(-2).map(call => call[2])).toEqual([{ ...query, offset: 0 }, { ...query, offset: 50 }]);
});
test("failed refresh keeps earlier pages and Retry performs refresh only", async () => {
  const { result } = renderHook(() => useTransactionHistory(defaultHistoryQuery()));
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  mocks.read.mockRejectedValueOnce(new Error("refresh offline"));
  await act(async () => { await expect(result.current.refresh()).rejects.toThrow("refresh offline"); });
  expect(result.current.entries[0].key).toBe("first");
  mocks.read.mockResolvedValueOnce(page("updated"));
  await act(async () => { await result.current.retry(); });
  expect(result.current.entries[0].key).toBe("updated");
  expect(mocks.read.mock.calls.at(-1)?.[2].offset).toBe(0);
});
test("option failures have separate Retry and cannot expose the previous owner", async () => {
  mocks.options.mockRejectedValueOnce(new Error("options offline")).mockResolvedValueOnce({ wallets: [{ id: "cash", name: "Cash" }], categories: [] });
  const { result, rerender } = renderHook(() => useTransactionHistory(defaultHistoryQuery()));
  await waitFor(() => expect(result.current.options.error).toBeTruthy());
  expect(result.current.error).toBeNull();
  await act(async () => { await result.current.options.retry(); });
  expect(result.current.options.wallets[0].name).toBe("Cash");
  mocks.owner = { ...mocks.owner, userId: "owner-b", generation: 2 };
  rerender();
  expect(result.current.options.wallets).toEqual([]);
});
test("a write refresh supersedes an outstanding load-more receipt", async () => {
  const pending = deferred<FilteredHistoryPage>();
  mocks.read.mockResolvedValueOnce(page("first", 50)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page("after-write"));
  const { result } = renderHook(() => useTransactionHistory(defaultHistoryQuery()));
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  let loading!: Promise<void>;
  act(() => { loading = result.current.loadMore(); });
  await act(async () => {});
  await act(async () => { await result.current.refresh(); });
  expect(result.current.entries.map(value => value.key)).toEqual(["after-write"]);
  await act(async () => { pending.resolve(page("stale-more")); await loading; });
  expect(result.current.entries.map(value => value.key)).toEqual(["after-write"]);
});
test("strict effect replay can still publish current history", async () => {
  const { result } = renderHook(() => useTransactionHistory(defaultHistoryQuery()), { wrapper: StrictMode });
  await waitFor(() => expect(result.current.entries[0]?.key).toBe("first"));
});
test("a stale write refresh rejects instead of confirming the new account was refreshed", async () => {
  const { result, rerender } = renderHook(() => useTransactionHistory(defaultHistoryQuery()));
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  const pending = deferred<FilteredHistoryPage>(); mocks.read.mockReturnValueOnce(pending.promise);
  let refreshing!: Promise<void>;
  act(() => { refreshing = result.current.refresh(); });
  await act(async () => {});
  mocks.owner = { ...mocks.owner, userId: "owner-b", generation: 2 };
  rerender();
  await act(async () => { pending.resolve(page("wrong-owner")); await expect(refreshing).rejects.toThrow(); });
  expect(result.current.entries.some(entry => entry.key === "wrong-owner")).toBe(false);
});
test("a stale load-more cannot append after a filter change", async () => {
  const pending = deferred<FilteredHistoryPage>();
  mocks.read.mockResolvedValueOnce(page("first", 50)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page("filtered"));
  const { result, rerender } = renderHook(({ type }) => useTransactionHistory({ type }), { initialProps: { type: "all" as "all" | "income" } });
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  let loading!: Promise<void>;
  act(() => { loading = result.current.loadMore(); });
  await act(async () => {});
  rerender({ type: "income" });
  await waitFor(() => expect(result.current.entries[0]?.key).toBe("filtered"));
  await act(async () => { pending.resolve(page("stale-page")); await loading; });
  expect(result.current.entries.map(entry => entry.key)).toEqual(["filtered"]);
});
test("old-owner history and options are hidden immediately and late responses are discarded", async () => {
  const history = deferred<FilteredHistoryPage>();
  const options = deferred<any>();
  mocks.read.mockReturnValueOnce(history.promise).mockResolvedValueOnce(page("owner-b"));
  mocks.options.mockReturnValueOnce(options.promise).mockResolvedValueOnce({ wallets: [{ id: "b", name: "B" }], categories: [] });
  const { result, rerender } = renderHook(() => useTransactionHistory());
  await act(async () => {});
  mocks.owner = { ...mocks.owner, userId: "owner-b", generation: 2 };
  rerender();
  expect(result.current.entries).toEqual([]);
  expect(result.current.options.wallets).toEqual([]);
  await act(async () => { history.resolve(page("owner-a")); options.resolve({ wallets: [{ id: "a", name: "A" }], categories: [] }); });
  await waitFor(() => expect(result.current.entries[0]?.key).toBe("owner-b"));
  expect(result.current.options.wallets.map(wallet => wallet.name)).toEqual(["B"]);
});
test("unmount discards a pending request and does not schedule further reads", async () => {
  const pending = deferred<FilteredHistoryPage>(); mocks.read.mockReturnValueOnce(pending.promise);
  const { unmount } = renderHook(() => useTransactionHistory());
  await act(async () => {});
  unmount();
  await act(async () => { pending.resolve(page("unmounted")); });
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
