import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SWRConfig, unstable_serialize } from "swr";

const state = vi.hoisted(() => ({
  currentOwner: "owner-a",
  listeners: new Set<(event: string, session: unknown) => void>(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  rpc: vi.fn(),
  rawTables: [] as string[],
  authHeaders: [] as string[],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: state.getUser,
      getSession: state.getSession,
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        state.listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => state.listeners.delete(callback) } } };
      },
    },
    rpc: (name: string, args: { p_start: string; p_end: string }) => {
      let token = "";
      const builder = {
        setHeader: (_header: string, value: string) => {
          token = value;
          state.authHeaders.push(value);
          return builder;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve().then(() => state.rpc(name, args, token)).then(resolve, reject),
      };
      return builder;
    },
    from: (table: string) => {
      state.rawTables.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        lte: () => builder,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return builder;
    },
  }),
}));

vi.mock("@/hooks/use-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-data")>();
  return {
    ...actual,
    useAccounts: () => ({ data: [], isLoading: false, error: undefined }),
    useRecentTransactions: () => ({ data: [], isLoading: false, error: undefined }),
  };
});

vi.mock("@/hooks/use-local-today", () => ({ useLocalToday: () => new Date(2026, 9, 15, 12) }));
vi.mock("@/components/layout/navigation-link", () => ({ NavigationLink: (props: { children: React.ReactNode }) => props.children }));

import DashboardPage from "@/app/(dashboard)/dashboard/page";
import { useDashboardStats } from "@/hooks/use-data";
import { useSpendingSummary } from "@/hooks/use-spending";
import { comparisonRange, periodContaining, spentToDateEnd } from "@/lib/spending/periods";

const today = new Date(2026, 9, 15, 12);
const period = periodContaining(today, "month");
const previous = comparisonRange(period, today);
const currentEnd = spentToDateEnd(period, today);

type SummaryFixture = {
  start: string;
  end: string;
  spent: string;
  income: string;
};

function summary({ start, end, spent, income }: SummaryFixture) {
  return {
    start,
    end,
    spent,
    expenses: spent,
    debtPayments: "0.00",
    income,
    net: "0.00",
    categories: [],
    transactionCount: 2,
  };
}

function session(userId: string) {
  return { user: { id: userId }, access_token: `${userId}-token` };
}

function auth(userId: string | null) {
  state.currentOwner = userId ?? "";
  state.listeners.forEach((callback) => callback(userId ? "SIGNED_IN" : "SIGNED_OUT", userId ? session(userId) : null));
}

