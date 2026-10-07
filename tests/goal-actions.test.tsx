import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

declare module "vitest" {
  interface Assertion<T = any> {
    toBeVisible(): T;
  }
}

expect.extend({
  toBeVisible(element: HTMLElement) {
    let visible = element.isConnected;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      if (ancestor.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") visible = false;
    }
    return { pass: visible, message: () => `Expected element ${visible ? "not " : ""}to be visible` };
  },
});

const state = vi.hoisted(() => ({
  finance: null as any,
  refresh: vi.fn(),
  apply: vi.fn(),
  accounts: [] as any[],
  events: [] as any[],
  operations: [] as any[],
  walletError: null as any,
  financeError: null as any,
  financeLoading: false,
  historyError: null as any,
  readCalls: [] as any[],
}));

vi.mock("@/hooks/use-goal-finance", () => ({
  useGoalFinance: () => ({ data: state.finance, snapshot: state.finance, userId: "10000000-0000-4000-8000-000000000001", refresh: state.refresh, isLoading: false, error: null }),
  useGoalHistory: () => ({ data: state.events, isLoading: false, error: state.historyError, refresh: state.refresh }),
  useGoalWalletMetadata: () => ({ data: state.accounts, isLoading: false, error: state.walletError, refresh: state.refresh }),
}));

vi.mock("@/hooks/use-goals", () => ({
  useGoals: () => ({ goals: state.finance?.goals ?? [], financeSnapshot: state.finance, userId, refresh: state.refresh, isLoading: state.financeLoading, isError: state.financeError }),
  getProjection: () => ({ count: 0, unit: "months", projectedDate: null, monthlyAmount: 0, kinsenasAmount: 0 }),
}));

vi.mock("@/lib/goals/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/goals/client")>();
  return { ...actual, applyFinancialCommand: state.apply };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: (table: string) => {
    const builder: any = {
      select: (columns: string) => { state.readCalls.push({ table, method: "select", columns }); return builder; },
      eq: (column: string, value: string) => { state.readCalls.push({ table, method: "eq", column, value }); return builder; },
      in: (column: string, values: string[]) => { state.readCalls.push({ table, method: "in", column, values }); return builder; },
      order: (column: string) => { state.readCalls.push({ table, method: "order", column }); return builder; },
      then: (resolve: any, reject: any) => Promise.resolve({ data: table === "accounts" ? state.accounts : table === "goal_allocation_events" ? state.events : state.operations, error: null }).then(resolve, reject),
    };
    return builder;
  } }),
}));

import { GoalFundsDialog } from "@/components/goals/GoalFundsDialog";
import { GoalCompletionDialog } from "@/components/goals/GoalCompletionDialog";
import { GoalHistoryDialog } from "@/components/goals/GoalHistoryDialog";
import { GoalCard } from "@/components/goals/GoalCard";
import { FinancialCommandError, fetchGoalHistory, fetchGoalWalletMetadata } from "@/lib/goals/client";

const userId = "10000000-0000-4000-8000-000000000001";
const laptopId = "20000000-0000-4000-8000-000000000002";
const dateId = "20000000-0000-4000-8000-000000000003";
const gcashId = "30000000-0000-4000-8000-000000000003";
const bankId = "30000000-0000-4000-8000-000000000004";
const payLaterId = "30000000-0000-4000-8000-000000000005";
const operationId = "40000000-0000-4000-8000-000000000004";

function makeGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: laptopId, user_id: userId, name: "Laptop", target_amount: "30000.00", current_amount: "0.00",
    target_date: null, color: "#10b981", icon: "target", is_completed: false, status: "active",
    review_state: "confirmed", completed_at: null, archived_at: null, is_priority: false,
    category: "tech", allocation_per_cycle: "0.00", allocation_frequency: "monthly",
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    goalId: laptopId, reserved: "3000.00", spent: "2000.00", progressAmount: "5000.00",
    remaining: "25000.00", progressPercent: 16.6667,
    financeAmounts: { target: "30000.00", progress: "5000.00", allocationPerCycle: "0.00" },
    walletReservations: [{ accountId: gcashId, amount: "3000.00" }], legacyTaggedAmount: null,
    ...overrides,
  };
}

