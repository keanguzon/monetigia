import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import AddTransactionModal from "@/components/transactions/AddTransactionModal";
import { useGoals } from "@/hooks/use-goals";
import GoalsPage from "@/app/(dashboard)/goals/page";
import DashboardPage from "@/app/(dashboard)/dashboard/page";
import AccountsPage from "@/app/(dashboard)/accounts/page";
import { writeFileSync, mkdirSync } from "node:fs";

const db = vi.hoisted(() => ({ transactions: [] as any[], failInsert: false, delayLoad: null as Promise<void> | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/dashboard" }));
vi.mock("@/hooks/use-data", () => ({
  useAccounts: () => ({ data: [{ id: "cash", balance: 10000, type: "cash" }], isLoading: false }),
  useRecentTransactions: () => ({ data: [], isLoading: false }),
  useDashboardStats: () => ({ data: { monthlyIncome: 15000, monthlyExpenses: 5000, lastMonthIncome: 12000, lastMonthExpenses: 4000 }, isLoading: false }),
}));
vi.mock("@/lib/supabase/client", () => {
  const accounts = [{ id: "cash", name: "Cash", type: "cash", balance: 10000 }, { id: "bank", name: "Bank", type: "bank", balance: 0 }, { id: "debt", name: "PayLater", type: "credit_card", balance: 0 }];
  const goals = ["phone", "laptop"].map(id => ({ id, name: id, target_amount: 5000, allocation_per_cycle: 500, allocation_frequency: "monthly", is_completed: false }));
  return { createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "test-user" } } }) },
    from(table: string) {
      let inserted: any = null;
      let single = false;
      let id: string | undefined;
      const query: any = {
        select() { return query; }, order() { return query; }, not() { return query; }, in() { return query; }, or() { return query; }, limit() { return query; },
        eq(key: string, value: string) { if (key === "id") id = value; return query; },
        insert(value: any) { inserted = value; return query; }, update() { return query; },
        single() { single = true; return query; },
        async then(resolve: any) {
          if (table === "accounts" && !single && db.delayLoad) await db.delayLoad;
          if (inserted && db.failInsert) return Promise.resolve({ data: null, error: { message: "Save failed" } }).then(resolve);
          if (inserted) db.transactions.push(...(Array.isArray(inserted) ? inserted : [inserted]));
          const data = table === "accounts" ? (single ? accounts.find(a => a.id === id) : accounts) : table === "goals" ? goals : table === "transactions" ? db.transactions : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  }) };
});

function Progress() {
  const { goals } = useGoals();
  const phone = goals.find(g => g.id === "phone");
  return <output aria-label="Phone funding">{phone?.saved ?? 0}/{phone?.progressPercent ?? 0}</output>;
}

const config = { dedupingInterval: 0, revalidateOnFocus: false };
beforeEach(() => { db.transactions = []; db.failInsert = false; db.delayLoad = null; });
afterEach(cleanup);

test("goal shortcut selects the goal, leaves wallet empty and resets between openings", async () => {
  const view = render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="phone" /></SWRConfig>);
  await screen.findByRole("option", { name: "phone" });
  expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe("phone");
  expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe("");
  view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen={false} onClose={() => {}} /></SWRConfig>);
  view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="laptop" /></SWRConfig>);
  await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe("laptop"));
});

test.each(["Expense", "Transfer", "Income"])("%s saves correct goal association and refreshes actual progress", async (type) => {
  const user = userEvent.setup();
  render(<SWRConfig value={config}><Progress /><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="phone" /></SWRConfig>);
  await screen.findByRole("option", { name: "phone" });
  await user.click(screen.getByRole("button", { name: type }));
  await user.selectOptions(screen.getByLabelText(type === "Transfer" ? "From Account" : "Account"), "cash");
  if (type === "Transfer") await user.selectOptions(screen.getByLabelText("To Account"), "bank");
  if (type === "Income") expect(screen.queryByLabelText("Goal (Optional)")).toBeNull();
  await user.type(screen.getByLabelText("Amount"), "500");
  await user.click(screen.getByRole("button", { name: "Add Transaction" }));
  await waitFor(() => expect(db.transactions).toHaveLength(1));
  expect(db.transactions[0].goal_id).toBe(type === "Income" ? null : "phone");
  await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe(type === "Income" ? "0/0" : "500/10"));
});

