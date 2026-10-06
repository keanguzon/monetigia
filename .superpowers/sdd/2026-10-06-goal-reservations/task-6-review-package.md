f659cd2 feat: share authoritative goal and wallet financial snapshots
 .../2026-10-06-goal-reservations/task-6-report.md  |  62 ++++++
 src/hooks/use-goal-finance.ts                      |  37 ++++
 src/hooks/use-goals.ts                             | 220 +++++++++++----------
 src/lib/goals/client.ts                            | 119 +++++++++++
 src/lib/refresh-financial-data.ts                  |  36 +++-
 tests/contributions.test.tsx                       |  99 +++++++---
 tests/goal-finance-client.test.ts                  |  89 +++++++++
 tests/goal-finance-hooks.test.tsx                  | 169 ++++++++++++++++
 8 files changed, 694 insertions(+), 137 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-6-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-6-report.md
new file mode 100644
index 0000000..8c6e236
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-6-report.md
@@ -0,0 +1,62 @@
+# Task 6 report: typed transport, shared snapshots, and reliable refresh
+
+## Implemented
+
+- Added a Zod-validated RPC client for finance snapshots, transaction quotes, and financial commands. It sends canonical decimal strings, preserves named SQL codes and `HINT` text, and marks transport failures, status-0 responses, ambiguous server failures, and invalid write responses as unknown outcomes.
+- Added the `useGoalFinance(userId)` SWR hook with per-user snapshot keys, matching-user display gating, cache refresh for goal history and existing finance views, and cache data clearing on sign-out.
+- Changed `useGoals` to consume the authoritative snapshot. The existing numeric display shape remains available through an explicit bridge, while projection calculations use retained canonical strings. Fetching no longer writes automatic completion changes; archived goals are excluded from the UI list. Goal metadata edits remain direct metadata writes; archive, close, and reopen use financial commands.
+- Kept command application separate from revalidation. `applyAndRefreshFinancialCommand` returns the committed result alongside a refresh error, so refresh failure cannot turn a committed command into a failed save or create a new request ID.
+- Updated contribution fixtures to use UUIDs and full snapshot DTOs. Legacy tagged expense and transfer history no longer increases goal progress.
+
+## TDD and verification
+
+RED command, before implementation:
+
+```text
+npx vitest run tests/goal-finance-client.test.ts tests/goal-finance-hooks.test.tsx
+```
+
+Output: 2 suites failed during import resolution because `src/lib/goals/client.ts` and `src/hooks/use-goal-finance.ts` did not exist; 0 tests ran. This was the expected missing-feature failure.
+
+Focused GREEN command after implementation and compatibility fixes:
+
+```text
+npx vitest run tests/goal-finance-client.test.ts tests/goal-finance-hooks.test.tsx tests/goal-summary.test.ts tests/contributions.test.tsx
+```
+
+Output: 4 test files passed, 56/56 tests passed.
+
+Final full suite:
+
+```text
+npm test
+```
+
+Output: navigation checks 2/2 passed; Vitest 5/5 files and 58/58 tests passed.
+
+TypeScript check:
+
+```text
+npx tsc --noEmit
+```
+
+Output: exit code 0, no diagnostics.
+
+`git diff --check` reported no whitespace errors. One earlier full-suite run exposed a legacy projection caller without the new exact-amount bridge; the explicit `parseMoney` fallback fixed it, and the focused and final full suites passed afterward.
+
+## Files changed
+
+- `src/lib/goals/client.ts`
+- `src/hooks/use-goal-finance.ts`
+- `src/hooks/use-goals.ts`
+- `src/lib/refresh-financial-data.ts`
+- `tests/goal-finance-client.test.ts`
+- `tests/goal-finance-hooks.test.tsx`
+- `tests/contributions.test.tsx`
+
+## Self-review and concerns
+
+- Caller-provided request IDs are validated and passed through unchanged. A replay therefore uses the caller's same UUID. PostgREST status `0` and other ambiguous outcomes stay distinguishable from named server rejections.
+- Goal closure currently submits `leftovers: null`; if reservations remain, the server rejects closure instead of silently releasing them. Task 7 should provide the explicit leftover choice UI.
+- The typed allocation event schema expects canonical decimal strings. Task 7's history reader should normalize valid database decimal text such as `0` to two decimal places using string operations, without float conversion, before parsing events.
+- Transaction entry remains on its existing path for Task 8 to migrate to the command and quote flow.
diff --git a/src/hooks/use-goal-finance.ts b/src/hooks/use-goal-finance.ts
new file mode 100644
index 0000000..7a4dbda
--- /dev/null
+++ b/src/hooks/use-goal-finance.ts
@@ -0,0 +1,37 @@
+import { useCallback, useEffect, useRef, useState } from "react";
+import useSWR, { useSWRConfig } from "swr";
+import { fetchGoalFinance } from "@/lib/goals/client";
+import type { GoalFinanceSnapshot } from "@/lib/goals/contracts";
+import { refreshFinancialData } from "@/lib/refresh-financial-data";
+
+export function useGoalFinance(userId: string | null) {
+  const { mutate: mutateCache } = useSWRConfig();
+  const [snapshotUserId, setSnapshotUserId] = useState(userId);
+  const selectedUserId = useRef(userId);
+  selectedUserId.current = userId;
+  const key = userId ? ["goalFinance", userId] as const : null;
+  const fetchForUser = useCallback(async () => {
+    const snapshot = await fetchGoalFinance();
+    if (selectedUserId.current === userId) setSnapshotUserId(userId);
+    return snapshot;
+  }, [userId]);
+  const { data: cachedData, error, isLoading, mutate } = useSWR<GoalFinanceSnapshot>(key, fetchForUser);
+
+  useEffect(() => setSnapshotUserId(userId), [userId]);
+
+  useEffect(() => {
+    if (userId !== null) return;
+    void mutateCache(
+      cacheKey => Array.isArray(cacheKey) && (cacheKey[0] === "goalFinance" || cacheKey[0] === "goalHistory"),
+      () => undefined,
+      { populateCache: true, revalidate: false },
+    );
+  }, [mutateCache, userId]);
+
+  const refresh = useCallback(async () => {
+    if (userId === null) return;
+    await refreshFinancialData(userId, mutateCache);
+  }, [mutateCache, userId]);
+
+  return { data: snapshotUserId === userId ? cachedData : undefined, isLoading, error, refresh, mutate };
+}
diff --git a/src/hooks/use-goals.ts b/src/hooks/use-goals.ts
index 1f8fe47..8a72a1e 100644
--- a/src/hooks/use-goals.ts
+++ b/src/hooks/use-goals.ts
@@ -1,156 +1,160 @@
-import useSWR from "swr";
-import { goalFunding } from "@/lib/goal-funding";
+import { useEffect, useState } from "react";
+import { useGoalFinance } from "@/hooks/use-goal-finance";
+import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
 import { parseMoney, projectGoal, type ProjectionResult } from "@/lib/goals/summary";
 import { createClient } from "@/lib/supabase/client";
