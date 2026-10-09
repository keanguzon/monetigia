import { describe, expect, it } from "vitest";
import { EditTransactionDescriptionCommandSchema, FinancialCommandSchema } from "@/lib/goals/contracts";
import { normalizeTransactionDescription } from "@/lib/transactions/description";

const transactionId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000002";
const command = (overrides: Record<string, unknown> = {}) => ({
  kind: "edit_transaction_description",
  transactionId,
  groupId: null,
  description: "Coffee",
  expectedDescription: null,
  ...overrides,
});

describe("transaction description command contract", () => {
  it("accepts exactly one UUID target and uses the financial command union", () => {
    const ordinary = command();
    const grouped = command({ transactionId: null, groupId });

    expect(EditTransactionDescriptionCommandSchema.parse(ordinary)).toEqual(ordinary);
    expect(FinancialCommandSchema.parse(grouped)).toEqual(grouped);
    expect(FinancialCommandSchema.parse({ kind: "reserve", goalId: groupId, accountId: transactionId, amount: "1.00" }))
      .toMatchObject({ kind: "reserve" });
  });

  it("rejects missing, extra, malformed, or ambiguous target fields", () => {
    for (const input of [
      { ...command(), extra: true },
      { ...command(), transactionId: null },
      { ...command(), transactionId: "bad" },
      { ...command(), transactionId, groupId },
      { ...command(), expectedDescription: undefined },
    ]) {
      expect(EditTransactionDescriptionCommandSchema.safeParse(input).success).toBe(false);
      expect(FinancialCommandSchema.safeParse(input).success).toBe(false);
    }
  });

  it("counts Unicode code points before trimming for both description fields", () => {
    expect(EditTransactionDescriptionCommandSchema.safeParse(command({ description: "😀".repeat(500) })).success).toBe(true);
    expect(EditTransactionDescriptionCommandSchema.safeParse(command({ description: "😀".repeat(501) })).success).toBe(false);
    expect(EditTransactionDescriptionCommandSchema.safeParse(command({ expectedDescription: "x".repeat(501) })).success).toBe(false);
    expect(EditTransactionDescriptionCommandSchema.safeParse(command({ description: `${"x".repeat(500)} ` })).success).toBe(false);
  });

  it("trims only ASCII whitespace and maps empty descriptions to null", () => {
    expect(normalizeTransactionDescription("\t\r\n  Coffee  \n")).toBe("Coffee");
    expect(normalizeTransactionDescription(" \t\r\n\v\f ")).toBeNull();
    expect(normalizeTransactionDescription(null)).toBeNull();
    expect(normalizeTransactionDescription("\u00a0Coffee\u00a0")).toBe("\u00a0Coffee\u00a0");
  });
});
