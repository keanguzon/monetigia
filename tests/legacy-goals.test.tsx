import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({ apply: vi.fn(), refresh: vi.fn(), quote: vi.fn(), reset: vi.fn(), readError: null as any, history: [] as any[], accounts: [] as any[], goal: null as any, wallets: [] as any[] }));
vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ goals: [state.goal], userId: "10000000-0000-4000-8000-000000000001", financeSnapshot: { goals: [state.goal], wallets: state.wallets }, refresh: state.refresh, isLoading: false, isError: null }), getProjection: () => ({ count: 1, unit: "months", projectedDate: null }) }));
vi.mock("@/hooks/use-goal-finance", () => ({ useGoalWalletMetadata: () => ({ data: state.accounts, isLoading: false, error: null, refresh: state.refresh }) }));
vi.mock("@/lib/refresh-financial-data", () => ({ applyAndRefreshFinancialCommand: state.apply }));
vi.mock("@/hooks/use-transaction-submit", () => ({ useTransactionSubmit: () => ({ phase: "editing", reset: state.reset, quote: state.quote }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "10000000-0000-4000-8000-000000000001" } } }) }, from: (table: string) => {
  const q: any = { select: () => q, eq: () => q, order: () => q, then: (resolve: any) => Promise.resolve({ data: table === "transactions" ? state.history : table === "accounts" ? state.accounts : [], error: state.readError }).then(resolve) }; return q;
} }) }));
import { LegacyGoalReviewDialog } from "@/components/goals/LegacyGoalReviewDialog";
import { GoalCard } from "@/components/goals/GoalCard";
import { FinancialCommandError } from "@/lib/goals/client";
import AddTransactionModal from "@/components/transactions/AddTransactionModal";

const goalId = "20000000-0000-4000-8000-000000000002", accountId = "30000000-0000-4000-8000-000000000003";
beforeEach(() => {
  vi.clearAllMocks(); state.readError = null;
  state.goal = { id: goalId, name: "Laptop", review_state: "needs_review", status: "active", archived_at: null, category: "tech", target_amount: 5000, reserved: "0.00", spent: "0.00", walletReservations: [], progressPercent: 0, legacyTaggedAmount: "2000.00", financeAmounts: { target: "5000.00", progress: "0.00", allocationPerCycle: "0.00" } };
  state.accounts = [{ id: accountId, name: "GCash", type: "e_wallet", currency: "PHP", is_active: true }, { id: "card", name: "Card", type: "credit_card", currency: "PHP", is_active: true }];
  state.wallets = [{ accountId, actual: "3000.00", reserved: "0.00", available: "3000.00" }];
  state.history = [{ id: "40000000-0000-4000-8000-000000000004", account_id: accountId, type: "expense", amount: 2000, description: "Laptop purchase", date: "2026-10-01", transfer_to_account_id: null }, { id: "credit", account_id: "card", type: "expense", amount: 2000, description: "Installment purchase", date: "2026-10-01" }, { id: "transfer", account_id: accountId, type: "transfer", amount: 2000, description: "Cash transfer", transfer_to_account_id: accountId, date: "2026-10-01" }];
  state.apply.mockResolvedValue({ refreshError: null }); state.refresh.mockResolvedValue(undefined);
});
afterEach(cleanup);
const renderDialog = () => render(<LegacyGoalReviewDialog goalId={goalId} open onOpenChange={vi.fn()} />);

