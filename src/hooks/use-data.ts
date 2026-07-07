import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Account, Category, Transaction } from "@/types/database";

const supabase = createClient();

export function useAccounts() {
  return useSWR<Account[]>("accounts", async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", user.id)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
      
    if (error) throw error;
    return data || [];
  });
}

export function useCategories() {
  return useSWR<Category[]>("categories", async () => {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("name");
      
    if (error) throw error;
    return data || [];
  });
}

export function useRecentTransactions() {
  return useSWR("recentTransactions", async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    
    const { data, error } = await (supabase as any)
      .from("transactions")
      .select("id, user_id, account_id, category_id, type, amount, description, date, transfer_to_account_id, created_at, category:categories(id,name,color), account:accounts!account_id(id,name,type)")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3);
      
    if (error) throw error;
    return data || [];
  });
}

export function useDashboardStats(
  currentStart: string, currentEnd: string, previousStart: string, previousEnd: string
) {
  return useSWR(
    `dashboardStats-${currentStart}-${currentEnd}`,
    async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const [monthTxData, lastMonthTxData] = await Promise.all([
        supabase
          .from("transactions")
          .select("type, amount, account_id, transfer_to_account_id")
          .eq("user_id", user.id)
          .gte("date", currentStart)
          .lte("date", currentEnd),
        supabase
          .from("transactions")
          .select("type, amount, account_id, transfer_to_account_id")
          .eq("user_id", user.id)
          .gte("date", previousStart)
          .lte("date", previousEnd)
      ]);

      const monthTransactions = monthTxData.data || [];
      const lastMonthTransactions = lastMonthTxData.data || [];

      // We need accounts to check for credit_card types (for transfers/debt payments)
      const { data: accountsData } = await supabase
        .from("accounts")
        .select("id, type")
        .eq("user_id", user.id);
      
      const accountTypeById = new Map<string, string>();
      (accountsData || []).forEach(a => accountTypeById.set(a.id, a.type));

      const isCredit = (accountId?: string | null) => {
        if (!accountId) return false;
        return accountTypeById.get(accountId) === "credit_card";
      };

      const income = monthTransactions
        .filter((t) => t.type === "income" && !isCredit(t.account_id))
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const expenses = monthTransactions
        .filter((t) => t.type === "expense" && !isCredit(t.account_id))
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const debtPayments = monthTransactions
        .filter(
          (t) =>
            t.type === "transfer" &&
            !isCredit(t.account_id) &&
            isCredit(t.transfer_to_account_id)
        )
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const lastIncome = lastMonthTransactions
        .filter((t) => t.type === "income" && !isCredit(t.account_id))
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const lastExpenses = lastMonthTransactions
        .filter((t) => t.type === "expense" && !isCredit(t.account_id))
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const lastDebtPayments = lastMonthTransactions
        .filter(
          (t) =>
            t.type === "transfer" &&
            !isCredit(t.account_id) &&
            isCredit(t.transfer_to_account_id)
        )
        .reduce((sum, t) => sum + Number(t.amount), 0);

      return {
        monthlyIncome: income || 0,
        monthlyExpenses: (expenses + debtPayments) || 0,
        lastMonthIncome: lastIncome || 0,
        lastMonthExpenses: (lastExpenses + lastDebtPayments) || 0,
      };
    }
  );
}
