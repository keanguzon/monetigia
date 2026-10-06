d4dbe29 fix: guard finance refresh and session races
 .../2026-10-06-goal-reservations/task-6-report.md  |  53 +++++++
 src/hooks/use-goal-finance.ts                      |  31 +++-
 src/hooks/use-goals.ts                             |  21 +--
 src/lib/goals/client.ts                            |  40 ++++-
 src/lib/refresh-financial-data.ts                  |  50 +++++-
 tests/contributions.test.tsx                       |  14 +-
 tests/goal-finance-hooks.test.tsx                  | 173 ++++++++++++++++++++-
 tests/goal-summary.test.ts                         |  14 ++
 8 files changed, 359 insertions(+), 37 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-6-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-6-report.md
index 8c6e236..88b4b4d 100644
--- a/.superpowers/sdd/2026-10-06-goal-reservations/task-6-report.md
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-6-report.md
@@ -53,10 +53,63 @@ Output: exit code 0, no diagnostics.
 - `tests/goal-finance-client.test.ts`
 - `tests/goal-finance-hooks.test.tsx`
 - `tests/contributions.test.tsx`
 
 ## Self-review and concerns
 
 - Caller-provided request IDs are validated and passed through unchanged. A replay therefore uses the caller's same UUID. PostgREST status `0` and other ambiguous outcomes stay distinguishable from named server rejections.
 - Goal closure currently submits `leftovers: null`; if reservations remain, the server rejects closure instead of silently releasing them. Task 7 should provide the explicit leftover choice UI.
 - The typed allocation event schema expects canonical decimal strings. Task 7's history reader should normalize valid database decimal text such as `0` to two decimal places using string operations, without float conversion, before parsing events.
 - Transaction entry remains on its existing path for Task 8 to migrate to the command and quote flow.
+
+## Review fix round 1
+
+Addressed the independent review findings:
+
+- Bound each user-scoped snapshot RPC to the access token captured for that request, then rechecked the user, token, request selection revision, and returned goal ownership before accepting the response. This also rejects an older request after a user1 → user2 → user1 switch.
+- Kept `getProjection` comparisons in canonical centavos, including fully funded checks. The numeric compatibility fallback is used only when legacy callers have no canonical amount bridge.
+- Made refresh clear the prior SWR error while retaining cached data, await revalidation, and inspect the current scoped cache error. This detects the same reused `Error` instance. `applyAndRefreshFinancialCommand` now requires a refresh callback so command callers use a hook-scoped refresh with observable errors; the legacy global helper remains for refresh-only paths and documents its cache limitation.
+- Updated the contribution test client fixture for session-bound snapshot requests while preserving its association, reset, cancellation, installment, and navigation coverage.
+
+RED evidence:
+
+```text
+npx vitest run tests/goal-summary.test.ts tests/goal-finance-hooks.test.tsx
+```
+
+Output: 1 failing projection case (expected count 1, received 0); the existing hook cases passed. The canonical display values collapsed to the same JavaScript number at the safe-centavo boundary.
+
+```text
+npx vitest run tests/goal-finance-hooks.test.tsx -t "repeated real SWR"
+```
+
+Output: 1 failing test; the second real mounted-hook revalidation returned `refreshError: null` while SWR retained the same `Error` instance.
+
+GREEN and final verification:
+
+```text
+npx vitest run tests/goal-summary.test.ts tests/goal-finance-hooks.test.tsx tests/goal-finance-client.test.ts
+```
+
+Output: 3 test files passed, 53/53 tests passed.
+
+```text
+npm test
+```
+
+Output: navigation checks 2/2 passed; Vitest 5/5 files and 63/63 tests passed.
+
+```text
+npx tsc --noEmit
+```
+
+Output: exit code 0, no diagnostics.
+
+```text
+npx vitest run tests/contributions.test.tsx
+```
+
+Output: 1 test file passed, 8/8 tests passed after adding the session-bound RPC behavior to its fixture.
+
+Files additionally changed in this round: `src/hooks/use-goal-finance.ts`, `src/hooks/use-goals.ts`, `src/lib/refresh-financial-data.ts`, `tests/goal-finance-hooks.test.tsx`, `tests/goal-summary.test.ts`, and `tests/contributions.test.tsx`.
+
+No remaining concerns identified within Task 6. Future save flows should pass `useGoalFinance().refresh` into `applyAndRefreshFinancialCommand`; the no-cache global helper is for legacy refresh-only flows and cannot report per-key revalidation errors.
diff --git a/src/hooks/use-goal-finance.ts b/src/hooks/use-goal-finance.ts
index 7a4dbda..b72e139 100644
--- a/src/hooks/use-goal-finance.ts
+++ b/src/hooks/use-goal-finance.ts
@@ -1,37 +1,54 @@
 import { useCallback, useEffect, useRef, useState } from "react";
 import useSWR, { useSWRConfig } from "swr";
 import { fetchGoalFinance } from "@/lib/goals/client";
 import type { GoalFinanceSnapshot } from "@/lib/goals/contracts";
 import { refreshFinancialData } from "@/lib/refresh-financial-data";