-import type { Goal, GoalInsert, GoalUpdate } from "@/types/database";
+import type { GoalFinanceGoal, Money } from "@/lib/goals/contracts";
+import type { GoalInsert, GoalUpdate } from "@/types/database";
 
 const supabase = createClient();
 
-export interface GoalWithProgress extends Goal {
+export type GoalWithProgress = Omit<GoalFinanceGoal, "target_amount" | "current_amount" | "allocation_per_cycle"> & {
+  target_amount: number;
+  current_amount: number;
+  allocation_per_cycle: number;
+  financeAmounts: { target: Money; progress: Money; allocationPerCycle: Money };
   saved: number;
   progressPercent: number;
-}
+};
 
 export type { ProjectionResult } from "@/lib/goals/summary";
 
+function moneyFromLegacyDisplay(value: number): Money {
+  if (!Number.isFinite(value) || value < 0) throw new Error("Goal display amounts must be finite and nonnegative");
+  return parseMoney(value.toFixed(2));
+}
+
 export function getProjection(goal: GoalWithProgress): ProjectionResult {
   const isKinsenas = goal.allocation_frequency === "kinsenas";
-  const allocation = Number(goal.allocation_per_cycle) || 0;
-  const target = Number(goal.target_amount) || 0;
-  const saved = Number(goal.saved) || 0;
+  const allocation = goal.allocation_per_cycle;
+  const target = goal.target_amount;
+  const saved = goal.saved;
 
   if (allocation <= 0 || target <= 0 || saved >= target) {
     return {
       count: 0,
       unit: isKinsenas ? "paydays" : "months",
       projectedDate: null,
       monthlyAmount: isKinsenas ? allocation * 2 : allocation,
       kinsenasAmount: isKinsenas ? allocation : allocation / 2,
     };
   }
 
-  // The legacy reader still sums floats; this adapter lasts until decimal snapshot cutover.
-  return projectGoal({ target: parseMoney(target.toFixed(2)), progressAmount: parseMoney(saved.toFixed(2)),
-    allocationPerCycle: parseMoney(allocation.toFixed(2)), allocationFrequency: goal.allocation_frequency }, new Date());
+  const exactAmounts = goal.financeAmounts ?? {
+    target: moneyFromLegacyDisplay(target),
+    progress: moneyFromLegacyDisplay(saved),
+    allocationPerCycle: moneyFromLegacyDisplay(allocation),
+  };
+  return projectGoal({
+    target: exactAmounts.target,
+    progressAmount: exactAmounts.progress,
+    allocationPerCycle: exactAmounts.allocationPerCycle,
+    allocationFrequency: goal.allocation_frequency,
+  }, new Date());
+}
+
+function toDisplayGoal(goal: GoalFinanceGoal): GoalWithProgress {
+  const saved = Number(goal.progressAmount);
+  return {
+    ...goal,
+    target_amount: Number(goal.target_amount),
+    current_amount: saved,
+    allocation_per_cycle: Number(goal.allocation_per_cycle),
+    financeAmounts: { target: goal.target_amount, progress: goal.progressAmount, allocationPerCycle: goal.allocation_per_cycle },
+    saved,
+    progressPercent: goal.progressPercent,
+    is_completed: goal.status === "completed" || goal.is_completed,
+  };
+}
+
+function orderGoals(goals: GoalWithProgress[]): GoalWithProgress[] {
+  return goals.filter(goal => goal.archived_at === null).sort((left, right) => {
+    if (left.is_priority !== right.is_priority) return Number(right.is_priority) - Number(left.is_priority);
+    if (left.target_date === null) return right.target_date === null ? 0 : 1;
+    if (right.target_date === null) return -1;
+    return left.target_date.localeCompare(right.target_date);
+  });
 }
 
 export function useGoals() {
-  const { data, error, isLoading, mutate } = useSWR<GoalWithProgress[]>(
-    "goals",
-    async () => {
-      const {
-        data: { user },
-      } = await supabase.auth.getUser();
-      if (!user) throw new Error("Not authenticated");
-
-      const [goalsRes, txRes] = await Promise.all([
-        supabase
-          .from("goals")
-          .select("*")
-          .eq("user_id", user.id)
-          .order("is_priority", { ascending: false })
-          .order("target_date", { ascending: true, nullsFirst: false }),
-        supabase
-          .from("transactions")
-          .select("goal_id, amount, type")
-          .eq("user_id", user.id)
-          .not("goal_id", "is", null),
-      ]);
-
-      if (goalsRes.error) throw goalsRes.error;
-      if (txRes.error) throw txRes.error;
-
-      const goalsList: GoalWithProgress[] = (goalsRes.data || []).map((goal) => {
-        const target = Number(goal.target_amount) || 0;
-        const { saved, progressPercent } = goalFunding(goal.id, target, txRes.data || []);
-        const isAutoCompleted = target > 0 && saved >= target;
-        const isCompleted = goal.is_completed || isAutoCompleted;
-
-        // Sync auto-completion to database if not already marked
-        if (isAutoCompleted && !goal.is_completed) {
-          supabase
-            .from("goals")
-            .update({ is_completed: true })
-            .eq("id", goal.id)
-            .eq("user_id", user.id)
-            .then();
-        }
-
-        return {
-          ...goal,
-          target_amount: target,
-          current_amount: saved,
-          allocation_per_cycle: Number(goal.allocation_per_cycle) || 0,
-          saved,
-          progressPercent,
-          is_completed: isCompleted,
-        };
-      });
-
-      return goalsList;
-    }
-  );
+  const [userId, setUserId] = useState<string | null>(null);
+  const [userIsLoading, setUserIsLoading] = useState(true);
+  const [userError, setUserError] = useState<unknown>(null);
+
+  useEffect(() => {
+    let mounted = true;
+    let authRevision = 0;
+    const initialRevision = authRevision;
+    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
+      authRevision += 1;
+      if (!mounted) return;
+      setUserId(session?.user.id ?? null);
+      setUserIsLoading(false);
+      setUserError(null);
+    });
+    void supabase.auth.getUser().then(({ data: { user } }) => {
+      if (!mounted || authRevision !== initialRevision) return;
+      setUserId(user?.id ?? null);
+      setUserIsLoading(false);
+    }).catch(error => {
+      if (!mounted || authRevision !== initialRevision) return;
+      setUserError(error);
+      setUserIsLoading(false);
+    });
+    return () => {
+      mounted = false;
+      subscription.unsubscribe();
+    };
+  }, []);
 
