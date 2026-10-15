import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SpendingSummaryPanel } from "@/components/transactions/SpendingSummaryPanel";
import { PeriodBar } from "@/components/transactions/PeriodBar";

const summary = vi.hoisted(() => ({ value: {} as any, retry: vi.fn() }));
vi.mock("@/hooks/use-spending", () => ({ useSpendingLimitCommand: () => ({ isSaving: false }), useSpendingSummary: () => summary.value, useSpendingLimit: () => ({ limit: undefined, isLoading: true, error: null }) }));
vi.mock("@/hooks/use-spending-owner", () => ({ useSpendingOwner: () => ({ status: "resolving", userId: null, generation: 0, isCurrent: () => false }) }));
const today = new Date(2026, 9, 15);
const period = { kind: "month" as const, start: "2026-10-01", end: "2026-10-31" };
const data = { start: period.start, end: "2026-10-15", spent: "120.30", expenses: "100.20", debtPayments: "20.10", income: "200.00", net: "79.70", categories: [{ categoryId: null, name: "Food", amount: "100.20" }], transactionCount: 3, };
beforeEach(() => { summary.value = { data, comparison: { ...data, spent: "100.10", transactionCount: 2 }, retry: summary.retry }; summary.retry.mockReset(); });
afterEach(cleanup);

