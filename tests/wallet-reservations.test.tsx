import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import AccountsPage from "@/app/(dashboard)/accounts/page";
import DashboardPage from "@/app/(dashboard)/dashboard/page";
import { useGoals } from "@/hooks/use-goals";
import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
import { formatCurrency } from "@/lib/utils";

const fixture = vi.hoisted(() => {
  const userId = "10000000-0000-4000-8000-000000000001";
  const cashId = "30000000-0000-4000-8000-000000000001";
  const excludedId = "30000000-0000-4000-8000-000000000002";
  const creditId = "30000000-0000-4000-8000-000000000003";
  return {
    userId,
    cashId,
    excludedId,
    creditId,
    accounts: [] as any[],
    transactions: [] as any[],
    snapshot: { goals: [], wallets: [] } as any,
    nextSnapshot: null as any,
    accountReadError: null as unknown,
    transactionReadError: null as unknown,
    financeReadError: null as unknown,
    accountWrites: [] as any[],
    applyCalls: [] as any[],
    accountReads: 0,
  };
});

vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: fixture.userId } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table: string) => {
      let action: "select" | "update" = "select";
      const query: any = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        or() { return query; },
        limit() { return query; },
        gte() { return query; },
        lte() { return query; },
        update(values: unknown) {
          action = "update";
          fixture.accountWrites.push(values);
          return query;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          if (action === "update") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          if (table === "accounts") {
            fixture.accountReads += 1;
            return Promise.resolve({ data: fixture.accounts, error: fixture.accountReadError }).then(resolve, reject);
          }
          if (table === "transactions") {
            return Promise.resolve({ data: fixture.transactions, error: fixture.transactionReadError }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  }),
}));

vi.mock("@/lib/goals/client", () => ({
  fetchGoalFinance: vi.fn(async () => {
    if (fixture.financeReadError) throw fixture.financeReadError;
    return fixture.snapshot;
  }),
  fetchGoalHistory: vi.fn(async () => []),
  fetchGoalWalletMetadata: vi.fn(async () => []),
  applyFinancialCommand: vi.fn(async (...args: unknown[]) => {
    fixture.applyCalls.push(args);
    if (fixture.nextSnapshot) fixture.snapshot = fixture.nextSnapshot;
    return { operationId: "40000000-0000-4000-8000-000000000001", transactionIds: [], replayed: false };
  }),
}));

const cache = new Map();
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>
    {children}
  </SWRConfig>
);

function snapshot(mainReserved: string, excludedReserved = "0.00") {
  const mainAvailable = (3000000 - Number(mainReserved.replace(".", ""))) / 100;
  const excludedAvailable = (12000000 - Number(excludedReserved.replace(".", ""))) / 100;
  return {
    goals: [],
    wallets: [
      { accountId: fixture.cashId, actual: "30000.00", reserved: mainReserved, available: mainAvailable.toFixed(2) },
      { accountId: fixture.excludedId, actual: "120000.00", reserved: excludedReserved, available: excludedAvailable.toFixed(2) },
    ],
  };
}

function makeAccounts() {
  return [
    { id: fixture.cashId, user_id: fixture.userId, name: "GoTyme", type: "bank", currency: "PHP", is_active: true, balance: 30000, include_in_networth: true, display_order: 0 },
    { id: fixture.excludedId, user_id: fixture.userId, name: "Excluded wallet", type: "cash", currency: "PHP", is_active: true, balance: 120000, include_in_networth: false, display_order: 1 },
    { id: fixture.creditId, user_id: fixture.userId, name: "PayLater", type: "credit_card", currency: "PHP", is_active: true, balance: 8000, include_in_networth: true, display_order: 2 },
  ];
}

function makeTransactions() {
  return [
    { id: "expense-cash", user_id: fixture.userId, account_id: fixture.cashId, transfer_to_account_id: null, type: "expense", amount: 1000, date: "2026-10-02", description: "Cash expense", category: null, account: { name: "GoTyme" } },
    { id: "income-cash", user_id: fixture.userId, account_id: fixture.cashId, transfer_to_account_id: null, type: "income", amount: 2500, date: "2026-10-03", description: "Salary", category: null, account: { name: "GoTyme" } },
    { id: "credit-september-expense", user_id: fixture.userId, account_id: fixture.creditId, transfer_to_account_id: null, type: "expense", amount: 500, date: "2026-09-05", description: "September purchase", category: null, account: { name: "PayLater" } },
    { id: "credit-september-cash-advance", user_id: fixture.userId, account_id: fixture.creditId, transfer_to_account_id: fixture.cashId, type: "transfer", amount: 200, date: "2026-09-20", description: "Cash advance", category: null, account: { name: "PayLater" } },
    { id: "credit-october-expense", user_id: fixture.userId, account_id: fixture.creditId, transfer_to_account_id: null, type: "expense", amount: 1000, date: "2026-10-01", description: "October purchase", category: null, account: { name: "PayLater" } },
    { id: "credit-october-payment", user_id: fixture.userId, account_id: fixture.cashId, transfer_to_account_id: fixture.creditId, type: "transfer", amount: 100, date: "2026-10-04", description: "Debt payment", category: null, account: { name: "GoTyme" } },
  ];
}

function FinanceOperation({ command, label }: { command: any; label: string }) {
  const goals = useGoals();
  return (
    <button type="button" onClick={() => void applyAndRefreshFinancialCommand("40000000-0000-4000-8000-000000000002", command, undefined, goals.refresh)}>
      {label}
    </button>
  );
}

