import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useTransactionSubmit, useTransactionDelete } from "@/hooks/use-transaction-submit";
import AddTransactionModal from "@/components/transactions/AddTransactionModal";
import TransactionDetailModal from "@/components/transactions/TransactionDetailModal";
import { FinancialCommandError, applyFinancialCommand, quoteTransaction } from "@/lib/goals/client";
import type { TransactionDraft, TransactionQuote } from "@/lib/goals/contracts";

const fixture = vi.hoisted(() => ({ userId: "user", authUserId: undefined as string | null | undefined, refresh: vi.fn(), history: [] as any[], accounts: [
  { id: "cash", name: "GoTyme", type: "bank", currency: "PHP", is_active: true, balance: 30000 },
  { id: "bank", name: "Cash", type: "cash", currency: "PHP", is_active: true, balance: 20000 },
  { id: "credit", name: "userPayLater", type: "credit_card", currency: "PHP", is_active: true, balance: 0 },
], goals: [
  { id: "laptop", name: "Laptop", status: "active", review_state: "confirmed", archived_at: null, category: "Savings", walletReservations: [{ accountId: "cash", amount: "5000.00" }] },
  { id: "phone", name: "Phone", status: "active", review_state: "confirmed", archived_at: null, category: "Savings", walletReservations: [{ accountId: "cash", amount: "5000.00" }] },
] }));
vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ userId: fixture.userId, goals: fixture.goals, financeSnapshot: { goals: fixture.goals }, refresh: fixture.refresh, isLoading: false, isError: null }) }));
vi.mock("@/hooks/use-goal-finance", () => ({ useGoalHistory: (_userId: string, goalId: string) => ({ data: fixture.history.filter(event => event.goal_id === goalId), isLoading: false, error: null }) }));
vi.mock("@/lib/goals/client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/goals/client")>(), applyFinancialCommand: vi.fn(), quoteTransaction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: fixture.authUserId === null ? null : { id: fixture.authUserId ?? fixture.userId } } }) }, from(table: string) { const builder: any = { select: () => builder, eq: () => builder, order: () => builder, or: () => builder, limit: () => builder, then: (resolve: any) => Promise.resolve({ data: table === "accounts" ? fixture.accounts : [], error: null }).then(resolve) }; return builder; } }) }));

const draft: TransactionDraft = { type: "expense", accountId: "cash", transferToAccountId: null, categoryId: null, goalId: null, amount: "28000.00", description: null, date: "2026-10-07", installments: null, reservationMoves: [] };
const proposal: TransactionQuote = { fingerprint: "first", actual: "30000.00", reserved: "5000.00", available: "25000.00", releases: [{ goalId: "laptop", accountId: "cash", amount: "3000.00" }] };
let sequence = 0;
beforeEach(() => { fixture.authUserId = undefined; fixture.history = []; fixture.userId = `user-${++sequence}`; vi.mocked(quoteTransaction).mockReset().mockResolvedValue(proposal); vi.mocked(applyFinancialCommand).mockReset().mockResolvedValue({ operationId: "op", transactionIds: ["tx"], replayed: false }); fixture.refresh.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

async function quoteHook() { const hook = renderHook(() => useTransactionSubmit()); await act(() => hook.result.current.quote(draft)); return hook; }

test("a release quote waits for explicit confirmation and applies only once", async () => {
  const hook = await quoteHook();
  expect(hook.result.current.phase).toBe("review");
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  await act(() => Promise.all([hook.result.current.confirm(), hook.result.current.confirm()]));
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
  expect(applyFinancialCommand).toHaveBeenCalledWith(expect.any(String), { kind: "transaction", draft }, proposal);
  expect(hook.result.current.phase).toBe("saved");
});

test("declining a proposal writes nothing and editing invalidates it", async () => {
  const hook = await quoteHook();
  act(() => hook.result.current.reset());
  await act(() => hook.result.current.confirm());
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  expect(hook.result.current.phase).toBe("editing");
});

test("a late quote cannot restore confirmation after editing", async () => {
  let resolve!: (value: TransactionQuote) => void;
  vi.mocked(quoteTransaction).mockReturnValue(new Promise(r => { resolve = r; }));
  const hook = renderHook(() => useTransactionSubmit());
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.quote(draft); });
  act(() => hook.result.current.reset());
  await act(async () => { resolve(proposal); await pending; });
  expect(hook.result.current.phase).toBe("editing");
  await act(() => hook.result.current.confirm());
  expect(applyFinancialCommand).not.toHaveBeenCalled();
});