test("shows concise totals and keeps accounting explanations collapsed until requested", async () => {
  const user = userEvent.setup();
  render(<SpendingSummaryPanel period={period} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.getByText("Spent so far")).toBeTruthy();
  expect(screen.getByText("₱20.20 more than Sep 1–15, 2026")).toBeTruthy();
  expect(screen.getByText("Income ₱200.00")).toBeTruthy();
  expect(screen.getByText("Expenses + card payments")).toBeTruthy();
  expect(screen.getByText("Totals: Oct 1–15, 2026")).toBeTruthy();
  const disclosure = screen.getByText("How totals work");
  const details = disclosure.closest("details")!;
  expect(details.open).toBe(false);
  await user.click(disclosure);
  expect(details.open).toBe(true);
  expect(screen.getByText("Wallet transfers are excluded.")).toBeTruthy();
  expect(screen.getByText("Search and type filters only change the list.")).toBeTruthy();
  expect(screen.getByText(/future-dated entries/)).toBeTruthy();
  expect(screen.getByText("Full group amounts are not period spending.")).toBeTruthy();
  disclosure.focus();
  expect(document.activeElement).toBe(disclosure);
  await user.click(disclosure);
  expect(details.open).toBe(false);
});
test.each([["140.50", "₱20.20 less than Sep 1–15, 2026"], ["120.30", "Same as Sep 1–15, 2026"]])("compares %s without rounding money", (spent, text) => {
  summary.value.comparison.spent = spent;
  render(<SpendingSummaryPanel period={period} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.getByText(text)).toBeTruthy();
});
test("retains PHP income without spending and offers add", async () => {
  summary.value.data = { ...data, spent: "0.00", debtPayments: "0.00", categories: [], };
  const add = vi.fn();
  render(<SpendingSummaryPanel period={period} today={today} onAddTransaction={add} />);
  expect(screen.getByText("No spending recorded for October 2026.")).toBeTruthy();
  expect(screen.getByText("Income ₱200.00")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Add Transaction" })); expect(add).toHaveBeenCalledOnce();
});
test("comparison failure preserves current totals and retry revalidates", async () => {
  summary.value.comparisonError = new Error(); summary.value.comparison = undefined;
  render(<SpendingSummaryPanel period={period} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.getByText("₱120.30")).toBeTruthy();
  expect(screen.getByText("Comparison couldn't load")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry comparison" })); expect(summary.retry).toHaveBeenCalledOnce();
});
test("loading, current error, past label and all-time have distinct states", async () => {
  summary.value.isLoading = true;
  const view = render(<SpendingSummaryPanel period={period} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.getByRole("status", { name: "Loading spending summary" })).toBeTruthy();
  summary.value.isLoading = false; summary.value.error = new Error();
  view.rerender(<SpendingSummaryPanel period={period} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.getByText("Spending totals couldn't load. Your transactions below are unaffected.")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" })); expect(summary.retry).toHaveBeenCalledOnce();
  summary.value.error = undefined;
  view.rerender(<SpendingSummaryPanel period={{ kind: "month", start: "2026-09-01", end: "2026-09-30" }} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.getByText("Spent")).toBeTruthy();
  view.rerender(<SpendingSummaryPanel period={null} today={today} onAddTransaction={vi.fn()} />); expect(view.container.textContent).toBe("");
});
test("period control starts all-time, supports keyboard navigation and clamps future halves", async () => {
  const change = vi.fn(); const user = userEvent.setup();
  const view = render(<PeriodBar period={null} today={today} onChange={change} />);
  await user.tab(); expect(document.activeElement).toBe(screen.getByRole("button", { name: "Choose period" }));
  await user.keyboard("{Enter}"); await user.click(screen.getByRole("menuitemradio", { name: "16th–end" }));
  expect(change).toHaveBeenLastCalledWith({ kind: "second_half", start: "2026-09-16", end: "2026-09-30" });
  view.rerender(<PeriodBar period={period} today={today} onChange={change} />);
  expect((screen.getByRole("button", { name: "Next period" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Previous period" }));
  expect(change).toHaveBeenLastCalledWith({ kind: "month", start: "2026-09-01", end: "2026-09-30" });
});

test("past comparison identifies full dates and hides comparison with no rows", () => {
  const past = { kind: "month" as const, start: "2026-09-01", end: "2026-09-30" };
  const view = render(<SpendingSummaryPanel period={past} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.getByText("₱20.20 more than Aug 1–31, 2026")).toBeTruthy();
  summary.value.comparison.transactionCount = 0;
  view.rerender(<SpendingSummaryPanel period={past} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.queryByText(/more than/)).toBeNull();
});
test("ranks five categories and sums the remainder exactly while retaining debt payments", () => {
  summary.value.data = { ...data, spent: "280.10", debtPayments: "0.10", categories: [1, 7, 2, 6, 3, 5, 4].map(n => ({ categoryId: String(n), name: `Category ${n}`, amount: `${n * 10}.00` })) };
  render(<SpendingSummaryPanel period={period} today={today} onAddTransaction={vi.fn()} />);
  const rows = screen.getByRole("list", { name: "Spending by category" }).querySelectorAll("li");
  expect(Array.from(rows).map(row => row.textContent)).toEqual([
    "Category 7₱70.00 (25%)", "Category 6₱60.00 (21.4%)", "Category 5₱50.00 (17.9%)", "Category 4₱40.00 (14.3%)", "Category 3₱30.00 (10.7%)", "Other categories₱30.00 (10.7%)", "Debt payments₱0.10 (0%)",
  ]);
});
test("zero rows keep truthful empty PHP totals", () => {
  summary.value.data = { ...data, spent: "0.00", debtPayments: "0.00", income: "0.00", net: "0.00", categories: [], transactionCount: 0, };
  render(<SpendingSummaryPanel period={period} today={today} onAddTransaction={vi.fn()} />);
  expect(screen.getByText("No spending recorded for October 2026.")).toBeTruthy();
  expect(screen.getByText("Income ₱0.00")).toBeTruthy();
});
test("midnight rollover keeps selection and updates whether next period is reachable", async () => {
  const change = vi.fn(); const user = userEvent.setup();
  const half = { kind: "first_half" as const, start: "2026-10-01", end: "2026-10-15" };
  const view = render(<PeriodBar period={half} today={today} onChange={change} />);
  expect((screen.getByRole("button", { name: "Next period" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<PeriodBar period={half} today={new Date(2026, 9, 16)} onChange={change} />);
  expect(change).not.toHaveBeenCalled();
  const next = screen.getByRole("button", { name: "Next period" }); next.focus();
  await user.keyboard(" ");
  expect(change).toHaveBeenLastCalledWith({ kind: "second_half", start: "2026-10-16", end: "2026-10-31" });
  view.rerender(<PeriodBar period={period} today={new Date(2026, 10, 1)} onChange={change} />);
  await user.click(screen.getByRole("button", { name: "Next period" }));
  expect(change).toHaveBeenLastCalledWith({ kind: "month", start: "2026-11-01", end: "2026-11-30" });
});

test.each([
  ["Month", { kind: "month", start: "2026-10-01", end: "2026-10-31" }],
  ["1st–15th", { kind: "first_half", start: "2026-10-01", end: "2026-10-15" }],
  ["16th–end", { kind: "second_half", start: "2026-09-16", end: "2026-09-30" }],
])("choosing %s from historical September opens its latest available current period", async (name, expected) => {
  const change = vi.fn();
  render(<PeriodBar period={{ kind: "month", start: "2026-09-01", end: "2026-09-30" }} today={today} onChange={change} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Choose period" }));
  await user.click(screen.getByRole("menuitemradio", { name }));
  expect(change).toHaveBeenLastCalledWith(expected);
});

test("list-only filters add one concise hint while preserving preset totals", () => {
  render(<SpendingSummaryPanel period={period} today={today} listFiltersActive onAddTransaction={vi.fn()} />);
  expect(screen.getByText("List filters only")).toBeTruthy();
  expect(screen.getByText("₱120.30")).toBeTruthy();
});
