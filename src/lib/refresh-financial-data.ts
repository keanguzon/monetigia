import { mutate, unstable_serialize } from "swr";
import type { Cache, Key, ScopedMutator } from "swr";
import { applyFinancialCommand, restoreArchivedGoal } from "@/lib/goals/client";
import type { FinancialCommand, FinancialResult, TransactionQuote } from "@/lib/goals/contracts";

export class FinancialRefreshError extends Error {
  constructor(readonly failures: unknown[]) {
    super("The financial change was saved, but some views could not refresh.");
    this.name = "FinancialRefreshError";
  }
}

/**
 * Revalidate finance views and surface errors from the current pass. Callers
 * that need refresh status must provide their scoped cache; the global default
 * exists for legacy refresh-only flows that do not return a save outcome.
 */
export async function refreshFinancialData(userId?: string, mutateCache: ScopedMutator = mutate, cache?: Cache) {
  const matchingKeys: unknown[] = [];
  const knownKeys = new Set<string>();
  const matchesKey = (key: unknown) => {
    if (typeof key === "string") {
      return key === "goals" || key === "accounts" || key === "recentTransactions" || key.startsWith("dashboardStats-");
    }
    if (!Array.isArray(key)) return false;
    if (key[0] === "goalFinance" || key[0] === "goalHistory" || key[0] === "goalWalletMetadata" || key[0] === "debtSnapshot") return userId === undefined || key[1] === userId;
    return false;
  };
  const rememberMatchingKey = (key: unknown) => {
    if (!matchesKey(key)) return false;
    const serialized = unstable_serialize(key as Key);
    if (!knownKeys.has(serialized)) {
      knownKeys.add(serialized);
      matchingKeys.push(key);
    }
    return true;
  };

  // SWR keeps the last fetch error in cache until a successful fetch. Clear it
  // while preserving the data so this pass can detect a reused Error instance.
  await mutateCache(rememberMatchingKey, current => current, { populateCache: true, revalidate: false });
  await mutateCache(rememberMatchingKey);

  if (!cache) return;
  const failures = matchingKeys.flatMap(key => {
    const serialized = unstable_serialize(key as Key);
    const error = cache.get(serialized)?.error;
    return error ? [error] : [];
  });
  if (failures.length > 0) throw new FinancialRefreshError(failures);
}

export interface FinancialSaveOutcome {
  saved: FinancialResult;
  refreshError: unknown | null;
}

export async function applyAndRefreshFinancialCommand(
  requestId: string,
  command: FinancialCommand,
  quote: TransactionQuote | undefined,
  refresh: () => Promise<unknown>,
): Promise<FinancialSaveOutcome> {
  return saveAndRefreshFinancialCommand(() => applyFinancialCommand(requestId, command, quote), refresh);
}

export async function restoreArchivedGoalAndRefresh(
  requestId: string,
  goalId: string,
  refresh: () => Promise<unknown>,
): Promise<FinancialSaveOutcome> {
  return saveAndRefreshFinancialCommand(() => restoreArchivedGoal(requestId, goalId), refresh);
}

async function saveAndRefreshFinancialCommand(
  save: () => Promise<FinancialResult>,
  refresh: () => Promise<unknown>,
): Promise<FinancialSaveOutcome> {
  const saved = await save();
  try {
    await refresh();
    return { saved, refreshError: null };
  } catch (refreshError) {
    return { saved, refreshError };
  }
}
