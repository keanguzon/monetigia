3afa4a6 fix: cap goal transaction installments
 src/lib/goals/contracts.ts |  3 ++-
 src/lib/goals/summary.ts   |  6 ++++--
 tests/goal-summary.test.ts | 29 ++++++++++++++++++++++++++++-
 3 files changed, 34 insertions(+), 4 deletions(-)
diff --git a/src/lib/goals/contracts.ts b/src/lib/goals/contracts.ts
index 483f84e..56ce121 100644
--- a/src/lib/goals/contracts.ts
+++ b/src/lib/goals/contracts.ts
@@ -1,14 +1,15 @@
 import { z } from "zod";
 import type { Goal, GoalAllocationEvent } from "@/types/database";
 
 export type Money = string;
+export const MAX_INSTALLMENTS = 12;
 const id = z.string().uuid();
 const safeCentavos = (amount: string) => Number.isSafeInteger(Number(amount.replace(".", "")));
 export const MoneySchema = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/).refine(safeCentavos, "Amount exceeds safe centavo range");
 export const SignedMoneySchema = z.string().regex(/^-?(0|[1-9]\d*)\.\d{2}$/).refine(amount => amount !== "-0.00" && safeCentavos(amount), "Invalid signed amount or unsafe centavo range");
 export const PositiveMoneySchema = MoneySchema.refine(amount => amount !== "0.00", "Amount must be positive");
 export const GoalStatusSchema = z.enum(["active", "completed", "cancelled"]);
 export const ReviewStateSchema = z.enum(["needs_review", "confirmed"]);
 export type GoalStatus = z.infer<typeof GoalStatusSchema>;
 export type ReviewState = z.infer<typeof ReviewStateSchema>;
 export const ReleaseLineSchema = z.object({ goalId: id, accountId: id, amount: PositiveMoneySchema });