test("stale quotes refresh into review and need fresh confirmation", async () => {
  const fresh = { ...proposal, fingerprint: "fresh", releases: [{ ...proposal.releases[0], amount: "4000.00" }] };
  const hook = await quoteHook();
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "STALE_QUOTE", code: "STALE_QUOTE", outcome: "rejected" }));
  vi.mocked(quoteTransaction).mockResolvedValue(fresh);
  await act(() => hook.result.current.confirm());
  expect(hook.result.current.phase).toBe("review");
  expect(hook.result.current.transactionQuote).toEqual(fresh);
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
  await act(() => hook.result.current.confirm());
  expect(applyFinancialCommand).toHaveBeenCalledTimes(2);
  expect(vi.mocked(applyFinancialCommand).mock.calls[1][2]).toEqual(fresh);
});

test("unknown outcomes survive reset and unmount, retrying the same UUID, command and quote", async () => {
  const hook = await quoteHook();
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
  await act(() => hook.result.current.confirm());
  const first = vi.mocked(applyFinancialCommand).mock.calls[0];
  act(() => hook.result.current.reset());
  hook.unmount();
  const reopened = renderHook(() => useTransactionSubmit());
  await act(() => reopened.result.current.quote({ ...draft, amount: "100.00" }));
  expect(quoteTransaction).toHaveBeenCalledTimes(1);
  await act(() => reopened.result.current.confirm());
  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(first);
  expect(reopened.result.current.phase).toBe("saved");
});

test("zero releases save directly; refresh failures remain saved and cannot resubmit", async () => {
  vi.mocked(quoteTransaction).mockResolvedValue({ ...proposal, releases: [] });
  fixture.refresh.mockRejectedValue(new Error("refresh offline"));
  const hook = await quoteHook();
  expect(hook.result.current.phase).toBe("saved");
  expect(hook.result.current.refreshError).toBeTruthy();
  await act(() => hook.result.current.confirm());
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
});

test("server rejection uses its human hint and permits correction with a fresh request", async () => {
  const hook = await quoteHook();
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "INVALID_STATE", code: "INVALID_STATE", hint: "Choose an active wallet.", outcome: "rejected" }));
  await act(() => hook.result.current.confirm());
  expect(hook.result.current.error).toBe("Choose an active wallet.");
  act(() => hook.result.current.reset());
  await act(() => hook.result.current.quote(draft));
  await act(() => hook.result.current.confirm());
  const calls = vi.mocked(applyFinancialCommand).mock.calls;
  expect(calls[1][0]).not.toBe(calls[0][0]);
});

test("custom release breakdown is quoted exactly before confirmation", async () => {
  const hook = await quoteHook();
  const releases = [{ goalId: "phone", accountId: "cash", amount: "2000.00" }, { goalId: "laptop", accountId: "cash", amount: "1000.00" }];
  vi.mocked(quoteTransaction).mockResolvedValue({ ...proposal, releases });
  await act(() => hook.result.current.quote(draft, releases));
  expect(quoteTransaction).toHaveBeenLastCalledWith(draft, releases);
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  await act(() => hook.result.current.confirm());
  expect(vi.mocked(applyFinancialCommand).mock.calls[0][2]?.releases).toEqual(releases);
});

test("ordinary expense shows Laptop release, declining writes nothing, then confirmation writes once", async () => {
  render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await screen.findByRole("button", { name: "Release funds and save" });
  expect(screen.getByText(/Laptop.*3,000/)).toBeTruthy();
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep reservations" }));
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await screen.findByRole("button", { name: "Release funds and save" });
  fireEvent.click(screen.getByRole("button", { name: "Release funds and save" }));
  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(1));
});