function makeSnapshot(goals = [makeGoal()]) {
  return {
    goals,
    wallets: [
      { accountId: gcashId, actual: "30000.00", reserved: "3000.00", available: "27000.00" },
      { accountId: bankId, actual: "10000.00", reserved: "0.00", available: "10000.00" },
      { accountId: payLaterId, actual: "-500.00", reserved: "0.00", available: "-500.00" },
    ],
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "50000000-0000-4000-8000-000000000005", user_id: userId, goal_id: laptopId,
    account_id: gcashId, operation_id: operationId, kind: "reserve", reserved_delta: "10.00",
    spent_delta: "0.00", transaction_id: null, reversal_of: null, created_at: "2026-10-01T00:00:00Z",
    accountName: "GCash", operation: null, ...overrides,
  };
}

beforeEach(() => {
  state.finance = makeSnapshot();
  state.accounts = [
    { id: gcashId, user_id: userId, name: "GCash", type: "e_wallet", currency: "PHP", is_active: true },
    { id: bankId, user_id: userId, name: "GoTyme", type: "bank", currency: "PHP", is_active: true },
    { id: payLaterId, user_id: userId, name: "SPayLater", type: "credit_card", currency: "PHP", is_active: true },
  ];
  state.events = [];
  state.operations = [];
  state.walletError = null;
  state.financeError = null;
  state.financeLoading = false;
  state.historyError = null;
  state.readCalls = [];
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.apply.mockReset().mockResolvedValue({ operationId, transactionIds: [], replayed: false });
});

afterEach(() => cleanup());

