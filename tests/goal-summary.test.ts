import { describe, expect, test, vi } from "vitest";
import {
  AllocationEventSchema, FinancialCommandSchema, GoalFinanceSnapshotSchema, MAX_INSTALLMENTS,
  MoneySchema, TransactionDraftSchema,
  type AllocationEvent,
} from "@/lib/goals/contracts";
import { fromMinorUnits, parseMoney, projectGoal, splitInstallments, summarizeGoal, toMinorUnits } from "@/lib/goals/summary";
import { getProjection, type GoalWithProgress } from "@/hooks/use-goals";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const goalId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000001";
const otherAccountId = "20000000-0000-4000-8000-000000000002";
const operationId = "30000000-0000-4000-8000-000000000001";
function event(reserved_delta: string, spent_delta = "0.00", overrides: Partial<AllocationEvent> = {}): AllocationEvent {
  return { id: "40000000-0000-4000-8000-000000000001", user_id: goalId, goal_id: goalId,
    account_id: accountId, operation_id: operationId, kind: "reserve", reserved_delta, spent_delta,
    transaction_id: null, reversal_of: null, created_at: "2026-10-06T00:00:00Z", ...overrides };
}

describe("exact PHP money", () => {
  test("normalizes entry amounts and adds centavos exactly", () => {
    expect(parseMoney("0005.1")).toBe("5.10");
    expect(parseMoney("0")).toBe("0.00");
    expect(fromMinorUnits(toMinorUnits(parseMoney("0.10")) + toMinorUnits(parseMoney("0.20")))).toBe("0.30");
  });
  test.each(["-1", "-0.00", "NaN", "Infinity", "1e3", "1.001", "90071992547409.92", "", " 1.00", "+1", ".5", "1."])("rejects invalid entry %s", input => {
    expect(() => parseMoney(input)).toThrow();
  });
  test("serializes safe integer boundaries without rounding", () => {
    expect(toMinorUnits("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(fromMinorUnits(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(fromMinorUnits(-Number.MAX_SAFE_INTEGER)).toBe("-90071992547409.91");
    expect(toMinorUnits("-0.01")).toBe(-1);
    for (const cents of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => fromMinorUnits(cents)).toThrow();
    for (const value of ["1", "01.00", "1.0", "-0.00", "1e2", "90071992547409.92"]) expect(() => toMinorUnits(value)).toThrow();
    expect(() => parseMoney(0.1 as unknown as string)).toThrow();
  });
  test("splits installments with the remainder in the earliest rows", () => {
    expect(splitInstallments("100.00", 3)).toEqual(["33.34", "33.33", "33.33"]);
    expect(splitInstallments("0.03", 3)).toEqual(["0.01", "0.01", "0.01"]);
    expect(splitInstallments("90071992547409.91", 3).reduce((sum, part) => sum + toMinorUnits(part), 0)).toBe(Number.MAX_SAFE_INTEGER);
    for (const count of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => splitInstallments("100.00", count)).toThrow();
    expect(() => splitInstallments("-1.00", 2)).toThrow();
  });
  test("caps installment splitting at the existing twelve choices", () => {
    expect(MAX_INSTALLMENTS).toBe(12);
    expect(splitInstallments("12.00", MAX_INSTALLMENTS)).toEqual(Array(MAX_INSTALLMENTS).fill("1.00"));
    expect(() => splitInstallments("13.00", MAX_INSTALLMENTS + 1)).toThrow(/12/);
  });
  test("rejects oversized installment counts before allocating rows", () => {
    const arrayFrom = vi.spyOn(Array, "from").mockImplementation(() => {
      throw new Error("Array.from was reached");
    });
    let caught: unknown;
    try {
      splitInstallments("42949672.95", 0xffffffff);
    } catch (error) {
      caught = error;
    } finally {
      arrayFrom.mockRestore();
    }
    expect(arrayFrom).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/12/);
  });
  test("rejects splits that would create zero-value transaction rows", () => {
    expect(() => splitInstallments("0.01", 3)).toThrow(/centavo|installment/i);
    expect(() => splitInstallments("0.00", 1)).toThrow();
  });
});

describe("allocation event progress", () => {
  test("reserving the target funds a goal without spending", () => {
    expect(summarizeGoal(goalId, "5000.00", [event("5000.00")])).toMatchObject({ reserved: "5000.00", spent: "0.00", remaining: "0.00", progressPercent: 100 });
  });
  test("goal spending preserves combined progress", () => {
    const totals = summarizeGoal(goalId, "3000.00", [event("3000.00"), event("-2000.00", "2000.00", { kind: "spend" })]);
    expect(totals).toMatchObject({ reserved: "1000.00", spent: "2000.00", progressAmount: "3000.00", progressPercent: 100 });
  });
  test("releasing reservations lowers progress without recording spending", () => {
    expect(summarizeGoal(goalId, "30000.00", [event("27000.00"), event("-15000.00", "0.00", { kind: "release" })])).toMatchObject({ reserved: "12000.00", spent: "0.00", progressPercent: 40 });
  });
  test("paired wallet moves preserve goal totals", () => {
    const totals = summarizeGoal(goalId, "5000.00", [event("5000.00"), event("-1000.00", "0.00", { kind: "move_out" }), event("1000.00", "0.00", { kind: "move_in", account_id: otherAccountId })]);
    expect(totals).toMatchObject({ reserved: "5000.00", progressAmount: "5000.00", walletReservations: [{ accountId, amount: "4000.00" }, { accountId: otherAccountId, amount: "1000.00" }] });
  });
  test("paired goal moves preserve total reservations across goals", () => {
    const secondGoalId = otherAccountId;
    const events = [event("5000.00"), event("-1000.00", "0.00", { kind: "move_out" }), event("1000.00", "0.00", { kind: "move_in", goal_id: secondGoalId })];
    expect(summarizeGoal(goalId, "5000.00", events).reserved).toBe("4000.00");
    expect(summarizeGoal(secondGoalId, "5000.00", events).reserved).toBe("1000.00");
  });
  test("reversals restore reservation and spending amounts", () => {
    const spend = event("-2000.00", "2000.00", { kind: "spend" });
    const totals = summarizeGoal(goalId, "3000.00", [event("3000.00"), spend, event("2000.00", "-2000.00", { kind: "reversal", reversal_of: spend.id })]);
    expect(totals).toMatchObject({ reserved: "3000.00", spent: "0.00", progressAmount: "3000.00" });
  });
  test("never infers reservations or spending from legacy tags", () => {
    expect(summarizeGoal(goalId, "5000.00", [])).toEqual({ goalId, reserved: "0.00", spent: "0.00", progressAmount: "0.00", remaining: "5000.00", progressPercent: 0, walletReservations: [], legacyTaggedAmount: null });
    expect(() => summarizeGoal(goalId, "5000.00", [{ goal_id: goalId, type: "expense", amount: "5000.00" }] as unknown as AllocationEvent[])).toThrow();
    expect(summarizeGoal(goalId, "5000.00", [event("0.00", "1000.00", { kind: "legacy_spent" })]).spent).toBe("1000.00");
  });
  test("keeps true amounts while clamping the display percentage", () => {
    expect(summarizeGoal(goalId, "5000.00", [event("6000.00")])).toMatchObject({ reserved: "6000.00", progressAmount: "6000.00", remaining: "0.00", progressPercent: 100 });
  });
  test("requires positive targets and rejects invalid deltas and totals", () => {
    for (const target of ["0.00", "-1.00", "NaN", "1.001"]) expect(() => summarizeGoal(goalId, target, [])).toThrow();
    for (const delta of ["NaN", "Infinity", "1e3", "1.001", "1.0"]) expect(() => summarizeGoal(goalId, "5000.00", [event(delta)])).toThrow();
    expect(() => summarizeGoal(goalId, "5000.00", [event(1 as unknown as string)])).toThrow();
    expect(() => summarizeGoal(goalId, "5000.00", [event("90071992547409.91"), event("0.01")])).toThrow();
    expect(() => summarizeGoal(goalId, "5000.00", [event("-1.00", "0.00", { kind: "release" })])).toThrow();
    expect(() => summarizeGoal(goalId, "5000.00", [event("1.00"), event("-2.00", "0.00", { kind: "move_out", account_id: otherAccountId })])).toThrow();
  });
});

describe("pure cadence projection", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const input = { target: "5000.00", progressAmount: "500.00", allocationPerCycle: "1000.00", allocationFrequency: "monthly" };
  test("monthly cadence uses remaining combined progress", () => {
    expect(projectGoal(input, now)).toEqual({ count: 5, unit: "months", projectedDate: "2026-06-10", monthlyAmount: 1000, kinsenasAmount: 500 });
    expect(now.toISOString()).toBe("2026-01-10T00:00:00.000Z");
  });
  test("kinsenas cadence uses nine half-month cycles", () => {
    expect(projectGoal({ ...input, allocationPerCycle: "500.00", allocationFrequency: "kinsenas" }, now)).toEqual({ count: 9, unit: "paydays", projectedDate: "2026-05-25", monthlyAmount: 1000, kinsenasAmount: 500 });
  });
  test("zero cadence or a funded goal gives no estimate", () => {
    expect(projectGoal({ ...input, allocationPerCycle: "0.00" }, now)).toMatchObject({ count: 0, unit: "months", projectedDate: null });
    expect(projectGoal({ ...input, progressAmount: "6000.00" }, now)).toMatchObject({ count: 0, projectedDate: null });
  });
  test("keeps singular labels and existing half-cycle display conversion", () => {
    expect(projectGoal({ ...input, progressAmount: "4000.00" }, now)).toMatchObject({ count: 1, unit: "month" });
    expect(projectGoal({ ...input, progressAmount: "4500.00", allocationFrequency: "kinsenas" }, now)).toMatchObject({ count: 1, unit: "payday" });
    expect(projectGoal({ ...input, allocationPerCycle: "0.01", progressAmount: "4999.99" }, now).kinsenasAmount).toBe(0.005);
  });
  test("keeps cycle counts when projected dates exceed the calendar range", () => {
    for (const allocationFrequency of ["monthly", "kinsenas"]) {
      expect(projectGoal({ ...input, target: "90071992547409.91", progressAmount: "0.00", allocationPerCycle: "0.01", allocationFrequency }, now)).toMatchObject({ count: Number.MAX_SAFE_INTEGER, projectedDate: null });
      expect(projectGoal({ ...input, allocationFrequency, target: "10000.00", progressAmount: "0.00", allocationPerCycle: "1.00" }, new Date("9999-12-01T00:00:00Z"))).toMatchObject({ count: 10000, projectedDate: null });
    }
  });
  test("legacy projection callers delegate while tolerating their floating contribution totals", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const legacy = { target_amount: 1, saved: 0.1 + 0.2, allocation_per_cycle: 0.1, allocation_frequency: "monthly" } as GoalWithProgress;
      expect(getProjection(legacy)).toMatchObject({ count: 7, monthlyAmount: 0.1, kinsenasAmount: 0.05 });
      expect(getProjection({ ...legacy, target_amount: 0 })).toMatchObject({ count: 0, projectedDate: null });
      expect(getProjection({ ...legacy, allocation_per_cycle: 0 })).toMatchObject({ count: 0, projectedDate: null });
      expect(getProjection({ ...legacy, target_amount: 90071992547400, saved: 0, allocation_per_cycle: 0.01 })).toMatchObject({ count: 9007199254740000, projectedDate: null });
    } finally { vi.useRealTimers(); }
  });
});

