import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import InstallmentHistoryGroup from "@/components/transactions/InstallmentHistoryGroup";
import TransactionDetailModal from "@/components/transactions/TransactionDetailModal";
import type { DebtAccountSnapshot, DebtDueRow } from "@/lib/debt/contracts";
import {
  filterHistoryEntries,
  groupTransactions,
  loadHistoryPage,
  mergeHistoryRows,
  sortHistoryEntries,
  type InstallmentHistoryEntry,
  type TransactionHistoryRow,
} from "@/lib/transactions/history";

const debtView = vi.hoisted(() => ({ snapshot: null as unknown }));
vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ userId: "owner-1" }) }));
vi.mock("@/hooks/use-debt", () => ({
  useDebt: () => ({ snapshot: debtView.snapshot, isLoading: false, error: null, refresh: async () => undefined }),
  useDebtCommand: () => ({ isSaving: false, unresolved: false, saved: null, error: null, refreshError: null, pendingCommand: null,
    submit: async () => undefined, retry: async () => undefined, reset: () => undefined }),
}));

afterEach(() => cleanup());

const transaction = (overrides: Partial<TransactionHistoryRow> = {}): TransactionHistoryRow => ({
  id: "tx-1",
  user_id: "owner-1",
  account_id: "account-1",
  type: "expense",
  amount: "0.10",
  description: "Coffee maker (Installment 1/2)",
  date: "2026-02-10",
  purchase_date: "2026-01-10",
  installment_group_id: "purchase-1",
  created_at: "2026-01-10T10:00:00Z",
  category: { name: "Home" },
  account: { name: "Card", type: "cash" } as TransactionHistoryRow["account"],
  ...overrides,
});

const twoInstallments = () => [
  transaction({ id: "tx-1", amount: "0.10", description: "Coffee maker (Installment 1/2)", date: "2026-02-10" }),
  transaction({ id: "tx-2", amount: "0.20", description: "Coffee maker (Installment 2/2)", date: "2026-03-10" }),
];

const creditRows: DebtDueRow[] = [
  { id: "debt-1", accountId: "account-1", groupId: "purchase-1", source: "purchase", transactionId: "tx-1", dueDate: "2026-02-10", originalAmount: "0.10", paidAmount: "0.00", correctedAmount: "0.00", remainingAmount: "0.10", ordinal: 1, name: "Coffee maker" },
  { id: "debt-2", accountId: "account-1", groupId: "purchase-1", source: "purchase", transactionId: "tx-2", dueDate: "2026-03-10", originalAmount: "0.20", paidAmount: "0.00", correctedAmount: "0.00", remainingAmount: "0.20", ordinal: 2, name: "Coffee maker" },
];
const creditAccount: DebtAccountSnapshot = { accountId: "account-1", totalOutstanding: "0.30", undatedOutstanding: "0.00", fingerprint: "a".repeat(64), reconciliation: "balanced", reconciliationDelta: "0.00" };
const creditGroup = () => groupTransactions(twoInstallments().map(row => ({ ...row, account: { name: "Card", type: "credit_card" } })))[0] as InstallmentHistoryEntry;

