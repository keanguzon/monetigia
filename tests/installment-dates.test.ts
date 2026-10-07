import { describe, expect, test } from "vitest";
import {
  getFirstInstallmentDueDate,
  getInstallmentScheduleDates,
  toLocalDateInputValue,
} from "@/lib/transactions/installment-dates";

describe("installment dates", () => {
  test("formats the local calendar date without converting through UTC", () => {
    expect(toLocalDateInputValue(new Date(2026, 9, 6, 0, 30))).toBe("2026-10-06");
  });

  test("defaults the first due date one calendar month later and clamps short months", () => {
    expect(getFirstInstallmentDueDate("2026-10-06")).toBe("2026-11-06");
    expect(getFirstInstallmentDueDate("2026-01-31")).toBe("2026-02-28");
    expect(getFirstInstallmentDueDate("2028-01-31")).toBe("2028-02-29");
  });

  test("returns schedule dates from the original due-day anchor", () => {
    expect(getInstallmentScheduleDates("2026-01-31", 3)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    expect(getInstallmentScheduleDates("2028-01-31", 3)).toEqual([
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
    ]);
  });

  test("rejects invalid dates and installment counts", () => {
    expect(() => getFirstInstallmentDueDate("2026-02-30")).toThrow();
    expect(() => getInstallmentScheduleDates("2026-01-31", 0)).toThrow();
    expect(() => getInstallmentScheduleDates("2026-01-31", 1.5)).toThrow();
  });
});