-  const createGoal = async (payload: Omit<GoalInsert, "user_id">) => {
-    const {
-      data: { user },
-    } = await supabase.auth.getUser();
+  const finance = useGoalFinance(userId);
+  const goals = orderGoals((finance.data?.goals ?? []).map(toDisplayGoal));
+
+  const ensureUser = async () => {
+    const { data: { user } } = await supabase.auth.getUser();
     if (!user) throw new Error("Not authenticated");
+    return user;
+  };
 
-    const { error: insertError } = await supabase.from("goals").insert({
+  const createGoal = async (payload: Omit<GoalInsert, "user_id">) => {
+    const user = await ensureUser();
+    const { error } = await supabase.from("goals").insert({
       ...payload,
       user_id: user.id,
       current_amount: 0,
     });
-
-    if (insertError) throw insertError;
-    await mutate();
+    if (error) throw error;
+    await finance.mutate();
   };
 
   const updateGoal = async (id: string, payload: GoalUpdate) => {
-    const {
-      data: { user },
-    } = await supabase.auth.getUser();
-    if (!user) throw new Error("Not authenticated");
-
-    const { error: updateError } = await supabase
-      .from("goals")
-      .update(payload)
-      .eq("id", id)
-      .eq("user_id", user.id);
-
-    if (updateError) throw updateError;
-    await mutate();
+    if (payload.status !== undefined || payload.is_completed !== undefined || payload.completed_at !== undefined || payload.archived_at !== undefined) {
+      throw new Error("Goal lifecycle changes must use a financial command.");
+    }
+    const user = await ensureUser();
+    const { error } = await supabase.from("goals").update(payload).eq("id", id).eq("user_id", user.id);
+    if (error) throw error;
+    await finance.mutate();
   };
 
-  const deleteGoal = async (id: string) => {
-    const {
-      data: { user },
-    } = await supabase.auth.getUser();
-    if (!user) throw new Error("Not authenticated");
-
-    const { error: deleteError } = await supabase
-      .from("goals")
-      .delete()
-      .eq("id", id)
-      .eq("user_id", user.id);
+  const runLifecycleCommand = (command: { kind: "archive" | "reopen"; goalId: string } | {
+    kind: "close"; goalId: string; status: "completed"; leftovers: null;
+  }) => applyAndRefreshFinancialCommand(crypto.randomUUID(), command, undefined, finance.refresh);
 
-    if (deleteError) throw deleteError;
-    await mutate();
-  };
+  const deleteGoal = async (id: string) => runLifecycleCommand({ kind: "archive", goalId: id });
 
-  const toggleComplete = async (id: string, completed: boolean) => {
-    await updateGoal(id, { is_completed: completed });
-  };
+  const toggleComplete = async (id: string, completed: boolean) => completed
+    ? runLifecycleCommand({ kind: "close", goalId: id, status: "completed", leftovers: null })
+    : runLifecycleCommand({ kind: "reopen", goalId: id });
 
   return {
-    goals: data || [],
-    isLoading,
-    isError: error,
+    goals,
+    isLoading: userIsLoading || finance.isLoading,
+    isError: userError ?? finance.error,
     createGoal,
     updateGoal,
     deleteGoal,
     toggleComplete,
-    mutate,
+    mutate: finance.mutate,
   };
 }
diff --git a/src/lib/goals/client.ts b/src/lib/goals/client.ts
new file mode 100644
index 0000000..8d622c9
--- /dev/null
+++ b/src/lib/goals/client.ts
@@ -0,0 +1,119 @@
+import { z } from "zod";
+import { createClient } from "@/lib/supabase/client";
+import {
+  FinancialCommandSchema,
+  FinancialErrorCodeSchema,
+  FinancialResultSchema,
+  GoalFinanceSnapshotSchema,
+  ReleaseLineSchema,
+  TransactionDraftSchema,
+  TransactionQuoteSchema,
+  type FinancialCommand,
+  type FinancialErrorCode,
+  type FinancialResult,
+  type GoalFinanceSnapshot,
+  type ReleaseLine,
+  type TransactionDraft,
+  type TransactionQuote,
+} from "./contracts";
+
+export { parseMoney, toMinorUnits, fromMinorUnits, summarizeGoal } from "./summary";
+
+export class FinancialCommandError extends Error {
+  readonly code: FinancialErrorCode | "TRANSPORT_ERROR";
+  readonly hint: string | null;
+  readonly outcome: "rejected" | "unknown";
+
+  constructor(options: {
+    message: string;
+    code?: FinancialErrorCode | "TRANSPORT_ERROR";
+    hint?: string | null;
+    outcome: "rejected" | "unknown";
+    cause?: unknown;
+  }) {
+    super(options.message, { cause: options.cause });
+    this.name = "FinancialCommandError";
+    this.code = options.code ?? "TRANSPORT_ERROR";
+    this.hint = options.hint ?? null;
+    this.outcome = options.outcome;
+  }
+}
+
+const requestIdSchema = z.string().uuid();
+
+function readServerError(error: unknown, ambiguousOutcome = false): FinancialCommandError {
+  if (typeof error === "object" && error !== null) {
+    const response = error as { message?: unknown; hint?: unknown; status?: unknown };
+    const message = typeof response.message === "string" ? response.message : "The server rejected the financial command.";
+    const codeMatch = message.match(/\b(INSUFFICIENT_ACTUAL|INSUFFICIENT_AVAILABLE|INSUFFICIENT_RESERVATION|STALE_QUOTE|NEEDS_REVIEW|INVALID_STATE|REQUEST_CONFLICT|NOT_ALLOWED)\b/);
+    const code = codeMatch ? FinancialErrorCodeSchema.parse(codeMatch[1]) : undefined;
+    const status = typeof response.status === "number" ? response.status : null;
+    const uncertainResponse = ambiguousOutcome && (
+      status === 0 || (status !== null && status >= 500) ||
+      /failed to fetch|network(error| request)|load failed|invalid json|unexpected end of json/i.test(message)
+    );
+    if (uncertainResponse && code === undefined) {
+      return unknownOutcome(error);
+    }
+    return new FinancialCommandError({
+      message,
+      code,
+      hint: typeof response.hint === "string" ? response.hint : null,
+      outcome: "rejected",
+      cause: error,
+    });
+  }
+  return new FinancialCommandError({
+    message: "The server rejected the financial command.",
+    outcome: "rejected",
+    cause: error,
+  });
+}
+
+function unknownOutcome(error: unknown): FinancialCommandError {
+  const message = error instanceof Error ? error.message : "The financial command response could not be confirmed.";
+  return new FinancialCommandError({ message, code: "TRANSPORT_ERROR", outcome: "unknown", cause: error });
+}
+
+export async function fetchGoalFinance(): Promise<GoalFinanceSnapshot> {
+  const { data, error } = await createClient().rpc("goal_finance_snapshot");
+  if (error) throw readServerError(error);
+  return GoalFinanceSnapshotSchema.parse(data);
+}
+
+export async function quoteTransaction(draft: TransactionDraft, releases?: ReleaseLine[]): Promise<TransactionQuote> {
+  const safeDraft = TransactionDraftSchema.parse(draft);
+  const safeReleases = releases === undefined ? null : z.array(ReleaseLineSchema).parse(releases);
+  const { data, error } = await createClient().rpc("goal_transaction_quote", {
+    p_draft: safeDraft,
+    p_releases: safeReleases,
+  });
+  if (error) throw readServerError(error);
+  return TransactionQuoteSchema.parse(data);
+}
+
+export async function applyFinancialCommand(
+  requestId: string,
+  command: FinancialCommand,
+  quote?: TransactionQuote,
+): Promise<FinancialResult> {
+  const safeRequestId = requestIdSchema.parse(requestId);
+  const safeCommand = FinancialCommandSchema.parse(command);
+  const isTransaction = safeCommand.kind === "transaction";
+  if (isTransaction && quote === undefined) throw new Error("A fresh quote is required for a transaction command.");
+  if (!isTransaction && quote !== undefined) throw new Error("Quotes are only valid for transaction commands.");
+  const safeQuote = quote === undefined ? null : TransactionQuoteSchema.parse(quote);
+
+  const response = await Promise.resolve().then(() => createClient().rpc("goal_finance_apply", {
+      p_request_id: safeRequestId,
+      p_command: safeCommand,
+      p_quote: safeQuote,
+    })).catch(error => { throw unknownOutcome(error); });
+  if (response.error) throw readServerError(response.error, true);
+  try {
+    return FinancialResultSchema.parse(response.data);
+  } catch (error) {
+    // The database may have committed even when its response cannot be parsed.
+    throw unknownOutcome(error);
+  }
+}
diff --git a/src/lib/refresh-financial-data.ts b/src/lib/refresh-financial-data.ts
index 3496cfc..dabcf32 100644
--- a/src/lib/refresh-financial-data.ts
+++ b/src/lib/refresh-financial-data.ts
@@ -1,7 +1,35 @@
 import { mutate } from "swr";
+import type { ScopedMutator } from "swr";
+import { applyFinancialCommand } from "@/lib/goals/client";
+import type { FinancialCommand, FinancialResult, TransactionQuote } from "@/lib/goals/contracts";
 
-export async function refreshFinancialData() {
-  await mutate((key) => typeof key === "string" && (
-    key === "goals" || key === "accounts" || key === "recentTransactions" || key.startsWith("dashboardStats-")
-  ), undefined, { revalidate: true });
+export async function refreshFinancialData(userId?: string, mutateCache: ScopedMutator = mutate) {
+  await mutateCache((key) => {
+    if (typeof key === "string") {
+      return key === "goals" || key === "accounts" || key === "recentTransactions" || key.startsWith("dashboardStats-");
+    }
+    if (!Array.isArray(key)) return false;
+    if (key[0] === "goalFinance" || key[0] === "goalHistory") return userId === undefined || key[1] === userId;
+    return false;
+  }, undefined, { revalidate: true });
+}
+
+export interface FinancialSaveOutcome {
+  saved: FinancialResult;
+  refreshError: unknown | null;
+}
+
+export async function applyAndRefreshFinancialCommand(
+  requestId: string,
+  command: FinancialCommand,
+  quote?: TransactionQuote,
+  refresh: () => Promise<unknown> = () => refreshFinancialData(),
+): Promise<FinancialSaveOutcome> {
+  const saved = await applyFinancialCommand(requestId, command, quote);
+  try {
+    await refresh();
+    return { saved, refreshError: null };
+  } catch (refreshError) {
+    return { saved, refreshError };
+  }
 }
diff --git a/tests/contributions.test.tsx b/tests/contributions.test.tsx
index 1cb0eee..a6c0c13 100644
--- a/tests/contributions.test.tsx
+++ b/tests/contributions.test.tsx
@@ -3,32 +3,81 @@ import { afterEach, beforeEach, expect, test, vi } from "vitest";
 import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
 import userEvent from "@testing-library/user-event";
 import { SWRConfig } from "swr";
 import AddTransactionModal from "@/components/transactions/AddTransactionModal";
 import { useGoals } from "@/hooks/use-goals";
 import GoalsPage from "@/app/(dashboard)/goals/page";
 import DashboardPage from "@/app/(dashboard)/dashboard/page";
 import AccountsPage from "@/app/(dashboard)/accounts/page";
 import { writeFileSync, mkdirSync } from "node:fs";
 
-const db = vi.hoisted(() => ({ transactions: [] as any[], failInsert: false, delayLoad: null as Promise<void> | null }));
+const db = vi.hoisted(() => ({
+  transactions: [] as any[], failInsert: false, delayLoad: null as Promise<void> | null,
+  userId: "10000000-0000-4000-8000-000000000001",
+  phoneId: "20000000-0000-4000-8000-000000000001",
+  laptopId: "20000000-0000-4000-8000-000000000002",
+  cashId: "30000000-0000-4000-8000-000000000001",
+  bankId: "30000000-0000-4000-8000-000000000002",
+  debtId: "30000000-0000-4000-8000-000000000003",
+}));
 vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/dashboard" }));
 vi.mock("@/hooks/use-data", () => ({
-  useAccounts: () => ({ data: [{ id: "cash", balance: 10000, type: "cash" }], isLoading: false }),
+  useAccounts: () => ({ data: [{ id: db.cashId, balance: 10000, type: "cash" }], isLoading: false }),
   useRecentTransactions: () => ({ data: [], isLoading: false }),
   useDashboardStats: () => ({ data: { monthlyIncome: 15000, monthlyExpenses: 5000, lastMonthIncome: 12000, lastMonthExpenses: 4000 }, isLoading: false }),
 }));
 vi.mock("@/lib/supabase/client", () => {
-  const accounts = [{ id: "cash", name: "Cash", type: "cash", balance: 10000 }, { id: "bank", name: "Bank", type: "bank", balance: 0 }, { id: "debt", name: "PayLater", type: "credit_card", balance: 0 }];
-  const goals = ["phone", "laptop"].map(id => ({ id, name: id, target_amount: 5000, allocation_per_cycle: 500, allocation_frequency: "monthly", is_completed: false }));
+  const accounts = [
+    { id: db.cashId, name: "Cash", type: "cash", balance: 10000 },
+    { id: db.bankId, name: "Bank", type: "bank", balance: 0 },
+    { id: db.debtId, name: "PayLater", type: "credit_card", balance: 0 },
+  ];
+  const goals = [{ id: db.phoneId, name: "phone" }, { id: db.laptopId, name: "laptop" }];
   return { createClient: () => ({
-    auth: { getUser: async () => ({ data: { user: { id: "test-user" } } }) },
+    auth: {
+      getUser: async () => ({ data: { user: { id: db.userId } } }),
+      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
+    },
+    async rpc(name: string) {
+      if (name !== "goal_finance_snapshot") return { data: null, error: null };
+      return { data: {
+        goals: goals.map(goal => ({
+          ...goal,
+          user_id: db.userId,
+          target_amount: "5000.00",
+          current_amount: "0.00",
+          target_date: null,
+          color: null,
+          icon: null,
+          is_completed: false,
+          status: "active",
+          review_state: "confirmed",
+          completed_at: null,
+          archived_at: null,
+          is_priority: false,
+          category: "Savings",
+          allocation_per_cycle: "500.00",
+          allocation_frequency: "monthly",
+          created_at: "2026-01-01T00:00:00Z",
+          updated_at: "2026-01-01T00:00:00Z",
+          goalId: goal.id,
+          reserved: "0.00",
+          spent: "0.00",
+          progressAmount: "0.00",
+          remaining: "5000.00",
+          progressPercent: 0,
+          walletReservations: [],
+          legacyTaggedAmount: "0.00",
+        })),
+        wallets: [],
+      }, error: null };
+    },
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
@@ -39,114 +88,114 @@ vi.mock("@/lib/supabase/client", () => {
           return Promise.resolve({ data, error: null }).then(resolve);
         },
       };
       return query;
     },
   }) };
 });
 
 function Progress() {
   const { goals } = useGoals();
-  const phone = goals.find(g => g.id === "phone");
+  const phone = goals.find(g => g.id === db.phoneId);
   return <output aria-label="Phone funding">{phone?.saved ?? 0}/{phone?.progressPercent ?? 0}</output>;
 }
 
 const config = { dedupingInterval: 0, revalidateOnFocus: false };
 beforeEach(() => { db.transactions = []; db.failInsert = false; db.delayLoad = null; });
 afterEach(cleanup);
 
 test("goal shortcut selects the goal, leaves wallet empty and resets between openings", async () => {
-  const view = render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="phone" /></SWRConfig>);
+  const view = render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "phone" });
-  expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe("phone");
+  expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe(db.phoneId);
   expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe("");
   view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen={false} onClose={() => {}} /></SWRConfig>);