+import { createClient } from "@/lib/supabase/client";
 
 export function useGoalFinance(userId: string | null) {
   const { mutate: mutateCache } = useSWRConfig();
+  const { cache } = useSWRConfig();
   const [snapshotUserId, setSnapshotUserId] = useState(userId);
-  const selectedUserId = useRef(userId);
-  selectedUserId.current = userId;
+  const selectedUser = useRef({ userId, revision: 0 });
+  if (selectedUser.current.userId !== userId) {
+    selectedUser.current = { userId, revision: selectedUser.current.revision + 1 };
+  }
+  const sessionRevision = useRef(0);
   const key = userId ? ["goalFinance", userId] as const : null;
   const fetchForUser = useCallback(async () => {
-    const snapshot = await fetchGoalFinance();
-    if (selectedUserId.current === userId) setSnapshotUserId(userId);
+    const selection = selectedUser.current;
+    const requestSessionRevision = sessionRevision.current;
+    const isCurrentRequest = () => selectedUser.current.userId === userId &&
+      selectedUser.current.revision === selection.revision &&
+      sessionRevision.current === requestSessionRevision;
+    const snapshot = await fetchGoalFinance(userId ?? undefined, isCurrentRequest);
+    if (isCurrentRequest()) setSnapshotUserId(userId);
     return snapshot;
-  }, [userId]);
+  }, [userId, selectedUser.current.revision]);
   const { data: cachedData, error, isLoading, mutate } = useSWR<GoalFinanceSnapshot>(key, fetchForUser);
 
   useEffect(() => setSnapshotUserId(userId), [userId]);
 
+  useEffect(() => {
+    const { data: { subscription } } = createClient().auth.onAuthStateChange(event => {
+      if (event !== "INITIAL_SESSION") sessionRevision.current += 1;
+    });
+    return () => subscription.unsubscribe();
+  }, []);
+
   useEffect(() => {
     if (userId !== null) return;
     void mutateCache(
       cacheKey => Array.isArray(cacheKey) && (cacheKey[0] === "goalFinance" || cacheKey[0] === "goalHistory"),
       () => undefined,
       { populateCache: true, revalidate: false },
     );
   }, [mutateCache, userId]);
 
   const refresh = useCallback(async () => {
     if (userId === null) return;
-    await refreshFinancialData(userId, mutateCache);
-  }, [mutateCache, userId]);
+    await refreshFinancialData(userId, mutateCache, cache);
+  }, [cache, mutateCache, userId]);
 
   return { data: snapshotUserId === userId ? cachedData : undefined, isLoading, error, refresh, mutate };
 }
diff --git a/src/hooks/use-goals.ts b/src/hooks/use-goals.ts
index 8a72a1e..bb1b23f 100644
--- a/src/hooks/use-goals.ts
+++ b/src/hooks/use-goals.ts
@@ -1,14 +1,14 @@
 import { useEffect, useState } from "react";
 import { useGoalFinance } from "@/hooks/use-goal-finance";
 import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
