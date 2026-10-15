import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import DashboardPage from "@/app/(dashboard)/dashboard/page";
import { useDashboardStats } from "@/hooks/use-data";

vi.mock("@/hooks/use-data", () => ({
  useAccounts: () => ({ data: [] }),
  useRecentTransactions: () => ({ data: [] }),
  useDashboardStats: vi.fn(() => ({ data: {} })),
}));
vi.mock("@/components/layout/navigation-link", () => ({
  NavigationLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it("queries the browser-local month at 00:30 on the first", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 1, 0, 30));
  expect(new Date().getDate()).toBe(1);
  render(<DashboardPage />);
  expect(useDashboardStats).toHaveBeenLastCalledWith("2026-10-01", "2026-10-01", "2026-09-01", "2026-09-01");
});

it.each([
  ["Last 7 days", "2026-09-25", "2026-09-18", "2026-09-24"],
  ["Last 30 days", "2026-09-02", "2026-08-03", "2026-09-01"],
])("keeps %s and its previous window contiguous", async (label, start, previousStart, previousEnd) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 1, 0, 30));
  render(<DashboardPage />);
  fireEvent.keyDown(screen.getByRole("button", { name: "This month" }), { key: "ArrowDown" });
  await act(async () => { vi.advanceTimersByTime(10); });
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  expect(useDashboardStats).toHaveBeenLastCalledWith(start, "2026-10-01", previousStart, previousEnd);
});

it("updates the Dashboard query on midnight month rollover", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 59));
  render(<DashboardPage />);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(useDashboardStats).toHaveBeenLastCalledWith("2026-10-01", "2026-10-01", "2026-09-01", "2026-09-01");
});
