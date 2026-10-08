import { z } from "zod";
import type { Money } from "@/lib/money/contracts";
import { MoneySchema, SignedMoneySchema } from "@/lib/money/contracts";

export const MAX_REMAINING_MONTHS = 600;

export type OpeningDebtDraft = {
  clientId: string;
  name: string;
  mode: "single" | "installments";
  amount: Money;
  firstDueDate: string;
  count: number;
};

export const RemainingMonthsSchema: z.ZodType<number> = z.number().int().positive().safe().max(MAX_REMAINING_MONTHS);

export const MAX_OPENING_DEBT_ITEMS = 100;
export const MAX_OPENING_DEBT_DUE_ROWS = 6000;
export const MAX_OPENING_DEBT_AMOUNT = "9999999999999.99";
const maxCentavos = BigInt(MAX_OPENING_DEBT_AMOUNT.replace(".", ""));
const name = z.string().trim().min(1).refine(value => Array.from(value).length <= 60, "Name cannot exceed 60 characters");
const openingMoney = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/).refine(value => {
  if (!/^(0|[1-9]\d*)\.\d{2}$/.test(value)) return false;
  const centavos = BigInt(value.replace(".", ""));
  return centavos > BigInt(0) && centavos <= maxCentavos;
}, "Amount must be positive and within the account storage range");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return value.slice(0, 4) !== "0000" && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");

export const OpeningDebtDraftSchema: z.ZodType<OpeningDebtDraft> = z.object({
  clientId: z.string().min(1).refine(value => Array.from(value).length <= 100, "Client ID cannot exceed 100 characters"),
  name, mode: z.enum(["single", "installments"]), amount: openingMoney,
  firstDueDate: date, count: RemainingMonthsSchema,
}).strict().superRefine((item, context) => {
  if (item.mode === "single" && item.count !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "Single debt requires one due row" });
  if (Number.isSafeInteger(item.count) && /^(0|[1-9]\d*)\.\d{2}$/.test(item.amount) && BigInt(item.amount.replace(".", "")) < BigInt(item.count)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Each due row must contain at least one centavo" });
  }
  const [year, month] = item.firstDueDate.split("-").map(Number);
  if ((year - 1) * 12 + month - 1 + item.count - 1 >= 9999 * 12) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["firstDueDate"], message: "Schedule exceeds the supported calendar range" });
  }
});

export type DebtAccountCreateInput = {
  requestId: string;
  account: {
    name: string; type: "credit_card"; currency: "PHP";
    color: string | null; icon: string | null;
    is_savings: false; interest_rate: 0;
    include_in_networth: boolean; display_order: number;
  };
  openingDebts: OpeningDebtDraft[];
};
export type DebtAccountCreateResult = { accountId: string; debtItemIds: string[]; replayed: boolean };

export const DebtAccountCreateInputSchema: z.ZodType<DebtAccountCreateInput> = z.object({
  requestId: z.string().uuid(),
  account: z.object({
    name, type: z.literal("credit_card"), currency: z.literal("PHP"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    icon: z.string().regex(/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif|svg)$/i).nullable(),
    is_savings: z.literal(false), interest_rate: z.literal(0),
    include_in_networth: z.boolean(), display_order: z.number().int().min(0).max(2147483647),
  }).strict(),
  openingDebts: z.array(OpeningDebtDraftSchema).max(MAX_OPENING_DEBT_ITEMS),
}).strict().superRefine((input, context) => {
  if (new Set(input.openingDebts.map(item => item.clientId)).size !== input.openingDebts.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["openingDebts"], message: "Client IDs must be unique within a request" });
  }
  if (input.openingDebts.reduce((count, item) => count + item.count, 0) > MAX_OPENING_DEBT_DUE_ROWS) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["openingDebts"], message: "A request cannot exceed 6000 due rows" });
  }
  const total = input.openingDebts.reduce((sum, item) => /^(0|[1-9]\d*)\.\d{2}$/.test(item.amount) ? sum + BigInt(item.amount.replace(".", "")) : sum, BigInt(0));
  if (total > maxCentavos) context.addIssue({ code: z.ZodIssueCode.custom, path: ["openingDebts"], message: "Total exceeds the account storage range" });
});
export const DebtAccountCreateResultSchema: z.ZodType<DebtAccountCreateResult> = z.object({
  accountId: z.string().uuid(), debtItemIds: z.array(z.string().uuid()), replayed: z.boolean(),
}).strict();