-  view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="laptop" /></SWRConfig>);
-  await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe("laptop"));
+  view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.laptopId} /></SWRConfig>);
+  await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe(db.laptopId));
 });
 
 test.each(["Expense", "Transfer", "Income"])("%s saves correct goal association and refreshes actual progress", async (type) => {
   const user = userEvent.setup();
-  render(<SWRConfig value={config}><Progress /><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="phone" /></SWRConfig>);
+  render(<SWRConfig value={config}><Progress /><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "phone" });
   await user.click(screen.getByRole("button", { name: type }));
-  await user.selectOptions(screen.getByLabelText(type === "Transfer" ? "From Account" : "Account"), "cash");
-  if (type === "Transfer") await user.selectOptions(screen.getByLabelText("To Account"), "bank");
+  await user.selectOptions(screen.getByLabelText(type === "Transfer" ? "From Account" : "Account"), db.cashId);
+  if (type === "Transfer") await user.selectOptions(screen.getByLabelText("To Account"), db.bankId);
   if (type === "Income") expect(screen.queryByLabelText("Goal (Optional)")).toBeNull();
   await user.type(screen.getByLabelText("Amount"), "500");
   await user.click(screen.getByRole("button", { name: "Add Transaction" }));
   await waitFor(() => expect(db.transactions).toHaveLength(1));
-  expect(db.transactions[0].goal_id).toBe(type === "Income" ? null : "phone");
-  await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe(type === "Income" ? "0/0" : "500/10"));
+  expect(db.transactions[0].goal_id).toBe(type === "Income" ? null : db.phoneId);
+  await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe("0/0"));
 });
 
 test("failed save and cancellation do not add funding; Escape closes the dialog", async () => {
   db.failInsert = true;
   const close = vi.fn();
   const user = userEvent.setup();
-  render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={close} defaultGoalId="phone" /></SWRConfig>);
+  render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={close} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "phone" });
-  await user.selectOptions(screen.getByLabelText("Account"), "cash");
+  await user.selectOptions(screen.getByLabelText("Account"), db.cashId);
   await user.type(screen.getByLabelText("Amount"), "500");
   await user.click(screen.getByRole("button", { name: "Add Transaction" }));
   await waitFor(() => expect((screen.getByRole("button", { name: "Add Transaction" }) as HTMLButtonElement).disabled).toBe(false));
   expect(db.transactions).toHaveLength(0);
   fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
   expect(close).toHaveBeenCalledTimes(1);
 });
 
 test("reopening a contribution cannot submit a wallet retained from the previous goal while accounts load", async () => {
   const user = userEvent.setup();
-  const view = render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="phone" /></SWRConfig>);
+  const view = render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "Cash" });
-  await user.selectOptions(screen.getByLabelText("Account"), "cash");
+  await user.selectOptions(screen.getByLabelText("Account"), db.cashId);
   view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen={false} onClose={() => {}} /></SWRConfig>);
   let release!: () => void;
   db.delayLoad = new Promise<void>(resolve => { release = resolve; });
