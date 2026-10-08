import { expect, test } from "vitest";
import { summarizeDebt } from "@/lib/debt/summary";
import type { DebtSnapshot } from "@/lib/debt/contracts";

export const snapshot: DebtSnapshot = {
  accounts: [{ accountId: "a", totalOutstanding: "6600.00", undatedOutstanding: "5000.00", reconciliation: "balanced", reconciliationDelta: "0.00", fingerprint: "f" }],
  rows: [{ id: "r", accountId: "a", groupId: "g", source: "purchase", transactionId: "t", dueDate: "2026-10-08", originalAmount: "2000.00", paidAmount: "400.00", correctedAmount: "0.00", remainingAmount: "1600.00", ordinal: 1, name: "Purchase" }],
};
test("All months includes authoritative residual without deducting payments twice", () => {
  expect(summarizeDebt(snapshot, null)).toEqual({ totalOutstanding: "6600.00", scheduledDebt: "1600.00", undatedOutstanding: "5000.00", needsReviewAccountIds: [] });
});
test("selected months use remaining dated rows while preserving undated debt", () => {
  expect(summarizeDebt(snapshot, ["2026-09"]).scheduledDebt).toBe("0.00");
  expect(summarizeDebt(snapshot, ["2026-10", "2026-10"]).scheduledDebt).toBe("1600.00");
  expect(summarizeDebt(snapshot, []).undatedOutstanding).toBe("5000.00");
});
test("review state preserves authoritative total but makes schedule unavailable", () => {
  expect(summarizeDebt({ ...snapshot, accounts: [{ ...snapshot.accounts[0], reconciliation: "needs_review" }] }, null)).toEqual({ totalOutstanding: "6600.00", scheduledDebt: null, undatedOutstanding: "5000.00", needsReviewAccountIds: ["a"] });
});
test("complete snapshots exceed 5000 rows and accumulate exact centavos", () => {
  const rows = Array.from({ length: 6001 }, (_, index) => ({ ...snapshot.rows[0], id: String(index), remainingAmount: "0.01" }));
  expect(summarizeDebt({ ...snapshot, rows }, null).scheduledDebt).toBe("60.01");
});
test("invalid months and unsafe aggregate amounts fail visibly", () => {
  expect(() => summarizeDebt(snapshot, ["2026-13"])).toThrow();
  expect(() => summarizeDebt({ accounts: Array.from({ length: 2 }, () => ({ ...snapshot.accounts[0], totalOutstanding: "90071992547409.91" })), rows: [] }, null)).toThrow();
});