export type CorrectDebtRowsCommand = {
  kind: "correct_debt_rows";
  accountId: string;
  rowIds: string[];
  fingerprint: string;
};

export const CorrectDebtRowsCommandSchema = z.object({
  kind: z.literal("correct_debt_rows"),
  accountId: z.string().uuid(),
  rowIds: z.array(z.string().uuid()).min(1).max(600).refine(
    (ids) => new Set(ids.map(id => id.toLowerCase())).size === ids.length,
    "Row IDs must be unique"
  ),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type DebtDueRow = {
  id: string; accountId: string; groupId: string; source: "opening" | "purchase";
  transactionId: string | null; dueDate: string | null; originalAmount: Money;
  paidAmount: Money; remainingAmount: Money; correctedAmount: Money; ordinal: number; name: string;
};
export type DebtAccountSnapshot = {
  accountId: string; totalOutstanding: Money; undatedOutstanding: Money; fingerprint: string;
  reconciliation: "balanced" | "needs_review"; reconciliationDelta: Money;
};
export type DebtSnapshot = { accounts: DebtAccountSnapshot[]; rows: DebtDueRow[] };
export const DebtDueRowSchema: z.ZodType<DebtDueRow> = z.object({
  id: z.string().uuid(), accountId: z.string().uuid(), groupId: z.string().uuid(),
  source: z.enum(["opening", "purchase"]), transactionId: z.string().uuid().nullable(),
  dueDate: date.nullable(), originalAmount: MoneySchema, paidAmount: MoneySchema,
  remainingAmount: MoneySchema, correctedAmount: MoneySchema, ordinal: z.number().int().positive().safe(), name: z.string(),
}).strict().superRefine((row, context) => {
  if ((row.source === "opening") !== (row.transactionId === null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["transactionId"], message: "Transaction source mismatch" });
  const amounts = [row.originalAmount, row.paidAmount, row.correctedAmount, row.remainingAmount];
  if (amounts.every(value => /^(0|[1-9]\d*)\.\d{2}$/.test(value))) {
    const [original, paid, corrected, remaining] = amounts.map(value => BigInt(value.replace(".", "")));
    if (original - paid - corrected !== remaining) context.addIssue({ code: z.ZodIssueCode.custom, path: ["remainingAmount"], message: "Row amounts do not reconcile" });
  }
});
export const DebtSnapshotSchema: z.ZodType<DebtSnapshot> = z.object({
  accounts: z.array(z.object({ accountId: z.string().uuid(), totalOutstanding: MoneySchema, undatedOutstanding: MoneySchema,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/), reconciliation: z.enum(["balanced", "needs_review"]), reconciliationDelta: SignedMoneySchema }).strict()),
  rows: z.array(DebtDueRowSchema),
}).strict();
export type AdoptOpeningDebtCommand = { kind: "adopt_opening_debt"; accountId: string; items: OpeningDebtDraft[]; fingerprint: string };
export const AdoptOpeningDebtCommandSchema = z.object({
  kind: z.literal("adopt_opening_debt"), accountId: z.string().uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  items: z.array(OpeningDebtDraftSchema).min(1).max(MAX_OPENING_DEBT_ITEMS).superRefine((items, context) => {
    const validation = DebtAccountCreateInputSchema.safeParse({ requestId: "00000000-0000-4000-8000-000000000000",
      account: { name: "Validation", type: "credit_card", currency: "PHP", color: null, icon: null, is_savings: false, interest_rate: 0, include_in_networth: true, display_order: 0 }, openingDebts: items });
    if (!validation.success) for (const issue of validation.error.issues) context.addIssue({ ...issue, path: issue.path.slice(1) });
  }),
}).strict();
