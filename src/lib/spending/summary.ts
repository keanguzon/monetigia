import { z } from "zod";
import { MoneySchema, SignedMoneySchema } from "@/lib/money/contracts";
import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";
import { createClient } from "@/lib/supabase/client";
import type { ComparisonRange } from "./periods";

const money = MoneySchema.transform(value => fromMinorUnits(toMinorUnits(value)));
const summarySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spent: money, expenses: money, debtPayments: money, income: money,
  net: SignedMoneySchema.transform(value => fromMinorUnits(toMinorUnits(value))),
  categories: z.array(z.object({ categoryId: z.string().uuid().nullable(), name: z.string(), amount: money })),
  transactionCount: z.number().int().nonnegative().safe(),
});
export type SpendingSummary = z.infer<typeof summarySchema>;

export class SpendingSummaryError extends Error {
  constructor(cause?: unknown) {
    super("The spending summary response could not be read.", { cause });
    this.name = "SpendingSummaryError";
  }
}

export function parseSpendingSummary(value: unknown): SpendingSummary {
  const result = summarySchema.safeParse(value);
  if (!result.success) throw new SpendingSummaryError(result.error);
  return result.data;
}

export async function fetchSpendingSummary(range: ComparisonRange, accessToken: string): Promise<SpendingSummary> {
  const { data, error } = await createClient().rpc("spending_summary", { p_start: range.start, p_end: range.end })
    .setHeader("Authorization", `Bearer ${accessToken}`);
  if (error) throw error;
  const summary = parseSpendingSummary(data);
  if (summary.start !== range.start || summary.end !== range.end) throw new SpendingSummaryError();
  return summary;
}