@@ -22,21 +23,21 @@ export type ReservationMove = z.infer<typeof ReservationMoveSchema>;
 export type LeftoverChoice = z.infer<typeof LeftoverChoiceSchema>;
 
 const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
   const parsed = new Date(`${value}T00:00:00Z`);
   return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
 }, "Invalid calendar date");
 export const TransactionDraftSchema = z.object({
   type: z.enum(["income", "expense", "transfer"]), accountId: id,
   transferToAccountId: id.nullable(), categoryId: id.nullable(), goalId: id.nullable(),
   amount: PositiveMoneySchema, description: z.string().nullable(), date,
-  installments: z.object({ count: z.number().int().positive().safe() }).nullable(),
+  installments: z.object({ count: z.number().int().positive().safe().max(MAX_INSTALLMENTS) }).nullable(),
   reservationMoves: z.array(ReservationMoveSchema),
 });
 export type TransactionDraft = z.infer<typeof TransactionDraftSchema>;
 export const FinancialCommandSchema = z.discriminatedUnion("kind", [
   z.object({ kind: z.enum(["reserve", "release"]), goalId: id, accountId: id, amount: PositiveMoneySchema }),
   z.object({ kind: z.literal("reallocate"), goalId: id, destinationGoalId: id, accountId: id, amount: PositiveMoneySchema }),
   z.object({ kind: z.literal("close"), goalId: id, status: z.enum(["completed", "cancelled"]), leftovers: LeftoverChoiceSchema.nullable() }),
   z.object({ kind: z.enum(["reopen", "archive"]), goalId: id }),
   z.object({ kind: z.literal("transaction"), draft: TransactionDraftSchema }),
   z.object({ kind: z.literal("delete_transaction"), transactionId: id }),
diff --git a/src/lib/goals/summary.ts b/src/lib/goals/summary.ts
index 083dc0f..29fe3dc 100644
--- a/src/lib/goals/summary.ts
+++ b/src/lib/goals/summary.ts
@@ -1,12 +1,12 @@
 import { AllocationEventSchema, MoneySchema, PositiveMoneySchema, SignedMoneySchema,
-  type AllocationEvent, type GoalTotals, type Money } from "./contracts";
+  MAX_INSTALLMENTS, type AllocationEvent, type GoalTotals, type Money } from "./contracts";
 
 export function parseMoney(input: string): Money {
   if (typeof input !== "string" || !/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("Enter a nonnegative decimal amount with at most two decimal places");
   const [whole, fraction = ""] = input.split(".");
   return MoneySchema.parse(`${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`);
 }
 
 export function toMinorUnits(amount: Money): number {
   return Number(SignedMoneySchema.parse(amount).replace(".", ""));
 }
@@ -18,21 +18,23 @@ export function fromMinorUnits(cents: number): Money {
 }
 
 function addCentavos(left: number, right: number): number {
   const sum = left + right;
   if (!Number.isSafeInteger(sum)) throw new Error("Total exceeds safe centavo range");
   return sum;
 }
 
 export function splitInstallments(amount: Money, count: number): Money[] {
   const total = toMinorUnits(MoneySchema.parse(amount));
-  if (!Number.isSafeInteger(count) || count <= 0 || count > 0xffffffff) throw new Error("Installment count must be a positive array length");
+  if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_INSTALLMENTS) {
+    throw new Error(`Installment count must be between 1 and ${MAX_INSTALLMENTS}`);
+  }
   if (total < count) throw new Error("Each installment must contain at least one centavo");
   const divisor = BigInt(count);
   const base = Number(BigInt(total) / divisor);
   const remainder = Number(BigInt(total) % divisor);
   return Array.from({ length: count }, (_, index) => fromMinorUnits(base + (index < remainder ? 1 : 0)));
 }
 
 export function summarizeGoal(goalId: string, target: Money, events: AllocationEvent[]): GoalTotals {
   const targetCentavos = toMinorUnits(PositiveMoneySchema.parse(target));
   let reserved = 0;
diff --git a/tests/goal-summary.test.ts b/tests/goal-summary.test.ts
index 05da1ed..c03d073 100644
--- a/tests/goal-summary.test.ts
+++ b/tests/goal-summary.test.ts
@@ -1,13 +1,13 @@
 import { describe, expect, test, vi } from "vitest";
 import {
-  AllocationEventSchema, FinancialCommandSchema, GoalFinanceSnapshotSchema,
+  AllocationEventSchema, FinancialCommandSchema, GoalFinanceSnapshotSchema, MAX_INSTALLMENTS,
   MoneySchema, TransactionDraftSchema,
   type AllocationEvent,
 } from "@/lib/goals/contracts";
 import { fromMinorUnits, parseMoney, projectGoal, splitInstallments, summarizeGoal, toMinorUnits } from "@/lib/goals/summary";
 import { getProjection, type GoalWithProgress } from "@/hooks/use-goals";
 
 vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
 
 const goalId = "10000000-0000-4000-8000-000000000001";
 const accountId = "20000000-0000-4000-8000-000000000001";
@@ -37,20 +37,41 @@ describe("exact PHP money", () => {
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
+  test("caps installment splitting at the existing twelve choices", () => {
+    expect(MAX_INSTALLMENTS).toBe(12);
+    expect(splitInstallments("12.00", MAX_INSTALLMENTS)).toEqual(Array(MAX_INSTALLMENTS).fill("1.00"));
+    expect(() => splitInstallments("13.00", MAX_INSTALLMENTS + 1)).toThrow(/12/);
+  });
+  test("rejects oversized installment counts before allocating rows", () => {
+    const arrayFrom = vi.spyOn(Array, "from").mockImplementation(() => {
+      throw new Error("Array.from was reached");
+    });
+    let caught: unknown;
+    try {
+      splitInstallments("42949672.95", 0xffffffff);
+    } catch (error) {
+      caught = error;
+    } finally {
+      arrayFrom.mockRestore();
+    }
+    expect(arrayFrom).not.toHaveBeenCalled();
+    expect(caught).toBeInstanceOf(Error);
+    expect((caught as Error).message).toMatch(/12/);
+  });
   test("rejects splits that would create zero-value transaction rows", () => {
     expect(() => splitInstallments("0.01", 3)).toThrow(/centavo|installment/i);
     expect(() => splitInstallments("0.00", 1)).toThrow();
   });
 });
 
 describe("allocation event progress", () => {
   test("reserving the target funds a goal without spending", () => {
     expect(summarizeGoal(goalId, "5000.00", [event("5000.00")])).toMatchObject({ reserved: "5000.00", spent: "0.00", remaining: "0.00", progressPercent: 100 });
   });
@@ -147,18 +168,24 @@ describe("domain JSON parsing", () => {
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
+  test("limits transaction draft installments to the existing twelve choices", () => {
+    expect(TransactionDraftSchema.safeParse({ ...draft, installments: { count: MAX_INSTALLMENTS } }).success).toBe(true);
+    for (const count of [MAX_INSTALLMENTS + 1, 0xffffffff]) {
+      expect(TransactionDraftSchema.safeParse({ ...draft, installments: { count } }).success).toBe(false);
+    }
+  });
   test("snapshot goal row monetary fields override raw numeric rows", () => {
     const goal = { id: goalId, user_id: goalId, name: "Date", target_amount: "3000.00", current_amount: "1000.00", target_date: null, color: null, icon: null, is_completed: false, status: "active", review_state: "confirmed", completed_at: null, archived_at: null, is_priority: false, category: "savings", allocation_per_cycle: "500.00", allocation_frequency: "monthly", created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", ...summarizeGoal(goalId, "3000.00", [event("1000.00")]) };
     const snapshot = { goals: [goal], wallets: [{ accountId, actual: "5000.00", reserved: "1000.00", available: "4000.00" }] };
     expect(GoalFinanceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
     for (const field of ["target_amount", "current_amount", "allocation_per_cycle"]) expect(GoalFinanceSnapshotSchema.safeParse({ ...snapshot, goals: [{ ...goal, [field]: 1000 }] }).success).toBe(false);
     expect(GoalFinanceSnapshotSchema.safeParse({ ...snapshot, goals: [{ ...goal, target_amount: "0.00" }] }).success).toBe(false);
   });
 });
