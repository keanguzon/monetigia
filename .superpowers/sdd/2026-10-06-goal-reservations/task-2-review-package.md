# Task 2 review: 8c23f8040ac06e9b75f26a3d7c2176e22da1652c..80be291faae94acd907f85502d5db1c360842edb
80be291 feat: calculate reservation and spending progress exactly
 src/hooks/use-goals.ts          |  46 ++---------
 src/lib/goal-funding.ts         |   1 +
 src/lib/goals/contracts.ts      |  83 ++++++++++++++++++++
 src/lib/goals/summary.ts        |  92 ++++++++++++++++++++++
 tests/goal-summary.test.ts      | 164 ++++++++++++++++++++++++++++++++++++++++
 tests/navigation-goals.test.cjs |  29 ++++---
 vitest.config.ts                |   2 +-
 7 files changed, 366 insertions(+), 51 deletions(-)
diff --git a/src/hooks/use-goals.ts b/src/hooks/use-goals.ts
index 378c1da..1f8fe47 100644
--- a/src/hooks/use-goals.ts
+++ b/src/hooks/use-goals.ts
@@ -1,74 +1,44 @@
 import useSWR from "swr";
 import { goalFunding } from "@/lib/goal-funding";
+import { parseMoney, projectGoal, type ProjectionResult } from "@/lib/goals/summary";
 import { createClient } from "@/lib/supabase/client";
 import type { Goal, GoalInsert, GoalUpdate } from "@/types/database";
 
 const supabase = createClient();
 
 export interface GoalWithProgress extends Goal {
   saved: number;
   progressPercent: number;
 }
 