describe("domain JSON parsing", () => {
  const draft = { type: "expense", accountId, transferToAccountId: null, categoryId: null, goalId: null, amount: "100.00", description: null, date: "2026-10-06", installments: null, reservationMoves: [] };
  test("money JSON must already be canonical decimal text", () => {
    expect(MoneySchema.parse("100.00")).toBe("100.00");
    for (const amount of [100, "100", "100.0", "-1.00", "01.00", "90071992547409.92"]) expect(MoneySchema.safeParse(amount).success).toBe(false);
    expect(AllocationEventSchema.parse(event("-1.00", "1.00", { kind: "spend" }))).toEqual(event("-1.00", "1.00", { kind: "spend" }));
    expect(AllocationEventSchema.safeParse(event(1 as unknown as string)).success).toBe(false);
  });
  test("parses the command union and rejects invalid entry amounts", () => {
    expect(FinancialCommandSchema.parse({ kind: "transaction", draft })).toEqual({ kind: "transaction", draft });
    const commands = [
      { kind: "reserve", goalId, accountId, amount: "1.00" }, { kind: "release", goalId, accountId, amount: "1.00" },
      { kind: "reallocate", goalId, destinationGoalId: otherAccountId, accountId, amount: "1.00" },
      { kind: "close", goalId, status: "completed", leftovers: { mode: "release" } },
      { kind: "reopen", goalId }, { kind: "archive", goalId }, { kind: "delete_transaction", transactionId: goalId },
      { kind: "adopt_legacy", goalId, status: "active", reservations: [{ accountId, amount: "1.00" }], spentTransactionIds: [goalId] },
    ];
    for (const command of commands) expect(FinancialCommandSchema.parse(command)).toEqual(command);
    for (const amount of ["-1.00", "0.00", "1e2", 100]) expect(TransactionDraftSchema.safeParse({ ...draft, amount }).success).toBe(false);
    expect(TransactionDraftSchema.safeParse({ ...draft, date: "2026-02-30" }).success).toBe(false);
    expect(TransactionDraftSchema.safeParse({ ...draft, installments: { count: 1.5 } }).success).toBe(false);
  });
  test("limits transaction draft installments to the existing twelve choices", () => {
    expect(TransactionDraftSchema.safeParse({ ...draft, installments: { count: MAX_INSTALLMENTS } }).success).toBe(true);
    for (const count of [MAX_INSTALLMENTS + 1, 0xffffffff]) {
      expect(TransactionDraftSchema.safeParse({ ...draft, installments: { count } }).success).toBe(false);
    }
  });
  test("snapshot goal row monetary fields override raw numeric rows", () => {
    const goal = { id: goalId, user_id: goalId, name: "Date", target_amount: "3000.00", current_amount: "1000.00", target_date: null, color: null, icon: null, is_completed: false, status: "active", review_state: "confirmed", completed_at: null, archived_at: null, is_priority: false, category: "savings", allocation_per_cycle: "500.00", allocation_frequency: "monthly", created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", ...summarizeGoal(goalId, "3000.00", [event("1000.00")]) };
    const snapshot = { goals: [goal], wallets: [{ accountId, actual: "5000.00", reserved: "1000.00", available: "4000.00" }] };
    expect(GoalFinanceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    for (const field of ["target_amount", "current_amount", "allocation_per_cycle"]) expect(GoalFinanceSnapshotSchema.safeParse({ ...snapshot, goals: [{ ...goal, [field]: 1000 }] }).success).toBe(false);
    expect(GoalFinanceSnapshotSchema.safeParse({ ...snapshot, goals: [{ ...goal, target_amount: "0.00" }] }).success).toBe(false);
  });
});
