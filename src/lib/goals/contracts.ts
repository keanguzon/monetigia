import { z } from "zod";
import type { Goal, GoalAllocationEvent } from "@/types/database";

export type Money = string;
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
export const ReservationMoveSchema = z.object({ goalId: id, amount: PositiveMoneySchema });
export const LeftoverChoiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("release") }),
  z.object({ mode: z.literal("move"), goalId: id }),
]);
export type ReleaseLine = z.infer<typeof ReleaseLineSchema>;
export type ReservationMove = z.infer<typeof ReservationMoveSchema>;
export type LeftoverChoice = z.infer<typeof LeftoverChoiceSchema>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
export const TransactionDraftSchema = z.object({
  type: z.enum(["income", "expense", "transfer"]), accountId: id,
  transferToAccountId: id.nullable(), categoryId: id.nullable(), goalId: id.nullable(),
  amount: PositiveMoneySchema, description: z.string().nullable(), date,
  installments: z.object({ count: z.number().int().positive().safe() }).nullable(),
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
  z.object({ kind: z.literal("adopt_legacy"), goalId: id, status: GoalStatusSchema,
    reservations: z.array(z.object({ accountId: id, amount: PositiveMoneySchema })), spentTransactionIds: z.array(id) }),
]);
export type FinancialCommand = z.infer<typeof FinancialCommandSchema>;
export const TransactionQuoteSchema = z.object({ fingerprint: z.string().min(1), actual: SignedMoneySchema,
  reserved: MoneySchema, available: SignedMoneySchema, releases: z.array(ReleaseLineSchema) });
export type TransactionQuote = z.infer<typeof TransactionQuoteSchema>;
export const FinancialResultSchema = z.object({ operationId: id, transactionIds: z.array(id), replayed: z.boolean() });
export type FinancialResult = z.infer<typeof FinancialResultSchema>;
export const WalletFundsSchema = z.object({ accountId: id, actual: SignedMoneySchema, reserved: MoneySchema, available: SignedMoneySchema });
export type WalletFunds = z.infer<typeof WalletFundsSchema>;
export const GoalTotalsSchema = z.object({ goalId: id, reserved: MoneySchema, spent: MoneySchema,
  progressAmount: MoneySchema, remaining: MoneySchema, progressPercent: z.number().finite().min(0).max(100),
  walletReservations: z.array(z.object({ accountId: id, amount: MoneySchema })), legacyTaggedAmount: MoneySchema.nullable() });
export type GoalTotals = z.infer<typeof GoalTotalsSchema>;
export type GoalFinanceGoal = Omit<Goal, "target_amount" | "current_amount" | "allocation_per_cycle"> &
  { target_amount: Money; current_amount: Money; allocation_per_cycle: Money } & GoalTotals;
export const GoalFinanceGoalSchema: z.ZodType<GoalFinanceGoal> = z.object({
  id, user_id: id, name: z.string(), target_amount: PositiveMoneySchema, current_amount: MoneySchema,
  target_date: date.nullable(), color: z.string().nullable(), icon: z.string().nullable(),
  is_completed: z.boolean(), status: GoalStatusSchema, review_state: ReviewStateSchema,
  completed_at: z.string().nullable(), archived_at: z.string().nullable(), is_priority: z.boolean(),
  category: z.string(), allocation_per_cycle: MoneySchema, allocation_frequency: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
}).merge(GoalTotalsSchema);
export const GoalFinanceSnapshotSchema = z.object({ goals: z.array(GoalFinanceGoalSchema), wallets: z.array(WalletFundsSchema) });
export type GoalFinanceSnapshot = z.infer<typeof GoalFinanceSnapshotSchema>;

// Raw NUMERIC JSON numbers cannot preserve centavos; history must supply decimal text.
export type AllocationEvent = Omit<GoalAllocationEvent, "reserved_delta" | "spent_delta"> & { reserved_delta: Money; spent_delta: Money };
export const AllocationEventSchema: z.ZodType<AllocationEvent> = z.object({
  id, user_id: id, goal_id: id, account_id: id, operation_id: id,
  kind: z.enum(["reserve", "release", "spend", "move_in", "move_out", "legacy_spent", "reversal"]),
  reserved_delta: SignedMoneySchema, spent_delta: SignedMoneySchema,
  transaction_id: id.nullable(), reversal_of: id.nullable(), created_at: z.string(),
}).refine(event => event.reserved_delta !== "0.00" || event.spent_delta !== "0.00", "An event must change an amount")
  .refine(event => (event.kind === "reversal") === (event.reversal_of !== null), "Invalid reversal reference");

export const FinancialErrorCodeSchema = z.enum(["INSUFFICIENT_ACTUAL", "INSUFFICIENT_AVAILABLE", "INSUFFICIENT_RESERVATION",
  "STALE_QUOTE", "NEEDS_REVIEW", "INVALID_STATE", "REQUEST_CONFLICT", "NOT_ALLOWED"]);
export type FinancialErrorCode = z.infer<typeof FinancialErrorCodeSchema>;