-import { parseMoney, projectGoal, type ProjectionResult } from "@/lib/goals/summary";
+import { parseMoney, projectGoal, toMinorUnits, type ProjectionResult } from "@/lib/goals/summary";
 import { createClient } from "@/lib/supabase/client";
 import type { GoalFinanceGoal, Money } from "@/lib/goals/contracts";
 import type { GoalInsert, GoalUpdate } from "@/types/database";
 
 const supabase = createClient();
 
 export type GoalWithProgress = Omit<GoalFinanceGoal, "target_amount" | "current_amount" | "allocation_per_cycle"> & {
   target_amount: number;
   current_amount: number;
   allocation_per_cycle: number;
@@ -19,39 +19,40 @@ export type GoalWithProgress = Omit<GoalFinanceGoal, "target_amount" | "current_
 
 export type { ProjectionResult } from "@/lib/goals/summary";
 
 function moneyFromLegacyDisplay(value: number): Money {
   if (!Number.isFinite(value) || value < 0) throw new Error("Goal display amounts must be finite and nonnegative");
   return parseMoney(value.toFixed(2));
 }
 
 export function getProjection(goal: GoalWithProgress): ProjectionResult {
   const isKinsenas = goal.allocation_frequency === "kinsenas";
-  const allocation = goal.allocation_per_cycle;
-  const target = goal.target_amount;
-  const saved = goal.saved;
+  const exactAmounts = goal.financeAmounts ?? {
+    target: moneyFromLegacyDisplay(goal.target_amount),
+    progress: moneyFromLegacyDisplay(goal.saved),
+    allocationPerCycle: moneyFromLegacyDisplay(goal.allocation_per_cycle),
+  };
+  const allocationCents = toMinorUnits(exactAmounts.allocationPerCycle);
+  const targetCents = toMinorUnits(exactAmounts.target);
+  const progressCents = toMinorUnits(exactAmounts.progress);
+  const allocation = allocationCents / 100;
 
-  if (allocation <= 0 || target <= 0 || saved >= target) {
+  if (allocationCents <= 0 || targetCents <= 0 || progressCents >= targetCents) {
     return {
       count: 0,
       unit: isKinsenas ? "paydays" : "months",
       projectedDate: null,
       monthlyAmount: isKinsenas ? allocation * 2 : allocation,
       kinsenasAmount: isKinsenas ? allocation : allocation / 2,
     };
   }
 
-  const exactAmounts = goal.financeAmounts ?? {
-    target: moneyFromLegacyDisplay(target),
-    progress: moneyFromLegacyDisplay(saved),
-    allocationPerCycle: moneyFromLegacyDisplay(allocation),
-  };
   return projectGoal({
     target: exactAmounts.target,
     progressAmount: exactAmounts.progress,
     allocationPerCycle: exactAmounts.allocationPerCycle,
     allocationFrequency: goal.allocation_frequency,
   }, new Date());
 }
 
 function toDisplayGoal(goal: GoalFinanceGoal): GoalWithProgress {
   const saved = Number(goal.progressAmount);
diff --git a/src/lib/goals/client.ts b/src/lib/goals/client.ts
index 8d622c9..56928ee 100644
--- a/src/lib/goals/client.ts
+++ b/src/lib/goals/client.ts
@@ -32,20 +32,27 @@ export class FinancialCommandError extends Error {
     cause?: unknown;
   }) {
     super(options.message, { cause: options.cause });
     this.name = "FinancialCommandError";
     this.code = options.code ?? "TRANSPORT_ERROR";
     this.hint = options.hint ?? null;
     this.outcome = options.outcome;
   }
 }
 
+export class SupersededGoalFinanceRequestError extends Error {
+  constructor() {
+    super("The signed-in user changed while the goal snapshot was loading.");
+    this.name = "SupersededGoalFinanceRequestError";
+  }
+}
+
 const requestIdSchema = z.string().uuid();
 
 function readServerError(error: unknown, ambiguousOutcome = false): FinancialCommandError {
   if (typeof error === "object" && error !== null) {
     const response = error as { message?: unknown; hint?: unknown; status?: unknown };
     const message = typeof response.message === "string" ? response.message : "The server rejected the financial command.";
     const codeMatch = message.match(/\b(INSUFFICIENT_ACTUAL|INSUFFICIENT_AVAILABLE|INSUFFICIENT_RESERVATION|STALE_QUOTE|NEEDS_REVIEW|INVALID_STATE|REQUEST_CONFLICT|NOT_ALLOWED)\b/);
     const code = codeMatch ? FinancialErrorCodeSchema.parse(codeMatch[1]) : undefined;
     const status = typeof response.status === "number" ? response.status : null;
     const uncertainResponse = ambiguousOutcome && (
@@ -68,24 +75,51 @@ function readServerError(error: unknown, ambiguousOutcome = false): FinancialCom
     outcome: "rejected",
     cause: error,
   });
 }
 
 function unknownOutcome(error: unknown): FinancialCommandError {
   const message = error instanceof Error ? error.message : "The financial command response could not be confirmed.";
   return new FinancialCommandError({ message, code: "TRANSPORT_ERROR", outcome: "unknown", cause: error });
 }
 
-export async function fetchGoalFinance(): Promise<GoalFinanceSnapshot> {
-  const { data, error } = await createClient().rpc("goal_finance_snapshot");
+export async function fetchGoalFinance(
+  expectedUserId?: string,
+  isCurrentRequest: () => boolean = () => true,
+): Promise<GoalFinanceSnapshot> {
+  const client = createClient();
+  let requestToken: string | null = null;
+  if (expectedUserId !== undefined) {
+    const { data: { session }, error: sessionError } = await client.auth.getSession();
+    if (sessionError) throw sessionError;
+    if (!session || session.user.id !== expectedUserId || !isCurrentRequest()) {
+      throw new SupersededGoalFinanceRequestError();
+    }
+    requestToken = session.access_token;
+  }
+
+  const request = client.rpc("goal_finance_snapshot");
+  const { data, error } = await (requestToken === null
+    ? request
+    : request.setHeader("Authorization", `Bearer ${requestToken}`));
   if (error) throw readServerError(error);
-  return GoalFinanceSnapshotSchema.parse(data);
+  const snapshot = GoalFinanceSnapshotSchema.parse(data);
+
+  if (expectedUserId !== undefined) {
+    const { data: { session }, error: sessionError } = await client.auth.getSession();
+    if (sessionError) throw sessionError;
+    if (!session || session.user.id !== expectedUserId || session.access_token !== requestToken || !isCurrentRequest() ||
+      snapshot.goals.some(goal => goal.user_id !== expectedUserId)) {
+      throw new SupersededGoalFinanceRequestError();
+    }
+  }
+  return snapshot;
 }
 
 export async function quoteTransaction(draft: TransactionDraft, releases?: ReleaseLine[]): Promise<TransactionQuote> {
   const safeDraft = TransactionDraftSchema.parse(draft);
   const safeReleases = releases === undefined ? null : z.array(ReleaseLineSchema).parse(releases);
   const { data, error } = await createClient().rpc("goal_transaction_quote", {
     p_draft: safeDraft,
     p_releases: safeReleases,
   });
   if (error) throw readServerError(error);
diff --git a/src/lib/refresh-financial-data.ts b/src/lib/refresh-financial-data.ts
index dabcf32..44780db 100644
--- a/src/lib/refresh-financial-data.ts
+++ b/src/lib/refresh-financial-data.ts
@@ -1,35 +1,71 @@
-import { mutate } from "swr";
-import type { ScopedMutator } from "swr";
+import { mutate, unstable_serialize } from "swr";
+import type { Cache, Key, ScopedMutator } from "swr";
 import { applyFinancialCommand } from "@/lib/goals/client";
 import type { FinancialCommand, FinancialResult, TransactionQuote } from "@/lib/goals/contracts";
 
-export async function refreshFinancialData(userId?: string, mutateCache: ScopedMutator = mutate) {
-  await mutateCache((key) => {
+export class FinancialRefreshError extends Error {
+  constructor(readonly failures: unknown[]) {
+    super("The financial change was saved, but some views could not refresh.");
+    this.name = "FinancialRefreshError";
+  }
+}
+
+/**
+ * Revalidate finance views and surface errors from the current pass. Callers
+ * that need refresh status must provide their scoped cache; the global default
+ * exists for legacy refresh-only flows that do not return a save outcome.
+ */
+export async function refreshFinancialData(userId?: string, mutateCache: ScopedMutator = mutate, cache?: Cache) {
+  const matchingKeys: unknown[] = [];
+  const knownKeys = new Set<string>();
+  const matchesKey = (key: unknown) => {
     if (typeof key === "string") {
       return key === "goals" || key === "accounts" || key === "recentTransactions" || key.startsWith("dashboardStats-");
     }
     if (!Array.isArray(key)) return false;
     if (key[0] === "goalFinance" || key[0] === "goalHistory") return userId === undefined || key[1] === userId;
     return false;
-  }, undefined, { revalidate: true });
+  };
+  const rememberMatchingKey = (key: unknown) => {
+    if (!matchesKey(key)) return false;
+    const serialized = unstable_serialize(key as Key);
+    if (!knownKeys.has(serialized)) {
+      knownKeys.add(serialized);
+      matchingKeys.push(key);
+    }
+    return true;
+  };
+
+  // SWR keeps the last fetch error in cache until a successful fetch. Clear it
+  // while preserving the data so this pass can detect a reused Error instance.
+  await mutateCache(rememberMatchingKey, current => current, { populateCache: true, revalidate: false });
+  await mutateCache(rememberMatchingKey);
+
+  if (!cache) return;
+  const failures = matchingKeys.flatMap(key => {
+    const serialized = unstable_serialize(key as Key);
+    const error = cache.get(serialized)?.error;
+    return error ? [error] : [];
+  });
+  if (failures.length > 0) throw new FinancialRefreshError(failures);
 }
 
 export interface FinancialSaveOutcome {
   saved: FinancialResult;
   refreshError: unknown | null;
 }
 
 export async function applyAndRefreshFinancialCommand(
   requestId: string,
   command: FinancialCommand,
-  quote?: TransactionQuote,
-  refresh: () => Promise<unknown> = () => refreshFinancialData(),
+  quote: TransactionQuote | undefined,
+  refresh: () => Promise<unknown>,
 ): Promise<FinancialSaveOutcome> {
   const saved = await applyFinancialCommand(requestId, command, quote);
   try {
     await refresh();
     return { saved, refreshError: null };
   } catch (refreshError) {
     return { saved, refreshError };
   }
 }
diff --git a/tests/contributions.test.tsx b/tests/contributions.test.tsx
index a6c0c13..088fbb5 100644
--- a/tests/contributions.test.tsx
+++ b/tests/contributions.test.tsx
@@ -28,25 +28,27 @@ vi.mock("@/hooks/use-data", () => ({
 vi.mock("@/lib/supabase/client", () => {
   const accounts = [
     { id: db.cashId, name: "Cash", type: "cash", balance: 10000 },
     { id: db.bankId, name: "Bank", type: "bank", balance: 0 },
     { id: db.debtId, name: "PayLater", type: "credit_card", balance: 0 },
   ];
   const goals = [{ id: db.phoneId, name: "phone" }, { id: db.laptopId, name: "laptop" }];
   return { createClient: () => ({
     auth: {
       getUser: async () => ({ data: { user: { id: db.userId } } }),
+      getSession: async () => ({ data: { session: { user: { id: db.userId }, access_token: "fixture-token" } }, error: null }),
       onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
     },
-    async rpc(name: string) {
-      if (name !== "goal_finance_snapshot") return { data: null, error: null };
-      return { data: {
+    rpc(name: string) {
+      const response = Promise.resolve().then(() => {
+        if (name !== "goal_finance_snapshot") return { data: null, error: null };
+        return { data: {
         goals: goals.map(goal => ({
           ...goal,
           user_id: db.userId,
           target_amount: "5000.00",
           current_amount: "0.00",
           target_date: null,
           color: null,
           icon: null,
           is_completed: false,
           status: "active",
@@ -63,20 +65,26 @@ vi.mock("@/lib/supabase/client", () => {
           reserved: "0.00",
           spent: "0.00",
           progressAmount: "0.00",
           remaining: "5000.00",
           progressPercent: 0,
           walletReservations: [],
           legacyTaggedAmount: "0.00",
         })),
         wallets: [],
       }, error: null };
+      });
+      const builder: any = {
+        setHeader() { return builder; },
+        then(resolve: any, reject: any) { return response.then(resolve, reject); },
+      };
+      return builder;
     },
     from(table: string) {
       let inserted: any = null;
       let single = false;
       let id: string | undefined;
       const query: any = {
         select() { return query; }, order() { return query; }, not() { return query; }, in() { return query; }, or() { return query; }, limit() { return query; },
         eq(key: string, value: string) { if (key === "id") id = value; return query; },
         insert(value: any) { inserted = value; return query; }, update() { return query; },
         single() { single = true; return query; },
diff --git a/tests/goal-finance-hooks.test.tsx b/tests/goal-finance-hooks.test.tsx
index fdc7d7a..0f0a4e0 100644
--- a/tests/goal-finance-hooks.test.tsx
+++ b/tests/goal-finance-hooks.test.tsx
@@ -1,22 +1,33 @@
 import React from "react";
-import { afterEach, expect, test, vi } from "vitest";
+import { afterEach, beforeEach, expect, test, vi } from "vitest";
 import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
 import useSWR, { SWRConfig, unstable_serialize } from "swr";
 
-const state = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), authListener: null as any }));
+const state = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getSession: vi.fn(), authListeners: [] as any[], headers: [] as string[] }));
 vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
-  rpc: state.rpc,
+  rpc: (...args: any[]) => {
+    const response = Promise.resolve(state.rpc(...args));
+    const builder: any = {
+      setHeader(name: string, value: string) {
+        state.headers.push(`${name}:${value}`);
+        return builder;
+      },
+      then(resolve: any, reject: any) { return response.then(resolve, reject); },
+    };
+    return builder;
+  },
   auth: {
     getUser: state.getUser,
+    getSession: state.getSession,
     onAuthStateChange: (listener: any) => {
-      state.authListener = listener;
+      state.authListeners.push(listener);
       return { data: { subscription: { unsubscribe() {} } } };
     },
   },
   from: () => ({ select() { return this; }, eq() { return this; }, then(resolve: any) { return Promise.resolve({ data: [], error: null }).then(resolve); } }),
 }) }));
 
 import { useGoalFinance } from "@/hooks/use-goal-finance";
 import { applyAndRefreshFinancialCommand, refreshFinancialData } from "@/lib/refresh-financial-data";
 import { useGoals } from "@/hooks/use-goals";
 
@@ -36,26 +47,34 @@ function makeSnapshot(userId: string, amount: string) {
 const cache = new Map();
 const provider = () => cache;
 const wrapper = ({ children }: { children: React.ReactNode }) => (
   <SWRConfig value={{ provider, dedupingInterval: 0, revalidateOnFocus: false }}>{children}</SWRConfig>
 );
 
 afterEach(() => {
   cleanup();
   cache.clear();
   vi.clearAllMocks();
-  state.authListener = null;
+  state.authListeners = [];
+  state.headers = [];
+});
+
+beforeEach(() => {
+  state.rpc.mockReset();
+  state.getUser.mockReset();
+  state.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: userOne }, access_token: "token-one" } }, error: null });
 });
 
 test("user-scoped snapshots never show another user's wallets and logout clears the cache", async () => {
   let activeUser = userOne;
   state.rpc.mockImplementation(async (name: string) => ({ data: name === "goal_finance_snapshot" ? makeSnapshot(activeUser, activeUser === userOne ? "100.00" : "900.00") : null, error: null }));
+  state.getSession.mockImplementation(async () => ({ data: { session: { user: { id: activeUser }, access_token: activeUser === userOne ? "token-one" : "token-two" } }, error: null }));
   function Probe({ userId }: { userId: string | null }) {
     const result = useGoalFinance(userId);
     return <output aria-label="wallet">{result.data?.wallets[0]?.actual ?? "empty"}</output>;
   }
 
   const view = render(<Probe userId={userOne} />, { wrapper });
   await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("100.00"));
   activeUser = userTwo;
   view.rerender(<Probe userId={userTwo} />);
   await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("900.00"));
@@ -145,25 +164,165 @@ test("a rejected command does not refresh or mutate cached finance values", asyn
     refresh,
   )).rejects.toMatchObject({ code: "INSUFFICIENT_AVAILABLE" });
   expect(refresh).not.toHaveBeenCalled();
   expect(screen.getByLabelText("available funds").textContent).toBe("100.00");
   expect(state.rpc).toHaveBeenCalledTimes(2);
 });
 
 test("a late initial user lookup cannot replace a newer auth session", async () => {
   let resolveInitial!: (value: { data: { user: { id: string } } }) => void;
   state.getUser.mockImplementation(() => new Promise(resolve => { resolveInitial = resolve; }));
+  state.getSession.mockResolvedValue({ data: { session: { user: { id: userTwo }, access_token: "token-two" } }, error: null });
   state.rpc.mockResolvedValue({ data: makeSnapshot(userTwo, "900.00"), error: null });
 
   function Probe() {
     const goals = useGoals();
     return <output aria-label="goal load">{goals.isLoading ? "loading" : String(Boolean(goals.isError))}</output>;
   }
 
   render(<Probe />, { wrapper });
-  await waitFor(() => expect(state.authListener).toBeTypeOf("function"));
-  state.authListener("SIGNED_IN", { user: { id: userTwo } });
+  await waitFor(() => expect(state.authListeners.length).toBeGreaterThan(0));
+  state.authListeners.forEach(listener => listener("SIGNED_IN", { user: { id: userTwo }, access_token: "token-two" }));
   await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
   resolveInitial({ data: { user: { id: userOne } } });
   await waitFor(() => expect(screen.getByLabelText("goal load").textContent).toBe("false"));
   expect(state.rpc).toHaveBeenCalledTimes(1);
 });