test("failed save and cancellation do not add funding; Escape closes the dialog", async () => {
  db.failInsert = true;
  const close = vi.fn();
  const user = userEvent.setup();
  render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={close} defaultGoalId="phone" /></SWRConfig>);
  await screen.findByRole("option", { name: "phone" });
  await user.selectOptions(screen.getByLabelText("Account"), "cash");
  await user.type(screen.getByLabelText("Amount"), "500");
  await user.click(screen.getByRole("button", { name: "Add Transaction" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Add Transaction" }) as HTMLButtonElement).disabled).toBe(false));
  expect(db.transactions).toHaveLength(0);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});

test("reopening a contribution cannot submit a wallet retained from the previous goal while accounts load", async () => {
  const user = userEvent.setup();
  const view = render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="phone" /></SWRConfig>);
  await screen.findByRole("option", { name: "Cash" });
  await user.selectOptions(screen.getByLabelText("Account"), "cash");
  view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen={false} onClose={() => {}} /></SWRConfig>);
  let release!: () => void;
  db.delayLoad = new Promise<void>(resolve => { release = resolve; });
  view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="laptop" /></SWRConfig>);
  expect((screen.getByRole("button", { name: /Add Transaction|Loading accounts/ }) as HTMLButtonElement).disabled).toBe(true);
  release();
  await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe(""));
});

test("tagged installments count once, and untagged saves remain unassociated", async () => {
  const user = userEvent.setup();
  const view = render(<SWRConfig value={config}><Progress /><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="phone" /></SWRConfig>);
  await screen.findByRole("option", { name: "Cash" });
  await user.click(screen.getByLabelText("PayLater purchase (adds to debt)"));
  await user.selectOptions(screen.getByLabelText("Installments"), "3");
  await user.type(screen.getByLabelText("Amount"), "300");
  await user.click(screen.getByRole("button", { name: "Add Transaction" }));
  await waitFor(() => expect(db.transactions).toHaveLength(3));
  expect(db.transactions.map(tx => [tx.amount, tx.goal_id])).toEqual([[100, "phone"], [100, "phone"], [100, "phone"]]);
  await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe("300/6"));
  view.unmount();
  render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} /></SWRConfig>);
  await screen.findByRole("option", { name: "Cash" });
  await user.type(screen.getByLabelText("Amount"), "50");
  await user.click(screen.getByRole("button", { name: "Add Transaction" }));
  await waitFor(() => expect(db.transactions).toHaveLength(4));
  expect(db.transactions[3].goal_id).toBeNull();
});

test("page fixtures render summaries and expose a working contribution shortcut", async () => {
  function save(name: string) {
    if (!process.env.MONETIGIA_VISUAL_FIXTURES) return;
    mkdirSync(".superpowers/visual-check", { recursive: true });
    writeFileSync(`.superpowers/visual-check/${name}.html`, document.body.innerHTML);
  }
  const user = userEvent.setup();
  const goals = render(<SWRConfig value={config}><GoalsPage /></SWRConfig>);
  await screen.findAllByRole("button", { name: "Add contribution" });
  save("goals");
  await user.click(screen.getAllByRole("button", { name: "Add contribution" })[0]);
  await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe("phone"));
  save("contribution");
  goals.unmount();
  const dashboard = render(<DashboardPage />);
  expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
  save("dashboard");
  dashboard.unmount();
  const accounts = render(<AccountsPage />);
  save("wallets-loading");
  await screen.findAllByText("Cash", { exact: true });
  save("wallets");
  accounts.unmount();
});