test.each(["Amount", "Account"])("editing %s removes the prior release confirmation", async label => {
  render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await screen.findByRole("button", { name: "Release funds and save" });
  fireEvent.click(screen.getByRole("button", { name: "Keep reservations" }));
  fireEvent.change(screen.getByLabelText(label), { target: { value: label === "Amount" ? "20000" : "bank" } });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Release funds and save" })).toBeNull());
  expect(applyFinancialCommand).not.toHaveBeenCalled();
});

test("deletion uses a financial command, refreshes local and shared data, and retains UUID through unknown retry", async () => {
  const localRefresh = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useTransactionDelete(localRefresh));
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
  await act(() => hook.result.current.remove("tx"));
  const first = vi.mocked(applyFinancialCommand).mock.calls[0];
  expect(first[1]).toEqual({ kind: "delete_transaction", transactionId: "tx" });
  hook.unmount();
  const reopened = renderHook(() => useTransactionDelete(localRefresh));
  await act(() => reopened.result.current.remove("other-tx"));
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
  await act(() => reopened.result.current.remove("tx"));
  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(first);
  expect(localRefresh).toHaveBeenCalledTimes(1);
  expect(fixture.refresh).toHaveBeenCalledTimes(1);
  expect(reopened.result.current.savedTransactionId).toBe("tx");
});

test("a committed deletion with failed local refresh stays saved, while shared refresh still runs", async () => {
  const localRefresh = vi.fn().mockRejectedValue(new Error("list unavailable"));
  const hook = renderHook(() => useTransactionDelete(localRefresh));
  await act(() => Promise.all([hook.result.current.remove("tx"), hook.result.current.remove("tx")]));
  expect(hook.result.current.savedTransactionId).toBe("tx");
  expect(hook.result.current.refreshError).toBeTruthy();
  expect(fixture.refresh).toHaveBeenCalledTimes(1);
  await act(() => hook.result.current.remove("tx"));
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
});

test("switching transaction type invalidates a release review", async () => {
  render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await screen.findByRole("button", { name: "Release funds and save" });
  fireEvent.click(screen.getByRole("button", { name: "Keep reservations" }));
  fireEvent.click(screen.getByRole("button", { name: "Income" }));
  expect(screen.queryByRole("button", { name: "Release funds and save" })).toBeNull();
  expect(applyFinancialCommand).not.toHaveBeenCalled();
});

test("detail distinguishes actual goal spend, carried reservations and unrelated automatic releases", () => {
  fixture.history = [
    { id: "spend", goal_id: "laptop", kind: "spend", transaction_id: "tx", reserved_delta: "-1000.00", spent_delta: "1000.00", accountName: "GoTyme" },
    { id: "carry", goal_id: "phone", kind: "move_out", transaction_id: "tx", reserved_delta: "-500.00", spent_delta: "0.00", accountName: "GoTyme" },
    { id: "release", goal_id: "phone", kind: "release", transaction_id: null, linkedTransactionIds: ["tx"], reserved_delta: "-3000.00", spent_delta: "0.00", operationKind: "transaction", accountName: "GoTyme" },
    { id: "unrelated", goal_id: "phone", kind: "spend", transaction_id: "other", reserved_delta: "-999.00", spent_delta: "999.00", accountName: "GoTyme" },
  ];
  render(<TransactionDetailModal isOpen onClose={() => {}} transaction={{ id: "tx", type: "expense", amount: 1000, date: "2026-10-07", created_at: "2026-10-07", account: { name: "GoTyme" } }} />);
  expect(screen.getByText(/Spent from Laptop.*1,000/)).toBeTruthy();
  expect(screen.getByText(/Carried Phone reservation.*500/)).toBeTruthy();
  expect(screen.getByText(/Automatic release from Phone.*3,000/)).toBeTruthy();
  expect(screen.queryByText(/999/)).toBeNull();
});