function wrapper(cache = new Map()) {
  return ({ children }: { children: React.ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, errorRetryCount: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
      {children}
    </SWRConfig>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  state.currentOwner = "owner-a";
  state.listeners.clear();
  state.rawTables = [];
  state.authHeaders = [];
  state.getUser.mockReset().mockImplementation(async () => ({ data: { user: { id: state.currentOwner } }, error: null }));
  state.getSession.mockReset().mockImplementation(async () => ({ data: { session: session(state.currentOwner) }, error: null }));
  state.rpc.mockReset().mockImplementation(async (_name: string, args: { p_start: string; p_end: string }) => ({
    data: summary({ start: args.p_start, end: args.p_end, spent: "12.34", income: "100.01" }),
    error: null,
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("uses one owner-pinned spending summary for current and previous Dashboard totals", async () => {
  const view = renderHook(() => useDashboardStats(period.start, currentEnd, previous.start, previous.end), { wrapper: wrapper() });

  await waitFor(() => expect(view.result.current.data).toEqual({
    monthlyIncome: 100.01,
    monthlyExpenses: 12.34,
    lastMonthIncome: 100.01,
    lastMonthExpenses: 12.34,
    }));

  expect(state.rpc).toHaveBeenCalledTimes(2);
  expect(state.rpc.mock.calls.map((call) => call[1])).toEqual(expect.arrayContaining([
    { p_start: "2026-10-01", p_end: "2026-10-15" },
    { p_start: "2026-09-01", p_end: "2026-09-15" },
  ]));
  expect(state.authHeaders).toEqual(["Bearer owner-a-token", "Bearer owner-a-token"]);
  expect(state.rawTables).toEqual([]);
});

it("matches the Dashboard expense total to the same period summary", async () => {
  const view = renderHook(() => ({
    dashboard: useDashboardStats(period.start, currentEnd, previous.start, previous.end),
    summary: useSpendingSummary(period, today),
  }), { wrapper: wrapper() });

  await waitFor(() => expect(view.result.current.summary.data).toBeDefined());
  expect(view.result.current.dashboard.data?.monthlyExpenses).toBe(Number(view.result.current.summary.data?.spent));
});

it("keys Dashboard results by owner and all four range boundaries", async () => {
  const cache = new Map();
  renderHook(() => useDashboardStats("2026-10-01", "2026-10-15", "2026-09-01", "2026-09-15"), { wrapper: wrapper(cache) });
  const expected = ["dashboardStats", "owner-a", "2026-10-01", "2026-10-15", "2026-09-01", "2026-09-15"] as const;

  await waitFor(() => expect(cache.has(unstable_serialize(expected))).toBe(true));
  for (const index of [1, 2, 3, 4, 5]) {
    const alternate: string[] = [...expected];
    alternate[index] = `${alternate[index]}-other`;
    expect(cache.has(unstable_serialize(alternate))).toBe(false);
  }
});

it.each(["2026-10-01", "2026-09-01"])("surfaces a summary RPC error for the %s range", async (failedStart) => {
  const failure = new Error("spending summary unavailable");
  state.rpc.mockImplementation(async (_name: string, args: { p_start: string; p_end: string }) => ({
    data: summary({ start: args.p_start, end: args.p_end, spent: "12.34", income: "100.01" }),
    error: args.p_start === failedStart ? failure : null,
  }));
  const view = renderHook(() => useDashboardStats(period.start, currentEnd, previous.start, previous.end), { wrapper: wrapper() });

  await waitFor(() => expect(view.result.current.error).toBe(failure));
  expect(view.result.current.data).toBeUndefined();
});

it("preserves owner identity errors without issuing summary reads", async () => {
  const identityError = new Error("identity lookup failed");
  state.getUser.mockResolvedValue({ data: { user: null }, error: identityError });
  const view = renderHook(() => useDashboardStats(period.start, currentEnd, previous.start, previous.end), { wrapper: wrapper() });

  await waitFor(() => expect(view.result.current.error).toBe(identityError));
  expect(view.result.current.data).toBeUndefined();
  expect(state.rpc).not.toHaveBeenCalled();
});

it("hides the previous owner's totals while the new account summary is loading", async () => {
  const ownerBRequests = new Map<string, ReturnType<typeof deferred<{ data: ReturnType<typeof summary>; error: null }>>>();
  state.rpc.mockImplementation((_name: string, args: { p_start: string; p_end: string }, token: string) => token === "Bearer owner-b-token"
    ? (() => {
        const pending = deferred<{ data: ReturnType<typeof summary>; error: null }>();
        ownerBRequests.set(args.p_start, pending);
        return pending.promise;
      })()
    : Promise.resolve({ data: summary({ start: args.p_start, end: args.p_end, spent: "12.34", income: "100.01" }), error: null }));
  const view = renderHook(() => useDashboardStats(period.start, currentEnd, previous.start, previous.end), { wrapper: wrapper() });
  await waitFor(() => expect(view.result.current.data?.monthlyExpenses).toBe(12.34));

  await act(async () => { auth("owner-b"); });
  expect(view.result.current.data).toBeUndefined();
  await waitFor(() => expect(ownerBRequests.size).toBe(2));
  ownerBRequests.forEach((pending, start) => {
    pending.resolve({ data: summary({ start, end: start === period.start ? currentEnd : previous.end, spent: "80.00", income: "90.00" }), error: null });
  });
  await waitFor(() => expect(view.result.current.data?.monthlyExpenses).toBe(80));
});

it("does not cache a late summary response after its owner request becomes stale", async () => {
  const oldRequests = new Map<string, ReturnType<typeof deferred<{ data: ReturnType<typeof summary>; error: null }>>>();
  state.rpc.mockImplementation((_name: string, args: { p_start: string; p_end: string }, token: string) => {
    if (token === "Bearer owner-a-token") {
      const pending = deferred<{ data: ReturnType<typeof summary>; error: null }>();
      oldRequests.set(args.p_start, pending);
      return pending.promise;
    }
    return Promise.resolve({ data: summary({ start: args.p_start, end: args.p_end, spent: "80.00", income: "90.00" }), error: null });
  });
  const cache = new Map();
  const view = renderHook(() => useDashboardStats(period.start, currentEnd, previous.start, previous.end), { wrapper: wrapper(cache) });
  await waitFor(() => expect(oldRequests.size).toBe(2));
  await act(async () => { auth("owner-b"); });
  await waitFor(() => expect(view.result.current.data?.monthlyExpenses).toBe(80));

  await act(async () => {
    oldRequests.forEach((pending, start) => pending.resolve({ data: summary({ start, end: start === period.start ? currentEnd : previous.end, spent: "12.34", income: "100.01" }), error: null }));
    await Promise.resolve();
  });

  expect(view.result.current.data?.monthlyExpenses).toBe(80);
  expect(cache.get(unstable_serialize(["dashboardStats", "owner-a", period.start, currentEnd, previous.start, previous.end]))?.data).toBeUndefined();
});

it.each([
  ["This month", "200.01", "123.45", 2],
  ["Last 7 days", "45.67", "23.45", 1],
  ["Last 30 days", "987.65", "678.90", 3],
])("shows the RPC's PHP Income and Expenses for %s", async (range, income, expenses) => {
  state.rpc.mockImplementation(async (_name: string, args: { p_start: string; p_end: string }) => {

    const values = args.p_start === "2026-10-09"
      ? { income: "45.67", spent: "23.45", }
      : args.p_start === "2026-09-16"
        ? { income: "987.65", spent: "678.90", }
        : { income: "200.01", spent: "123.45", };
    return { data: summary({ start: args.p_start, end: args.p_end, ...values }), error: null };
  });
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0, shouldRetryOnError: false, revalidateOnFocus: false }}><DashboardPage /></SWRConfig>);

  if (range !== "This month") {
    fireEvent.keyDown(await screen.findByRole("button", { name: "This month" }), { key: "ArrowDown" });
    const option = await screen.findByRole("menuitem", { name: range });
    fireEvent.click(option);
  }

  await waitFor(() => {
    expect(screen.queryByText("Income", { exact: true })).not.toBeNull();
    expect(screen.queryByText("Expenses", { exact: true })).not.toBeNull();
    expect(screen.queryByText(`₱${income}`)).not.toBeNull();
    expect(screen.queryByText(`₱${expenses}`)).not.toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
  const incomeCard = screen.getByText("Income", { exact: true }).closest("div.min-w-0");
  const expenseCard = screen.getByText("Expenses", { exact: true }).closest("div.min-w-0");
  expect(within(incomeCard as HTMLElement).getByText(`₱${income}`)).not.toBeNull();
  expect(within(expenseCard as HTMLElement).getByText(`₱${expenses}`)).not.toBeNull();
});
