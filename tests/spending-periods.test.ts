import { describe, expect, it } from "vitest";
import { comparisonRange, formatPeriodLabel, isCurrentPeriod, periodContaining, previousPeriod, shiftPeriod, spentToDateEnd, toLocalDateString } from "@/lib/spending/periods";
import { toLocalDateInputValue } from "@/lib/transactions/installment-dates";

describe("local spending periods", () => {
  for (const [zone, expected] of [["Asia/Manila", "2026-10-01"], ["Asia/Tokyo", "2026-10-01"], ["America/Los_Angeles", "2026-09-30"]]) {
    it.skipIf(process.env.TZ !== zone)(`uses the local civil date for the same instant in ${zone}`, () => {
      const instant = new Date("2026-09-30T16:30:00Z");
      expect(toLocalDateString(instant)).toBe(expected);
      expect(toLocalDateString(instant)).toBe(toLocalDateInputValue(instant));
    });
  }
  it.each([[2026, "2026-02-28"], [2028, "2028-02-29"]])("ends February's second half correctly in %i", (year, end) => {
    expect(periodContaining(new Date(year, 1, 20), "second_half")).toEqual({ kind: "second_half", start: `${year}-02-16`, end });
  });
  it("navigates sequential halves through the year boundary", () => {
    const december = periodContaining(new Date(2026, 11, 20), "second_half");
    const january = shiftPeriod(december, 1);
    expect(january).toEqual({ kind: "first_half", start: "2027-01-01", end: "2027-01-15" });
    expect(previousPeriod(january)).toEqual(december);
    expect(previousPeriod(december)).toEqual({ kind: "first_half", start: "2026-12-01", end: "2026-12-15" });
  });
  it("moves months across years without carrying the day", () => {
    expect(previousPeriod(periodContaining(new Date(2027, 0, 31), "month"))).toEqual({ kind: "month", start: "2026-12-01", end: "2026-12-31" });
  });
  it("clamps spending to today but keeps past periods complete", () => {
    const october = periodContaining(new Date(2026, 9, 5), "month");
    expect(spentToDateEnd(october, new Date(2026, 9, 5))).toBe("2026-10-05");
    expect(spentToDateEnd(october, new Date(2026, 10, 5))).toBe("2026-10-31");
    expect(isCurrentPeriod(october, new Date(2026, 9, 31, 23, 59))).toBe(true);
    expect(isCurrentPeriod(october, new Date(2026, 10, 1))).toBe(false);
    expect(spentToDateEnd(october, new Date(2026, 8, 30))).toBe("2026-09-30");
  });
  it("compares elapsed current-month days, capped to the shorter previous month", () => {
    const march = periodContaining(new Date(2026, 2, 31), "month");
    expect(comparisonRange(march, new Date(2026, 2, 5))).toEqual({ start: "2026-02-01", end: "2026-02-05" });
    expect(comparisonRange(march, new Date(2026, 2, 31))).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(comparisonRange(march, new Date(2026, 3, 1))).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("compares current and past halves sequentially", () => {
    expect(comparisonRange(periodContaining(new Date(2026, 9, 16), "second_half"), new Date(2026, 9, 16))).toEqual({ start: "2026-10-01", end: "2026-10-01" });
    expect(comparisonRange(periodContaining(new Date(2026, 9, 1), "first_half"), new Date(2026, 9, 16))).toEqual({ start: "2026-09-16", end: "2026-09-30" });
  });
  it.each([
    ["month", "October 2026"], ["first_half", "Oct 1–15, 2026"], ["second_half", "Oct 16–31, 2026"],
  ] as const)("labels %s", (kind, label) => {
    expect(formatPeriodLabel(periodContaining(new Date(2026, 9, 20), kind))).toBe(label);
  });
  it("formats the same civil date as the existing transaction form", () => {
    const date = new Date(2026, 9, 1, 0, 30);
    expect(toLocalDateString(date)).toBe("2026-10-01");
    expect(toLocalDateString(date)).toBe(toLocalDateInputValue(date));
  });
});
