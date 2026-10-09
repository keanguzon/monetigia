import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  toast: vi.fn(),
}));
const debtMocks = vi.hoisted(() => ({
  snapshot: null as any,
  refresh: vi.fn(async () => undefined),
  command: { isSaving: false, unresolved: false, saved: null as any, error: null as string | null, refreshError: null as unknown, pendingCommand: null as any,
    submit: vi.fn(async () => undefined), retry: vi.fn(async () => undefined), reset: vi.fn() },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}));
vi.mock("@/hooks/use-transaction-submit", () => ({
  useTransactionDelete: () => ({
    isDeleting: false,
    pendingTransactionId: null,
    savedTransactionId: null,
    error: null,
    refreshError: null,
    remove: vi.fn(),
  }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ userId: "owner-1", refresh: async () => undefined }) }));
vi.mock("@/hooks/use-debt", () => ({
  useDebt: () => ({ snapshot: debtMocks.snapshot, isLoading: false, error: null, refresh: debtMocks.refresh }),
  useDebtCommand: () => debtMocks.command,
}));
vi.mock("@/components/transactions/DebtCorrectionDialog", () => ({
  DebtCorrectionDialog: ({ open, onSaved, accountId, groupId, selectedIds }: { open: boolean; onSaved: () => Promise<unknown>; accountId: string; groupId: string; selectedIds: string[] }) => open
    ? <div><span data-testid="correction-target" data-account-id={accountId} data-group-id={groupId} data-selected-ids={selectedIds.join(",")} /><button type="button" onClick={() => { void onSaved().catch(() => undefined); }}>Complete mock correction</button></div>
    : null,
}));

import TransactionsPage from "@/app/(dashboard)/transactions/page";

function row(id: number) {
  return {
    id: `transaction-${id}`,
    user_id: "owner-1",
    account_id: "account-1",
    category_id: null,
    goal_id: null,
    type: "expense",
    amount: "12.00",
    description: `Transaction ${id}`,
    date: `2026-01-${String((id % 28) + 1).padStart(2, "0")}`,
    created_at: new Date(Date.UTC(2026, 9, 28) - id * 86_400_000).toISOString(),
    installment_group_id: null,
    purchase_date: null,
    history_date: null,
    transfer_to_account_id: null,
    category: null,
    account: { id: "account-1", name: "Wallet", type: "cash" },
    transfer_to_account: null,
  };
}

function configureHistoryPages() {
  let laterAttempts = 0;
  const ranges: Array<[number, number]> = [];
  const orders: Array<[string, boolean]> = [];
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.from.mockImplementation(() => {
    let range: [number, number] = [0, 49];
    const query: any = {
      select: () => query,
      eq: () => query,
      order: (column: string, options?: { ascending?: boolean }) => { orders.push([column, options?.ascending ?? false]); return query; },
      range: (start: number, end: number) => { range = [start, end]; ranges.push(range); return query; },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (range[0] === 0) return Promise.resolve({ data: Array.from({ length: 50 }, (_, index) => row(index + 1)), error: null }).then(resolve, reject);
        laterAttempts += 1;
        if (laterAttempts === 1) return Promise.resolve({ data: null, error: new Error("temporary history read failure") }).then(resolve, reject);
        return Promise.resolve({ data: [row(51)], error: null }).then(resolve, reject);
      },
    };
    return query;
  });
  return { ranges, orders };
}

function configureHistoryRows(rows: ReturnType<typeof row>[]) {
  const ranges: Array<[number, number]> = [];
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.from.mockImplementation(() => {
    let range: [number, number] = [0, 49];
    let siblingIds: string[] = [];
    const query: any = {
      select: () => query,
      eq: () => query,
      in: (_column: string, ids: string[]) => { siblingIds = ids; return query; },
      order: () => query,
      range: (start: number, end: number) => { range = [start, end]; ranges.push(range); return query; },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const page = siblingIds.length
          ? rows.filter(item => item.installment_group_id && siblingIds.includes(item.installment_group_id))
          : rows.slice(range[0], range[1] + 1);
        return Promise.resolve({ data: page, error: null }).then(resolve, reject);
      },
    };
    return query;
  });
  return { ranges };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  debtMocks.snapshot = null;
  debtMocks.refresh = vi.fn(async () => undefined);
  debtMocks.command = { isSaving: false, unresolved: false, saved: null, error: null, refreshError: null, pendingCommand: null,
    submit: vi.fn(async () => undefined), retry: vi.fn(async () => undefined), reset: vi.fn() };
});

