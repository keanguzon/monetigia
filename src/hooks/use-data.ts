import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Account, Category, Transaction } from "@/types/database";

import { sortAccountsWithFallback } from "@/lib/account-order";
import { toMinorUnits } from "@/lib/goals/summary";
import { fetchSpendingSummary } from "@/lib/spending/summary";
import { SpendingOwnerChangedError, useSpendingOwner } from "./use-spending-owner";

const supabase = createClient();

export function useAccounts() {
  return useSWR<Account[]>("accounts", async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    
    let accountsList: Account[] = [];
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", user.id)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
      
    if (error) {
      const { data: fallbackData, error: fallbackErr } = await supabase
        .from("accounts")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (fallbackErr) throw fallbackErr;
      accountsList = (fallbackData || []) as Account[];
    } else {
      accountsList = (data || []) as Account[];
    }

    return sortAccountsWithFallback(accountsList, user.id);
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
  const owner = useSpendingOwner();
  const key = owner.userId
    ? ["dashboardStats", owner.userId, currentStart, currentEnd, previousStart, previousEnd] as const
    : null;
  const result = useSWR(key, async ([, keyOwnerId, rangeStart, rangeEnd, previousRangeStart, previousRangeEnd]) => {
    const request = await owner.capture();
    if (request.userId !== keyOwnerId) throw new SpendingOwnerChangedError();
    const [current, previous] = await Promise.all([
      fetchSpendingSummary({ start: rangeStart, end: rangeEnd }, request.accessToken),
      fetchSpendingSummary({ start: previousRangeStart, end: previousRangeEnd }, request.accessToken),
    ]);
    request.assertCurrent();
    return {
      monthlyIncome: toMinorUnits(current.income) / 100,
      monthlyExpenses: toMinorUnits(current.spent) / 100,
      lastMonthIncome: toMinorUnits(previous.income) / 100,
      lastMonthExpenses: toMinorUnits(previous.spent) / 100,
    };
  }, { keepPreviousData: false });
  const visible = owner.status === "authenticated" && owner.isCurrent();
  return {
    ...result,
    data: visible ? result.data : undefined,
    error: owner.error ?? (visible ? result.error : undefined),
    isLoading: owner.isLoading || (visible && result.isLoading),
  };
}