test("ordinary defaultAccountId opens expense in that wallet; goal shortcut invents neither wallet nor amount", async () => {
  const view = render(<AddTransactionModal isOpen onClose={() => {}} defaultAccountId="bank" />);
  await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe("bank"));
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
  view.rerender(<AddTransactionModal isOpen={false} onClose={() => {}} />);
  view.rerender(<AddTransactionModal isOpen onClose={() => {}} defaultGoalId="laptop" />);
  await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe(""));
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("option", { name: "userPayLater" })).toBeNull();
});

test.each(["unmount", "auth switch"])("zero-release quote cannot save after %s", async action => {
  let resolve!: (value: TransactionQuote) => void;
  vi.mocked(quoteTransaction).mockReturnValue(new Promise(r => { resolve = r; }));
  const hook = renderHook(() => useTransactionSubmit());
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.quote(draft); });
  if (action === "unmount") hook.unmount();
  else { fixture.userId = "different-user"; hook.rerender(); }
  await act(async () => { resolve({ ...proposal, releases: [] }); await pending; });
  expect(applyFinancialCommand).not.toHaveBeenCalled();
});

test("closing while a quote loads prevents a late release review or write on reopening", async () => {
  let resolve!: (value: TransactionQuote) => void;
  vi.mocked(quoteTransaction).mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  view.rerender(<AddTransactionModal isOpen={false} onClose={() => {}} />);
  await act(async () => { resolve({ ...proposal, releases: [] }); });
  view.rerender(<AddTransactionModal isOpen onClose={() => {}} />);
  expect(screen.queryByRole("button", { name: "Release funds and save" })).toBeNull();
  expect(applyFinancialCommand).not.toHaveBeenCalled();
});

test("custom release inputs quote the chosen goals before allowing confirmation", async () => {
  render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await screen.findByRole("button", { name: "Release funds and save" });
  fireEvent.click(screen.getByRole("button", { name: "Choose release amounts" }));
  fireEvent.change(screen.getByLabelText("Release from Laptop"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Release from Phone"), { target: { value: "2000" } });
  expect((screen.getByRole("button", { name: "Release funds and save" }) as HTMLButtonElement).disabled).toBe(true);
  const releases = [{ goalId: "laptop", accountId: "cash", amount: "1000.00" }, { goalId: "phone", accountId: "cash", amount: "2000.00" }];
  let resolve!: (quote: TransactionQuote) => void;
  vi.mocked(quoteTransaction).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  fireEvent.click(screen.getByRole("button", { name: "Review these releases" }));
  await waitFor(() => expect(quoteTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ amount: "28000.00" }), releases));
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Release funds and save" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Release from Laptop") as HTMLInputElement).disabled).toBe(true);
  await act(async () => resolve({ ...proposal, fingerprint: "custom", releases }));
  fireEvent.click(screen.getByRole("button", { name: "Release funds and save" }));
  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(1));
  expect(vi.mocked(applyFinancialCommand).mock.calls[0][2]?.releases).toEqual(releases);
});

