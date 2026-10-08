import { MAX_INSTALLMENTS } from "@/lib/goals/contracts";
import { MAX_REMAINING_MONTHS } from "@/lib/debt/contracts";

type CalendarDate = { year: number; month: number; day: number };

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Date must use YYYY-MM-DD format");

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("Invalid calendar date");
  }
  return { year, month, day };
}

function formatCalendarDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addMonthsFromAnchor(anchor: CalendarDate, months: number): CalendarDate {
  if (!Number.isSafeInteger(months) || months < 0) throw new Error("Month offset must be a nonnegative integer");
  const absoluteMonth = anchor.year * 12 + anchor.month - 1 + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth % 12 + 1;
  if (year > 9999) throw new Error("Date is outside the supported calendar range");
  return { year, month, day: Math.min(anchor.day, daysInMonth(year, month)) };
}

export function isValidCalendarDate(value: string): boolean {
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}

export function toLocalDateInputValue(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) throw new Error("Cannot format an invalid date");
  return formatCalendarDate({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

export function getFirstInstallmentDueDate(purchaseDate: string): string {
  return formatCalendarDate(addMonthsFromAnchor(parseCalendarDate(purchaseDate), 1));
}

export function getInstallmentScheduleDates(
  firstDueDate: string,
  count: number,
  maxCount: number = MAX_INSTALLMENTS,
): string[] {
  if (!Number.isSafeInteger(maxCount) || maxCount < 1 || maxCount > MAX_REMAINING_MONTHS) {
    throw new Error(`Maximum installment count must be between 1 and ${MAX_REMAINING_MONTHS}`);
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > maxCount) {
    throw new Error(`Installment count must be between 1 and ${maxCount}`);
  }
  const anchor = parseCalendarDate(firstDueDate);
  return Array.from({ length: count }, (_, index) => formatCalendarDate(addMonthsFromAnchor(anchor, index)));
}