+
+test("a token-bound snapshot from a superseded request cannot populate its key after switching back", async () => {
+  let resolveOldSnapshot!: (value: { data: ReturnType<typeof makeSnapshot>; error: null }) => void;
+  let activeUser = userOne;
+  state.getSession.mockImplementation(async () => ({ data: { session: {
+    user: { id: activeUser }, access_token: activeUser === userOne ? "token-one" : "token-two",
+  } }, error: null }));
+  state.rpc
+    .mockImplementationOnce(() => new Promise(resolve => { resolveOldSnapshot = resolve; }))
+    .mockImplementation(async () => ({ data: makeSnapshot(userTwo, "900.00"), error: null }));
+
+  function Probe({ userId }: { userId: string }) {
+    const finance = useGoalFinance(userId);
+    return <output aria-label="wallet">{finance.data?.wallets[0]?.actual ?? "empty"}</output>;
+  }
+
+  const view = render(<Probe userId={userOne} />, { wrapper });
+  await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(1));
+  expect(state.headers[0]).toBe("Authorization:Bearer token-one");
+  activeUser = userTwo;
+  view.rerender(<Probe userId={userTwo} />);
+  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("900.00"));
+  activeUser = userOne;
+  view.rerender(<Probe userId={userOne} />);
+  resolveOldSnapshot({ data: makeSnapshot(userTwo, "900.00"), error: null });
+
+  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).not.toBe("900.00"));
+  expect((cache.get(unstable_serialize(["goalFinance", userOne])) as any)?.data).toBeUndefined();
+});
+
+test("a delayed session lookup cannot start an RPC under a newer user's key", async () => {
+  let resolveSession!: (value: { data: { session: { user: { id: string }; access_token: string } }; error: null }) => void;
+  let activeUser = userTwo;
+  state.getSession
+    .mockImplementationOnce(() => new Promise(resolve => { resolveSession = resolve; }))
+    .mockImplementation(async () => ({ data: { session: {
+      user: { id: activeUser }, access_token: activeUser === userOne ? "token-one" : "token-two",
+    } }, error: null }));
+  state.rpc.mockResolvedValue({ data: makeSnapshot(userTwo, "900.00"), error: null });
+
+  function Probe({ userId }: { userId: string }) {
+    const finance = useGoalFinance(userId);
+    return <output aria-label="wallet">{finance.data?.wallets[0]?.actual ?? "empty"}</output>;
+  }
+
+  const view = render(<Probe userId={userOne} />, { wrapper });
+  await waitFor(() => expect(resolveSession).toBeTypeOf("function"));
+  view.rerender(<Probe userId={userTwo} />);
+  await waitFor(() => expect(screen.getByLabelText("wallet").textContent).toBe("900.00"));
+  resolveSession({ data: { session: { user: { id: userOne }, access_token: "token-one" } }, error: null });
+  await waitFor(() => expect(state.getSession).toHaveBeenCalledTimes(3));
+
+  expect(state.rpc).toHaveBeenCalledTimes(1);
+  expect(state.headers).toEqual(["Authorization:Bearer token-two"]);
+  expect(screen.getByLabelText("wallet").textContent).toBe("900.00");
+});
+
+test("a real SWR refresh error is reported alongside the committed result", async () => {
+  const saved = { operationId: requestId, transactionIds: [], replayed: true };
+  let snapshotReads = 0;
+  state.rpc.mockImplementation(async (name: string) => {
+    if (name === "goal_finance_snapshot") {
+      snapshotReads += 1;
+      return snapshotReads === 1
+        ? { data: makeSnapshot(userOne, "100.00"), error: null }
+        : { data: null, error: { message: "gateway unavailable", status: 503 } };
+    }
+    return { data: saved, error: null };
+  });
+
+  let refreshSnapshot: (() => Promise<void>) | undefined;
+  function Probe() {
+    const finance = useGoalFinance(userOne);
+    refreshSnapshot = finance.refresh;
+    return <output aria-label="available funds">{finance.data?.wallets[0]?.available ?? "loading"}</output>;
+  }
+
+  render(<Probe />, { wrapper });
+  await waitFor(() => expect(screen.getByLabelText("available funds").textContent).toBe("100.00"));
+  expect(snapshotReads).toBe(1);
+  const outcome = await applyAndRefreshFinancialCommand(
+    requestId,
+    { kind: "reserve", goalId, accountId, amount: "25.00" },
+    undefined,
+    async () => { await refreshSnapshot?.(); },
+  );
+
+  expect(outcome.saved).toEqual(saved);
+  expect((cache.get(unstable_serialize(["goalFinance", userOne])) as any)?.error).toBeTruthy();
+  expect(outcome.refreshError).toBeInstanceOf(Error);
+  expect(snapshotReads).toBe(2);
+
+  const repeatedOutcome = await applyAndRefreshFinancialCommand(
+    requestId,
+    { kind: "reserve", goalId, accountId, amount: "25.00" },
+    undefined,
+    async () => { await refreshSnapshot?.(); },
+  );
+  expect(repeatedOutcome.saved).toEqual(saved);
+  expect(repeatedOutcome.refreshError).toBeInstanceOf(Error);
+  expect(snapshotReads).toBe(3);
+});
+
+test("a repeated real SWR refresh failure remains visible when it reuses the same Error", async () => {
+  const saved = { operationId: requestId, transactionIds: [], replayed: true };
+  state.rpc.mockImplementation(async (name: string) => name === "goal_finance_snapshot"
+    ? { data: makeSnapshot(userOne, "100.00"), error: null }
+    : { data: saved, error: null });
+  state.getSession.mockResolvedValue({ data: { session: { user: { id: userOne }, access_token: "token-one" } }, error: null });
+
+  let refreshSnapshot: (() => Promise<void>) | undefined;
+  function Probe() {
+    const finance = useGoalFinance(userOne);
+    refreshSnapshot = finance.refresh;
+    return <output aria-label="available funds">{finance.data?.wallets[0]?.available ?? "loading"}</output>;
+  }
+
+  render(<Probe />, { wrapper });
+  await waitFor(() => expect(screen.getByLabelText("available funds").textContent).toBe("100.00"));
+  const persistentError = new Error("session lookup unavailable");
+  state.getSession.mockRejectedValue(persistentError);
+  const runCommittedRefresh = () => applyAndRefreshFinancialCommand(
+    requestId,
+    { kind: "reserve", goalId, accountId, amount: "25.00" },
+    undefined,
+    async () => { await refreshSnapshot?.(); },
+  );
+
+  const first = await runCommittedRefresh();
+  const firstCacheError = (cache.get(unstable_serialize(["goalFinance", userOne])) as any)?.error;
+  const second = await runCommittedRefresh();
+  const secondCacheError = (cache.get(unstable_serialize(["goalFinance", userOne])) as any)?.error;
+
+  expect(first.refreshError).toBeInstanceOf(Error);
+  expect(second.saved).toEqual(saved);
+  expect(second.refreshError).toBeInstanceOf(Error);
+  expect(firstCacheError).toBe(persistentError);
+  expect(secondCacheError).toBe(persistentError);
+});
diff --git a/tests/goal-summary.test.ts b/tests/goal-summary.test.ts
index c03d073..8ff42b7 100644
--- a/tests/goal-summary.test.ts
+++ b/tests/goal-summary.test.ts
@@ -144,20 +144,34 @@ describe("pure cadence projection", () => {
     vi.useFakeTimers();
     vi.setSystemTime(now);
     try {
       const legacy = { target_amount: 1, saved: 0.1 + 0.2, allocation_per_cycle: 0.1, allocation_frequency: "monthly" } as GoalWithProgress;
       expect(getProjection(legacy)).toMatchObject({ count: 7, monthlyAmount: 0.1, kinsenasAmount: 0.05 });
       expect(getProjection({ ...legacy, target_amount: 0 })).toMatchObject({ count: 0, projectedDate: null });
       expect(getProjection({ ...legacy, allocation_per_cycle: 0 })).toMatchObject({ count: 0, projectedDate: null });
       expect(getProjection({ ...legacy, target_amount: 90071992547400, saved: 0, allocation_per_cycle: 0.01 })).toMatchObject({ count: 9007199254740000, projectedDate: null });
     } finally { vi.useRealTimers(); }
   });