-export interface ProjectionResult {
-  count: number;
-  unit: "month" | "months" | "payday" | "paydays";
-  projectedDate: string | null;
-  monthlyAmount: number;
-  kinsenasAmount: number;
-}
+export type { ProjectionResult } from "@/lib/goals/summary";
 
 export function getProjection(goal: GoalWithProgress): ProjectionResult {
   const isKinsenas = goal.allocation_frequency === "kinsenas";
   const allocation = Number(goal.allocation_per_cycle) || 0;
   const target = Number(goal.target_amount) || 0;
   const saved = Number(goal.saved) || 0;
 
-  const monthlyAmount = isKinsenas ? allocation * 2 : allocation;
-  const kinsenasAmount = isKinsenas ? allocation : allocation / 2;
-
-  if (allocation <= 0 || saved >= target) {
+  if (allocation <= 0 || target <= 0 || saved >= target) {
     return {
       count: 0,
       unit: isKinsenas ? "paydays" : "months",
       projectedDate: null,
-      monthlyAmount,
-      kinsenasAmount,
+      monthlyAmount: isKinsenas ? allocation * 2 : allocation,
+      kinsenasAmount: isKinsenas ? allocation : allocation / 2,
     };
   }
 
-  const remaining = Math.max(0, target - saved);
-
-  if (isKinsenas) {
-    const paydays = Math.ceil(remaining / allocation);
-    const projected = new Date();
-    projected.setDate(projected.getDate() + paydays * 15);
-    return {
-      count: paydays,
-      unit: paydays === 1 ? "payday" : "paydays",
-      projectedDate: projected.toISOString().slice(0, 10),
-      monthlyAmount,
-      kinsenasAmount,
-    };
-  } else {
-    const months = Math.ceil(remaining / allocation);
-    const projected = new Date();
-    projected.setMonth(projected.getMonth() + months);
-    return {
-      count: months,
-      unit: months === 1 ? "month" : "months",
-      projectedDate: projected.toISOString().slice(0, 10),
-      monthlyAmount,
-      kinsenasAmount,
-    };
-  }
+  // The legacy reader still sums floats; this adapter lasts until decimal snapshot cutover.
+  return projectGoal({ target: parseMoney(target.toFixed(2)), progressAmount: parseMoney(saved.toFixed(2)),
+    allocationPerCycle: parseMoney(allocation.toFixed(2)), allocationFrequency: goal.allocation_frequency }, new Date());
 }
 
 export function useGoals() {
   const { data, error, isLoading, mutate } = useSWR<GoalWithProgress[]>(
     "goals",
     async () => {
       const {
         data: { user },
       } = await supabase.auth.getUser();
       if (!user) throw new Error("Not authenticated");
diff --git a/src/lib/goal-funding.ts b/src/lib/goal-funding.ts
index 6cfd2dc..046613d 100644
--- a/src/lib/goal-funding.ts
+++ b/src/lib/goal-funding.ts
@@ -1,8 +1,9 @@
+// Legacy tagged contributions remain in use until the finance reader and modal cutover.
 export function contributionGoalId(type: string, goalId: string | null | undefined) {
   return (type === "expense" || type === "transfer") && goalId ? goalId : null;
 }
 
 export function goalFunding(goalId: string, target: number, transactions: { goal_id: string | null; type: string; amount: number | string }[]) {
   const saved = transactions.reduce((sum, tx) => contributionGoalId(tx.type, tx.goal_id) === goalId ? sum + Number(tx.amount || 0) : sum, 0);
   return { saved, progressPercent: target > 0 ? saved / target * 100 : 0 };
 }
diff --git a/src/lib/goals/contracts.ts b/src/lib/goals/contracts.ts
new file mode 100644
index 0000000..483f84e
--- /dev/null
+++ b/src/lib/goals/contracts.ts
@@ -0,0 +1,83 @@
+import { z } from "zod";
+import type { Goal, GoalAllocationEvent } from "@/types/database";
+
+export type Money = string;
+const id = z.string().uuid();
+const safeCentavos = (amount: string) => Number.isSafeInteger(Number(amount.replace(".", "")));
+export const MoneySchema = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/).refine(safeCentavos, "Amount exceeds safe centavo range");
+export const SignedMoneySchema = z.string().regex(/^-?(0|[1-9]\d*)\.\d{2}$/).refine(amount => amount !== "-0.00" && safeCentavos(amount), "Invalid signed amount or unsafe centavo range");
+export const PositiveMoneySchema = MoneySchema.refine(amount => amount !== "0.00", "Amount must be positive");
+export const GoalStatusSchema = z.enum(["active", "completed", "cancelled"]);
+export const ReviewStateSchema = z.enum(["needs_review", "confirmed"]);
+export type GoalStatus = z.infer<typeof GoalStatusSchema>;
+export type ReviewState = z.infer<typeof ReviewStateSchema>;
+export const ReleaseLineSchema = z.object({ goalId: id, accountId: id, amount: PositiveMoneySchema });
+export const ReservationMoveSchema = z.object({ goalId: id, amount: PositiveMoneySchema });
+export const LeftoverChoiceSchema = z.discriminatedUnion("mode", [
+  z.object({ mode: z.literal("release") }),
+  z.object({ mode: z.literal("move"), goalId: id }),
+]);
+export type ReleaseLine = z.infer<typeof ReleaseLineSchema>;
+export type ReservationMove = z.infer<typeof ReservationMoveSchema>;
+export type LeftoverChoice = z.infer<typeof LeftoverChoiceSchema>;
+
+const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
+  const parsed = new Date(`${value}T00:00:00Z`);
+  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
+}, "Invalid calendar date");
+export const TransactionDraftSchema = z.object({
+  type: z.enum(["income", "expense", "transfer"]), accountId: id,
+  transferToAccountId: id.nullable(), categoryId: id.nullable(), goalId: id.nullable(),
+  amount: PositiveMoneySchema, description: z.string().nullable(), date,
+  installments: z.object({ count: z.number().int().positive().safe() }).nullable(),
+  reservationMoves: z.array(ReservationMoveSchema),
+});
+export type TransactionDraft = z.infer<typeof TransactionDraftSchema>;
+export const FinancialCommandSchema = z.discriminatedUnion("kind", [
+  z.object({ kind: z.enum(["reserve", "release"]), goalId: id, accountId: id, amount: PositiveMoneySchema }),
+  z.object({ kind: z.literal("reallocate"), goalId: id, destinationGoalId: id, accountId: id, amount: PositiveMoneySchema }),
+  z.object({ kind: z.literal("close"), goalId: id, status: z.enum(["completed", "cancelled"]), leftovers: LeftoverChoiceSchema.nullable() }),
+  z.object({ kind: z.enum(["reopen", "archive"]), goalId: id }),
+  z.object({ kind: z.literal("transaction"), draft: TransactionDraftSchema }),
+  z.object({ kind: z.literal("delete_transaction"), transactionId: id }),
+  z.object({ kind: z.literal("adopt_legacy"), goalId: id, status: GoalStatusSchema,
+    reservations: z.array(z.object({ accountId: id, amount: PositiveMoneySchema })), spentTransactionIds: z.array(id) }),
+]);
+export type FinancialCommand = z.infer<typeof FinancialCommandSchema>;
+export const TransactionQuoteSchema = z.object({ fingerprint: z.string().min(1), actual: SignedMoneySchema,
+  reserved: MoneySchema, available: SignedMoneySchema, releases: z.array(ReleaseLineSchema) });
+export type TransactionQuote = z.infer<typeof TransactionQuoteSchema>;
+export const FinancialResultSchema = z.object({ operationId: id, transactionIds: z.array(id), replayed: z.boolean() });
+export type FinancialResult = z.infer<typeof FinancialResultSchema>;
+export const WalletFundsSchema = z.object({ accountId: id, actual: SignedMoneySchema, reserved: MoneySchema, available: SignedMoneySchema });
+export type WalletFunds = z.infer<typeof WalletFundsSchema>;
+export const GoalTotalsSchema = z.object({ goalId: id, reserved: MoneySchema, spent: MoneySchema,
+  progressAmount: MoneySchema, remaining: MoneySchema, progressPercent: z.number().finite().min(0).max(100),
+  walletReservations: z.array(z.object({ accountId: id, amount: MoneySchema })), legacyTaggedAmount: MoneySchema.nullable() });
+export type GoalTotals = z.infer<typeof GoalTotalsSchema>;
+export type GoalFinanceGoal = Omit<Goal, "target_amount" | "current_amount" | "allocation_per_cycle"> &
+  { target_amount: Money; current_amount: Money; allocation_per_cycle: Money } & GoalTotals;
+export const GoalFinanceGoalSchema: z.ZodType<GoalFinanceGoal> = z.object({
+  id, user_id: id, name: z.string(), target_amount: PositiveMoneySchema, current_amount: MoneySchema,
+  target_date: date.nullable(), color: z.string().nullable(), icon: z.string().nullable(),
+  is_completed: z.boolean(), status: GoalStatusSchema, review_state: ReviewStateSchema,
+  completed_at: z.string().nullable(), archived_at: z.string().nullable(), is_priority: z.boolean(),
+  category: z.string(), allocation_per_cycle: MoneySchema, allocation_frequency: z.string().nullable(),
+  created_at: z.string(), updated_at: z.string(),
+}).merge(GoalTotalsSchema);
+export const GoalFinanceSnapshotSchema = z.object({ goals: z.array(GoalFinanceGoalSchema), wallets: z.array(WalletFundsSchema) });
+export type GoalFinanceSnapshot = z.infer<typeof GoalFinanceSnapshotSchema>;
+
+// Raw NUMERIC JSON numbers cannot preserve centavos; history must supply decimal text.
+export type AllocationEvent = Omit<GoalAllocationEvent, "reserved_delta" | "spent_delta"> & { reserved_delta: Money; spent_delta: Money };
+export const AllocationEventSchema: z.ZodType<AllocationEvent> = z.object({
+  id, user_id: id, goal_id: id, account_id: id, operation_id: id,
+  kind: z.enum(["reserve", "release", "spend", "move_in", "move_out", "legacy_spent", "reversal"]),
+  reserved_delta: SignedMoneySchema, spent_delta: SignedMoneySchema,
+  transaction_id: id.nullable(), reversal_of: id.nullable(), created_at: z.string(),
+}).refine(event => event.reserved_delta !== "0.00" || event.spent_delta !== "0.00", "An event must change an amount")
+  .refine(event => (event.kind === "reversal") === (event.reversal_of !== null), "Invalid reversal reference");
+
+export const FinancialErrorCodeSchema = z.enum(["INSUFFICIENT_ACTUAL", "INSUFFICIENT_AVAILABLE", "INSUFFICIENT_RESERVATION",
+  "STALE_QUOTE", "NEEDS_REVIEW", "INVALID_STATE", "REQUEST_CONFLICT", "NOT_ALLOWED"]);
+export type FinancialErrorCode = z.infer<typeof FinancialErrorCodeSchema>;
diff --git a/src/lib/goals/summary.ts b/src/lib/goals/summary.ts
new file mode 100644
index 0000000..083dc0f
--- /dev/null
+++ b/src/lib/goals/summary.ts
@@ -0,0 +1,92 @@
+import { AllocationEventSchema, MoneySchema, PositiveMoneySchema, SignedMoneySchema,
+  type AllocationEvent, type GoalTotals, type Money } from "./contracts";
+
+export function parseMoney(input: string): Money {
+  if (typeof input !== "string" || !/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("Enter a nonnegative decimal amount with at most two decimal places");
+  const [whole, fraction = ""] = input.split(".");
+  return MoneySchema.parse(`${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`);
+}
+
+export function toMinorUnits(amount: Money): number {
+  return Number(SignedMoneySchema.parse(amount).replace(".", ""));
+}
+
+export function fromMinorUnits(cents: number): Money {
+  if (!Number.isSafeInteger(cents)) throw new Error("Centavos must be a safe integer");
+  const digits = Math.abs(cents).toString().padStart(3, "0");
+  return `${cents < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
+}
+
+function addCentavos(left: number, right: number): number {
+  const sum = left + right;
+  if (!Number.isSafeInteger(sum)) throw new Error("Total exceeds safe centavo range");
+  return sum;
+}
+
+export function splitInstallments(amount: Money, count: number): Money[] {
+  const total = toMinorUnits(MoneySchema.parse(amount));
+  if (!Number.isSafeInteger(count) || count <= 0 || count > 0xffffffff) throw new Error("Installment count must be a positive array length");
+  if (total < count) throw new Error("Each installment must contain at least one centavo");
+  const divisor = BigInt(count);
+  const base = Number(BigInt(total) / divisor);
+  const remainder = Number(BigInt(total) % divisor);
+  return Array.from({ length: count }, (_, index) => fromMinorUnits(base + (index < remainder ? 1 : 0)));
+}
+
+export function summarizeGoal(goalId: string, target: Money, events: AllocationEvent[]): GoalTotals {
+  const targetCentavos = toMinorUnits(PositiveMoneySchema.parse(target));
+  let reserved = 0;
+  let spent = 0;
+  const wallets = new Map<string, number>();
+  for (const input of events) {
+    const event = AllocationEventSchema.parse(input);
+    if (event.goal_id !== goalId) continue;
+    const reservedDelta = toMinorUnits(event.reserved_delta);
+    reserved = addCentavos(reserved, reservedDelta);
+    spent = addCentavos(spent, toMinorUnits(event.spent_delta));
+    wallets.set(event.account_id, addCentavos(wallets.get(event.account_id) ?? 0, reservedDelta));
+  }
+  if (reserved < 0 || spent < 0 || Array.from(wallets.values()).some(amount => amount < 0)) throw new Error("Allocation totals cannot be negative");
+  const progress = addCentavos(reserved, spent);
+  return { goalId, reserved: fromMinorUnits(reserved), spent: fromMinorUnits(spent), progressAmount: fromMinorUnits(progress),
+    remaining: fromMinorUnits(Math.max(0, targetCentavos - progress)), progressPercent: Math.min(100, progress / targetCentavos * 100),
+    walletReservations: Array.from(wallets.entries()).filter(([, amount]) => amount > 0)
+      .sort(([left], [right]) => left.localeCompare(right)).map(([accountId, amount]) => ({ accountId, amount: fromMinorUnits(amount) })),
+    legacyTaggedAmount: null };
+}
+
+export interface GoalProjectionInput {
+  target: Money;
+  progressAmount: Money;
+  allocationPerCycle: Money;
+  allocationFrequency: string | null;
+}
+
+export interface ProjectionResult {
+  count: number;
+  unit: "month" | "months" | "payday" | "paydays";
+  projectedDate: string | null;
+  monthlyAmount: number;
+  kinsenasAmount: number;
+}
+
+export function projectGoal(input: GoalProjectionInput, now: Date): ProjectionResult {
+  const target = toMinorUnits(PositiveMoneySchema.parse(input.target));
+  const progress = toMinorUnits(MoneySchema.parse(input.progressAmount));
+  const allocation = toMinorUnits(MoneySchema.parse(input.allocationPerCycle));
+  const isKinsenas = input.allocationFrequency === "kinsenas";
+  const displayAllocation = allocation / 100;
+  const result: ProjectionResult = { count: 0, unit: isKinsenas ? "paydays" : "months", projectedDate: null,
+    monthlyAmount: isKinsenas ? displayAllocation * 2 : displayAllocation,
+    kinsenasAmount: isKinsenas ? displayAllocation : displayAllocation / 2 };
+  if (allocation === 0 || progress >= target) return result;
+  const remaining = BigInt(target - progress);
+  const cycle = BigInt(allocation);
+  const count = Number(remaining / cycle + (remaining % cycle === BigInt(0) ? BigInt(0) : BigInt(1)));
+  const projected = new Date(now.getTime());
+  if (isKinsenas) projected.setDate(projected.getDate() + count * 15);
+  else projected.setMonth(projected.getMonth() + count);
+  const isoDate = Number.isFinite(projected.getTime()) ? projected.toISOString().slice(0, 10) : null;
+  return { ...result, count, unit: isKinsenas ? (count === 1 ? "payday" : "paydays") : (count === 1 ? "month" : "months"),
+    projectedDate: isoDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : null };
+}
diff --git a/tests/goal-summary.test.ts b/tests/goal-summary.test.ts
new file mode 100644
index 0000000..05da1ed
--- /dev/null
+++ b/tests/goal-summary.test.ts
@@ -0,0 +1,164 @@
+import { describe, expect, test, vi } from "vitest";
+import {
+  AllocationEventSchema, FinancialCommandSchema, GoalFinanceSnapshotSchema,
+  MoneySchema, TransactionDraftSchema,
+  type AllocationEvent,
+} from "@/lib/goals/contracts";
+import { fromMinorUnits, parseMoney, projectGoal, splitInstallments, summarizeGoal, toMinorUnits } from "@/lib/goals/summary";
+import { getProjection, type GoalWithProgress } from "@/hooks/use-goals";
+
+vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
+
+const goalId = "10000000-0000-4000-8000-000000000001";
+const accountId = "20000000-0000-4000-8000-000000000001";
+const otherAccountId = "20000000-0000-4000-8000-000000000002";
+const operationId = "30000000-0000-4000-8000-000000000001";
+function event(reserved_delta: string, spent_delta = "0.00", overrides: Partial<AllocationEvent> = {}): AllocationEvent {
+  return { id: "40000000-0000-4000-8000-000000000001", user_id: goalId, goal_id: goalId,
+    account_id: accountId, operation_id: operationId, kind: "reserve", reserved_delta, spent_delta,
+    transaction_id: null, reversal_of: null, created_at: "2026-10-06T00:00:00Z", ...overrides };
+}
+
+describe("exact PHP money", () => {
+  test("normalizes entry amounts and adds centavos exactly", () => {
+    expect(parseMoney("0005.1")).toBe("5.10");
+    expect(parseMoney("0")).toBe("0.00");
+    expect(fromMinorUnits(toMinorUnits(parseMoney("0.10")) + toMinorUnits(parseMoney("0.20")))).toBe("0.30");
+  });
+  test.each(["-1", "-0.00", "NaN", "Infinity", "1e3", "1.001", "90071992547409.92", "", " 1.00", "+1", ".5", "1."])("rejects invalid entry %s", input => {
+    expect(() => parseMoney(input)).toThrow();
+  });
+  test("serializes safe integer boundaries without rounding", () => {
+    expect(toMinorUnits("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
+    expect(fromMinorUnits(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
+    expect(fromMinorUnits(-Number.MAX_SAFE_INTEGER)).toBe("-90071992547409.91");
+    expect(toMinorUnits("-0.01")).toBe(-1);
+    for (const cents of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => fromMinorUnits(cents)).toThrow();
+    for (const value of ["1", "01.00", "1.0", "-0.00", "1e2", "90071992547409.92"]) expect(() => toMinorUnits(value)).toThrow();
+    expect(() => parseMoney(0.1 as unknown as string)).toThrow();
+  });
+  test("splits installments with the remainder in the earliest rows", () => {
+    expect(splitInstallments("100.00", 3)).toEqual(["33.34", "33.33", "33.33"]);
+    expect(splitInstallments("0.03", 3)).toEqual(["0.01", "0.01", "0.01"]);
+    expect(splitInstallments("90071992547409.91", 3).reduce((sum, part) => sum + toMinorUnits(part), 0)).toBe(Number.MAX_SAFE_INTEGER);
+    for (const count of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => splitInstallments("100.00", count)).toThrow();
+    expect(() => splitInstallments("-1.00", 2)).toThrow();
+  });
+  test("rejects splits that would create zero-value transaction rows", () => {
+    expect(() => splitInstallments("0.01", 3)).toThrow(/centavo|installment/i);
+    expect(() => splitInstallments("0.00", 1)).toThrow();
+  });
+});
+
+describe("allocation event progress", () => {
+  test("reserving the target funds a goal without spending", () => {
+    expect(summarizeGoal(goalId, "5000.00", [event("5000.00")])).toMatchObject({ reserved: "5000.00", spent: "0.00", remaining: "0.00", progressPercent: 100 });
+  });
+  test("goal spending preserves combined progress", () => {
+    const totals = summarizeGoal(goalId, "3000.00", [event("3000.00"), event("-2000.00", "2000.00", { kind: "spend" })]);
+    expect(totals).toMatchObject({ reserved: "1000.00", spent: "2000.00", progressAmount: "3000.00", progressPercent: 100 });
+  });
+  test("releasing reservations lowers progress without recording spending", () => {
+    expect(summarizeGoal(goalId, "30000.00", [event("27000.00"), event("-15000.00", "0.00", { kind: "release" })])).toMatchObject({ reserved: "12000.00", spent: "0.00", progressPercent: 40 });
+  });
+  test("paired wallet moves preserve goal totals", () => {
+    const totals = summarizeGoal(goalId, "5000.00", [event("5000.00"), event("-1000.00", "0.00", { kind: "move_out" }), event("1000.00", "0.00", { kind: "move_in", account_id: otherAccountId })]);
+    expect(totals).toMatchObject({ reserved: "5000.00", progressAmount: "5000.00", walletReservations: [{ accountId, amount: "4000.00" }, { accountId: otherAccountId, amount: "1000.00" }] });
+  });
+  test("paired goal moves preserve total reservations across goals", () => {
+    const secondGoalId = otherAccountId;
+    const events = [event("5000.00"), event("-1000.00", "0.00", { kind: "move_out" }), event("1000.00", "0.00", { kind: "move_in", goal_id: secondGoalId })];
+    expect(summarizeGoal(goalId, "5000.00", events).reserved).toBe("4000.00");
+    expect(summarizeGoal(secondGoalId, "5000.00", events).reserved).toBe("1000.00");
+  });
+  test("reversals restore reservation and spending amounts", () => {
+    const spend = event("-2000.00", "2000.00", { kind: "spend" });
+    const totals = summarizeGoal(goalId, "3000.00", [event("3000.00"), spend, event("2000.00", "-2000.00", { kind: "reversal", reversal_of: spend.id })]);
+    expect(totals).toMatchObject({ reserved: "3000.00", spent: "0.00", progressAmount: "3000.00" });
+  });
+  test("never infers reservations or spending from legacy tags", () => {
+    expect(summarizeGoal(goalId, "5000.00", [])).toEqual({ goalId, reserved: "0.00", spent: "0.00", progressAmount: "0.00", remaining: "5000.00", progressPercent: 0, walletReservations: [], legacyTaggedAmount: null });
+    expect(() => summarizeGoal(goalId, "5000.00", [{ goal_id: goalId, type: "expense", amount: "5000.00" }] as unknown as AllocationEvent[])).toThrow();
+    expect(summarizeGoal(goalId, "5000.00", [event("0.00", "1000.00", { kind: "legacy_spent" })]).spent).toBe("1000.00");
+  });
+  test("keeps true amounts while clamping the display percentage", () => {
+    expect(summarizeGoal(goalId, "5000.00", [event("6000.00")])).toMatchObject({ reserved: "6000.00", progressAmount: "6000.00", remaining: "0.00", progressPercent: 100 });
+  });
+  test("requires positive targets and rejects invalid deltas and totals", () => {
+    for (const target of ["0.00", "-1.00", "NaN", "1.001"]) expect(() => summarizeGoal(goalId, target, [])).toThrow();
+    for (const delta of ["NaN", "Infinity", "1e3", "1.001", "1.0"]) expect(() => summarizeGoal(goalId, "5000.00", [event(delta)])).toThrow();
+    expect(() => summarizeGoal(goalId, "5000.00", [event(1 as unknown as string)])).toThrow();
+    expect(() => summarizeGoal(goalId, "5000.00", [event("90071992547409.91"), event("0.01")])).toThrow();
+    expect(() => summarizeGoal(goalId, "5000.00", [event("-1.00", "0.00", { kind: "release" })])).toThrow();
+    expect(() => summarizeGoal(goalId, "5000.00", [event("1.00"), event("-2.00", "0.00", { kind: "move_out", account_id: otherAccountId })])).toThrow();
+  });
+});
+
+describe("pure cadence projection", () => {
+  const now = new Date("2026-01-10T00:00:00Z");
+  const input = { target: "5000.00", progressAmount: "500.00", allocationPerCycle: "1000.00", allocationFrequency: "monthly" };
+  test("monthly cadence uses remaining combined progress", () => {
+    expect(projectGoal(input, now)).toEqual({ count: 5, unit: "months", projectedDate: "2026-06-10", monthlyAmount: 1000, kinsenasAmount: 500 });
+    expect(now.toISOString()).toBe("2026-01-10T00:00:00.000Z");
+  });
+  test("kinsenas cadence uses nine half-month cycles", () => {
+    expect(projectGoal({ ...input, allocationPerCycle: "500.00", allocationFrequency: "kinsenas" }, now)).toEqual({ count: 9, unit: "paydays", projectedDate: "2026-05-25", monthlyAmount: 1000, kinsenasAmount: 500 });
+  });
+  test("zero cadence or a funded goal gives no estimate", () => {
+    expect(projectGoal({ ...input, allocationPerCycle: "0.00" }, now)).toMatchObject({ count: 0, unit: "months", projectedDate: null });
+    expect(projectGoal({ ...input, progressAmount: "6000.00" }, now)).toMatchObject({ count: 0, projectedDate: null });
+  });
+  test("keeps singular labels and existing half-cycle display conversion", () => {
+    expect(projectGoal({ ...input, progressAmount: "4000.00" }, now)).toMatchObject({ count: 1, unit: "month" });
+    expect(projectGoal({ ...input, progressAmount: "4500.00", allocationFrequency: "kinsenas" }, now)).toMatchObject({ count: 1, unit: "payday" });
+    expect(projectGoal({ ...input, allocationPerCycle: "0.01", progressAmount: "4999.99" }, now).kinsenasAmount).toBe(0.005);
+  });
+  test("keeps cycle counts when projected dates exceed the calendar range", () => {
+    for (const allocationFrequency of ["monthly", "kinsenas"]) {
+      expect(projectGoal({ ...input, target: "90071992547409.91", progressAmount: "0.00", allocationPerCycle: "0.01", allocationFrequency }, now)).toMatchObject({ count: Number.MAX_SAFE_INTEGER, projectedDate: null });
+      expect(projectGoal({ ...input, allocationFrequency, target: "10000.00", progressAmount: "0.00", allocationPerCycle: "1.00" }, new Date("9999-12-01T00:00:00Z"))).toMatchObject({ count: 10000, projectedDate: null });
+    }
+  });
+  test("legacy projection callers delegate while tolerating their floating contribution totals", () => {
+    vi.useFakeTimers();
+    vi.setSystemTime(now);
+    try {
+      const legacy = { target_amount: 1, saved: 0.1 + 0.2, allocation_per_cycle: 0.1, allocation_frequency: "monthly" } as GoalWithProgress;
+      expect(getProjection(legacy)).toMatchObject({ count: 7, monthlyAmount: 0.1, kinsenasAmount: 0.05 });
+      expect(getProjection({ ...legacy, target_amount: 0 })).toMatchObject({ count: 0, projectedDate: null });
+      expect(getProjection({ ...legacy, allocation_per_cycle: 0 })).toMatchObject({ count: 0, projectedDate: null });
+      expect(getProjection({ ...legacy, target_amount: 90071992547400, saved: 0, allocation_per_cycle: 0.01 })).toMatchObject({ count: 9007199254740000, projectedDate: null });
+    } finally { vi.useRealTimers(); }
+  });
+});
+
+describe("domain JSON parsing", () => {
+  const draft = { type: "expense", accountId, transferToAccountId: null, categoryId: null, goalId: null, amount: "100.00", description: null, date: "2026-10-06", installments: null, reservationMoves: [] };
+  test("money JSON must already be canonical decimal text", () => {
+    expect(MoneySchema.parse("100.00")).toBe("100.00");
+    for (const amount of [100, "100", "100.0", "-1.00", "01.00", "90071992547409.92"]) expect(MoneySchema.safeParse(amount).success).toBe(false);
+    expect(AllocationEventSchema.parse(event("-1.00", "1.00", { kind: "spend" }))).toEqual(event("-1.00", "1.00", { kind: "spend" }));
+    expect(AllocationEventSchema.safeParse(event(1 as unknown as string)).success).toBe(false);
+  });
+  test("parses the command union and rejects invalid entry amounts", () => {
+    expect(FinancialCommandSchema.parse({ kind: "transaction", draft })).toEqual({ kind: "transaction", draft });
+    const commands = [
+      { kind: "reserve", goalId, accountId, amount: "1.00" }, { kind: "release", goalId, accountId, amount: "1.00" },
+      { kind: "reallocate", goalId, destinationGoalId: otherAccountId, accountId, amount: "1.00" },
+      { kind: "close", goalId, status: "completed", leftovers: { mode: "release" } },
+      { kind: "reopen", goalId }, { kind: "archive", goalId }, { kind: "delete_transaction", transactionId: goalId },
+      { kind: "adopt_legacy", goalId, status: "active", reservations: [{ accountId, amount: "1.00" }], spentTransactionIds: [goalId] },
+    ];
+    for (const command of commands) expect(FinancialCommandSchema.parse(command)).toEqual(command);
+    for (const amount of ["-1.00", "0.00", "1e2", 100]) expect(TransactionDraftSchema.safeParse({ ...draft, amount }).success).toBe(false);
+    expect(TransactionDraftSchema.safeParse({ ...draft, date: "2026-02-30" }).success).toBe(false);
+    expect(TransactionDraftSchema.safeParse({ ...draft, installments: { count: 1.5 } }).success).toBe(false);
+  });
+  test("snapshot goal row monetary fields override raw numeric rows", () => {
+    const goal = { id: goalId, user_id: goalId, name: "Date", target_amount: "3000.00", current_amount: "1000.00", target_date: null, color: null, icon: null, is_completed: false, status: "active", review_state: "confirmed", completed_at: null, archived_at: null, is_priority: false, category: "savings", allocation_per_cycle: "500.00", allocation_frequency: "monthly", created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", ...summarizeGoal(goalId, "3000.00", [event("1000.00")]) };
+    const snapshot = { goals: [goal], wallets: [{ accountId, actual: "5000.00", reserved: "1000.00", available: "4000.00" }] };
+    expect(GoalFinanceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
+    for (const field of ["target_amount", "current_amount", "allocation_per_cycle"]) expect(GoalFinanceSnapshotSchema.safeParse({ ...snapshot, goals: [{ ...goal, [field]: 1000 }] }).success).toBe(false);
+    expect(GoalFinanceSnapshotSchema.safeParse({ ...snapshot, goals: [{ ...goal, target_amount: "0.00" }] }).success).toBe(false);
+  });
+});
diff --git a/tests/navigation-goals.test.cjs b/tests/navigation-goals.test.cjs
index 74d5a9c..7dedfe0 100644
--- a/tests/navigation-goals.test.cjs
+++ b/tests/navigation-goals.test.cjs
@@ -1,31 +1,36 @@
 const { test } = require('node:test');
 const assert = require('node:assert/strict');
 const fs = require('node:fs');
+const path = require('node:path');
 const ts = require('typescript');
-function load(path) {
+function load(pathname) {
   const module = { exports: {} };
-  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
-  new Function('module', 'exports', 'require', code)(module, module.exports, require);
+  const code = ts.transpileModule(fs.readFileSync(pathname, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
+  const localRequire = name => name.startsWith('.') ? load(path.resolve(path.dirname(pathname), name) + '.ts') : require(name);
+  new Function('module', 'exports', 'require', code)(module, module.exports, localRequire);
   return module.exports;
 }
 test('navigation ignores same route, fragments, external links and modified clicks', () => {
   const { navigationDestination } = load('src/lib/navigation.ts');
   const current = 'https://app.test/dashboard';
   assert.equal(navigationDestination('/accounts', current, {}), '/accounts');
   for (const href of ['/dashboard', '#summary', 'https://other.test/accounts', 'mailto:a@test.com']) {
     assert.equal(navigationDestination(href, current, {}), null);
   }
   for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }, { target: '_blank' }, { download: true }]) {
     assert.equal(navigationDestination('/accounts', current, event), null);
   }
 });
-test('only expense and transfer contributions affect a goal, with exact saved progress', () => {
-  const { contributionGoalId, goalFunding } = load('src/lib/goal-funding.ts');
-  assert.equal(contributionGoalId('income', 'phone'), null);
-  assert.equal(contributionGoalId('expense', ''), null);
-  assert.equal(contributionGoalId('transfer', 'phone'), 'phone');
-  const tx = [{ goal_id: 'phone', type: 'expense', amount: 200 }, { goal_id: 'phone', type: 'transfer', amount: 300 }, { goal_id: 'phone', type: 'income', amount: 900 }, { goal_id: 'other', type: 'expense', amount: 500 }];
-  assert.deepEqual(goalFunding('phone', 5000, tx), { saved: 500, progressPercent: 10 });
-  assert.deepEqual(goalFunding('empty', 0, tx), { saved: 0, progressPercent: 0 });
-  assert.deepEqual(goalFunding('phone', 5000, [1,2,3].map(() => ({ goal_id: 'phone', type: 'expense', amount: 100 }))), { saved: 300, progressPercent: 6 });
+test('allocation events preserve combined progress and never infer legacy funding', () => {
+  const { summarizeGoal } = load('src/lib/goals/summary.ts');
+  const goalId = '10000000-0000-4000-8000-000000000001';
+  const accountId = '20000000-0000-4000-8000-000000000001';
+  const base = { id: goalId, user_id: goalId, goal_id: goalId, account_id: accountId, operation_id: goalId, transaction_id: null, reversal_of: null, created_at: '2026-10-06T00:00:00Z' };
+  const events = [
+    { ...base, kind: 'reserve', reserved_delta: '3000.00', spent_delta: '0.00' },
+    { ...base, kind: 'spend', reserved_delta: '-2000.00', spent_delta: '2000.00' },
+  ];
+  assert.deepEqual(summarizeGoal(goalId, '3000.00', events), { goalId, reserved: '1000.00', spent: '2000.00', progressAmount: '3000.00', remaining: '0.00', progressPercent: 100, walletReservations: [{ accountId, amount: '1000.00' }], legacyTaggedAmount: null });
+  assert.equal(summarizeGoal(goalId, '5000.00', []).progressAmount, '0.00');
+  assert.throws(() => summarizeGoal(goalId, '5000.00', [{ goal_id: goalId, type: 'expense', amount: 5000 }]));
 });
diff --git a/vitest.config.ts b/vitest.config.ts
index e86ede2..c98dab4 100644
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -1,8 +1,8 @@
 import { defineConfig } from "vitest/config";
 import path from "node:path";
 
 export default defineConfig({
   resolve: { alias: { "@": path.resolve(__dirname, "src") } },
   esbuild: { jsx: "automatic" },
-  test: { environment: "jsdom", include: ["tests/**/*.test.tsx"], testTimeout: 10000 },
+  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"], testTimeout: 10000 },
 });