describe("goal reservation actions", () => {
  test("set aside uses reservation dialog and does not quote or create an expense", async () => {
    const user = userEvent.setup();
    render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: /set aside/i });
    expect(screen.getByRole("dialog", { name: /set aside/i })).toBeVisible();
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.apply.mock.calls.some(([, command]) => command.kind === "transaction")).toBe(false);
    expect(dialog.getAttribute("data-state")).toBe("open");
    expect(within(dialog).getAllByRole("option").map(option => option.textContent)).toEqual(["Choose a wallet", "GCash", "GoTyme"]);
    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
    await user.type(within(dialog).getByLabelText(/amount/i), "500");
    await user.click(within(dialog).getByRole("button", { name: /set aside/i }));

    await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
      kind: "reserve", goalId: laptopId, accountId: gcashId, amount: "500.00",
    }, undefined));
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.apply.mock.calls.some(([, command]) => command.kind === "transaction")).toBe(false);
    expect(state.finance.wallets[0].actual).toBe("30000.00");
  });

  test("release changes reservations without changing actual wallet balance", async () => {
    const user = userEvent.setup();
    render(<GoalFundsDialog goalId={laptopId} mode="release" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /release funds/i });
    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
    await user.type(within(dialog).getByLabelText(/amount/i), "1000");
    await user.click(within(dialog).getByRole("button", { name: /release funds/i }));

    await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
      kind: "release", goalId: laptopId, accountId: gcashId, amount: "1000.00",
    }, undefined));
    expect(state.finance.wallets[0].actual).toBe("30000.00");
  });

  test("move lists only owned active goals and keeps the selected wallet", async () => {
    const user = userEvent.setup();
    state.finance = makeSnapshot([
      makeGoal(),
      makeGoal({ id: dateId, goalId: dateId, name: "Date", status: "active", archived_at: null }),
      makeGoal({ id: "20000000-0000-4000-8000-000000000006", goalId: "20000000-0000-4000-8000-000000000006", name: "Cancelled", status: "cancelled" }),
      makeGoal({ id: "20000000-0000-4000-8000-000000000007", goalId: "20000000-0000-4000-8000-000000000007", name: "Archived", status: "active", archived_at: "2026-10-02T00:00:00Z" }),
    ]);
    render(<GoalFundsDialog goalId={laptopId} mode="move" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /move reservation/i });
    const destination = within(dialog).getByLabelText(/move to goal/i);
    expect(within(destination).getAllByRole("option").map(option => option.textContent)).toEqual(["Choose a goal", "Date"]);
    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
    await user.selectOptions(destination, dateId);
    await user.type(within(dialog).getByLabelText(/amount/i), "250");
    await user.click(within(dialog).getByRole("button", { name: /move reservation/i }));
    await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
      kind: "reallocate", goalId: laptopId, destinationGoalId: dateId, accountId: gcashId, amount: "250.00",
    }, undefined));
  });

  test("changing goal or reopening clears entered amount and wallet selection", async () => {
    const user = userEvent.setup();
    const view = render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
    let dialog = screen.getByRole("dialog", { name: /set aside/i });
    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
    await user.type(within(dialog).getByLabelText(/amount/i), "500");

    view.rerender(<GoalFundsDialog goalId={dateId} mode="reserve" open onOpenChange={() => {}} />);
    dialog = screen.getByRole("dialog", { name: /set aside/i });
    expect((within(dialog).getByLabelText(/amount/i) as HTMLInputElement).value).toBe("");
    expect((within(dialog).getByLabelText(/wallet/i) as HTMLSelectElement).value).toBe("");

    view.rerender(<GoalFundsDialog goalId={dateId} mode="reserve" open={false} onOpenChange={() => {}} />);
    view.rerender(<GoalFundsDialog goalId={dateId} mode="reserve" open onOpenChange={() => {}} />);
    dialog = screen.getByRole("dialog", { name: /set aside/i });
    expect((within(dialog).getByLabelText(/amount/i) as HTMLInputElement).value).toBe("");
    expect((within(dialog).getByLabelText(/wallet/i) as HTMLSelectElement).value).toBe("");
  });

  test("cancel and rejected commands leave the finance snapshot untouched", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const view = render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole("dialog", { name: /set aside/i });
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.finance.wallets[0].reserved).toBe("3000.00");

    state.apply.mockRejectedValueOnce(new Error("Could not reserve funds"));
    view.rerender(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={onOpenChange} />);
    const reopened = screen.getByRole("dialog", { name: /set aside/i });
    await user.selectOptions(within(reopened).getByLabelText(/wallet/i), gcashId);
    await user.type(within(reopened).getByLabelText(/amount/i), "500");
    await user.click(within(reopened).getByRole("button", { name: /set aside/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not reserve funds/i);
    expect(state.finance.wallets[0].reserved).toBe("3000.00");
  });

  test("unknown save retries the same request even after the selected goal changes", async () => {
    const user = userEvent.setup();
    const unknown = new FinancialCommandError({ message: "Network disconnected", outcome: "unknown" });
    state.apply.mockRejectedValueOnce(unknown).mockResolvedValue({ operationId, transactionIds: [], replayed: true });
    const view = render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
    let dialog = screen.getByRole("dialog", { name: /set aside/i });
    await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
    await user.type(within(dialog).getByLabelText(/amount/i), "125");
    await user.click(within(dialog).getByRole("button", { name: /set aside/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm whether this was saved/i);
    const firstAttempt = state.apply.mock.calls[0];

    view.rerender(<GoalFundsDialog goalId={dateId} mode="reserve" open onOpenChange={() => {}} />);
    dialog = screen.getByRole("dialog", { name: /set aside/i });
    await user.click(within(dialog).getByRole("button", { name: /retry same request/i }));
    await waitFor(() => expect(state.apply).toHaveBeenCalledTimes(2));
    expect(state.apply.mock.calls[1]).toEqual(firstAttempt);
  });

  test("wallet read errors stay distinct from an empty eligible-wallet list", () => {
    state.walletError = new Error("metadata unavailable");
    render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /set aside/i });
    expect(within(dialog).getByRole("alert").textContent).toMatch(/could not load/i);
    expect(dialog.textContent).not.toMatch(/no wallet has money available/i);
  });

  test("reservation amount and retry loading controls have mobile minimum heights", () => {
    state.walletError = new Error("metadata unavailable");
    render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /set aside/i });
    expect(within(dialog).getByLabelText(/amount/i).classList.contains("min-h-11")).toBe(true);
    expect(within(dialog).getByRole("button", { name: /retry loading/i }).classList.contains("min-h-11")).toBe(true);
  });
});

