import { AllocationEventSchema, MoneySchema, PositiveMoneySchema, SignedMoneySchema,
  MAX_INSTALLMENTS, type AllocationEvent, type GoalTotals, type Money } from "./contracts";
import { MAX_REMAINING_MONTHS } from "@/lib/debt/contracts";

export function parseMoney(input: string): Money {
  if (typeof input !== "string" || !/^\d+(\.\d{1,2})?$/.test(input)) throw new Error("Enter a nonnegative decimal amount with at most two decimal places");
  const [whole, fraction = ""] = input.split(".");
  return MoneySchema.parse(`${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`);
}

export function toMinorUnits(amount: Money): number {
  return Number(SignedMoneySchema.parse(amount).replace(".", ""));
}

export function fromMinorUnits(cents: number): Money {
  if (!Number.isSafeInteger(cents)) throw new Error("Centavos must be a safe integer");
  const digits = Math.abs(cents).toString().padStart(3, "0");
  return `${cents < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function addCentavos(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("Total exceeds safe centavo range");
  return sum;
}

export function splitInstallments(
  amount: Money,
  count: number,
  options?: { maxCount?: number; remainderPlacement?: "first" | "last" },
): Money[] {
  const maxCount = options?.maxCount === undefined ? MAX_INSTALLMENTS : options.maxCount;
  const remainderPlacement = options?.remainderPlacement === undefined ? "first" : options.remainderPlacement;
  if (!Number.isSafeInteger(maxCount) || maxCount < 1 || maxCount > MAX_REMAINING_MONTHS) {
    throw new Error(`Maximum installment count must be between 1 and ${MAX_REMAINING_MONTHS}`);
  }
  if (remainderPlacement !== "first" && remainderPlacement !== "last") {
    throw new Error("Remainder placement must be first or last");
  }
  const total = toMinorUnits(MoneySchema.parse(amount));
  if (!Number.isSafeInteger(count) || count <= 0 || count > maxCount) {
    throw new Error(`Installment count must be between 1 and ${maxCount}`);
  }
  if (total < count) throw new Error("Each installment must contain at least one centavo");
  const divisor = BigInt(count);
  const base = Number(BigInt(total) / divisor);
  const remainder = Number(BigInt(total) % divisor);
  return Array.from({ length: count }, (_, index) => fromMinorUnits(base + (
    remainderPlacement === "last" ? (index === count - 1 ? remainder : 0) : (index < remainder ? 1 : 0)
  )));
}

export function summarizeGoal(goalId: string, target: Money, events: AllocationEvent[]): GoalTotals {
  const targetCentavos = toMinorUnits(PositiveMoneySchema.parse(target));
  let reserved = 0;
  let spent = 0;
  const wallets = new Map<string, number>();
  for (const input of events) {
    const event = AllocationEventSchema.parse(input);
    if (event.goal_id !== goalId) continue;
    const reservedDelta = toMinorUnits(event.reserved_delta);
    reserved = addCentavos(reserved, reservedDelta);
    spent = addCentavos(spent, toMinorUnits(event.spent_delta));
    wallets.set(event.account_id, addCentavos(wallets.get(event.account_id) ?? 0, reservedDelta));
  }
  if (reserved < 0 || spent < 0 || Array.from(wallets.values()).some(amount => amount < 0)) throw new Error("Allocation totals cannot be negative");
  const progress = addCentavos(reserved, spent);
  return { goalId, reserved: fromMinorUnits(reserved), spent: fromMinorUnits(spent), progressAmount: fromMinorUnits(progress),
    remaining: fromMinorUnits(Math.max(0, targetCentavos - progress)), progressPercent: Math.min(100, progress / targetCentavos * 100),
    walletReservations: Array.from(wallets.entries()).filter(([, amount]) => amount > 0)
      .sort(([left], [right]) => left.localeCompare(right)).map(([accountId, amount]) => ({ accountId, amount: fromMinorUnits(amount) })),
    legacyTaggedAmount: null };
}

export interface GoalProjectionInput {
  target: Money;
  progressAmount: Money;
  allocationPerCycle: Money;
  allocationFrequency: string | null;
}

export interface ProjectionResult {
  count: number;
  unit: "month" | "months" | "payday" | "paydays";
  projectedDate: string | null;
  monthlyAmount: number;
  kinsenasAmount: number;
}

export function projectGoal(input: GoalProjectionInput, now: Date): ProjectionResult {
  const target = toMinorUnits(PositiveMoneySchema.parse(input.target));
  const progress = toMinorUnits(MoneySchema.parse(input.progressAmount));
  const allocation = toMinorUnits(MoneySchema.parse(input.allocationPerCycle));
  const isKinsenas = input.allocationFrequency === "kinsenas";
  const displayAllocation = allocation / 100;
  const result: ProjectionResult = { count: 0, unit: isKinsenas ? "paydays" : "months", projectedDate: null,
    monthlyAmount: isKinsenas ? displayAllocation * 2 : displayAllocation,
    kinsenasAmount: isKinsenas ? displayAllocation : displayAllocation / 2 };
  if (allocation === 0 || progress >= target) return result;
  const remaining = BigInt(target - progress);
  const cycle = BigInt(allocation);
  const count = Number(remaining / cycle + (remaining % cycle === BigInt(0) ? BigInt(0) : BigInt(1)));
  const projected = new Date(now.getTime());
  if (isKinsenas) projected.setDate(projected.getDate() + count * 15);
  else projected.setMonth(projected.getMonth() + count);
  const isoDate = Number.isFinite(projected.getTime()) ? projected.toISOString().slice(0, 10) : null;
  return { ...result, count, unit: isKinsenas ? (count === 1 ? "payday" : "paydays") : (count === 1 ? "month" : "months"),
    projectedDate: isoDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : null };
}
