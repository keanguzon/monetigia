import { MoneySchema, type Money } from "@/lib/goals/contracts";
import { splitInstallments, toMinorUnits } from "@/lib/goals/summary";
import { getInstallmentScheduleDates } from "@/lib/transactions/installment-dates";
import { MAX_REMAINING_MONTHS, RemainingMonthsSchema } from "./contracts";

export function parseRemainingMonths(value: string): number | null {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_REMAINING_MONTHS ? count : null;
}

export function buildDebtSchedule(
  amount: Money,
  firstDueDate: string,
  count: number,
): Array<{ ordinal: number; dueDate: string; amount: Money }> {
  const validatedAmount = MoneySchema.parse(amount);
  const validatedCount = RemainingMonthsSchema.parse(count);
  const totalCentavos = toMinorUnits(validatedAmount);
  if (totalCentavos <= 0) throw new Error("Debt amount must be positive");
  if (totalCentavos < validatedCount) throw new Error("Each installment must contain at least one centavo");

  const amounts = splitInstallments(validatedAmount, validatedCount, {
    maxCount: MAX_REMAINING_MONTHS,
    remainderPlacement: "last",
  });
  const dueDates = getInstallmentScheduleDates(firstDueDate, validatedCount, MAX_REMAINING_MONTHS);
  return amounts.map((installmentAmount, index) => ({
    ordinal: index + 1,
    dueDate: dueDates[index],
    amount: installmentAmount,
  }));
}
