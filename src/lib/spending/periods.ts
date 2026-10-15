import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, parseISO, startOfDay, startOfMonth } from "date-fns";

export type PeriodKind = "month" | "first_half" | "second_half";
export type SpendingPeriod = { kind: PeriodKind; start: string; end: string };
export type ComparisonRange = { start: string; end: string };

export function toLocalDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function periodContaining(date: Date, kind: PeriodKind): SpendingPeriod {
  const monthStart = startOfMonth(date);
  const start = kind === "second_half" ? addDays(monthStart, 15) : monthStart;
  const end = kind === "first_half" ? addDays(monthStart, 14) : endOfMonth(date);
  return { kind, start: toLocalDateString(start), end: toLocalDateString(end) };
}

export function shiftPeriod(period: SpendingPeriod, step: -1 | 1): SpendingPeriod {
  const start = parseISO(period.start);
  if (period.kind === "month") return periodContaining(addMonths(start, step), "month");
  if (period.kind === "first_half") {
    return periodContaining(step === 1 ? start : addMonths(start, -1), "second_half");
  }
  return periodContaining(step === 1 ? addMonths(start, 1) : start, "first_half");
}

export function previousPeriod(period: SpendingPeriod): SpendingPeriod {
  return shiftPeriod(period, -1);
}

export function spentToDateEnd(period: SpendingPeriod, today: Date): string {
  const date = toLocalDateString(today);
  return date < period.end ? date : period.end;
}

export function isCurrentPeriod(period: SpendingPeriod, today: Date): boolean {
  const date = toLocalDateString(today);
  return period.start <= date && date <= period.end;
}

export function comparisonRange(period: SpendingPeriod, today: Date): ComparisonRange {
  const previous = previousPeriod(period);
  if (!isCurrentPeriod(period, today)) return { start: previous.start, end: previous.end };
  const elapsed = differenceInCalendarDays(startOfDay(today), parseISO(period.start));
  const elapsedEnd = toLocalDateString(addDays(parseISO(previous.start), elapsed));
  return { start: previous.start, end: elapsedEnd < previous.end ? elapsedEnd : previous.end };
}

export function formatPeriodLabel(period: SpendingPeriod): string {
  const start = parseISO(period.start);
  if (period.kind === "month") return format(start, "MMMM yyyy");
  return `${format(start, "MMM d")}–${format(parseISO(period.end), "d, yyyy")}`;
}
