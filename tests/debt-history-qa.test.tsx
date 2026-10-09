import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DebtHistoryGroup } from "@/components/accounts/DebtHistoryGroup";
import { DebtScheduleSection } from "@/components/accounts/DebtScheduleSection";
import InstallmentHistoryGroup from "@/components/transactions/InstallmentHistoryGroup";
import { groupTransactions, type InstallmentHistoryEntry } from "@/lib/transactions/history";
import type { DebtAccountSnapshot, DebtDueRow } from "@/lib/debt/contracts";

vi.mock("@/components/transactions/DebtCorrectionDialog", () => ({ DebtCorrectionDialog: () => null }));

afterEach(cleanup);

const account: DebtAccountSnapshot = {
  accountId: "10000000-0000-4000-8000-000000000001", totalOutstanding: "30.00",
  undatedOutstanding: "0.00", fingerprint: "a".repeat(64), reconciliation: "balanced", reconciliationDelta: "0.00",
};
const rows: DebtDueRow[] = [1, 2, 3].map(ordinal => ({
  id: `20000000-0000-4000-8000-00000000000${ordinal}`, accountId: account.accountId,
  groupId: "30000000-0000-4000-8000-000000000001", source: "opening", transactionId: null,
  dueDate: `2026-0${ordinal}-01`, originalAmount: "10.00", paidAmount: "0.00",
  correctedAmount: "0.00", remainingAmount: "10.00", ordinal, name: "Phone",
}));

test("each mouse checkbox toggle agrees with the selected count", async () => {
  const user = userEvent.setup();
  render(<DebtHistoryGroup account={account} rows={rows} onSaved={async () => undefined} />);
  await user.click(screen.getByRole("button", { name: "Show debt history for Phone" }));
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("checkbox", { name: "Select installment 1" }));
  await user.click(screen.getByRole("checkbox", { name: "Select installment 2" }));
  expect(screen.getByText("2 selected")).toBeTruthy();
  expect(screen.getAllByRole("checkbox").filter(input => (input as HTMLInputElement).checked)).toHaveLength(2);
});

test("spacebar checkbox toggle agrees with the selected count", async () => {
  const user = userEvent.setup();
  render(<DebtHistoryGroup account={account} rows={rows} onSaved={async () => undefined} />);
  await user.click(screen.getByRole("button", { name: "Show debt history for Phone" }));
  await user.click(screen.getByRole("button", { name: "Select" }));
  const checkbox = screen.getByRole("checkbox", { name: "Select installment 1" }) as HTMLInputElement;
  checkbox.focus();
  await user.keyboard(" ");
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(checkbox.checked).toBe(true);
});

test("purchase history mouse checkbox toggles agree with the selected count", async () => {
  const user = userEvent.setup();
  const purchaseRows = rows.map(row => ({ ...row, source: "purchase" as const, transactionId: `tx-${row.ordinal}` }));
  const group = groupTransactions(purchaseRows.map(row => ({
    id: row.transactionId, user_id: "owner", account_id: account.accountId, type: "expense" as const,
    amount: "10.00", description: `Phone (Installment ${row.ordinal}/3)`,
    date: row.dueDate!, created_at: "2026-01-01T00:00:00Z", installment_group_id: row.groupId,
    account: { name: "Credit wallet", type: "credit_card" },
  })))[0] as InstallmentHistoryEntry;
  render(<InstallmentHistoryGroup group={group} sortMode="date_added" debtState={{ account, rows: purchaseRows }}
    selectionResetKey="qa" onRequestDelete={vi.fn()} onSelectTransaction={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Show payment schedule for Phone" }));
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("checkbox", { name: "Select installment 1" }));
  await user.click(screen.getByRole("checkbox", { name: "Select installment 2" }));
  expect(screen.getByText("2 selected")).toBeTruthy();
  expect(screen.getAllByRole("checkbox").filter(input => (input as HTMLInputElement).checked)).toHaveLength(2);
});

test("background loading with a cached snapshot preserves expanded history and selection", async () => {
  const user = userEvent.setup();
  const props = { snapshot: { accounts: [account], rows }, error: null, onReviewLegacy: vi.fn() };
  const view = render(<DebtScheduleSection {...props} isLoading={false} />);
  await user.click(screen.getByRole("button", { name: "Show debt history for Phone" }));
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("3 selected")).toBeTruthy();
  view.rerender(<DebtScheduleSection {...props} isLoading />);
  view.rerender(<DebtScheduleSection {...props} isLoading={false} />);
  expect(screen.getByRole("button", { name: "Hide debt history for Phone" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("3 selected")).toBeTruthy();
});


test("clicking an installment row toggles selection without double toggling its checkbox", async () => {
  const user = userEvent.setup();
  render(<DebtHistoryGroup account={account} rows={rows} onSaved={async () => undefined} />);
  await user.click(screen.getByRole("button", { name: "Show debt history for Phone" }));
  await user.click(screen.getByRole("button", { name: "Select" }));
  await user.click(screen.getByText("Installment 1"));
  const checkbox = screen.getByRole("checkbox", { name: "Select installment 1" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  expect(screen.getByText("1 selected")).toBeTruthy();
  await user.click(checkbox);
  expect(checkbox.checked).toBe(false);
  expect(screen.getByText("0 selected")).toBeTruthy();
  await user.click(screen.getByText("Installment 2"));
  await user.keyboard("{Shift>}");
  await user.click(screen.getByText("Installment 3"));
  await user.keyboard("{/Shift}");
  expect(screen.getByText("2 selected")).toBeTruthy();
});
