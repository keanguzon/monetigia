import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as debt from "@/lib/debt/contracts";
import { FinancialCommandSchema } from "@/lib/goals/contracts";

const accountId = randomUUID();
const item = { clientId: "one", name: "Existing", mode: "single", amount: "5000.00", firstDueDate: "2026-11-30", count: 1 };
const command = { kind: "adopt_opening_debt", accountId, items: [item], fingerprint: "a".repeat(64) };
const row = { id: randomUUID(), accountId, groupId: randomUUID(), source: "opening", transactionId: null,
  dueDate: "2026-11-30", originalAmount: "5000.00", paidAmount: "400.00", correctedAmount: "100.00", remainingAmount: "4500.00", ordinal: 1, name: "Existing" };
const snapshot = { accounts: [{ accountId, totalOutstanding: "4500.00", undatedOutstanding: "0.00", fingerprint: "a".repeat(64), reconciliation: "balanced", reconciliationDelta: "0.00" }], rows: [row] };

describe("complete debt contracts", () => {
  it("validates canonical exact snapshots including signed review discrepancies", () => {
    expect(debt.DebtSnapshotSchema?.safeParse(snapshot).success).toBe(true);
    expect(debt.DebtSnapshotSchema?.safeParse({ ...snapshot, accounts: [{ ...snapshot.accounts[0], reconciliation: "needs_review", reconciliationDelta: "-100.00" }] }).success).toBe(true);
  });
  it("rejects unsafe or noncanonical money, invalid dates, and inconsistent row arithmetic", () => {
    for (const change of [{ paidAmount: 400 }, { remainingAmount: "4500" }, { remainingAmount: "4501.00" }, { originalAmount: "90071992547409.92" }, { dueDate: "2026-02-30" }, { source: "purchase", transactionId: null }, { ordinal: 0 }, { extra: true }]) {
      expect(debt.DebtDueRowSchema?.safeParse({ ...row, ...change }).success).toBe(false);
    }
  });
  it("accepts adoption through the financial dispatcher contract", () => {
    expect(debt.AdoptOpeningDebtCommandSchema?.safeParse(command).success).toBe(true);
    expect(FinancialCommandSchema.safeParse(command).success).toBe(true);
  });
  it("enforces the creation limits without weakening item validation", () => {
    for (const change of [{ items: [] }, { items: [item, item] }, { items: Array.from({ length: 101 }, (_, i) => ({ ...item, clientId: String(i) })) },
      { items: [{ ...item, firstDueDate: "9999-12-31", mode: "installments", count: 2 }] }, { items: [{ ...item, name: " " }] },
      { items: [{ ...item, amount: "0.00" }] }, { items: [{ ...item, count: 2 }] }, { items: [{ ...item, amount: "10000000000000.00" }] },
      { items: Array.from({ length: 11 }, (_, i) => ({ ...item, clientId: String(i), mode: "installments", count: 600 })) },
      { items: [{ ...item, amount: "9999999999999.99" }, { ...item, clientId: "two" }] }, { fingerprint: "A".repeat(64) }, { accountId: "wrong" }, { extra: true }]) {
      expect(debt.AdoptOpeningDebtCommandSchema?.safeParse({ ...command, ...change }).success).toBe(false);
      expect(FinancialCommandSchema.safeParse({ ...command, ...change }).success).toBe(false);
    }
  });
});