describe("goal lifecycle presentation", () => {
  test("active progress adds reserved and spent while showing each amount separately", () => {
    render(<GoalCard goal={makeGoal() as any} onEdit={() => {}} onDelete={() => {}} onToggleComplete={() => {}} onContribute={() => {}} onReserve={() => {}} onRelease={() => {}} onMove={() => {}} onHistory={() => {}} />);
    const card = screen.getByRole("article", { name: /laptop/i });
    expect(within(card).getByText(/reserved/i).textContent).toContain("₱3,000.00");
    expect(within(card).getByText(/spent/i).textContent).toContain("₱2,000.00");
    expect(within(card).getByText("17%")).toBeTruthy();
    expect(within(card).getByText("Saving")).toBeTruthy();
  });

  test("completed status comes from lifecycle, shows spending, and offers reopen and archive", async () => {
    const user = userEvent.setup();
    const onToggleComplete = vi.fn();
    const onDelete = vi.fn();
    render(<GoalCard goal={makeGoal({ status: "completed", is_completed: false, reserved: "0.00", spent: "2000.00", progressAmount: "2000.00", walletReservations: [] }) as any} onEdit={() => {}} onDelete={onDelete} onToggleComplete={onToggleComplete} onContribute={() => {}} onReserve={() => {}} onRelease={() => {}} onMove={() => {}} onHistory={() => {}} />);
    const card = screen.getByRole("article", { name: /laptop/i });
    expect(within(card).getByText("Completed")).toBeTruthy();
    expect(within(card).getAllByText(/spent/i).some(element => element.textContent?.includes("₱2,000.00"))).toBe(true);
    await user.click(within(card).getByRole("button", { name: /reopen/i }));
    expect(onToggleComplete).toHaveBeenCalledWith(laptopId, false);
    await user.click(within(card).getByRole("button", { name: /laptop actions/i }));
    await user.click(screen.getByRole("menuitem", { name: /archive goal/i }));
    expect(onDelete).toHaveBeenCalledWith(laptopId);
  });

  test("reopening retains prior spending and restored active progress", async () => {
    const user = userEvent.setup();
    render(<GoalCard goal={makeGoal({ status: "completed", is_completed: true, reserved: "0.00", spent: "2000.00", progressAmount: "2000.00", progressPercent: 6.6667 }) as any} onEdit={() => {}} onDelete={() => {}} onToggleComplete={() => {}} onContribute={() => {}} onReserve={() => {}} onRelease={() => {}} onMove={() => {}} onHistory={() => {}} />);
    const card = screen.getByRole("article", { name: /laptop/i });
    await user.click(within(card).getByRole("button", { name: /reopen/i }));
    expect(within(card).getAllByText(/spent/i).some(element => element.textContent?.includes("₱2,000.00"))).toBe(true);
    expect(within(card).getByText("7%")).toBeTruthy();
  });
});

