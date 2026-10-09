import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DebtScheduleSection } from "@/components/accounts/DebtScheduleSection";
import type { DebtSnapshot } from "@/lib/debt/contracts";

vi.mock("@/components/accounts/DebtHistoryGroup", () => ({ DebtHistoryGroup: ({ rows }: any) => <div>{rows[0].name}</div> }));
afterEach(cleanup);
const snapshot: DebtSnapshot = {
  accounts: [{ accountId: "wallet", totalOutstanding: "40.00", undatedOutstanding: "0.00", fingerprint: "f", reconciliation: "balanced", reconciliationDelta: "0.00" }],
  rows: Array.from({ length: 5 }, (_, index) => ({ id: `row-${index}`, accountId: "wallet", groupId: `group-${index}`, source: "opening", transactionId: null, dueDate: `2026-11-0${index + 1}`, originalAmount: "10.00", paidAmount: index === 4 ? "10.00" : "0.00", correctedAmount: "0.00", remainingAmount: index === 4 ? "0.00" : "10.00", ordinal: 1, name: `Debt ${index}` })),
};
const props = { snapshot, isLoading: false, error: null, onReviewLegacy: vi.fn(), wallets: [{ id: "wallet", name: "Metrobank" }] };
test("Wallets preview is bounded and links to the complete debt page", () => {
  render(<DebtScheduleSection {...props} preview />);
  expect(screen.getByRole("link", { name: "See all" }).getAttribute("href")).toBe("/accounts/debt");
  expect(screen.getByText("Debt 0")).toBeTruthy();
  expect(screen.getByText("Debt 2")).toBeTruthy();
  expect(screen.queryByText("Debt 3")).toBeNull();
  expect(screen.queryByText("Debt 4")).toBeNull();
  expect(screen.queryByText("Complete installment history")).toBeNull();
});
test("Debt page uses one group list and search; history retains settled rows without mutating data", () => {
  const original = JSON.stringify(snapshot);
  render(<DebtScheduleSection {...props} />);
  expect(screen.getAllByText("Debt 0")).toHaveLength(1);
  expect(screen.queryByText("Debt 4")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(screen.getByText("Debt 4")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search debt" }), { target: { value: "Debt 2" } });
  expect(screen.getByText("Debt 2")).toBeTruthy();
  expect(screen.queryByText("Debt 0")).toBeNull();
  expect(JSON.stringify(snapshot)).toBe(original);
});
test("wallets needing reconciliation show their authoritative total instead of summing legacy rows", () => {
  const mismatch = { ...snapshot, accounts: [{ ...snapshot.accounts[0], reconciliation: "needs_review" as const, totalOutstanding: "2500.00" }] };
  render(<DebtScheduleSection {...props} snapshot={mismatch} />);
  expect(screen.getByRole("alert").textContent).toContain("Wallet outstanding: ₱2,500.00");
  expect(screen.queryByRole("button", { name: /Pay debt/ })).toBeNull();
});