+  test("uses canonical cents when display numbers collapse distinct safe-boundary amounts", () => {
+    vi.useFakeTimers();
+    vi.setSystemTime(now);
+    try {
+      const target = "90071992547409.91";
+      const progress = "90071992547409.90";
+      const canonical = {
+        target_amount: Number(target), saved: Number(progress), allocation_per_cycle: 0.01,
+        allocation_frequency: "monthly", financeAmounts: { target, progress, allocationPerCycle: "0.01" },
+      } as GoalWithProgress;
+      expect(canonical.saved).toBe(canonical.target_amount);
+      expect(getProjection(canonical)).toMatchObject({ count: 1, monthlyAmount: 0.01 });
+    } finally { vi.useRealTimers(); }
+  });
 });
 
 describe("domain JSON parsing", () => {
   const draft = { type: "expense", accountId, transferToAccountId: null, categoryId: null, goalId: null, amount: "100.00", description: null, date: "2026-10-06", installments: null, reservationMoves: [] };
   test("money JSON must already be canonical decimal text", () => {
     expect(MoneySchema.parse("100.00")).toBe("100.00");
     for (const amount of [100, "100", "100.0", "-1.00", "01.00", "90071992547409.92"]) expect(MoneySchema.safeParse(amount).success).toBe(false);
     expect(AllocationEventSchema.parse(event("-1.00", "1.00", { kind: "spend" }))).toEqual(event("-1.00", "1.00", { kind: "spend" }));
     expect(AllocationEventSchema.safeParse(event(1 as unknown as string)).success).toBe(false);
   });
