import { z } from "zod";
import type { Money } from "@/lib/goals/contracts";

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
