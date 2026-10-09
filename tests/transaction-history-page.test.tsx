import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
const descriptionMocks = vi.hoisted(() => ({
  state: null as any,
  submit: vi.fn(),
  retry: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
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
vi.mock("next/dynamic", () => ({ default: () => (props: any) => props?.transaction
  ? <div data-testid="mock-detail-description">{props.transaction.description}</div>
  : null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ userId: "owner-1", refresh: async () => undefined }) }));
vi.mock("@/hooks/use-debt", () => ({
  useDebt: () => ({ snapshot: debtMocks.snapshot, isLoading: false, error: null, refresh: debtMocks.refresh }),
  useDebtCommand: () => debtMocks.command,
}));
vi.mock("@/hooks/use-transaction-description", () => ({
  useTransactionDescription: (_userId: string | null, refreshHistory: () => Promise<unknown>) => ({
    ...descriptionMocks.state,
    submit: (command: unknown) => descriptionMocks.submit(command, refreshHistory),
    retry: () => descriptionMocks.retry(),
    refresh: () => descriptionMocks.refresh(),
    reset: () => descriptionMocks.reset(),
  }),
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

type HistoryTestRow = Omit<ReturnType<typeof row>, "installment_group_id" | "purchase_date" | "history_date">
  & { installment_group_id: string | null; purchase_date: string | null; history_date: string | null };

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

function configureHistoryRows(rows: HistoryTestRow[], operationOverrides?: any[]) {
  const ranges: Array<[number, number]> = [];
  const groupReads: string[] = [];
  const groupRows = new Map<string, HistoryTestRow[]>();
  rows.forEach(item => {
    if (!item.installment_group_id) return;
    const siblings = groupRows.get(item.installment_group_id) ?? [];
    siblings.push(item);
    groupRows.set(item.installment_group_id, siblings);
  });
  const operations = operationOverrides ?? Array.from(groupRows, ([groupId, siblings]) => ({
    id: groupId,
    user_id: "owner-1",
    completed_at: "2026-01-01T00:00:00Z",
    command: { kind: "transaction", draft: { type: "expense", accountId: siblings[0].account_id, installments: { count: siblings.length } } },
    result: { operationId: groupId, transactionIds: siblings.map(item => item.id) },
  }));
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.from.mockImplementation((table: string) => {
    if (table === "financial_operations") {
      const filters: Array<[string, unknown]> = [];
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        maybeSingle: async () => {
          const id = filters.find(([column]) => column === "id")?.[1];
          const owner = filters.find(([column]) => column === "user_id")?.[1];
          return { data: operations.find(item => item.id === id && item.user_id === owner) ?? null, error: null };
        },
      };
      return query;
    }
    let range: [number, number] = [0, 49];
    let siblingIds: string[] = [];
    const filters: Array<[string, unknown]> = [];
    const query: any = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); if (column === "installment_group_id") groupReads.push(String(value)); return query; },
      in: (_column: string, ids: string[]) => { siblingIds = ids; return query; },
      order: () => query,
      range: (start: number, end: number) => { range = [start, end]; ranges.push(range); return query; },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const requestedGroup = filters.find(([column]) => column === "installment_group_id")?.[1];
        const page = siblingIds.length
          ? rows.filter(item => item.installment_group_id && siblingIds.includes(item.installment_group_id))
          : requestedGroup
            ? rows.filter(item => item.installment_group_id === requestedGroup)
            : rows.slice(range[0], range[1] + 1);
        return Promise.resolve({ data: page, error: null }).then(resolve, reject);
      },
    };
    return query;
  });
  return { ranges, groupReads };
}

