import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
const pageState = vi.hoisted(() => ({ accounts: [] as any[], snapshot: { accounts: [], rows: [] } as any }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-data", () => ({ useAccounts: () => ({ data: pageState.accounts, isLoading: false, isValidating: false, error: null, mutate: async () => {} }) }));
vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ userId: "10000000-0000-4000-8000-000000000001", financeSnapshot: { goals: [], wallets: [] }, isLoading: false, isError: null, refresh: async () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "10000000-0000-4000-8000-000000000001" } }, error: null }), getSession: async () => ({ data: { session: { user: { id: "10000000-0000-4000-8000-000000000001" }, access_token: "token" } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, rpc: () => { const response = Promise.resolve({ data: pageState.snapshot, error: null }); return { setHeader: () => response, then: response.then.bind(response) }; } }) }));
import AccountsPage from "@/app/(dashboard)/accounts/page";
import { DebtScheduleSection } from "@/components/accounts/DebtScheduleSection";
import { DebtHistoryGroup } from "@/components/accounts/DebtHistoryGroup";
import { debtCorrectionRecovery } from "@/components/accounts/DebtHistoryGroup";
import type { DebtSnapshot } from "@/lib/debt/contracts";
afterEach(cleanup);
const snapshot: DebtSnapshot = { accounts: [{ accountId: "actual-wallet", totalOutstanding: "6600.00", undatedOutstanding: "5000.00", reconciliation: "balanced", reconciliationDelta: "0.00", fingerprint: "f" }], rows: [{ id: "r", accountId: "actual-wallet", groupId: "g", source: "opening", transactionId: null, dueDate: "2026-10-08", originalAmount: "2000.00", paidAmount: "400.00", correctedAmount: "0.00", remainingAmount: "1600.00", ordinal: 1, name: "Remaining laptop" }] };
test("snapshot schedule displays remaining opening debt and reviews real wallet", () => {
  const pay = vi.fn(); const review = vi.fn();
  render(<DebtScheduleSection snapshot={snapshot} isLoading={false} error={null} onPayDebt={pay} onReviewLegacy={review} />);
  expect(screen.getAllByText("Remaining laptop").length).toBe(2);
  expect(screen.getByText(/Existing debt/)).toBeTruthy();
  expect(screen.getAllByText(/1600.00/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /Pay debt/ })); expect(pay).toHaveBeenCalledWith("actual-wallet");
  fireEvent.click(screen.getByRole("button", { name: /Review due dates/ })); expect(review).toHaveBeenCalledWith("actual-wallet");
});
test("loading and errors hide stale payable figures", () => {
  const { rerender } = render(<DebtScheduleSection snapshot={snapshot} isLoading error={null} onReviewLegacy={() => {}} />);
  expect(screen.queryByText("Remaining laptop")).toBeNull();
  rerender(<DebtScheduleSection snapshot={snapshot} isLoading={false} error={new Error()} onReviewLegacy={() => {}} />);
  expect(screen.getByRole("alert")).toBeTruthy(); expect(screen.queryByRole("button", { name: /Pay debt/ })).toBeNull();
});
test("review state disables scheduled payment and adoption; zero rows do not count", () => {
  render(<DebtScheduleSection snapshot={{ ...snapshot, accounts: [{ ...snapshot.accounts[0], reconciliation: "needs_review" }], rows: [{ ...snapshot.rows[0], remainingAmount: "0.00" }] }} isLoading={false} error={null} onPayDebt={() => {}} onReviewLegacy={() => {}} />);
  expect(screen.getAllByText(/reconciliation review/i).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Pay debt/ })).toBeNull();
  expect((screen.getByRole("button", { name: /Review due dates/ }) as HTMLButtonElement).disabled).toBe(true);
});
test("unknown due dates remain unknown and settled audit rows stay in snapshot", () => {
  const zero = { ...snapshot.rows[0], id: "settled", name: "Settled audit", remainingAmount: "0.00" };
  const unknown = { ...snapshot.rows[0], id: "unknown", source: "purchase" as const, transactionId: "transaction", dueDate: null, name: "Actual purchase" };
  const input = { ...snapshot, rows: [zero, unknown] };
  render(<DebtScheduleSection snapshot={input} isLoading={false} error={null} onReviewLegacy={() => {}} />);
  expect(screen.getAllByText(/Actual purchase.*Due date unknown/).length).toBeGreaterThan(0);
  expect(screen.getAllByText("Settled audit").length).toBeGreaterThan(0);
  expect(screen.queryByText("2026-10")).toBeNull();
  expect(input.rows).toHaveLength(2);
  expect(input.rows[0].remainingAmount).toBe("0.00");
});