test('unreviewed goal opens review and cannot spend or reserve legacy tagged money', async () => {
  const review = vi.fn();
  render(<GoalCard goal={state.goal} onReview={review} onEdit={vi.fn()} onDelete={vi.fn()} onToggleComplete={vi.fn()} onContribute={vi.fn()} onReserve={vi.fn()} onRelease={vi.fn()} onMove={vi.fn()} onHistory={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Review existing funding" }));
  expect(review).toHaveBeenCalledWith(goalId);
  expect(screen.queryByRole("button", { name: "Set aside" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Spend from goal" })).toBeNull();
});

test('review explains fake savings correction and only imports explicitly selected cash spending', async () => {
  renderDialog();
  await screen.findByRole("checkbox", { name: /Laptop purchase/ });
  expect(screen.getByText(/normal transaction correction/i)).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /Installment purchase/ })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /Cash transfer/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Set aside in GCash (PHP)"), { target: { value: "3000.01" } });
  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
  expect(state.apply).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/available/);
  fireEvent.change(screen.getByLabelText("Set aside in GCash (PHP)"), { target: { value: "500.01" } });
  await userEvent.click(screen.getByRole("checkbox", { name: /Laptop purchase/ }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
  expect(state.apply.mock.calls[0][1]).toEqual({ kind: "adopt_legacy", goalId, status: "active", reservations: [{ accountId, amount: "500.01" }], spentTransactionIds: [state.history[0].id] });
});

test('completed review submits zero reservations and optional empty history', async () => {
  renderDialog(); await screen.findByRole("checkbox", { name: /Laptop purchase/ });
  fireEvent.change(screen.getByLabelText("Goal status"), { target: { value: "completed" } });
  expect(screen.queryByLabelText("Set aside in GCash (PHP)")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
  expect(state.apply.mock.calls[0][1]).toEqual({ kind: "adopt_legacy", goalId, status: "completed", reservations: [], spentTransactionIds: [] });
});

test('history errors block confirmation and unknown outcomes retry the same request with frozen selections', async () => {
  state.readError = { message: "Failed" };
  const view = renderDialog();
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm funding review" }).hasAttribute("disabled")).toBe(true));
  expect(state.apply).not.toHaveBeenCalled(); view.unmount(); state.readError = null;
  state.apply.mockRejectedValueOnce(new FinancialCommandError({ message: "Lost response", outcome: "unknown" }));
  renderDialog(); await screen.findByRole("checkbox", { name: /Laptop purchase/ });
  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
  await userEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
  expect(state.apply.mock.calls[1][0]).toBe(state.apply.mock.calls[0][0]);
  expect(state.apply.mock.calls[1][1]).toEqual(state.apply.mock.calls[0][1]);
});

test('transaction dialog blocks an unreviewed default goal before requesting a quote', async () => {
  render(<AddTransactionModal isOpen defaultGoalId={goalId} onClose={vi.fn()} />);
  await screen.findByRole("option", { name: "GCash" });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: accountId } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
  await userEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  expect(state.quote).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/Review existing funding/);
});

test('an unknown review reopened for another goal identifies and retries the original review', async () => {
  state.apply.mockRejectedValueOnce(new FinancialCommandError({ message: "Lost response", outcome: "unknown" }));
  const view = renderDialog(); await screen.findByRole("checkbox", { name: /Laptop purchase/ });
  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
  await screen.findByRole("button", { name: "Retry same request" });
  state.goal = { ...state.goal, id: "trip", name: "Trip" };
  view.rerender(<LegacyGoalReviewDialog goalId="trip" open onOpenChange={vi.fn()} />);
  expect(screen.getByText(/Laptop.*pending review/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retry same request" }));
  expect(state.apply.mock.calls[1][0]).toBe(state.apply.mock.calls[0][0]);
  expect(state.apply.mock.calls[1][1].goalId).toBe(goalId);
});

test('keyboard Escape closes the review and restores focus to its opening button', async () => {
  function Wrapper() { const [open, setOpen] = React.useState(false); return <><button onClick={() => setOpen(true)}>Review Laptop</button><LegacyGoalReviewDialog goalId={goalId} open={open} onOpenChange={setOpen} /></>; }
  render(<Wrapper />); const opener = screen.getByRole("button", { name: "Review Laptop" });
  await userEvent.click(opener); await screen.findByRole("checkbox", { name: /Laptop purchase/ });
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
});
