import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}));
vi.mock("@/hooks/use-transaction-submit", () => ({
  useTransactionDelete: () => ({
    isDeleting: false,
    pendingTransactionId: null,
    savedTransactionId: null,
    error: null,
    refreshError: null,
    remove: vi.fn(),
  }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import TransactionsPage from "@/app/(dashboard)/transactions/page";

function row(id: number) {
  return {
    id: `transaction-${id}`,
    user_id: "owner-1",
    account_id: "account-1",
    category_id: null,
    goal_id: null,
    type: "expense",
    amount: "12.00",
    description: `Transaction ${id}`,
    date: `2026-01-${String((id % 28) + 1).padStart(2, "0")}`,
    created_at: new Date(Date.UTC(2026, 9, 28) - id * 86_400_000).toISOString(),
    installment_group_id: null,
    purchase_date: null,
    history_date: null,
    transfer_to_account_id: null,
    category: null,
    account: { id: "account-1", name: "Wallet", type: "cash" },
    transfer_to_account: null,
  };
}

function configureHistoryPages() {
  let laterAttempts = 0;
  const ranges: Array<[number, number]> = [];
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.from.mockImplementation(() => {
    let range: [number, number] = [0, 49];
    const query: any = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: (start: number, end: number) => { range = [start, end]; ranges.push(range); return query; },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (range[0] === 0) return Promise.resolve({ data: Array.from({ length: 50 }, (_, index) => row(index + 1)), error: null }).then(resolve, reject);
        laterAttempts += 1;
        if (laterAttempts === 1) return Promise.resolve({ data: null, error: new Error("temporary history read failure") }).then(resolve, reject);
        return Promise.resolve({ data: [row(51)], error: null }).then(resolve, reject);
      },
    };
    return query;
  });
  return ranges;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => vi.clearAllMocks());

describe("transactions history pagination", () => {
  test("loads older rows, shows a retry after a read error, and retries the same page", async () => {
    const user = userEvent.setup();
    const ranges = configureHistoryPages();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<TransactionsPage />);

    expect(screen.queryByText(/Showing 0 all entries/)).toBeNull();
    expect(await screen.findByRole("button", { name: "Load more" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Sort transactions" }) as HTMLSelectElement).value).toBe("date_added");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/older history could not be loaded/i);
    expect(screen.getByRole("button", { name: "Retry loading more" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry loading more" }));
    expect(await screen.findByText("Transaction 51")).toBeTruthy();
    expect(ranges).toEqual([[0, 49], [50, 99], [50, 99]]);
    expect((screen.getByRole("combobox", { name: "Sort transactions" }) as HTMLSelectElement).value).toBe("date_added");

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort transactions" }), "transaction_date");
    expect(await screen.findByText("Transaction 50")).toBeTruthy();
    expect(screen.queryByText("Transaction 51")).toBeNull();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(ranges).toEqual([[0, 49], [50, 99], [50, 99], [0, 49]]);
    expect((screen.getByRole("combobox", { name: "Sort transactions" }) as HTMLSelectElement).value).toBe("transaction_date");
  });

  test("confirms that deleting one installment leaves the remaining schedule", async () => {
    const user = userEvent.setup();
    const purchaseId = "40000000-0000-4000-8000-000000000004";
    const first = { ...row(1), id: "50000000-0000-4000-8000-000000000001", description: "Coffee maker (Installment 1/2)", date: "2026-02-10", purchase_date: "2026-01-10", history_date: "2026-01-10", installment_group_id: purchaseId };
    const second = { ...row(2), id: "50000000-0000-4000-8000-000000000002", description: "Coffee maker (Installment 2/2)", date: "2026-03-10", purchase_date: "2026-01-10", history_date: "2026-01-10", installment_group_id: purchaseId };
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    mocks.from.mockImplementation(() => {
      let isSiblingRead = false;
      const query: any = {
        select: () => query,
        eq: () => query,
        in: () => { isSiblingRead = true; return query; },
        order: () => query,
        range: () => query,
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: isSiblingRead ? [first, second] : [first], error: null }).then(resolve, reject),
      };
      return query;
    });
    render(<TransactionsPage />);

    await user.click(await screen.findByRole("button", { name: /show payment schedule/i }));
    await user.click(screen.getByRole("button", { name: "Delete installment 1" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/deletes only this installment/i);
    expect(dialog.textContent).toMatch(/other installments in this schedule will remain/i);
    expect(screen.getByRole("button", { name: "Delete installment" })).toBeTruthy();
  });
});