describe("transaction history grouping", () => {
  test("groups only rows with the same explicit installment id", () => {
    const entries = groupTransactions([
      ...twoInstallments(),
      transaction({ id: "tx-3", installment_group_id: "purchase-2", description: "Coffee maker (Installment 1/2)" }),
      transaction({ id: "legacy-1", installment_group_id: null, purchase_date: null, description: "Coffee maker", created_at: "2025-01-01T00:00:00Z" }),
      transaction({ id: "legacy-2", installment_group_id: null, purchase_date: null, description: "Coffee maker", created_at: "2025-01-01T00:00:00Z" }),
    ]);

    expect(entries).toHaveLength(4);
    expect(entries.filter(entry => entry.kind === "installment_group").map(entry => entry.groupId)).toEqual(["purchase-1", "purchase-2"]);
    expect(entries.filter(entry => entry.kind === "transaction").map(entry => entry.transaction.id)).toEqual(["legacy-1", "legacy-2"]);
  });

  test("uses integer cents for the remaining schedule amount", () => {
    const [group] = groupTransactions(twoInstallments());
    expect(group.kind).toBe("installment_group");
    if (group.kind !== "installment_group") throw new Error("Expected an installment group");
    expect(group.remainingAmount).toBe(0.3);
    expect(group.description).toBe("Coffee maker");

    const [afterOneDeletion] = groupTransactions(twoInstallments().slice(1));
    expect(afterOneDeletion.kind).toBe("installment_group");
    if (afterOneDeletion.kind !== "installment_group") throw new Error("Expected the remaining installment group");
    expect(afterOneDeletion.remainingAmount).toBe(0.2);
  });

  test("sorts purchase groups by purchase date and ordinary rows by transaction date", () => {
    const rows = [
      transaction({ id: "older-purchase", purchase_date: "2025-12-20", created_at: "2026-03-01T00:00:00Z" }),
      transaction({ id: "newer-purchase", installment_group_id: "purchase-new", purchase_date: "2026-02-20", created_at: "2026-01-01T00:00:00Z" }),
      transaction({ id: "ordinary", installment_group_id: null, purchase_date: null, date: "2026-01-15", created_at: "2026-02-01T00:00:00Z" }),
    ];
    const entries = groupTransactions(rows);

    expect(sortHistoryEntries(entries, "transaction_date").map(entry => entry.key)).toEqual([
      "installment:purchase-new",
      "transaction:ordinary",
      "installment:purchase-1",
    ]);
    expect(sortHistoryEntries(entries, "date_added").map(entry => entry.key)).toEqual([
      "installment:purchase-1",
      "transaction:ordinary",
      "installment:purchase-new",
    ]);
  });

  test("uses a group's first due date when a legacy purchase date is unknown", () => {
    const legacyGroup = groupTransactions([
      transaction({ id: "legacy-installment", installment_group_id: "legacy-group", purchase_date: null, date: "2024-04-15" }),
    ])[0];
    expect(legacyGroup.kind).toBe("installment_group");
    if (legacyGroup.kind !== "installment_group") throw new Error("Expected a legacy installment group");
    expect(legacyGroup.purchaseDate).toBeNull();
    expect(sortHistoryEntries([legacyGroup], "transaction_date")[0].key).toBe("installment:legacy-group");
  });

  test("ranks a hydrated legacy group by its latest due date on later history pages", async () => {
    const purchaseId = "legacy-purchase";
    const legacyChildren = [
      transaction({ id: "legacy-aug", installment_group_id: purchaseId, purchase_date: null, date: "2026-08-10", created_at: "2026-07-01T00:00:00Z" }),
      transaction({ id: "legacy-sep", installment_group_id: purchaseId, purchase_date: null, date: "2026-09-10", created_at: "2026-07-01T00:00:00Z" }),
      transaction({ id: "legacy-oct", installment_group_id: purchaseId, purchase_date: null, date: "2026-10-10", created_at: "2026-07-01T00:00:00Z" }),
    ];
    const laterPageRows = [
      legacyChildren[2],
      transaction({ id: "ordinary-oct-15", installment_group_id: null, purchase_date: null, date: "2026-10-15" }),
      transaction({ id: "ordinary-oct-05", installment_group_id: null, purchase_date: null, date: "2026-10-05" }),
    ];
    const client = {
      from() {
        const call: { filters: Array<[string, unknown]> } = { filters: [] };
        const query: any = {
          select: () => query,
          eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
          in: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
          order: () => query,
          range: () => query,
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            const isSiblingRead = call.filters.some(([column]) => column === "installment_group_id");
            return Promise.resolve({ data: isSiblingRead ? legacyChildren : laterPageRows, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };

    const page = await loadHistoryPage(client, "owner-1", "transaction_date", 50);
    const entries = sortHistoryEntries(groupTransactions(page.rows), "transaction_date");
    const legacyGroup = entries.find(entry => entry.kind === "installment_group");

    expect(entries.map(entry => entry.key)).toEqual([
      "transaction:ordinary-oct-15",
      "installment:legacy-purchase",
      "transaction:ordinary-oct-05",
    ]);
    expect(legacyGroup?.kind === "installment_group" && legacyGroup.purchaseDate).toBeNull();
    expect(legacyGroup?.kind === "installment_group" && legacyGroup.firstDueDate).toBe("2026-08-10");
    expect(legacyGroup?.kind === "installment_group" && legacyGroup.latestDueDate).toBe("2026-10-10");
  });

  test("uses transaction id as a stable tie break", () => {
    const entries = groupTransactions([
      transaction({ id: "a", installment_group_id: null, purchase_date: null, date: "2026-01-01", created_at: "2026-02-01T00:00:00Z" }),
      transaction({ id: "z", installment_group_id: null, purchase_date: null, date: "2026-01-01", created_at: "2026-02-01T00:00:00Z" }),
    ]);
    expect(sortHistoryEntries(entries, "transaction_date").map(entry => entry.key)).toEqual(["transaction:z", "transaction:a"]);
  });

  test("uses the server-ordered installment row id to break group ties", () => {
    const entries = groupTransactions([
      transaction({ id: "a-group-row", installment_group_id: "purchase-a", created_at: "2026-02-01T00:00:00Z" }),
      transaction({ id: "z-group-row", installment_group_id: "purchase-a", created_at: "2026-02-01T00:00:00Z" }),
      transaction({ id: "m-ordinary-row", installment_group_id: null, purchase_date: null, date: "2026-01-10", created_at: "2026-02-01T00:00:00Z" }),
    ]);

    expect(sortHistoryEntries(entries, "date_added").map(entry => entry.key)).toEqual([
      "installment:purchase-a",
      "transaction:m-ordinary-row",
    ]);
    expect(sortHistoryEntries(entries, "transaction_date").map(entry => entry.key)).toEqual([
      "installment:purchase-a",
      "transaction:m-ordinary-row",
    ]);
  });

  test("a search match on any child keeps the full group visible", () => {
    const entries = groupTransactions([
      ...twoInstallments(),
      transaction({ id: "unrelated", installment_group_id: "purchase-2", purchase_date: "2026-01-20", description: "Desk (Installment 1/2)" }),
    ]);

    const matches = filterHistoryEntries(entries, "2/2");
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("installment_group");
    if (matches[0].kind !== "installment_group") throw new Error("Expected the matching purchase group");
    expect(matches[0].children.map(child => child.id)).toEqual(["tx-1", "tx-2"]);
  });
});

describe("history query window", () => {
  test("hydrates every selected group's siblings with an owner-scoped query", async () => {
    const selected = transaction({ id: "selected", installment_group_id: "purchase-1" });
    const siblings = [selected, transaction({ id: "outside-window-1", date: "2026-03-10" }), transaction({ id: "outside-window-2", date: "2026-04-10" })];
    const calls: Array<{ table: string; filters: Array<[string, unknown]>; orders: string[]; range?: [number, number] }> = [];

    const client = {
      from(table: string) {
        const call = { table, filters: [] as Array<[string, unknown]>, orders: [] as string[], range: undefined as [number, number] | undefined };
        calls.push(call);
        const query: any = {
          select: () => query,
          eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
          in: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
          order: (column: string) => { call.orders.push(column); return query; },
          range: (start: number, end: number) => { call.range = [start, end]; return query; },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            const data = call.filters.some(([column]) => column === "installment_group_id") ? siblings : [selected];
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };

    const page = await loadHistoryPage(client, "owner-1", "date_added");

    expect(page.rows.map(row => row.id)).toEqual(["selected", "outside-window-1", "outside-window-2"]);
    expect(calls[0].range).toEqual([0, 49]);
    expect(calls[1].filters).toContainEqual(["user_id", "owner-1"]);
    expect(calls[1].filters).toContainEqual(["installment_group_id", ["purchase-1"]]);
    expect(calls[1].range).toBeUndefined();
  });

  test("uses the stored history date for transaction-date window selection", async () => {
    const calls: Array<{ orders: Array<[string, unknown]>; range?: [number, number] }> = [];
    const client = {
      from() {
        const call = { orders: [] as Array<[string, unknown]>, range: undefined as [number, number] | undefined };
        calls.push(call);
        const query: any = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: (column: string, options: unknown) => { call.orders.push([column, options]); return query; },
          range: (start: number, end: number) => { call.range = [start, end]; return query; },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        return query;
      },
    };

    await loadHistoryPage(client, "owner-1", "transaction_date");

    expect(calls[0].orders.map(([column]) => column)).toEqual(["history_date", "created_at", "id"]);
    expect(calls[0].range).toEqual([0, 49]);
  });

  test("loads the next bounded page and returns a cursor only when a full page exists", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => transaction({ id: `page-2-${index}`, installment_group_id: null, purchase_date: null }));
    let pageRange: [number, number] | undefined;
    const client = {
      from() {
        const query: any = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          range: (start: number, end: number) => { pageRange = [start, end]; return query; },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
        };
        return query;
      },
    };

    const page = await loadHistoryPage(client, "owner-1", "date_added", 50);

    expect(pageRange).toEqual([50, 99]);
    expect(page.nextOffset).toBe(100);
  });

  test("preserves the first copy of a transaction when adjacent pages overlap", () => {
    const original = transaction({ id: "same", description: "Original row" });
    const duplicate = transaction({ id: "same", description: "Duplicate row" });
    const later = transaction({ id: "later", installment_group_id: null, purchase_date: null });

    expect(mergeHistoryRows([original], [duplicate, later]).map(row => row.description)).toEqual([
      "Original row",
      "Coffee maker (Installment 1/2)",
    ]);
  });

  test("keeps the same page cursor available after an error so the request can be retried", async () => {
    let attempts = 0;
    let requestedRange: [number, number] | undefined;
    const client = {
      from() {
        const query: any = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          range: (start: number, end: number) => { requestedRange = [start, end]; return query; },
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            attempts += 1;
            const response = attempts === 1 ? { data: null, error: new Error("temporary read failure") } : { data: [transaction({ id: "retried" })], error: null };
            return Promise.resolve(response).then(resolve, reject);
          },
        };
        return query;
      },
    };

    await expect(loadHistoryPage(client, "owner-1", "date_added", 50)).rejects.toThrow("temporary read failure");
    const retry = await loadHistoryPage(client, "owner-1", "date_added", 50);

    expect(requestedRange).toEqual([50, 99]);
    expect(retry.rows.map(row => row.id)).toEqual(["retried"]);
    expect(retry.nextOffset).toBeNull();
  });
});

describe("installment history row", () => {
  test("expands from the whole header with keyboard input and deletes one installment", async () => {
    const user = userEvent.setup();
    const entry = groupTransactions(twoInstallments().map(row => ({ ...row, purchase_date: null })))[0] as InstallmentHistoryEntry;
    const onRequestDelete = vi.fn();
    const onSelectTransaction = vi.fn();
    render(<InstallmentHistoryGroup group={entry} sortMode="transaction_date" debtState={null} selectionResetKey="test" onRequestDelete={onRequestDelete} onSelectTransaction={onSelectTransaction} />);
    expect(screen.getByText("Sorted by latest due date")).toBeTruthy();

    const header = screen.getByRole("button", { name: /show payment schedule/i });
    await user.click(screen.getByText("Coffee maker"));
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Installment 1 of 2")).toBeTruthy();

    const disclosure = header;
    disclosure.focus();
    await user.keyboard("[Space]");

    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard("{Enter}");
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Due.*February 10, 2026/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete installment 1" }));
    expect(onRequestDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "tx-1", installment_group_id: "purchase-1" }));
    expect(onSelectTransaction).not.toHaveBeenCalled();
  });

  test("opens a child's original transaction details from the schedule", async () => {
    const entry = groupTransactions(twoInstallments())[0] as InstallmentHistoryEntry;
    const onSelectTransaction = vi.fn();
    render(<InstallmentHistoryGroup group={entry} sortMode="date_added" debtState={null} selectionResetKey="test" onRequestDelete={vi.fn()} onSelectTransaction={onSelectTransaction} />);
    fireEvent.click(screen.getByRole("button", { name: /show payment schedule/i }));
    fireEvent.click(screen.getByRole("button", { name: /view installment 2 details/i }));

    expect(onSelectTransaction).toHaveBeenCalledWith(expect.objectContaining({ id: "tx-2", date: "2026-03-10" }));
  });

  test("collapses and recalculates the remaining amount when a child disappears", async () => {
    const user = userEvent.setup();
    const originalGroup = groupTransactions(twoInstallments())[0] as InstallmentHistoryEntry;
    const { rerender } = render(<InstallmentHistoryGroup group={originalGroup} sortMode="date_added" debtState={null} selectionResetKey="test" onRequestDelete={vi.fn()} onSelectTransaction={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
    expect(screen.getByText("₱0.30")).toBeTruthy();

    const remainingGroup = groupTransactions(twoInstallments().slice(1))[0] as InstallmentHistoryEntry;
    rerender(<InstallmentHistoryGroup group={remainingGroup} sortMode="date_added" debtState={null} selectionResetKey="test" onRequestDelete={vi.fn()} onSelectTransaction={vi.fn()} />);

    expect(screen.getByRole("button", { name: /show payment schedule/i }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("₱0.20")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /view installment 2 details/i })).toBeNull();
    const header = screen.getByRole("button", { name: /show payment schedule/i });
    const schedule = document.getElementById(header.getAttribute("aria-controls") ?? "");
    expect(schedule?.getAttribute("aria-hidden")).toBe("true");
    expect(schedule?.hasAttribute("inert")).toBe(true);
  });

  test("credit history uses complete snapshot ordinals and focused-list shortcuts", async () => {
    const snapshot = { accounts: [creditAccount], rows: creditRows };
    debtView.snapshot = snapshot;
    const entry = creditGroup();
    render(<InstallmentHistoryGroup group={entry} sortMode="date_added" debtState={{ account: creditAccount, rows: creditRows }} selectionResetKey="credit" onRequestDelete={vi.fn()} onSelectTransaction={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /show payment schedule/i }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Select" }));
    const list = screen.getByRole("list", { name: "Installments for Coffee maker" });
    list.focus();
    fireEvent.keyDown(list, { key: "a", ctrlKey: true });
    expect((screen.getByRole("checkbox", { name: "Select installment 1" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select installment 2" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Installment 1")).toBeTruthy();
    expect(screen.queryByText("Installment 1 of 2")).toBeNull();
    fireEvent.keyDown(list, { key: "Delete" });
    expect(await screen.findByText(/2 installments · PHP 0\.30 remaining/)).toBeTruthy();
  });

  test("Escape exits selection only from the focused list and ignores IME and row controls", async () => {
    debtView.snapshot = { accounts: [creditAccount], rows: creditRows };
    const entry = creditGroup();
    render(<InstallmentHistoryGroup group={entry} sortMode="date_added" debtState={{ account: creditAccount, rows: creditRows }} selectionResetKey="escape" onRequestDelete={vi.fn()} onSelectTransaction={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
    await user.click(screen.getByRole("button", { name: "Select" }));
    const list = screen.getByRole("list", { name: "Installments for Coffee maker" });
    const firstCheckbox = screen.getByRole("checkbox", { name: "Select installment 1" }) as HTMLInputElement;

    fireEvent.keyDown(firstCheckbox, { key: "a", ctrlKey: true });
    fireEvent.keyDown(list, { key: "a", ctrlKey: true, isComposing: true, keyCode: 229 });
    expect(firstCheckbox.checked).toBe(false);

    list.focus();
    fireEvent.keyDown(list, { key: "a", ctrlKey: true });
    expect(firstCheckbox.checked).toBe(true);
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("checkbox", { name: "Select installment 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("expense groups with an unknown wallet type cannot fall through to ordinary deletion", async () => {
    const unknownGroup = groupTransactions(twoInstallments().map(row => ({ ...row, account: { name: "Unknown card", type: null } })))[0] as InstallmentHistoryEntry;
    const onRequestDelete = vi.fn();
    render(<InstallmentHistoryGroup group={unknownGroup} sortMode="date_added" debtState={null} selectionResetKey="unknown" onRequestDelete={onRequestDelete} onSelectTransaction={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /show payment schedule/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/wallet type.*unavailable/i);
    expect(screen.getAllByRole("button", { name: "Delete installment unavailable" }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(onRequestDelete).not.toHaveBeenCalled();
  });

  test("incomplete or unavailable credit snapshots block the old delete lane", async () => {
    const entry = creditGroup();
    const onRequestDelete = vi.fn();
    const view = render(<InstallmentHistoryGroup group={entry} sortMode="date_added" debtState={null} selectionResetKey="missing" onRequestDelete={onRequestDelete} onSelectTransaction={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /show payment schedule/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/does not match a complete debt snapshot/i);
    expect(screen.getAllByRole("button", { name: "Delete installment unavailable" }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(onRequestDelete).not.toHaveBeenCalled();

    view.rerender(<InstallmentHistoryGroup group={entry} sortMode="date_added" debtState={{ account: creditAccount, rows: [creditRows[0]] }} selectionResetKey="partial" onRequestDelete={onRequestDelete} onSelectTransaction={vi.fn()} />);
    expect(screen.getByRole("button", { name: /show payment schedule/i }).getAttribute("aria-expanded")).toBe("false");
    await userEvent.setup().click(screen.getByRole("button", { name: /show payment schedule/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/does not match a complete debt snapshot/i);
    expect(screen.getAllByRole("button", { name: "Delete installment unavailable" }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  test("page reset key clears selection and collapses the ledger", async () => {
    debtView.snapshot = { accounts: [creditAccount], rows: creditRows };
    const entry = creditGroup();
    const props = { group: entry, sortMode: "date_added" as const, debtState: { account: creditAccount, rows: creditRows }, onRequestDelete: vi.fn(), onSelectTransaction: vi.fn() };
    const view = render(<InstallmentHistoryGroup {...props} selectionResetKey="all|date_added|" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
    await user.click(screen.getByRole("button", { name: "Select" }));
    const list = screen.getByRole("list", { name: "Installments for Coffee maker" });
    list.focus();
    fireEvent.keyDown(list, { key: "a", ctrlKey: true });
    expect((screen.getByRole("checkbox", { name: "Select installment 1" }) as HTMLInputElement).checked).toBe(true);

    view.rerender(<InstallmentHistoryGroup {...props} selectionResetKey="all|date_added|new search" />);
    expect(screen.getByRole("button", { name: /show payment schedule/i }).getAttribute("aria-expanded")).toBe("false");
    await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect((screen.getByRole("checkbox", { name: "Select installment 1" }) as HTMLInputElement).checked).toBe(false);
  });

  test("paid credit rows expose a readable reason and cannot use the ordinary delete callback", () => {
    const onRequestDelete = vi.fn();
    render(<TransactionDetailModal
      isOpen
      transaction={{ ...twoInstallments()[0], account: { name: "Card", type: "credit_card" } }}
      onClose={vi.fn()}
      onRequestDelete={onRequestDelete}
      deleteDisabledReason="This installment is fully paid."
    />);

    const deleteButton = screen.getByRole("button", { name: "Delete unavailable" }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("This installment is fully paid.");
    fireEvent.click(deleteButton);
    expect(onRequestDelete).not.toHaveBeenCalled();
  });
});