test("an unknown dialog save survives closure and reopening before another transaction can be entered", async () => {
  const view = render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await screen.findByRole("button", { name: "Release funds and save" });
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
  fireEvent.click(screen.getByRole("button", { name: "Release funds and save" }));
  const retry = await screen.findByRole("button", { name: "Retry same transaction" });
  await waitFor(() => expect(document.activeElement).toBe(retry));
  expect(screen.queryByRole("dialog", { name: "Review goal releases" })).toBeNull();
  const alert = screen.getByRole("alert");
  expect(alert.parentElement?.contains(retry)).toBe(false);
  const scrollBody = screen.getByLabelText("Amount").closest("fieldset")?.parentElement;
  expect(scrollBody?.contains(alert)).toBe(false);
  expect(scrollBody?.contains(retry)).toBe(false);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  const original = vi.mocked(applyFinancialCommand).mock.calls[0];
  view.unmount();
  render(<AddTransactionModal isOpen onClose={() => {}} defaultAccountId="bank" />);
  expect((screen.getByLabelText("Amount") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry same transaction" }));
  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(2));
  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(original);
});

test("a saved dialog reports refresh failure without enabling another save", async () => {
  fixture.refresh.mockRejectedValue(new Error("offline"));
  vi.mocked(quoteTransaction).mockResolvedValue({ ...proposal, releases: [] });
  render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await screen.findByRole("status");
  const scrollBody = screen.getByLabelText("Amount").closest("fieldset")?.parentElement;
  expect(scrollBody?.contains(screen.getByRole("status"))).toBe(false);
  expect(screen.getByRole("status").textContent).toMatch(/saved.*could not refresh/i);
  fireEvent.click(screen.getByRole("button", { name: "Saved" }));
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
});

test("a rejected save stays visible above the scroll body and cancel clears it without retrying", async () => {
  vi.mocked(quoteTransaction).mockResolvedValue({ ...proposal, releases: [] });
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "INSUFFICIENT_ACTUAL", code: "INSUFFICIENT_ACTUAL", outcome: "rejected" }));
  const onClose = vi.fn();
  const view = render(<AddTransactionModal isOpen onClose={onClose} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

  const alert = await screen.findByRole("alert");
  const scrollBody = screen.getByLabelText("Amount").closest("fieldset")?.parentElement;
  expect(alert.textContent).toMatch(/does not have enough money/i);
  expect(scrollBody?.contains(alert)).toBe(false);
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);

  view.rerender(<AddTransactionModal isOpen={false} onClose={onClose} />);
  view.rerender(<AddTransactionModal isOpen onClose={onClose} />);
  await screen.findByRole("option", { name: "GoTyme" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
});

test("actual insufficiency is an inline human error and never writes", async () => {
  vi.mocked(quoteTransaction).mockRejectedValue(new FinancialCommandError({ message: "INSUFFICIENT_ACTUAL", code: "INSUFFICIENT_ACTUAL", outcome: "rejected" }));
  render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30001" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  const alert = await screen.findByRole("alert");
  const scrollBody = screen.getByLabelText("Amount").closest("fieldset")?.parentElement;
  expect(alert.textContent).toMatch(/does not have enough money/);
  expect(scrollBody?.contains(alert)).toBe(false);
  expect(screen.queryByText("INSUFFICIENT_ACTUAL")).toBeNull();
  expect(applyFinancialCommand).not.toHaveBeenCalled();
});

test("a live session change blocks retry without discarding the unresolved request", async () => {
  const hook = await quoteHook();
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
  await act(() => hook.result.current.confirm());
  const original = vi.mocked(applyFinancialCommand).mock.calls[0];
  fixture.authUserId = "another-account";
  await act(() => hook.result.current.confirm());
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
  expect(hook.result.current.unresolved).toBe(true);
  fixture.authUserId = undefined;
  await act(() => hook.result.current.confirm());
  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(original);
});

test("deletion session mismatch preserves its unknown request for the original owner", async () => {
  const hook = renderHook(() => useTransactionDelete(async () => {}));
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
  await act(() => hook.result.current.remove("tx"));
  const original = vi.mocked(applyFinancialCommand).mock.calls[0];
  fixture.authUserId = null;
  await act(() => hook.result.current.remove("tx"));
  expect(hook.result.current.pendingTransactionId).toBe("tx");
  fixture.authUserId = undefined;
  await act(() => hook.result.current.remove("tx"));
  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(original);
});

