import { describe, expect, test } from "vitest";
import { RemainingMonthsSchema } from "@/lib/debt/contracts";
import { buildDebtSchedule, parseRemainingMonths } from "@/lib/debt/schedule";
import { toMinorUnits } from "@/lib/goals/summary";

describe("remaining debt schedule", () => {
  test("strict remaining count accepts 2, 24 and 600", () => {
    for (const [input, expected] of [["1", 1], ["2", 2], ["02", 2], ["24", 24], ["600", 600]] as const) {
      expect(parseRemainingMonths(input)).toBe(expected);
    }
    for (const count of [2, 24, 600]) expect(RemainingMonthsSchema.parse(count)).toBe(count);
    for (const input of ["", " ", " 2", "2 ", "2.5", "2e1", "-2", "+2", "abc", "2!", "0", "601", "9007199254740992"]) {
      expect(parseRemainingMonths(input)).toBeNull();
    }
    for (const count of [0, -2, 2.5, NaN, Infinity, 601, Number.MAX_SAFE_INTEGER + 1]) {
      expect(RemainingMonthsSchema.safeParse(count).success).toBe(false);
    }
  });

  test("single debt keeps its entered due date", () => {
    expect(buildDebtSchedule("1000.00", "2026-10-01", 1)).toEqual([
      { ordinal: 1, dueDate: "2026-10-01", amount: "1000.00" },
    ]);
  });

  test("rejects year zero and accepts the first supported calendar year", () => {
    expect(() => buildDebtSchedule("1.00", "0000-01-01", 1)).toThrow();
    expect(buildDebtSchedule("1.00", "0001-01-01", 1)[0].dueDate).toBe("0001-01-01");
  });

  test("final row absorbs all centavo remainder", () => {
    expect(buildDebtSchedule("1000.00", "2026-10-01", 3).map(row => row.amount)).toEqual([
      "333.33", "333.33", "333.34",
    ]);
    expect(buildDebtSchedule("0.05", "2026-10-01", 3).map(row => row.amount)).toEqual([
      "0.01", "0.01", "0.03",
    ]);
  });

  test("24 and 600 row totals remain exact", () => {
    const twentyFour = buildDebtSchedule("1000.00", "2026-10-01", 24);
    expect(twentyFour).toHaveLength(24);
    expect(twentyFour.slice(0, 23).map(row => row.amount)).toEqual(Array(23).fill("41.66"));
    expect(twentyFour[23].amount).toBe("41.82");
    expect(twentyFour.reduce((sum, row) => sum + toMinorUnits(row.amount), 0)).toBe(100000);

    const sixHundred = buildDebtSchedule("6.00", "2026-10-01", 600);
    expect(sixHundred).toHaveLength(600);
    expect(sixHundred.map(row => row.amount)).toEqual(Array(600).fill("0.01"));
    expect(sixHundred[0].ordinal).toBe(1);
    expect(sixHundred[599].ordinal).toBe(600);
    expect(sixHundred.reduce((sum, row) => sum + toMinorUnits(row.amount), 0)).toBe(600);
  });

  test("dates preserve the original monthly day", () => {
    expect(buildDebtSchedule("3.00", "2026-01-31", 3).map(row => row.dueDate)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31",
    ]);
    expect(buildDebtSchedule("3.00", "2028-01-31", 3).map(row => row.dueDate)).toEqual([
      "2028-01-31", "2028-02-29", "2028-03-31",
    ]);
    const twentyFour = buildDebtSchedule("24.00", "2026-01-31", 24);
    expect(twentyFour[2].dueDate).toBe("2026-03-31");
    expect(twentyFour[23].dueDate).toBe("2027-12-31");
  });

  test("invalid schedule is rejected before rows escape", () => {
    for (const count of [0, -1, 1.5, 601, Infinity]) {
      expect(() => buildDebtSchedule("10.00", "2026-10-01", count)).toThrow();
    }
    expect(() => buildDebtSchedule("0.02", "2026-10-01", 3)).toThrow();
    for (const amount of ["0.00", "-1.00", "1", "1.001", "90071992547409.92"]) {
      expect(() => buildDebtSchedule(amount, "2026-10-01", 1)).toThrow();
    }
    expect(() => buildDebtSchedule("10.00", "2026-02-30", 1)).toThrow();
    expect(() => buildDebtSchedule("10.00", "9999-12-31", 2)).toThrow();

    const maximumSafe = buildDebtSchedule("90071992547409.91", "2026-10-01", 3);
    expect(maximumSafe.map(row => row.amount)).toEqual([
      "30023997515803.30", "30023997515803.30", "30023997515803.31",
    ]);
    expect(maximumSafe.reduce((sum, row) => sum + toMinorUnits(row.amount), 0)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