-  view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="laptop" /></SWRConfig>);
+  view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.laptopId} /></SWRConfig>);
   expect((screen.getByRole("button", { name: /Add Transaction|Loading accounts/ }) as HTMLButtonElement).disabled).toBe(true);
   release();
   await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe(""));
 });
 
-test("tagged installments count once, and untagged saves remain unassociated", async () => {
+test("legacy goal-tagged installments remain history and do not reserve funds", async () => {
   const user = userEvent.setup();
-  const view = render(<SWRConfig value={config}><Progress /><AddTransactionModal isOpen onClose={() => {}} defaultGoalId="phone" /></SWRConfig>);
+  const view = render(<SWRConfig value={config}><Progress /><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "Cash" });
   await user.click(screen.getByLabelText("PayLater purchase (adds to debt)"));
   await user.selectOptions(screen.getByLabelText("Installments"), "3");
   await user.type(screen.getByLabelText("Amount"), "300");
   await user.click(screen.getByRole("button", { name: "Add Transaction" }));
   await waitFor(() => expect(db.transactions).toHaveLength(3));
-  expect(db.transactions.map(tx => [tx.amount, tx.goal_id])).toEqual([[100, "phone"], [100, "phone"], [100, "phone"]]);
-  await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe("300/6"));
+  expect(db.transactions.map(tx => [tx.amount, tx.goal_id])).toEqual([[100, db.phoneId], [100, db.phoneId], [100, db.phoneId]]);
+  await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe("0/0"));
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
-  await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe("phone"));
+  await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe(db.phoneId));
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
diff --git a/tests/goal-finance-client.test.ts b/tests/goal-finance-client.test.ts
new file mode 100644
index 0000000..fb31143
--- /dev/null
+++ b/tests/goal-finance-client.test.ts
@@ -0,0 +1,89 @@
+import { afterEach, beforeEach, expect, test, vi } from "vitest";
+
+const rpcState = vi.hoisted(() => ({ rpc: vi.fn() }));
+
+vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: rpcState.rpc }) }));
+
+import { applyFinancialCommand, fetchGoalFinance, quoteTransaction } from "@/lib/goals/client";
+import type { GoalFinanceSnapshot, TransactionDraft } from "@/lib/goals/contracts";
+
+const userId = "10000000-0000-4000-8000-000000000001";
+const goalId = "20000000-0000-4000-8000-000000000002";
+const accountId = "30000000-0000-4000-8000-000000000003";
+const requestId = "40000000-0000-4000-8000-000000000004";
+
+const snapshot: GoalFinanceSnapshot = {
+  goals: [{
+    id: goalId, goalId, user_id: userId, name: "Emergency fund", target_amount: "5000.00", current_amount: "5000.00",
+    target_date: null, color: null, icon: null, is_completed: true, status: "completed", review_state: "confirmed",
+    completed_at: null, archived_at: null, is_priority: false, category: "Savings", allocation_per_cycle: "0.00",
+    allocation_frequency: "monthly", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
+    reserved: "0.00", spent: "5000.00", progressAmount: "5000.00", remaining: "0.00", progressPercent: 100,
+    walletReservations: [], legacyTaggedAmount: "0.00",
+  }],
+  wallets: [{ accountId, actual: "8000.00", reserved: "0.00", available: "8000.00" }],
+};
+
+const draft: TransactionDraft = {
+  type: "expense", accountId, transferToAccountId: null, categoryId: null, goalId: null,
+  amount: "12.30", description: "Lunch", date: "2026-10-07", installments: null, reservationMoves: [],
+};
+
+beforeEach(() => rpcState.rpc.mockReset());
+afterEach(() => vi.clearAllMocks());
+
+test("serializes canonical money strings at the quote RPC boundary", async () => {
+  rpcState.rpc.mockResolvedValue({ data: { fingerprint: "fresh", actual: "12.30", reserved: "0.00", available: "8000.00", releases: [] }, error: null });
+
+  const quote = await quoteTransaction(draft);
+
+  expect(quote.actual).toBe("12.30");
+  expect(rpcState.rpc).toHaveBeenCalledWith("goal_transaction_quote", {
+    p_draft: draft,
+    p_releases: null,
+  });
+});
+
+test("rejects malformed snapshot RPC results instead of coercing amounts", async () => {
+  rpcState.rpc.mockResolvedValue({ data: { goals: [{ ...snapshot.goals[0], target_amount: 5000 }], wallets: [] }, error: null });
+
+  await expect(fetchGoalFinance()).rejects.toThrow();
+});
+
+test("preserves named SQL errors and corrective HINT text", async () => {
+  rpcState.rpc.mockResolvedValue({ data: null, error: { message: "INSUFFICIENT_AVAILABLE", hint: "Release or move a reservation first." } });
+
+  await expect(applyFinancialCommand(requestId, { kind: "reserve", goalId, accountId, amount: "1.00" }))
+    .rejects.toMatchObject({ code: "INSUFFICIENT_AVAILABLE", hint: "Release or move a reservation first.", outcome: "rejected" });
+});
+
+test("retry recovers a committed operation using the caller's same UUID", async () => {
+  rpcState.rpc
+    .mockResolvedValueOnce({ data: { operationId: requestId, transactionIds: [], replayed: false }, error: null })
+    .mockResolvedValueOnce({ data: { operationId: requestId, transactionIds: [], replayed: true }, error: null });
+
+  const command = { kind: "reserve" as const, goalId, accountId, amount: "25.00" };
+  const first = await applyFinancialCommand(requestId, command);
+  const second = await applyFinancialCommand(requestId, command);
+
+  expect(rpcState.rpc).toHaveBeenNthCalledWith(1, "goal_finance_apply", { p_request_id: requestId, p_command: command, p_quote: null });
+  expect(rpcState.rpc).toHaveBeenNthCalledWith(2, "goal_finance_apply", { p_request_id: requestId, p_command: command, p_quote: null });
+  expect(second.operationId).toBe(first.operationId);
+  expect(second.replayed).toBe(true);
+});
+
+test("marks an unclassified transport failure as an unknown outcome", async () => {
+  rpcState.rpc.mockResolvedValue({ data: null, error: { message: "TypeError: Failed to fetch", status: 0 } });
+
+  const error = await applyFinancialCommand(requestId, { kind: "reserve", goalId, accountId, amount: "1.00" })
+    .then(() => null, caught => caught);
+  expect(error).toMatchObject({ outcome: "unknown" });
+});
+
+test("reads fully funded goals without issuing completion writes", async () => {
+  rpcState.rpc.mockResolvedValue({ data: snapshot, error: null });
+
+  await expect(fetchGoalFinance()).resolves.toEqual(snapshot);
+  expect(rpcState.rpc).toHaveBeenCalledTimes(1);
+  expect(rpcState.rpc).toHaveBeenCalledWith("goal_finance_snapshot");
+});
diff --git a/tests/goal-finance-hooks.test.tsx b/tests/goal-finance-hooks.test.tsx
new file mode 100644
index 0000000..fdc7d7a
--- /dev/null
+++ b/tests/goal-finance-hooks.test.tsx
@@ -0,0 +1,169 @@
+import React from "react";
+import { afterEach, expect, test, vi } from "vitest";
+import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
+import useSWR, { SWRConfig, unstable_serialize } from "swr";
+
+const state = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), authListener: null as any }));
+vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
+  rpc: state.rpc,
+  auth: {
+    getUser: state.getUser,
+    onAuthStateChange: (listener: any) => {
+      state.authListener = listener;
+      return { data: { subscription: { unsubscribe() {} } } };
+    },
+  },
+  from: () => ({ select() { return this; }, eq() { return this; }, then(resolve: any) { return Promise.resolve({ data: [], error: null }).then(resolve); } }),
+}) }));
+
+import { useGoalFinance } from "@/hooks/use-goal-finance";
+import { applyAndRefreshFinancialCommand, refreshFinancialData } from "@/lib/refresh-financial-data";
+import { useGoals } from "@/hooks/use-goals";
+
+const userOne = "10000000-0000-4000-8000-000000000001";
+const userTwo = "10000000-0000-4000-8000-000000000002";
+const goalId = "20000000-0000-4000-8000-000000000002";
+const accountId = "30000000-0000-4000-8000-000000000003";
+const requestId = "40000000-0000-4000-8000-000000000004";
+
+function makeSnapshot(userId: string, amount: string) {
+  return {
+    goals: [],
+    wallets: [{ accountId, actual: amount, reserved: "0.00", available: amount }],
+  };
+}
+
+const cache = new Map();
+const provider = () => cache;
+const wrapper = ({ children }: { children: React.ReactNode }) => (
+  <SWRConfig value={{ provider, dedupingInterval: 0, revalidateOnFocus: false }}>{children}</SWRConfig>
+);
+
+afterEach(() => {
+  cleanup();
+  cache.clear();
+  vi.clearAllMocks();
+  state.authListener = null;
+});
+
+test("user-scoped snapshots never show another user's wallets and logout clears the cache", async () => {
+  let activeUser = userOne;
+  state.rpc.mockImplementation(async (name: string) => ({ data: name === "goal_finance_snapshot" ? makeSnapshot(activeUser, activeUser === userOne ? "100.00" : "900.00") : null, error: null }));
+  function Probe({ userId }: { userId: string | null }) {
+    const result = useGoalFinance(userId);
+    return <output aria-label="wallet">{result.data?.wallets[0]?.actual ?? "empty"}</output>;
+  }
+
+  const view = render(<Probe userId={userOne} />, { wrapper });
+  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("100.00"));
+  activeUser = userTwo;
+  view.rerender(<Probe userId={userTwo} />);
+  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("900.00"));
+  view.rerender(<Probe userId={null} />);
+  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("empty"));
+  await waitFor(() => expect((cache.get(unstable_serialize(["goalFinance", userOne])) as any)?.data).toBeUndefined());
+  const requestsBeforeSignIn = state.rpc.mock.calls.length;
+  activeUser = userOne;
+  view.rerender(<Probe userId={userOne} />);
+  await waitFor(() => expect(state.rpc.mock.calls.length).toBe(requestsBeforeSignIn + 1));
+  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("100.00"));
+});
+
+test("refresh revalidates the goal snapshot, history, and existing financial views", async () => {
+  const calls = new Map<string, number>();
+  state.rpc.mockImplementation(async () => ({ data: makeSnapshot(userOne, "100.00"), error: null }));
+
+  function counted(key: string) {
+    return useSWR(key, async () => {
+      calls.set(key, (calls.get(key) ?? 0) + 1);
+      return calls.get(key);
+    });
+  }
+
+  function Probe() {
+    const finance = useGoalFinance(userOne);
+    const history = useSWR(["goalHistory", userOne, goalId], async () => {
+      calls.set("history", (calls.get("history") ?? 0) + 1);
+      return calls.get("history");
+    });
+    counted("accounts");
+    counted("recentTransactions");
+    counted("dashboardStats-2026-10");
+    return <button onClick={() => void finance.refresh()}>refresh {history.data ?? 0}</button>;
+  }
+
+  render(<Probe />, { wrapper });
+  await screen.findByText("refresh 1");
+  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
+  fireEvent.click(screen.getByRole("button", { name: /refresh/ }));
+
+  await waitFor(() => {
+    expect(state.rpc).toHaveBeenCalledTimes(2);
+    expect(calls.get("history")).toBe(2);
+    expect(calls.get("accounts")).toBe(2);
+    expect(calls.get("recentTransactions")).toBe(2);
+    expect(calls.get("dashboardStats-2026-10")).toBe(2);
+  });
+});
+
+test("a committed command stays saved when cache revalidation fails", async () => {
+  const saved = { operationId: requestId, transactionIds: [], replayed: false };
+  state.rpc.mockResolvedValue({ data: saved, error: null });
+  const refreshError = new Error("Snapshot refresh failed");
+  const refresh = vi.fn().mockRejectedValue(refreshError);
+
+  const outcome = await applyAndRefreshFinancialCommand(
+    requestId,
+    { kind: "reserve", goalId, accountId, amount: "25.00" },
+    undefined,
+    refresh,
+  );
+
+  expect(outcome.saved).toEqual(saved);
+  expect(outcome.refreshError).toBe(refreshError);
+  expect(state.rpc).toHaveBeenCalledTimes(1);
+  expect(refresh).toHaveBeenCalledTimes(1);
+});
+
+test("a rejected command does not refresh or mutate cached finance values", async () => {
+  const failure = { message: "INSUFFICIENT_AVAILABLE", hint: "Release funds first." };
+  state.rpc.mockImplementation(async (name: string) => name === "goal_finance_snapshot"
+    ? { data: makeSnapshot(userOne, "100.00"), error: null }
+    : { data: null, error: failure });
+  const refresh = vi.fn(() => refreshFinancialData());
+  function WalletProbe() {
+    const finance = useGoalFinance(userOne);
+    return <output aria-label="available funds">{finance.data?.wallets[0]?.available ?? "loading"}</output>;
+  }
+  render(<WalletProbe />, { wrapper });
+  await waitFor(() => expect(screen.getByLabelText("available funds").textContent).toBe("100.00"));
+
+  await expect(applyAndRefreshFinancialCommand(
+    requestId,
+    { kind: "reserve", goalId, accountId, amount: "25.00" },
+    undefined,
+    refresh,
+  )).rejects.toMatchObject({ code: "INSUFFICIENT_AVAILABLE" });
+  expect(refresh).not.toHaveBeenCalled();
+  expect(screen.getByLabelText("available funds").textContent).toBe("100.00");
+  expect(state.rpc).toHaveBeenCalledTimes(2);
+});
+
+test("a late initial user lookup cannot replace a newer auth session", async () => {
+  let resolveInitial!: (value: { data: { user: { id: string } } }) => void;
+  state.getUser.mockImplementation(() => new Promise(resolve => { resolveInitial = resolve; }));
+  state.rpc.mockResolvedValue({ data: makeSnapshot(userTwo, "900.00"), error: null });
+
+  function Probe() {
+    const goals = useGoals();
+    return <output aria-label="goal load">{goals.isLoading ? "loading" : String(Boolean(goals.isError))}</output>;
+  }
+
+  render(<Probe />, { wrapper });
+  await waitFor(() => expect(state.authListener).toBeTypeOf("function"));
+  state.authListener("SIGNED_IN", { user: { id: userTwo } });
+  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
+  resolveInitial({ data: { user: { id: userOne } } });
+  await waitFor(() => expect(screen.getByLabelText("goal load").textContent).toBe("false"));
+  expect(state.rpc).toHaveBeenCalledTimes(1);
+});