test("complete debt ledger keeps paid values and snapshot ordinal visible", async () => {
  const paid = { ...snapshot.rows[0], id: "paid-row", name: "Paid laptop", paidAmount: "1500.00", remainingAmount: "0.00" };
  render(<DebtScheduleSection snapshot={{ ...snapshot, rows: [paid] }} isLoading={false} error={null} onReviewLegacy={() => {}} />);
  const header = screen.getByRole("button", { name: /show debt history for paid laptop/i });
  fireEvent.click(header);
  expect(screen.getByText("Installment 1")).toBeTruthy();
  expect(screen.getAllByText("Remaining PHP 0.00").length).toBe(2);
  expect(screen.getByText("Paid PHP 1500.00 · Corrected PHP 0.00")).toBeTruthy();
});
test("Escape exits debt-ledger selection when its list has focus", () => {
  render(<DebtHistoryGroup account={snapshot.accounts[0]} rows={snapshot.rows} onSaved={async () => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: /show debt history for remaining laptop/i }));
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  const list = screen.getByRole("list", { name: "Installments for Remaining laptop" });
  list.focus();
  fireEvent.keyDown(list, { key: "a", ctrlKey: true });
  expect((screen.getByRole("checkbox", { name: "Select installment 1" }) as HTMLInputElement).checked).toBe(true);

  fireEvent.keyDown(list, { key: "Escape" });
  expect(screen.queryByRole("checkbox", { name: "Select installment 1" })).toBeNull();
  expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
});
test("inactive residual action is disabled with a visible eligibility reason", () => {
  render(<DebtScheduleSection snapshot={snapshot} isLoading={false} error={null} onReviewLegacy={() => {}} canReviewLegacy={() => false} />);
  expect((screen.getByRole("button", { name: "Review due dates" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/requires an active PHP wallet/)).toBeTruthy();
});
test("PHP page summary excludes USD with an explicit separate review notice", async () => {
  const phpId = "20000000-0000-4000-8000-000000000001"; const usdId = "20000000-0000-4000-8000-000000000002";
  pageState.accounts = [{ id: phpId, name: "PHP Card", type: "credit_card", currency: "PHP", is_active: false, balance: 6600 }, { id: usdId, name: "USD Card", type: "credit_card", currency: "USD", is_active: true, balance: 900 }];
  pageState.snapshot = { accounts: pageState.accounts.map(account => ({ accountId: account.id, totalOutstanding: account.id === phpId ? "6600.00" : "900.00", undatedOutstanding: account.id === phpId ? "5000.00" : "900.00", reconciliation: "balanced", reconciliationDelta: "0.00", fingerprint: "a".repeat(64) })), rows: [] };
  render(<SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false }}><AccountsPage /></SWRConfig>);
  await waitFor(() => expect(screen.getByLabelText("Outstanding debt").getAttribute("data-money")).toBe("6600.00"));
  expect(screen.getByText(/USD Card.*USD.*excluded/i)).toBeTruthy();
});
test("missing currency metadata makes PHP total unavailable", async () => {
  pageState.accounts = [];
  pageState.snapshot = { accounts: [{ accountId: "20000000-0000-4000-8000-000000000003", totalOutstanding: "6600.00", undatedOutstanding: "5000.00", reconciliation: "balanced", reconciliationDelta: "0.00", fingerprint: "a".repeat(64) }], rows: [] };
  render(<SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false }}><AccountsPage /></SWRConfig>);
  await waitFor(() => expect(screen.getByLabelText("Outstanding debt").textContent).toBe("Unavailable"));
  expect(screen.getByText(/currency metadata.*unavailable/i)).toBeTruthy();
});
test("accounts recovery banner observes the shared saved-correction identity", async () => {
  const ownerId = "10000000-0000-4000-8000-000000000001";
  pageState.accounts = [];
  pageState.snapshot = { accounts: [], rows: [] };
  debtCorrectionRecovery.refreshOwners.add(ownerId);

  render(<SWRConfig value={{ provider: () => new Map(), revalidateOnFocus: false }}><AccountsPage /></SWRConfig>);
  expect(await screen.findByRole("button", { name: "Refresh views" })).toBeTruthy();
  debtCorrectionRecovery.refreshOwners.delete(ownerId);
});