test("only active PHP accounts appear in the transaction wallet choices", async () => {
  const count = fixture.accounts.length;
  fixture.accounts.push({ id: "inactive", name: "Closed", type: "bank", currency: "PHP", is_active: false, balance: 1000 }, { id: "usd", name: "USD wallet", type: "bank", currency: "USD", is_active: true, balance: 1000 }, { id: "unknown", name: "Unknown status", type: "bank", currency: "PHP", is_active: null, balance: 1000 } as any);
  try {
    render(<AddTransactionModal isOpen onClose={() => {}} />);
    await screen.findByRole("option", { name: "GoTyme" });
    expect(screen.queryByRole("option", { name: "Closed" })).toBeNull();
    expect(screen.queryByRole("option", { name: "USD wallet" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Unknown status" })).toBeNull();
  } finally { fixture.accounts.splice(count); }
});

async function openReleaseReview(onClose = vi.fn()) {
  render(<AddTransactionModal isOpen onClose={onClose} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  return screen.findByRole("dialog", { name: "Review goal releases" });
}

test("release popup owns focus, hides the preserved form, and Escape declines only review", async () => {
  const user = userEvent.setup(); const onClose = vi.fn();
  const popup = await openReleaseReview(onClose);
  const keep = within(popup).getByRole("button", { name: "Keep reservations" });
  await waitFor(() => expect(document.activeElement).toBe(keep));
  expect(within(popup).getByText(/Laptop.*3,000/)).toBeTruthy();
  expect(within(popup).getByText(/Actual.*30,000.*Reserved.*5,000.*Available.*25,000/)).toBeTruthy();
  const parent = screen.getByText("Add Transaction", { selector: 'h2' }).closest('[role="dialog"]')!;
  expect(parent.hasAttribute("inert")).toBe(true);
  expect(parent.hasAttribute("data-mobile-nav-blocking")).toBe(true);
  expect(popup.hasAttribute("data-mobile-nav-blocking")).toBe(true);
  expect(parent.getAttribute("aria-hidden")).toBe("true");
  expect(screen.queryByRole("button", { name: "Add Transaction" })).toBeNull();
  await user.tab(); expect(document.activeElement).toBe(within(popup).getByRole("button", { name: "Release funds and save" }));
  await user.tab(); expect(document.activeElement).toBe(within(popup).getByRole("button", { name: "Choose release amounts" }));
  await user.tab({ shift: true }); expect(popup.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review goal releases" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Add Transaction" })).toBeTruthy();
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("28000");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add Transaction" })));
  expect(onClose).not.toHaveBeenCalled(); expect(applyFinancialCommand).not.toHaveBeenCalled();
});

test("outside dismissal keeps reservations without closing the transaction form", async () => {
  const user = userEvent.setup(); const popup = await openReleaseReview();
  await user.pointer({ target: popup.previousElementSibling!, keys: "[MouseLeft]" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review goal releases" })).toBeNull());
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("28000");
});

test("pending confirmation blocks dismissal and double submit, closing after refresh once", async () => {
  const user = userEvent.setup(); let resolve!: (result: any) => void;
  vi.mocked(applyFinancialCommand).mockReturnValue(new Promise(r => { resolve = r; }));
  let refresh!: () => void; fixture.refresh.mockReturnValue(new Promise<void>(r => { refresh = r; }));
  const onClose = vi.fn(); const popup = await openReleaseReview(onClose);
  await user.dblClick(within(popup).getByRole("button", { name: "Release funds and save" }));
  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(1));
  expect((within(popup).getByRole("button", { name: "Keep reservations" }) as HTMLButtonElement).disabled).toBe(true);
  await user.keyboard("{Escape}");
  await user.pointer({ target: popup.previousElementSibling!, keys: "[MouseLeft]" });
  expect(screen.getByRole("dialog", { name: "Review goal releases" })).toBe(popup);
  await act(async () => resolve({ operationId: "op", transactionIds: ["tx"], replayed: false }));
  expect(onClose).not.toHaveBeenCalled(); await act(async () => refresh());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

test.each([false, true])("stale review waits for renewed confirmation, zero releases: %s", async zero => {
  const popup = await openReleaseReview(); let resolve!: (quote: TransactionQuote) => void;
  vi.mocked(quoteTransaction).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "STALE_QUOTE", code: "STALE_QUOTE", outcome: "rejected" }));
  fireEvent.click(within(popup).getByRole("button", { name: "Release funds and save" }));
  await waitFor(() => expect(quoteTransaction).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("dialog", { name: "Review goal releases" })).toBe(popup);
  expect((within(popup).getByRole("button", { name: "Release funds and save" }) as HTMLButtonElement).disabled).toBe(true);
  const fresh = { ...proposal, fingerprint: "fresh", releases: zero ? [] : [{ ...proposal.releases[0], amount: "4000.00" }] };
  await act(async () => resolve(fresh));
  expect(within(popup).getByRole("alert").textContent).toMatch(/confirm again/);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  if (!zero) expect(within(popup).getByText(/Laptop.*4,000/)).toBeTruthy();
  else expect(within(popup).queryByRole("button", { name: "Choose release amounts" })).toBeNull();
  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
  fireEvent.click(within(popup).getByRole("button", { name: "Release funds and save" }));
  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(2));
  expect(vi.mocked(applyFinancialCommand).mock.calls[1][2]).toEqual(fresh);
});

test("custom quote failure restores the form with a human error and no write", async () => {
  const popup = await openReleaseReview();
  fireEvent.click(within(popup).getByRole("button", { name: "Choose release amounts" }));
  vi.mocked(quoteTransaction).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(within(popup).getByRole("button", { name: "Review these releases" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review goal releases" })).toBeNull());
  expect(screen.getByRole("alert").textContent).toMatch(/Could not check/);
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("28000");
  expect(applyFinancialCommand).not.toHaveBeenCalled();
});


test("declining review preserves all entered fields and parent scroll across Radix modal variants", async () => {
  render(<AddTransactionModal isOpen onClose={() => {}} />);
  await screen.findByRole("option", { name: "GoTyme" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
  fireEvent.change(screen.getByLabelText("Description (Optional)"), { target: { value: "School purchase" } });
  const scrollBody = screen.getByLabelText("Amount").closest("fieldset")!.parentElement!;
  scrollBody.scrollTop = 230;
  fireEvent.scroll(scrollBody);
  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await screen.findByRole("dialog", { name: "Review goal releases" });
  fireEvent.click(screen.getByRole("button", { name: "Keep reservations" }));
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Add Transaction" })).toBeTruthy());
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("28000");
  expect((screen.getByLabelText("Description (Optional)") as HTMLInputElement).value).toBe("School purchase");
  expect(screen.getByLabelText("Amount").closest("fieldset")!.parentElement!.scrollTop).toBe(230);
  expect(applyFinancialCommand).not.toHaveBeenCalled();
});

test("release save rejection restores one focused parent error without discarding the draft", async () => {
  const popup = await openReleaseReview();
  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "INVALID_STATE", code: "INVALID_STATE", hint: "Choose an active wallet.", outcome: "rejected" }));
  fireEvent.click(within(popup).getByRole("button", { name: "Release funds and save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review goal releases" })).toBeNull());
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Choose an active wallet.");
  await waitFor(() => expect(document.activeElement).toBe(alert));
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("28000");
});

test("reviewing unchanged custom amounts restores confirmation after an identical server quote", async () => {
  const popup = await openReleaseReview();
  fireEvent.click(within(popup).getByRole("button", { name: "Choose release amounts" }));
  let resolve!: (quote: TransactionQuote) => void;
  vi.mocked(quoteTransaction).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  fireEvent.click(within(popup).getByRole("button", { name: "Review these releases" }));
  await waitFor(() => expect(quoteTransaction).toHaveBeenCalledTimes(2));
  expect((within(popup).getByRole("button", { name: "Release funds and save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  await act(async () => resolve(proposal));
  await waitFor(() => expect((within(popup).getByRole("button", { name: "Release funds and save" }) as HTMLButtonElement).disabled).toBe(false));
  expect(within(popup).queryByRole("button", { name: "Review these releases" })).toBeNull();
  expect(applyFinancialCommand).not.toHaveBeenCalled();
  fireEvent.click(within(popup).getByRole("button", { name: "Release funds and save" }));
  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(1));
  expect(vi.mocked(applyFinancialCommand).mock.calls[0][2]).toEqual(proposal);
});