describe("goal closure and history", () => {
  test.each(["error", "loading"])("cached zero reservations do not permit closure while snapshot is %s", async condition => {
    state.finance = makeSnapshot([makeGoal({ reserved: "0.00", walletReservations: [] })]);
    state.financeError = condition === "error" ? new Error("snapshot unavailable") : null;
    state.financeLoading = condition === "loading";
    render(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /complete goal/i });
    expect(dialog.textContent).not.toMatch(/no reservations remain/i);
    expect(within(dialog).getByRole(condition === "error" ? "alert" : "status").textContent).toMatch(/goal funds/i);
    expect((within(dialog).getByRole("button", { name: "Complete goal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(within(dialog).getByRole("button", { name: "Complete goal" }).closest("form")!);
    expect(state.apply).not.toHaveBeenCalled();
  });

  test("unknown closure retries its original request despite a closed goal and snapshot error", async () => {
    const user = userEvent.setup();
    state.apply.mockRejectedValueOnce(new FinancialCommandError({ message: "Disconnected", outcome: "unknown" }));
    const view = render(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
    await user.click(screen.getByLabelText(/release leftovers/i));
    await user.click(screen.getByRole("button", { name: "Complete goal" }));
    await screen.findByText(/could not confirm whether this was saved/i);
    const firstAttempt = state.apply.mock.calls[0];
    state.finance = makeSnapshot([makeGoal({ status: "completed", reserved: "0.00", walletReservations: [] })]);
    state.financeError = new Error("snapshot unavailable");
    view.rerender(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: /retry same request/i }));
    await waitFor(() => expect(state.apply).toHaveBeenCalledTimes(2));
    expect(state.apply.mock.calls[1]).toEqual(firstAttempt);
  });

  test("closure asks whether to release or move leftover reservations", async () => {
    const user = userEvent.setup();
    render(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /complete goal/i });
    expect(within(dialog).getByText(/remains reserved/i).textContent).toContain("3000.00");
    expect(within(dialog).getByLabelText(/release leftovers/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/move leftovers/i)).toBeTruthy();
    await user.click(within(dialog).getByLabelText(/release leftovers/i));
    await user.click(within(dialog).getByRole("button", { name: /complete goal/i }));
    await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
      kind: "close", goalId: laptopId, status: "completed", leftovers: { mode: "release" },
    }, undefined));
  });

  test("history shows event labels and real wallet names, with exact decimal values", () => {
    state.events = [
      event({ kind: "reserve", reserved_delta: "10.00", spent_delta: "0.00", accountName: "GCash" }),
      event({ id: "50000000-0000-4000-8000-000000000006", kind: "release", reserved_delta: "-3.00", accountName: "GCash" }),
      event({ id: "50000000-0000-4000-8000-000000000007", kind: "spend", reserved_delta: "-2.00", spent_delta: "2.00", accountName: "Main bank", transaction_id: "60000000-0000-4000-8000-000000000006" }),
      event({ id: "50000000-0000-4000-8000-000000000008", kind: "move_out", reserved_delta: "-1.00", accountName: "GCash" }),
      event({ id: "50000000-0000-4000-8000-000000000009", kind: "move_in", reserved_delta: "1.00", accountName: "Main bank" }),
      event({ id: "50000000-0000-4000-8000-000000000010", kind: "reversal", reserved_delta: "0.00", spent_delta: "-2.00", reversal_of: "50000000-0000-4000-8000-000000000007", accountName: "Main bank" }),
      event({ id: "50000000-0000-4000-8000-000000000011", kind: "release", reserved_delta: "-4.00", operationKind: "transaction", accountName: "GCash" }),
    ];
    render(<GoalHistoryDialog goalId={laptopId} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: /laptop history/i });
    expect(within(dialog).getByText("Set aside")).toBeTruthy();
    expect(within(dialog).getByText("Release funds")).toBeTruthy();
    expect(within(dialog).getByText("Confirmed automatic release")).toBeTruthy();
    expect(within(dialog).getByText("Spending from goal")).toBeTruthy();
    expect(within(dialog).getAllByText("Move reservation").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Reversal")).toBeTruthy();
    expect(within(dialog).getAllByText(/GCash|Main bank/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("−PHP 3.00 reserved")).toBeTruthy();
  });

  test("history normalizes decimal text exactly and reads metadata only for the owner", async () => {
    state.events = [event({ kind: "spend", reserved_delta: "-2.5", spent_delta: "2.5", transaction_id: "60000000-0000-4000-8000-000000000006" })];
    state.operations = [{ id: operationId, command: { kind: "transaction" } }];
    const history = await fetchGoalHistory(userId, laptopId);
    expect(history[0]).toMatchObject({ reserved_delta: "-2.50", spent_delta: "2.50", accountName: "GCash", operationKind: "transaction" });
    expect(state.readCalls).toContainEqual({ table: "goal_allocation_events", method: "eq", column: "user_id", value: userId });
    expect(state.readCalls).toContainEqual({ table: "accounts", method: "eq", column: "user_id", value: userId });
    expect(state.readCalls).toContainEqual({ table: "financial_operations", method: "eq", column: "user_id", value: userId });
    expect(state.readCalls.find(call => call.table === "goal_allocation_events" && call.method === "select").columns).toContain("reserved_delta::text");
  });

  test("history rejects a database decimal with more than two places instead of rounding it", async () => {
    state.events = [event({ reserved_delta: "1.005" })];
    await expect(fetchGoalHistory(userId, laptopId)).rejects.toThrow(/invalid decimal/i);
  });

  test("history records deleted-transaction reversals without inventing an allocation amount", async () => {
    const transactionId = "60000000-0000-4000-8000-000000000006";
    const deletionOperationId = "40000000-0000-4000-8000-000000000008";
    state.events = [event({ kind: "release", reserved_delta: "-5.00", operation_id: operationId, transaction_id: transactionId })];
    state.operations = [
      { id: operationId, command: { kind: "release" }, result: {} },
      { id: deletionOperationId, command: { kind: "delete_transaction", transactionId }, created_at: "2026-10-06T00:00:00Z" },
    ];
    const history = await fetchGoalHistory(userId, laptopId);
    expect(history).toHaveLength(2);
    expect(history.find(entry => entry.kind === "transaction_reversal")).toMatchObject({
      reserved_delta: "0.00", spent_delta: "0.00", transaction_id: transactionId,
      operation_id: deletionOperationId, operationKind: "delete_transaction",
    });
  });

  test("wallet metadata stays owner-scoped and includes account kinds for eligibility", async () => {
    const wallets = await fetchGoalWalletMetadata(userId);
    expect(wallets.find(wallet => wallet.id === bankId)).toMatchObject({ name: "GoTyme", type: "bank", currency: "PHP" });
    expect(wallets.find(wallet => wallet.id === payLaterId)).toMatchObject({ name: "SPayLater", type: "credit_card" });
    expect(state.readCalls).toContainEqual({ table: "accounts", method: "eq", column: "user_id", value: userId });
  });

  test("keyboard opening, tabbing, escape, and focus return work for reservation dialog", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Open set aside</button><GoalFundsDialog goalId={laptopId} mode="reserve" open={open} onOpenChange={setOpen} /></>;
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open set aside" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /set aside/i });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /set aside/i })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
