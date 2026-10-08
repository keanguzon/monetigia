import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CorrectDebtRowsCommandSchema } from "@/lib/debt/contracts";
import { FinancialCommandSchema } from "@/lib/goals/contracts";

const command = (overrides: Record<string, unknown> = {}) => ({
  kind: "correct_debt_rows",
  accountId: randomUUID(),
  rowIds: [randomUUID()],
  fingerprint: "a".repeat(64),
  ...overrides,
});

describe("correct debt rows command contract", () => {
  it("accepts a valid strict command through both schemas", () => {
    const input = command();

    expect(CorrectDebtRowsCommandSchema.parse(input)).toEqual(input);
    expect(FinancialCommandSchema.parse(input)).toEqual(input);
  });

  it("rejects unknown keys", () => {
    expect(CorrectDebtRowsCommandSchema.safeParse({ ...command(), extra: true }).success).toBe(false);
    expect(CorrectDebtRowsCommandSchema.safeParse({ ...command(), rowIds: [randomUUID(), { id: randomUUID() }] }).success).toBe(false);
  });

  it("requires one to 600 unique UUID row IDs", () => {
    const duplicate = randomUUID();

    for (const rowIds of [[], [duplicate, duplicate], ["not-a-uuid"], Array.from({ length: 601 }, () => randomUUID())]) {
      expect(CorrectDebtRowsCommandSchema.safeParse(command({ rowIds })).success).toBe(false);
    }
    expect(CorrectDebtRowsCommandSchema.safeParse(command({ rowIds: Array.from({ length: 600 }, () => randomUUID()) })).success).toBe(true);
    expect(CorrectDebtRowsCommandSchema.safeParse(command({ accountId: "not-a-uuid" })).success).toBe(false);
  });

  it("rejects mixed-case duplicate UUIDs", () => {
    const id = randomUUID();
    const input = command({ rowIds: [id.toLowerCase(), id.toUpperCase()] });
    expect(CorrectDebtRowsCommandSchema.safeParse(input).success).toBe(false);
    expect(FinancialCommandSchema.safeParse(input).success).toBe(false);
  });

  it("requires a lowercase 64-character hexadecimal fingerprint", () => {
    for (const fingerprint of ["a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64)]) {
      expect(CorrectDebtRowsCommandSchema.safeParse(command({ fingerprint })).success).toBe(false);
    }
  });
});
