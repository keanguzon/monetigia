import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig, unstable_serialize } from "swr";

const state = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), authListener: null as any }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: state.rpc,
  auth: {
    getUser: state.getUser,
    onAuthStateChange: (listener: any) => {
      state.authListener = listener;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
  from: () => ({ select() { return this; }, eq() { return this; }, then(resolve: any) { return Promise.resolve({ data: [], error: null }).then(resolve); } }),
}) }));

import { useGoalFinance } from "@/hooks/use-goal-finance";
import { applyAndRefreshFinancialCommand, refreshFinancialData } from "@/lib/refresh-financial-data";
import { useGoals } from "@/hooks/use-goals";

const userOne = "10000000-0000-4000-8000-000000000001";
const userTwo = "10000000-0000-4000-8000-000000000002";
const goalId = "20000000-0000-4000-8000-000000000002";
const accountId = "30000000-0000-4000-8000-000000000003";
const requestId = "40000000-0000-4000-8000-000000000004";

function makeSnapshot(userId: string, amount: string) {
  return {
    goals: [],
    wallets: [{ accountId, actual: amount, reserved: "0.00", available: amount }],
  };
}

const cache = new Map();
const provider = () => cache;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider, dedupingInterval: 0, revalidateOnFocus: false }}>{children}</SWRConfig>
);

afterEach(() => {
  cleanup();
  cache.clear();
  vi.clearAllMocks();
  state.authListener = null;
});

test("user-scoped snapshots never show another user's wallets and logout clears the cache", async () => {
  let activeUser = userOne;
  state.rpc.mockImplementation(async (name: string) => ({ data: name === "goal_finance_snapshot" ? makeSnapshot(activeUser, activeUser === userOne ? "100.00" : "900.00") : null, error: null }));
  function Probe({ userId }: { userId: string | null }) {
    const result = useGoalFinance(userId);
    return <output aria-label="wallet">{result.data?.wallets[0]?.actual ?? "empty"}</output>;
  }

  const view = render(<Probe userId={userOne} />, { wrapper });
  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("100.00"));
  activeUser = userTwo;
  view.rerender(<Probe userId={userTwo} />);
  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("900.00"));
  view.rerender(<Probe userId={null} />);
  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("empty"));
  await waitFor(() => expect((cache.get(unstable_serialize(["goalFinance", userOne])) as any)?.data).toBeUndefined());
  const requestsBeforeSignIn = state.rpc.mock.calls.length;
  activeUser = userOne;
  view.rerender(<Probe userId={userOne} />);
  await waitFor(() => expect(state.rpc.mock.calls.length).toBe(requestsBeforeSignIn + 1));
  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("100.00"));
});

test("refresh revalidates the goal snapshot, history, and existing financial views", async () => {
  const calls = new Map<string, number>();
  state.rpc.mockImplementation(async () => ({ data: makeSnapshot(userOne, "100.00"), error: null }));

  function counted(key: string) {
    return useSWR(key, async () => {
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return calls.get(key);
    });
  }

  function Probe() {
    const finance = useGoalFinance(userOne);
    const history = useSWR(["goalHistory", userOne, goalId], async () => {
      calls.set("history", (calls.get("history") ?? 0) + 1);
      return calls.get("history");
    });
    counted("accounts");
    counted("recentTransactions");
    counted("dashboardStats-2026-10");
    return <button onClick={() => void finance.refresh()}>refresh {history.data ?? 0}</button>;
  }

  render(<Probe />, { wrapper });
  await screen.findByText("refresh 1");
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: /refresh/ }));

  await waitFor(() => {
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(calls.get("history")).toBe(2);
    expect(calls.get("accounts")).toBe(2);
    expect(calls.get("recentTransactions")).toBe(2);
    expect(calls.get("dashboardStats-2026-10")).toBe(2);
  });
});

test("a committed command stays saved when cache revalidation fails", async () => {
  const saved = { operationId: requestId, transactionIds: [], replayed: false };
  state.rpc.mockResolvedValue({ data: saved, error: null });
  const refreshError = new Error("Snapshot refresh failed");
  const refresh = vi.fn().mockRejectedValue(refreshError);

  const outcome = await applyAndRefreshFinancialCommand(
    requestId,
    { kind: "reserve", goalId, accountId, amount: "25.00" },
    undefined,
    refresh,
  );

  expect(outcome.saved).toEqual(saved);
  expect(outcome.refreshError).toBe(refreshError);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("a rejected command does not refresh or mutate cached finance values", async () => {
  const failure = { message: "INSUFFICIENT_AVAILABLE", hint: "Release funds first." };
  state.rpc.mockImplementation(async (name: string) => name === "goal_finance_snapshot"
    ? { data: makeSnapshot(userOne, "100.00"), error: null }
    : { data: null, error: failure });
  const refresh = vi.fn(() => refreshFinancialData());
  function WalletProbe() {
    const finance = useGoalFinance(userOne);
    return <output aria-label="available funds">{finance.data?.wallets[0]?.available ?? "loading"}</output>;
  }
  render(<WalletProbe />, { wrapper });
  await waitFor(() => expect(screen.getByLabelText("available funds").textContent).toBe("100.00"));

  await expect(applyAndRefreshFinancialCommand(
    requestId,
    { kind: "reserve", goalId, accountId, amount: "25.00" },
    undefined,
    refresh,
  )).rejects.toMatchObject({ code: "INSUFFICIENT_AVAILABLE" });
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByLabelText("available funds").textContent).toBe("100.00");
  expect(state.rpc).toHaveBeenCalledTimes(2);
});

test("a late initial user lookup cannot replace a newer auth session", async () => {
  let resolveInitial!: (value: { data: { user: { id: string } } }) => void;
  state.getUser.mockImplementation(() => new Promise(resolve => { resolveInitial = resolve; }));
  state.rpc.mockResolvedValue({ data: makeSnapshot(userTwo, "900.00"), error: null });

  function Probe() {
    const goals = useGoals();
    return <output aria-label="goal load">{goals.isLoading ? "loading" : String(Boolean(goals.isError))}</output>;
  }

  render(<Probe />, { wrapper });
  await waitFor(() => expect(state.authListener).toBeTypeOf("function"));
  state.authListener("SIGNED_IN", { user: { id: userTwo } });
  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
  resolveInitial({ data: { user: { id: userOne } } });
  await waitFor(() => expect(screen.getByLabelText("goal load").textContent).toBe("false"));
  expect(state.rpc).toHaveBeenCalledTimes(1);
});