describe("transactions history pagination", () => {
  test("loads older rows, shows a retry after a read error, and retries the same page", async () => {
    const user = userEvent.setup();
    const { ranges, orders } = configureHistoryPages();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<TransactionsPage />);

    expect(screen.queryByText(/Showing 0 all entries/)).toBeNull();
    expect(await screen.findByRole("button", { name: "Load more" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Sort transactions", hidden: true }) as HTMLSelectElement).value).toBe("date_added");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/older history could not be loaded/i);
    expect(screen.getByRole("button", { name: "Retry loading more" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry loading more" }));
    expect(await screen.findByText("Transaction 51")).toBeTruthy();
    expect(ranges).toEqual([[0, 49], [50, 99], [50, 99]]);
    expect((screen.getByRole("combobox", { name: "Sort transactions", hidden: true }) as HTMLSelectElement).value).toBe("date_added");

    await user.click(screen.getByRole("button", { name: "Sort transactions" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Transaction date (newest first)" }));
    expect(await screen.findByText("Transaction 50")).toBeTruthy();
    expect(screen.queryByText("Transaction 51")).toBeNull();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(ranges).toEqual([[0, 49], [50, 99], [50, 99], [0, 49]]);
    expect((screen.getByRole("combobox", { name: "Sort transactions", hidden: true }) as HTMLSelectElement).value).toBe("transaction_date");
    expect(orders).toEqual([
      ["created_at", false], ["id", false],
      ["created_at", false], ["id", false],
      ["created_at", false], ["id", false],
      ["history_date", false], ["created_at", false], ["id", false],
    ]);
  });

  test("offers both sort orders, keeps the default selection, and preserves filters when sorting", async () => {
    const user = userEvent.setup();
    const { ranges, orders } = configureHistoryPages();
    render(<TransactionsPage />);

    await screen.findByText("Transaction 50");
    await user.click(screen.getByRole("button", { name: "income" }));
    const search = screen.getByRole("searchbox", { name: "Search transactions" }) as HTMLInputElement;
    await user.type(search, "search survives");

    const trigger = screen.getByRole("button", { name: "Sort transactions" });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("menuitemradio").map(item => item.textContent?.trim())).toEqual([
      "Date added (newest first)",
      "Transaction date (newest first)",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "Date added (newest first)" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("combobox", { name: "Sort transactions", hidden: true }) as HTMLSelectElement).value).toBe("date_added");

    await user.click(screen.getByRole("menuitemradio", { name: "Date added (newest first)" }));
    expect(ranges).toHaveLength(1);

    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: "Transaction date (newest first)" }));
    await waitFor(() => expect(ranges).toHaveLength(2));
    expect(ranges).toEqual([[0, 49], [0, 49]]);
    expect(orders).toEqual([
      ["created_at", false], ["id", false],
      ["history_date", false], ["created_at", false], ["id", false],
    ]);
    expect((screen.getByRole("combobox", { name: "Sort transactions", hidden: true }) as HTMLSelectElement).value).toBe("transaction_date");
    expect(search.value).toBe("search survives");
    expect(screen.getByRole("button", { name: "income" }).className).toContain("bg-primary");

    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "Transaction date (newest first)" }).getAttribute("aria-checked")).toBe("true");
  });

  test("supports keyboard selection and Escape returns focus without reloading", async () => {
    const user = userEvent.setup();
    const { ranges } = configureHistoryPages();
    render(<TransactionsPage />);

    await screen.findByText("Transaction 50");
    const trigger = screen.getByRole("button", { name: "Sort transactions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitemradio", { name: "Date added (newest first)" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(ranges).toHaveLength(1);
    expect((screen.getByRole("combobox", { name: "Sort transactions" }) as HTMLSelectElement).value).toBe("date_added");

    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    await waitFor(() => expect(ranges).toHaveLength(2));
    expect((screen.getByRole("combobox", { name: "Sort transactions", hidden: true }) as HTMLSelectElement).value).toBe("transaction_date");
  });

  test("confirms that deleting one installment leaves the remaining schedule", async () => {
    const user = userEvent.setup();
    const purchaseId = "40000000-0000-4000-8000-000000000004";
    const first = { ...row(1), id: "50000000-0000-4000-8000-000000000001", description: "Coffee maker (Installment 1/2)", date: "2026-02-10", purchase_date: "2026-01-10", history_date: "2026-01-10", installment_group_id: purchaseId };
    const second = { ...row(2), id: "50000000-0000-4000-8000-000000000002", description: "Coffee maker (Installment 2/2)", date: "2026-03-10", purchase_date: "2026-01-10", history_date: "2026-01-10", installment_group_id: purchaseId };
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.from.mockImplementation(() => {
      let isSiblingRead = false;
      const query: any = {
        select: () => query,
        eq: () => query,
        in: () => { isSiblingRead = true; return query; },
        order: () => query,
        range: () => query,
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: isSiblingRead ? [first, second] : [first], error: null }).then(resolve, reject),
      };
      return query;
    });
    render(<TransactionsPage />);

    await user.click(await screen.findByRole("button", { name: /show payment schedule/i }));
    await user.click(screen.getByRole("button", { name: "Delete installment 1" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/deletes only this installment/i);
    expect(dialog.textContent).toMatch(/other installments in this schedule will remain/i);
    expect(screen.getByRole("button", { name: "Delete installment" })).toBeTruthy();
  });

  test("routes a standalone credit purchase to its exact debt row and refreshes without hiding the purchase", async () => {
    const purchaseId = "40000000-0000-4000-8000-000000000004";
    const creditPurchase = {
      ...row(1),
      id: "50000000-0000-4000-8000-000000000001",
      description: "Standalone card purchase",
      installment_group_id: null,
      account: { id: "account-1", name: "Card", type: "credit_card" },
    };
    configureHistoryRows([creditPurchase]);
    debtMocks.snapshot = {
      accounts: [{ accountId: "account-1", totalOutstanding: "12.00", undatedOutstanding: "0.00", fingerprint: "f", reconciliation: "balanced", reconciliationDelta: "0.00" }],
      rows: [{ id: "debt-row-1", accountId: "account-1", groupId: purchaseId, source: "purchase", transactionId: creditPurchase.id, dueDate: "2026-01-02", originalAmount: "12.00", paidAmount: "0.00", correctedAmount: "0.00", remainingAmount: "12.00", ordinal: 1, name: creditPurchase.description }],
    };
    const user = userEvent.setup();
    render(<TransactionsPage />);

    await screen.findByText("Standalone card purchase");
    await user.click(screen.getByRole("button", { name: "Delete transaction" }));
    const target = screen.getByTestId("correction-target");
    expect(target.getAttribute("data-account-id")).toBe("account-1");
    expect(target.getAttribute("data-group-id")).toBe(purchaseId);
    expect(target.getAttribute("data-selected-ids")).toBe("debt-row-1");
    expect(screen.queryByText("Delete transaction?")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Complete mock correction" }));
    expect(await screen.findByText("Standalone card purchase")).toBeTruthy();
    expect(screen.getByText("Showing 1 all entry in loaded history")).toBeTruthy();
  });

  test("blocks credit purchase deletion when its debt snapshot is missing", async () => {
    const creditPurchase = {
      ...row(1),
      id: "50000000-0000-4000-8000-000000000001",
      description: "Unmatched card purchase",
      installment_group_id: null,
      account: { id: "account-1", name: "Card", type: "credit_card" },
    };
    configureHistoryRows([creditPurchase]);
    const user = userEvent.setup();
    render(<TransactionsPage />);

    await screen.findByText("Unmatched card purchase");
    const deleteButton = screen.getByRole("button", { name: "Delete transaction" }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.title).toMatch(/Debt details are unavailable/i);
    expect(screen.getByText(/refresh the debt views before correcting this credit purchase/i)).toBeTruthy();
    await user.click(deleteButton);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("blocks deletion until an expense wallet type is known", async () => {
    const untypedExpense = {
      ...row(1),
      id: "50000000-0000-4000-8000-000000000001",
      description: "Expense without wallet metadata",
      installment_group_id: null,
      account: { id: "account-1", name: "Unknown wallet" } as ReturnType<typeof row>["account"],
    };
    configureHistoryRows([untypedExpense]);
    const user = userEvent.setup();
    render(<TransactionsPage />);

    await screen.findByText("Expense without wallet metadata");
    const deleteButton = screen.getByRole("button", { name: "Delete transaction" }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.title).toMatch(/wallet type.*unavailable/i);
    await user.click(deleteButton);
    expect(screen.queryByText("Delete transaction?")).toBeNull();
  });

  test("zero-row remount keeps correction retry tied to the saved correction kind", async () => {
    configureHistoryRows([]);
    const retry = vi.fn(async () => undefined);
    debtMocks.command = { ...debtMocks.command, pendingCommand: { kind: "correct_debt_rows", payload: {} }, error: "Request outcome is unknown.", retry };
    const user = userEvent.setup();
    render(<TransactionsPage />);

    expect(await screen.findByText(/debt correction is unconfirmed/i)).toBeTruthy();
    cleanup();
    render(<TransactionsPage />);
    expect(await screen.findByRole("button", { name: "Retry same correction" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry same correction" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No transactions found/)).toBeTruthy();

    debtMocks.command = { ...debtMocks.command, pendingCommand: { kind: "adopt_opening_debt", payload: {} }, saved: null, refreshError: null };
    cleanup();
    render(<TransactionsPage />);
    expect(await screen.findByText("No transactions found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry same correction" })).toBeNull();
  });

  test("saved correction refresh recovery survives a zero-row page remount", async () => {
    const purchaseId = "40000000-0000-4000-8000-000000000004";
    const creditPurchase = {
      ...row(1),
      id: "50000000-0000-4000-8000-000000000001",
      description: "Purchase awaiting history refresh",
      installment_group_id: null,
      account: { id: "account-1", name: "Card", type: "credit_card" },
    };
    configureHistoryRows([creditPurchase]);
    debtMocks.snapshot = {
      accounts: [{ accountId: "account-1", totalOutstanding: "12.00", undatedOutstanding: "0.00", fingerprint: "f", reconciliation: "balanced", reconciliationDelta: "0.00" }],
      rows: [{ id: "debt-row-1", accountId: "account-1", groupId: purchaseId, source: "purchase", transactionId: creditPurchase.id, dueDate: "2026-01-02", originalAmount: "12.00", paidAmount: "0.00", correctedAmount: "0.00", remainingAmount: "12.00", ordinal: 1, name: creditPurchase.description }],
    };
    debtMocks.refresh = vi.fn(async () => { throw new Error("debt refresh failed"); });
    const user = userEvent.setup();
    render(<TransactionsPage />);

    await screen.findByText("Purchase awaiting history refresh");
    await user.click(screen.getByRole("button", { name: "Delete transaction" }));
    await user.click(screen.getByRole("button", { name: "Complete mock correction" }));
    expect(await screen.findByRole("button", { name: "Refresh views" })).toBeTruthy();
    cleanup();

    configureHistoryRows([]);
    render(<TransactionsPage />);
    expect(await screen.findByRole("button", { name: "Refresh views" })).toBeTruthy();
  });
});