beforeEach(() => {
  cache.clear();
  fixture.accounts = makeAccounts();
  fixture.transactions = makeTransactions();
  fixture.snapshot = snapshot("0.00");
  fixture.nextSnapshot = null;
  fixture.accountReadError = null;
  fixture.transactionReadError = null;
  fixture.financeReadError = null;
  fixture.accountWrites = [];
  fixture.applyCalls = [];
  fixture.accountReads = 0;
});

afterEach(() => {
  cleanup();
  cache.clear();
  vi.clearAllMocks();
});

test("reservations update the mounted Wallets summary without changing its net worth", async () => {
  const before = snapshot("0.00");
  const after = snapshot("5000.00", "10000.00");
  fixture.nextSnapshot = after;

  render(
    <>
      <AccountsPage />
      <FinanceOperation command={{ kind: "reserve", goalId: "20000000-0000-4000-8000-000000000001", accountId: fixture.cashId, amount: "5000.00" }} label="Reserve 5,000" />
    </>,
    { wrapper },
  );

  const beforeNetWorth = await screen.findByLabelText("Net worth balance");
  await waitFor(() => expect(screen.getByLabelText("Available to spend").getAttribute("data-money")).toBe("30000.00"));
  const initialNetWorth = beforeNetWorth.getAttribute("data-money");
  expect(initialNetWorth).toBe("30000.00");
  expect(screen.getByLabelText("Actual wallet balance").getAttribute("data-money")).toBe("30000.00");
  expect(screen.getByLabelText("Reserved for goals").getAttribute("data-money")).toBe("0.00");

  fireEvent.click(screen.getByRole("button", { name: "Reserve 5,000" }));

  await waitFor(() => expect(screen.getByLabelText("Reserved for goals").getAttribute("data-money")).toBe("5000.00"));
  const afterNetWorth = screen.getByLabelText("Net worth balance").getAttribute("data-money");
  const afterAvailable = screen.getByLabelText("Available to spend").getAttribute("data-money");
  expect(afterNetWorth).toBe(initialNetWorth);
  expect(afterAvailable).toBe("25000.00");
  expect(fixture.applyCalls).toHaveLength(1);
});

test("wallet loading and read failures never display fabricated zero balances", async () => {
  fixture.accountReadError = new Error("accounts unavailable");

  render(<AccountsPage />, { wrapper });

  expect(screen.queryByLabelText("Available to spend")).toBeNull();
  expect(screen.queryByText(formatCurrency(0))).toBeNull();
  expect(await screen.findByText(/wallet balances could not be loaded/i)).not.toBeNull();
  expect(screen.queryByText(formatCurrency(0))).toBeNull();
});

test("Wallets keeps stored card debt while preserving credit previews and filters", async () => {
  const user = userEvent.setup();
  render(<AccountsPage />, { wrapper });

  expect(await screen.findByText("Statement Balance")).not.toBeNull();
  expect(screen.getByText(`-${formatCurrency(8000)}`)).not.toBeNull();
  expect(fixture.accountWrites.some(write => Object.prototype.hasOwnProperty.call(write, "balance"))).toBe(false);
  expect(screen.getByText(`-${formatCurrency(1600)}`)).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Deduct Debt: Off" }));
  expect(screen.getByLabelText("Net worth balance").getAttribute("data-money")).toBe("28400.00");

  await user.click(screen.getByRole("button", { name: "All months" }));
  await user.click(await screen.findByRole("menuitemcheckbox", { name: "2026-10" }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "2026-09" })).not.toBeNull();
  expect(screen.getByRole("button", { name: "Deduct Debt: Active" })).not.toBeNull();
  expect(screen.getByLabelText("Net worth balance").getAttribute("data-money")).toBe("29300.00");
});

test("Dashboard totals remain transaction-based after a reservation release", async () => {
  fixture.snapshot = snapshot("5000.00");
  fixture.nextSnapshot = snapshot("0.00");

  render(
    <>
      <DashboardPage />
      <FinanceOperation command={{ kind: "release", goalId: "20000000-0000-4000-8000-000000000001", accountId: fixture.cashId, amount: "5000.00" }} label="Release 5,000" />
    </>,
    { wrapper },
  );

  await screen.findByText(formatCurrency(2500));
  expect(screen.getByText(formatCurrency(30000))).not.toBeNull();
  expect(screen.getByText(formatCurrency(1100))).not.toBeNull();
  const accountReadsBeforeRelease = fixture.accountReads;

  fireEvent.click(screen.getByRole("button", { name: "Release 5,000" }));

  await waitFor(() => expect(fixture.applyCalls).toHaveLength(1));
  await waitFor(() => expect(fixture.accountReads).toBeGreaterThan(accountReadsBeforeRelease));
  expect(screen.getByText(formatCurrency(2500))).not.toBeNull();
  expect(screen.getByText(formatCurrency(1100))).not.toBeNull();
  expect(screen.getByText(formatCurrency(30000))).not.toBeNull();
});

test("Dashboard shows a read error instead of zeroed metrics", async () => {
  fixture.transactionReadError = new Error("transaction history unavailable");

  render(<DashboardPage />, { wrapper });

  expect((await screen.findByRole("alert")).textContent).toMatch(/financial overview could not be loaded/i);
  expect(screen.queryByText(formatCurrency(0))).toBeNull();
});
