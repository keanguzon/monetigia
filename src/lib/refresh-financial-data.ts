import { mutate } from "swr";
import type { ScopedMutator } from "swr";
import { applyFinancialCommand } from "@/lib/goals/client";
import type { FinancialCommand, FinancialResult, TransactionQuote } from "@/lib/goals/contracts";

export async function refreshFinancialData(userId?: string, mutateCache: ScopedMutator = mutate) {
  await mutateCache((key) => {
    if (typeof key === "string") {
      return key === "goals" || key === "accounts" || key === "recentTransactions" || key.startsWith("dashboardStats-");
    }
    if (!Array.isArray(key)) return false;
    if (key[0] === "goalFinance" || key[0] === "goalHistory") return userId === undefined || key[1] === userId;
    return false;
  }, undefined, { revalidate: true });
}

export interface FinancialSaveOutcome {
  saved: FinancialResult;
  refreshError: unknown | null;
}

export async function applyAndRefreshFinancialCommand(
  requestId: string,
  command: FinancialCommand,
  quote?: TransactionQuote,
  refresh: () => Promise<unknown> = () => refreshFinancialData(),
): Promise<FinancialSaveOutcome> {
  const saved = await applyFinancialCommand(requestId, command, quote);
  try {
    await refresh();
    return { saved, refreshError: null };
  } catch (refreshError) {
    return { saved, refreshError };
  }
}