function configureDescriptionRefreshPages() {
  const groupId = "40000000-0000-4000-8000-000000000004";
  const accountId = "60000000-0000-4000-8000-000000000006";
  let currentGroupRows: HistoryTestRow[] = [1, 2, 3].map(index => ({
    ...row(index),
    id: `50000000-0000-4000-8000-00000000000${index}`,
    account_id: accountId,
    description: `Original purchase (Installment ${index}/3)`,
    installment_group_id: groupId,
    purchase_date: "2026-01-10",
    history_date: "2026-01-10",
  }));
  const firstPageRows = () => [currentGroupRows[0], ...Array.from({ length: 49 }, (_, index) => row(index + 2))];
  const secondPageRows = Array.from({ length: 50 }, (_, index) => row(index + 51));
  const lateRows = [row(151)];
  lateRows[0].description = "Late stale page row";
  const ranges: Array<[number, number]> = [];
  const detailReads: string[] = [];
  let resolveLatePage!: (value: { data: HistoryTestRow[]; error: null }) => void;
  const latePage = new Promise<{ data: HistoryTestRow[]; error: null }>(resolve => { resolveLatePage = resolve; });
  const operation = {
    id: groupId,
    user_id: "owner-1",
    completed_at: "2026-01-01T00:00:00Z",
    command: { kind: "transaction", draft: { type: "expense", accountId, installments: { count: 3 } } },
    result: { operationId: groupId, transactionIds: currentGroupRows.map(item => item.id) },
  };
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = [];
    if (table === "financial_operations") {
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        maybeSingle: async () => ({ data: filters.some(([column, value]) => column === "user_id" && value === "owner-1")
          && filters.some(([column, value]) => column === "id" && value === groupId) ? operation : null, error: null }),
      };
      return query;
    }

    let groupIds: string[] | null = null;
    let requestedGroup: unknown;
    let requestedId: unknown;
    let offset: number | null = null;
    const query: any = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        if (column === "installment_group_id") requestedGroup = value;
        if (column === "id") requestedId = value;
        return query;
      },
      in: (_column: string, ids: string[]) => { groupIds = ids; return query; },
      order: () => query,
      range: (start: number, end: number) => { offset = start; ranges.push([start, end]); return query; },
      maybeSingle: async () => {
        if (requestedId) detailReads.push(String(requestedId));
        const rowValue = [...currentGroupRows, ...firstPageRows().slice(1), ...secondPageRows]
          .find(item => item.id === requestedId);
        return { data: rowValue ?? null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (offset === 100) return latePage.then(resolve, reject);
        if (offset === 0) return Promise.resolve({ data: firstPageRows(), error: null }).then(resolve, reject);
        if (offset === 50) return Promise.resolve({ data: secondPageRows, error: null }).then(resolve, reject);
        if (groupIds) return Promise.resolve({ data: currentGroupRows.filter(item => groupIds?.includes(item.installment_group_id ?? "")), error: null }).then(resolve, reject);
        if (requestedGroup) return Promise.resolve({ data: currentGroupRows.filter(item => item.installment_group_id === requestedGroup), error: null }).then(resolve, reject);
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return query;
  });

  return {
    groupId,
    ranges,
    detailReads,
    lateRows,
    resolveLatePage,
    updateDescription(description: string) {
      currentGroupRows = currentGroupRows.map((item, index) => ({ ...item, description: `${description} (Installment ${index + 1}/3)` }));
      operation.result.transactionIds = currentGroupRows.map(item => item.id);
    },
  };
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
  descriptionMocks.state = { isSaving: false, unresolved: false, saved: null, error: null, errorCode: null, refreshError: null, pendingCommand: null };
  descriptionMocks.submit.mockReset();
  descriptionMocks.retry.mockReset();
  descriptionMocks.refresh.mockReset();
  descriptionMocks.reset.mockReset();
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

  test("opens the complete installment description editor without opening the schedule", async () => {
    const user = userEvent.setup();
    const purchaseId = "40000000-0000-4000-8000-000000000004";
    const groupRows = [1, 2, 3].map(index => ({
      ...row(index),
      id: `50000000-0000-4000-8000-00000000000${index}`,
      account_id: "60000000-0000-4000-8000-000000000006",
      description: `QA purchase (Installment ${index}/3)`,
      installment_group_id: purchaseId,
      purchase_date: "2026-01-10",
      history_date: "2026-01-10",
    }));
    const { groupReads } = configureHistoryRows(groupRows);
    render(<TransactionsPage />);

    const edit = await screen.findByRole("button", { name: "Edit description for QA purchase" });
    await user.click(edit);

    expect(await screen.findByRole("textbox", { name: "Description" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("QA purchase");
    expect(screen.getByRole("button", { name: /show payment schedule/i }).getAttribute("aria-expanded")).toBe("false");
    expect(groupReads).toContain(purchaseId);
  });

  test("does not open a group editor when its original transaction proof is missing", async () => {
    const user = userEvent.setup();
    const purchaseId = "40000000-0000-4000-8000-000000000004";
    const groupRows = [1, 2].map(index => ({
      ...row(index),
      id: `50000000-0000-4000-8000-00000000000${index}`,
      account_id: "60000000-0000-4000-8000-000000000006",
      description: `QA purchase (Installment ${index}/2)`,
      installment_group_id: purchaseId,
      purchase_date: "2026-01-10",
      history_date: "2026-01-10",
    }));
    configureHistoryRows(groupRows, []);
    render(<TransactionsPage />);

    await user.click(await screen.findByRole("button", { name: "Edit description for QA purchase" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be verified against its original transaction/i);
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
  });

  test("refreshes both loaded pages and selected detail, then rejects an older pending load-more response", async () => {
    const user = userEvent.setup();
    const fixture = configureDescriptionRefreshPages();
    render(<TransactionsPage />);

    await screen.findByRole("button", { name: "Edit description for Original purchase" });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Transaction 100")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(fixture.ranges).toContainEqual([100, 149]));

    await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
    await user.click(screen.getByRole("button", { name: "View installment 1 details" }));
    expect(screen.getByTestId("mock-detail-description").textContent).toBe("Original purchase (Installment 1/3)");
    await user.click(screen.getByRole("button", { name: "Edit description for Original purchase" }));
    const textarea = await screen.findByRole("textbox", { name: "Description" }) as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, "Updated purchase");

    descriptionMocks.submit.mockImplementation(async (command: any, refreshHistory: () => Promise<unknown>) => {
      fixture.updateDescription(command.description);
      descriptionMocks.state = {
        ...descriptionMocks.state,
        saved: { operationId: "80000000-0000-4000-8000-000000000008", transactionIds: [
          "50000000-0000-4000-8000-000000000001",
          "50000000-0000-4000-8000-000000000002",
          "50000000-0000-4000-8000-000000000003",
        ], replayed: false },
      };
      await refreshHistory();
    });
    await user.click(screen.getByRole("button", { name: "Save description" }));

    expect(await screen.findByText("Updated purchase")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("mock-detail-description").textContent).toBe("Updated purchase (Installment 1/3)"));
    expect(descriptionMocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "edit_transaction_description",
      transactionId: null,
      groupId: fixture.groupId,
      description: "Updated purchase",
      expectedDescription: "Original purchase",
    }), expect.any(Function));
    expect(fixture.ranges.slice(-2)).toEqual([[0, 49], [50, 99]]);

    await act(async () => {
      fixture.resolveLatePage({ data: fixture.lateRows, error: null });
      await Promise.resolve();
    });
    expect(screen.queryByText("Late stale page row")).toBeNull();
    expect(screen.getByText("Transaction 100")).toBeTruthy();

    const search = screen.getByRole("searchbox", { name: "Search transactions" });
    await user.type(search, "Updated purchase");
    expect(screen.getByRole("button", { name: "Edit description for Updated purchase" })).toBeTruthy();
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
