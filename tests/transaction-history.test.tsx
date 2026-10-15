import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import InstallmentHistoryGroup from "@/components/transactions/InstallmentHistoryGroup";
import TransactionDetailModal from "@/components/transactions/TransactionDetailModal";
import type { DebtAccountSnapshot, DebtDueRow } from "@/lib/debt/contracts";
import {
  groupTransactions,
  loadHistoryGroup,
  loadHistoryTransaction,
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

test("marks sibling dates outside the selected range without mislabelling the group amount", async () => {
  render(<InstallmentHistoryGroup group={groupTransactions(twoInstallments())[0] as InstallmentHistoryEntry} periodRange={{ start: "2026-02-01", end: "2026-02-28" }} sortMode="date_added" debtState={null} selectionResetKey="period" onSelectTransaction={vi.fn()} onRequestDelete={vi.fn()} />);
  expect(screen.getByText("Full installment schedule, not period spending")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: /show payment schedule/i }));
  expect(screen.getByText("Outside selected period")).toBeTruthy();
});

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

function originalPurchaseOperation(groupId: string, count: number, transactionIds: string[], accountId = "60000000-0000-4000-8000-000000000006") {
  return {
    id: groupId,
    user_id: "owner-1",
    completed_at: "2026-01-01T00:00:00Z",
    command: { kind: "transaction", draft: { type: "expense", accountId, installments: { count } } },
    result: { operationId: groupId, transactionIds },
  };
}

function historyGroupClient(rows: TransactionHistoryRow[], operation: unknown) {
  return {
    from(table: string) {
      const query: any = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: table === "financial_operations" ? operation : rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return query;
    },
  };
}

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

  test("projects a consistent normalized base separately from the display fallback", () => {
    const [allBlank] = groupTransactions([
      transaction({ id: "blank-1", installment_group_id: "blank-group", description: null, category: { name: "Home" } }),
      transaction({ id: "blank-2", installment_group_id: "blank-group", description: null, category: { name: "Home" } }),
    ]);
    expect(allBlank.kind).toBe("installment_group");
    if (allBlank.kind !== "installment_group") throw new Error("Expected an installment group");
    expect(allBlank.descriptionState).toBe("consistent");
    expect(allBlank.baseDescription).toBeNull();
    expect(allBlank.description).toBe("Home");

    const [mixed] = groupTransactions([
      transaction({ id: "mixed-1", installment_group_id: "mixed-group", description: "Coffee maker (Installment 1/2)" }),
      transaction({ id: "mixed-2", installment_group_id: "mixed-group", description: "Desk (Installment 2/2)" }),
    ]);
    expect(mixed.kind).toBe("installment_group");
    if (mixed.kind !== "installment_group") throw new Error("Expected an installment group");
    expect(mixed.descriptionState).toBe("needs_review");
    expect(mixed.baseDescription).toBeNull();
  });

  test("strips only the exact terminal generated installment suffix for the edit base", () => {
    const [exact] = groupTransactions([
      transaction({ id: "exact-1", installment_group_id: "exact-group", description: "  Coffee maker (Installment 1/2)\n" }),
      transaction({ id: "exact-2", installment_group_id: "exact-group", description: "Coffee maker (Installment 2/2)" }),
    ]);
    expect(exact.kind === "installment_group" && exact.baseDescription).toBe("Coffee maker");

    const [notGenerated] = groupTransactions([
      transaction({ id: "literal", installment_group_id: "literal-group", description: "Coffee maker (installment 1/2)" }),
    ]);
    expect(notGenerated.kind === "installment_group" && notGenerated.baseDescription).toBe("Coffee maker (installment 1/2)");

    const [blankBase] = groupTransactions([
      transaction({ id: "blank-base-1", installment_group_id: "blank-base-group", description: " (Installment 1/2)" }),
      transaction({ id: "blank-base-2", installment_group_id: "blank-base-group", description: " (Installment 2/2)" }),
    ]);
    expect(blankBase.kind === "installment_group" && blankBase.descriptionState).toBe("consistent");
    expect(blankBase.kind === "installment_group" && blankBase.baseDescription).toBeNull();
  });
});

describe("history query window", () => {
  test("loads one owned detail and every owned explicit group sibling", async () => {
    const groupId = "70000000-0000-4000-8000-000000000007";
    const accountId = "60000000-0000-4000-8000-000000000006";
    const selected = transaction({ id: "70000000-0000-4000-8000-000000000001", account_id: accountId, installment_group_id: groupId });
    const sibling = transaction({ id: "70000000-0000-4000-8000-000000000002", account_id: accountId, installment_group_id: groupId, date: "2026-03-10" });
    const calls: Array<{ table: string; filters: Array<[string, unknown]>; orders: string[]; select: string }> = [];
    const client = {
      from(table: string) {
        const call = { table, filters: [] as Array<[string, unknown]>, orders: [] as string[], select: "" };
        calls.push(call);
        const query: any = {
          select: (value: string) => { call.select = value; return query; },
          eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
          order: (column: string) => { call.orders.push(column); return query; },
          maybeSingle: async () => ({ data: table === "financial_operations" ? originalPurchaseOperation(groupId, 2, [selected.id, sibling.id], accountId) : selected, error: null }),
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: [selected, sibling], error: null }).then(resolve, reject),
        };
        return query;
      },
    };

    await expect(loadHistoryTransaction(client, "owner-1", "selected")).resolves.toEqual(selected);
    await expect(loadHistoryGroup(client, "owner-1", groupId)).resolves.toEqual([
      { ...selected, descriptionProof: { count: 2, ordinal: 1 } },
      { ...sibling, descriptionProof: { count: 2, ordinal: 2 } },
    ]);
    expect(calls[0].filters).toEqual([["user_id", "owner-1"], ["id", "selected"]]);
    expect(calls[1].table).toBe("financial_operations");
    expect(calls[1].filters).toEqual([["user_id", "owner-1"], ["id", groupId]]);
    expect(calls[2].filters).toEqual([["user_id", "owner-1"], ["installment_group_id", groupId]]);
    expect(calls[2].orders).toEqual(["date", "id"]);
    expect(calls[0].select).toContain("description");
    expect(calls[2].select).toBe(calls[0].select);
  });

  test("uses original count one proof so a literal suffix-shaped description stays intact", async () => {
    const groupId = "70000000-0000-4000-8000-000000000007";
    const accountId = "60000000-0000-4000-8000-000000000006";
    const onlyId = "70000000-0000-4000-8000-000000000001";
    const rows = [transaction({ id: onlyId, account_id: accountId, installment_group_id: groupId, description: "Course (Installment 1/2)" })];
    const loaded = await loadHistoryGroup(historyGroupClient(rows, originalPurchaseOperation(groupId, 1, [onlyId], accountId)), "owner-1", groupId);
    const [group] = groupTransactions(loaded);

    expect(loaded[0].descriptionProof).toEqual({ count: 1, ordinal: 1 });
    expect(group.kind === "installment_group" && group.baseDescription).toBe("Course (Installment 1/2)");
    expect(group.kind === "installment_group" && group.descriptionState).toBe("consistent");
  });

  test("retains original ordinal three when earlier members were deleted", async () => {
    const groupId = "70000000-0000-4000-8000-000000000007";
    const accountId = "60000000-0000-4000-8000-000000000006";
    const originalIds = [1, 2, 3].map(index => `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const live = transaction({ id: originalIds[2], account_id: accountId, installment_group_id: groupId, description: "Course (Installment 3/3)" });
    const loaded = await loadHistoryGroup(historyGroupClient([live], originalPurchaseOperation(groupId, 3, originalIds, accountId)), "owner-1", groupId);
    const [group] = groupTransactions(loaded);

    expect(loaded[0].descriptionProof).toEqual({ count: 3, ordinal: 3 });
    expect(group.kind === "installment_group" && group.baseDescription).toBe("Course");
    expect(group.kind === "installment_group" && group.descriptionState).toBe("consistent");
  });

  test("fails closed with proof guidance when the original operation is missing", async () => {
    const groupId = "70000000-0000-4000-8000-000000000007";
    const accountId = "60000000-0000-4000-8000-000000000006";
    const live = transaction({ id: "70000000-0000-4000-8000-000000000001", account_id: accountId, installment_group_id: groupId, description: "Course (Installment 1/2)" });
    const loaded = await loadHistoryGroup(historyGroupClient([live], null), "owner-1", groupId);
    const [group] = groupTransactions(loaded);

    expect(loaded[0].descriptionProof).toBeNull();
    expect(group.kind === "installment_group" && group.descriptionProofState).toBe("needs_review");
    expect(group.kind === "installment_group" && group.descriptionState).toBe("needs_review");
    expect(group.kind === "installment_group" && group.baseDescription).toBeNull();
  });
});

describe("installment history row", () => {
  test("expands from the whole header with keyboard input and deletes one installment", async () => {
    const user = userEvent.setup();
    const entry = groupTransactions(twoInstallments().map(row => ({ ...row, purchase_date: null })))[0] as InstallmentHistoryEntry;
    const onRequestDelete = vi.fn();
    const onSelectTransaction = vi.fn();
    render(<InstallmentHistoryGroup group={entry} sortMode="transaction_date" debtState={null} selectionResetKey="test" onRequestDelete={onRequestDelete} onSelectTransaction={onSelectTransaction} />);
    expect(screen.queryByText("Sorted by latest due date")).toBeNull();
    expect(screen.queryByText("Purchase date: Unavailable")).toBeNull();

    const header = screen.getByRole("button", { name: /show payment schedule/i });
    await user.click(screen.getByText("Coffee maker"));
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Purchase date: Unavailable")).toBeTruthy();
    expect(screen.getByText("Sorted by latest due date")).toBeTruthy();
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

  test("refresh retains the expanded schedule and updates surviving children", async () => {
    const user = userEvent.setup();
    const props = { sortMode: "date_added" as const, debtState: null, selectionResetKey: "test", onRequestDelete: vi.fn(), onSelectTransaction: vi.fn() };
    const { rerender } = render(<InstallmentHistoryGroup {...props} group={groupTransactions(twoInstallments())[0] as InstallmentHistoryEntry} />);
    await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
    rerender(<InstallmentHistoryGroup {...props} group={groupTransactions(twoInstallments().slice(1))[0] as InstallmentHistoryEntry} />);
    expect(screen.getByRole("button", { name: /hide payment schedule/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /view installment 2 details/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /view installment 1 details/i })).toBeNull();
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
    expect(await screen.findByText(/2 installments · ₱0\.30 remaining/)).toBeTruthy();
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

test("bulk selection follows matching transaction IDs while outside siblings remain manually selectable", async () => {
  const user = userEvent.setup();
  render(<InstallmentHistoryGroup group={creditGroup()} matchingRowIds={["tx-1"]} recordedAmount="900719925474099.93" showRecordedAmount sortMode="amount_desc" debtState={{ account: creditAccount, rows: creditRows }} selectionResetKey="matching" onSelectTransaction={vi.fn()} onRequestDelete={vi.fn()} />);
  expect(screen.getByText("Recorded total ₱900,719,925,474,099.93")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
  expect(screen.getByText("Outside filters")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect((screen.getByRole("checkbox", { name: "Select installment 1" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Select installment 2" }) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole("checkbox", { name: "Select installment 2" }));
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("list", { name: /Installments for/ }), { key: "a", ctrlKey: true });
  expect(screen.getByText("1 selected")).toBeTruthy();
});

test("canonical unavailable dates and invalid recorded money never render guessed values", async () => {
  const group = groupTransactions(twoInstallments().map(row => ({ ...row, date: "", purchase_date: null, amount: "NaN" })))[0] as InstallmentHistoryEntry;
  render(<InstallmentHistoryGroup group={group} transactionDate={null} recordedAmount={null} showRecordedAmount sortMode="transaction_date_desc" debtState={null} selectionResetKey="unknown" onSelectTransaction={vi.fn()} onRequestDelete={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole("button", { name: /show payment schedule/i }));
  expect(screen.getByText("Transaction date: Unavailable")).toBeTruthy();
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toMatch(/Invalid Date|NaN|1970/);
});

test("refresh prunes missing debt rows and preserves explicitly selected outside siblings", async () => {
  const props = { matchingRowIds: ["tx-1"], sortMode: "date_added_desc" as const, selectionResetKey: "stable", onSelectTransaction: vi.fn(), onRequestDelete: vi.fn() };
  const user = userEvent.setup();
  const view = render(<InstallmentHistoryGroup {...props} group={creditGroup()} debtState={{ account: creditAccount, rows: creditRows }} />);
  await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("button", { name: "Select all" }));
  await user.click(screen.getByRole("checkbox", { name: "Select installment 2" }));
  const group = { ...creditGroup(), children: creditGroup().children.slice(1) };
  view.rerender(<InstallmentHistoryGroup {...props} matchingRowIds={["tx-2"]} group={group} debtState={{ account: creditAccount, rows: creditRows.slice(1) }} />);
  expect(screen.getByRole("button", { name: /hide payment schedule/i })).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: "Select installment 2" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("1 selected")).toBeTruthy();
});

test("paid matching rows do not block explicit selection of an unpaid outside sibling", async () => {
  const user = userEvent.setup();
  const rows = creditRows.map((row, index) => index === 0 ? { ...row, paidAmount: "0.10", remainingAmount: "0.00" } : row);
  render(<InstallmentHistoryGroup group={creditGroup()} matchingRowIds={["tx-1"]} sortMode="date_added_desc" debtState={{ account: creditAccount, rows }} selectionResetKey="paid-match" onSelectTransaction={vi.fn()} onRequestDelete={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /show payment schedule/i }));
  expect((screen.getByRole("button", { name: "Select" }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole("button", { name: "Select" }));
  expect((screen.getByRole("button", { name: "Select all" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "Select installment 2" }));
  expect(screen.getByText("1 selected")).toBeTruthy();
});
