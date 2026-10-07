95d941d fix(wallets): ignore superseded account and debt loads
 .../2026-10-06-goal-reservations/task-9-report.md  | 10 +++
 src/app/(dashboard)/accounts/page.tsx              | 40 +++++++---
 tests/wallet-reservations.test.tsx                 | 87 +++++++++++++++++++++-
 3 files changed, 124 insertions(+), 13 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md
index 14e9a76..988c176 100644
--- a/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md
@@ -17,10 +17,20 @@ Branch: `codex/goal-reservations`
 - `npx vitest run tests/wallet-reservations.test.tsx` — exit 0; 1 file, 5 tests passed.
 - `npx tsc --noEmit` — exit 0.
 - `npm test` — exit 0; Node tests 2/2; Vitest 8 files, 116 tests passed.
 - `npx vitest run tests/contributions.test.tsx` — exit 0; 1 file, 8 tests passed without maximum-update-depth warnings.
 - No SQL changed, so no database test was run. No live environment or database was accessed.
 - Rendered-browser verification remains with the separate Task 11 gate; the local API preview is blocked by the browser policy in this session.
 
 ## Review boundary
 
 No migration, schema, deployment, push, or merge was performed. The debt audit is documented for an authorized pre-cutover operator; it still requires statement evidence and a read-only review against the actual deployment data.
+
+## Review fix round 1
+
+- Added a monotonically increasing AccountsPage load revision. Every asynchronous boundary checks that its load remains current before writing state; stale catch/finally handlers cannot replace errors or clear loading. Account query changes/errors and effect cleanup invalidate outstanding loads, including on unmount.
+- Shared the effective account collection between the wallet summary and its account-count caption, including locally saved inclusion flags.
+- Added six focused behavior regressions: old debt success, old debt failure, old completion while the new load remains pending, delayed authentication with older account metadata, account-query failure while debt is pending, and the locally saved inclusion toggle's caption/amount scope.
+- TDD evidence: before the fix, the two stale debt cases removed the newer PHP 300 debt and the caption remained at one account after the amount rose to PHP 150,000 (3 failed, 5 passed). After the fix, all focused regressions pass.
+- Final verification: `npm test` exit 0, Node 2/2 and Vitest 8 files / 122 tests; Wallets test file 11/11. `npx tsc --noEmit` exit 0. Existing no-fabricated-zero, no-fetch-balance-write, preview and month-filter tests remain passing.
+- antislop scope gate PASS: the existing layout, visual styles, copy, wallet actions, APY controls, order, debt filters and previews were preserved. The only caption change is using the same account inclusion collection as the amounts; the toggle behavior test exercises that scope.
+- No dependencies, SQL, live database access, push or merge. Root ledger/plan/review files were not edited by this fix.
diff --git a/src/app/(dashboard)/accounts/page.tsx b/src/app/(dashboard)/accounts/page.tsx
index a41b99c..de6ddb2 100644
--- a/src/app/(dashboard)/accounts/page.tsx
+++ b/src/app/(dashboard)/accounts/page.tsx
@@ -1,13 +1,13 @@
 "use client";
 
-import { useMemo, useState, useEffect } from "react";
+import { useMemo, useState, useEffect, useRef } from "react";
 import dynamic from "next/dynamic";
 import { createClient } from "@/lib/supabase/client";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { formatCurrency, isValidUuid } from "@/lib/utils";
 import { setStoredAccountOrder, sortAccountsWithFallback } from "@/lib/account-order";
 import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuLabel,
@@ -32,20 +32,21 @@ const AddAccountModal = dynamic(() => import("@/components/accounts/AddAccountMo
 });
 
 const AddTransactionModal = dynamic(() => import("@/components/transactions/AddTransactionModal"), {
   ssr: false,
 });
 
 export default function AccountsPage() {
   const supabase = createClient();
   const sb = supabase as any;
   const accountsQuery = useAccounts();
+  const loadRevision = useRef(0);
   const goals = useGoals();
   const [accounts, setAccounts] = useState<any[]>([]);
   const [isModalOpen, setIsModalOpen] = useState(false);
   const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
   const [defaultTransactionAccountId, setDefaultTransactionAccountId] = useState<string | undefined>(undefined);
   const [isLoading, setIsLoading] = useState(true);
   const [interestRateDraft, setInterestRateDraft] = useState<Record<string, string>>({});
 
   const [isDebtLoading, setIsDebtLoading] = useState(false);
   const [debtLoadError, setDebtLoadError] = useState<unknown>(null);
@@ -61,30 +62,32 @@ export default function AccountsPage() {
   const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
   const [editingAccountName, setEditingAccountName] = useState("");
   const { toast } = useToast();
 
   const normalizeLogoFilename = (filename: string) => {
     const cleaned = filename.replace(/^\/?logos\//i, "").replace(/^\//, "");
     return cleaned.replace(/\.avif$/i, ".png");
   };
 
   useEffect(() => {
+    loadRevision.current += 1;
     if (accountsQuery.error) {
       setAccountLoadError(accountsQuery.error);
       setDebtLoadError(accountsQuery.error);
       setAccounts([]);
       setIsLoading(false);
       setIsDebtLoading(false);
       return;
     }
     if (accountsQuery.data === undefined) return;
     void loadAccounts(accountsQuery.data);
+    return () => { loadRevision.current += 1; };
   }, [accountsQuery.data, accountsQuery.error]);
 
   useEffect(() => {
     setInterestRateDraft((prev) => {
       const next = { ...prev };
       for (const acc of accounts || []) {
         if (!acc?.id) continue;
         if (!acc?.is_savings) continue;
         if (next[acc.id] === undefined) {
           next[acc.id] = String(Number(acc?.interest_rate || 0));
@@ -244,58 +247,65 @@ export default function AccountsPage() {
     }
 
     toast({ title: "Wallet renamed", description: "The wallet has been successfully renamed." });
     setEditingAccountId(null);
     loadAccounts();
   };
 
   const isCustomAccount = (account: any) => !account.icon && account.name !== "Cash on Hand";
 
   const loadAccounts = async (providedAccounts?: any[]) => {
+    const revision = ++loadRevision.current;
+    const isCurrentLoad = () => revision === loadRevision.current;
     setIsLoading(true);
     setAccountLoadError(null);
     setIsDebtLoading(true);
     try {
       const {
         data: { user },
       } = await supabase.auth.getUser();
+      if (!isCurrentLoad()) return;
       if (!user?.id) throw new Error("Not authenticated");
 
       let accountsList: any[];
       if (providedAccounts !== undefined) {
         accountsList = providedAccounts;
       } else {
         const { data, error } = await supabase
           .from("accounts")
           .select("*")
           .eq("user_id", user.id)
           .order("display_order", { ascending: true })
           .order("created_at", { ascending: true });
 
+        if (!isCurrentLoad()) return;
+
         if (error) {
           const { data: fallbackData, error: fallbackError } = await supabase
             .from("accounts")
             .select("*")
             .eq("user_id", user.id)
             .order("created_at", { ascending: true });
+          if (!isCurrentLoad()) return;
           if (fallbackError) throw fallbackError;
           accountsList = fallbackData || [];
         } else {
           accountsList = data || [];
         }
       }
 
       // Apply resilient fallback sorting using localStorage order if display_order is unpopulated.
       accountsList = sortAccountsWithFallback(accountsList, user.id);
       setAccounts(accountsList);
       if (providedAccounts === undefined) {
         await accountsQuery.mutate(accountsList, { revalidate: false });
+        if (!isCurrentLoad()) return;
       }
 
       const creditIds = accountsList
         .filter((account: any) => account?.type === "credit_card")
         .map((account: any) => account.id)
         .filter(Boolean);
 
       if (creditIds.length === 0) {
         setDebtByMonth({});
         setExpenseItemsByMonth({});
@@ -316,20 +326,22 @@ export default function AccountsPage() {
           .or(`account_id.in.(${creditIds.join(",")}),transfer_to_account_id.in.(${creditIds.join(",")})`)
           .order("date", { ascending: false })
           .limit(5000);
         txData = result.data;
         txError = result.error;
       } catch (error) {
         txData = null;
         txError = error;
       }
 
+      if (!isCurrentLoad()) return;
+
       if (txError) {
         setDebtLoadError(txError);
         setDebtByMonth({});
         setExpenseItemsByMonth({});
         setSelectedDebtMonths([]);
         return;
       }
 
       const byMonth: Record<string, number> = {};
       const itemsByMonth: Record<string, any[]> = {};
@@ -369,25 +381,28 @@ export default function AccountsPage() {
         } else {
           normalizedByMonth[month] = next;
           carry = 0;
         }
       }
 
       setDebtLoadError(null);
       setDebtByMonth(normalizedByMonth);
       setExpenseItemsByMonth(itemsByMonth);
     } catch (error) {
+      if (!isCurrentLoad()) return;
       setAccountLoadError(error);
       setDebtLoadError(error);
     } finally {
-      setIsLoading(false);
-      setIsDebtLoading(false);
+      if (isCurrentLoad()) {
+        setIsLoading(false);
+        setIsDebtLoading(false);
+      }
     }
   };
 
   const handleDragStart = (index: number) => {
     setDraggedIndex(index);
   };
 
   const handleDragOver = (e: React.DragEvent, index: number) => {
     e.preventDefault();
     if (draggedIndex === null || draggedIndex === index) return;
@@ -430,37 +445,40 @@ export default function AccountsPage() {
 
       await Promise.allSettled(updates);
     } catch (err) {
       console.warn("Could not sync display_order to remote database:", err);
     }
 
     toast({ title: "Order saved", description: "Your wallet order has been updated." });
     setIsEditingOrder(false);
   };
 
+  const summaryAccounts = useMemo(() => {
+    const localInclusion = new Map(accounts.map(account => [account.id, account.include_in_networth]));
+    return (accountsQuery.data ?? accounts).map(account =>
+      localInclusion.has(account.id)
+        ? { ...account, include_in_networth: localInclusion.get(account.id) }
+        : account
+    );
+  }, [accounts, accountsQuery.data]);
+
   const walletSummaryResult = useMemo(() => {
     if (!goals.financeSnapshot) return { summary: null, error: null as unknown };
     try {
-      const localInclusion = new Map(accounts.map(account => [account.id, account.include_in_networth]));
-      const summaryAccounts = (accountsQuery.data ?? accounts).map(account =>
-        localInclusion.has(account.id)
-          ? { ...account, include_in_networth: localInclusion.get(account.id) }
-          : account
-      );
       return {
         summary: summarizeWalletFunds(summaryAccounts, goals.financeSnapshot.wallets),
         error: null as unknown,
       };
     } catch (error) {
       return { summary: null, error };
     }
-  }, [accounts, accountsQuery.data, goals.financeSnapshot]);
+  }, [summaryAccounts, goals.financeSnapshot]);
   const walletSummaryError = accountsQuery.error || accountLoadError || goals.isError || walletSummaryResult.error ||
     (!goals.isLoading && !goals.financeSnapshot ? new Error("Finance snapshot is unavailable") : null);
   const walletSummaryLoading = isLoading || accountsQuery.isLoading || goals.isLoading;
   const currentMoney = walletSummaryResult.summary ? Number(walletSummaryResult.summary.netWorth) : 0;
 
   const sortedMonths = useMemo(() => {
     const keys = Object.keys(debtByMonth).filter((k) => {
       if (!k || k === "unknown") return false;
       const debt = Math.max(0, Number(debtByMonth[k] || 0));
       return debt > 0.005; // Only show months with meaningful outstanding debt
@@ -566,21 +584,21 @@ export default function AccountsPage() {
                     </output>
                   )}
                 </div>
                 {previewAfterPay && !debtLoadError && !walletSummaryError && (
                   <span className="text-xs tabular-nums text-muted-foreground font-medium">
                     (reflecting -{formatCurrency(Math.abs(selectedDebt))} debt deduction)
                   </span>
                 )}
               </div>
               <div className="text-xs text-muted-foreground">
-                {walletSummaryLoading ? <Skeleton className="h-4 w-64 max-w-full" /> : walletSummaryError ? "Wallet balance details are unavailable." : <>Aggregated balance across {(accountsQuery.data ?? accounts).filter((a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false).length} accounts (excluding credit card debt).</>}
+                {walletSummaryLoading ? <Skeleton className="h-4 w-64 max-w-full" /> : walletSummaryError ? "Wallet balance details are unavailable." : <>Aggregated balance across {summaryAccounts.filter((a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false).length} accounts (excluding credit card debt).</>}
               </div>
             </div>
 
             {/* Inline Debt Deduction Bar */}
             <div className="flex flex-wrap items-center gap-2 pt-1 lg:pt-0">
               <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs">
                 <span className="text-muted-foreground">Outstanding Debt:</span>
                 <span className="font-heading tabular-nums font-bold text-rose-600 dark:text-rose-400">
                   {isDebtLoading ? "..." : debtLoadError ? "Unavailable" : `-${formatCurrency(Math.abs(selectedDebt))}`}
                 </span>
diff --git a/tests/wallet-reservations.test.tsx b/tests/wallet-reservations.test.tsx
index 43836b8..225b736 100644
--- a/tests/wallet-reservations.test.tsx
+++ b/tests/wallet-reservations.test.tsx
@@ -1,13 +1,13 @@
 import React from "react";
 import { afterEach, beforeEach, expect, test, vi } from "vitest";
-import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
+import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
 import userEvent from "@testing-library/user-event";
 import { SWRConfig } from "swr";
 import AccountsPage from "@/app/(dashboard)/accounts/page";
 import DashboardPage from "@/app/(dashboard)/dashboard/page";
 import { useGoals } from "@/hooks/use-goals";
 import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
 import { formatCurrency } from "@/lib/utils";
 
 const fixture = vi.hoisted(() => {
   const userId = "10000000-0000-4000-8000-000000000001";
@@ -22,30 +22,33 @@ const fixture = vi.hoisted(() => {
     accounts: [] as any[],
     transactions: [] as any[],
     snapshot: { goals: [], wallets: [] } as any,
     nextSnapshot: null as any,
     accountReadError: null as unknown,
     transactionReadError: null as unknown,
     financeReadError: null as unknown,
     accountWrites: [] as any[],
     applyCalls: [] as any[],
     accountReads: 0,
+    transactionResponses: [] as Promise<any>[],
+    transactionReads: 0,
+    authResponses: [] as Promise<any>[],
   };
 });
 
 vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
 vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
 
 vi.mock("@/lib/supabase/client", () => ({
   createClient: () => ({
     auth: {
-      getUser: async () => ({ data: { user: { id: fixture.userId } }, error: null }),
+      getUser: async () => fixture.authResponses.shift() ?? ({ data: { user: { id: fixture.userId } }, error: null }),
       onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
     },
     from: (table: string) => {
       let action: "select" | "update" = "select";
       const query: any = {
         select() { return query; },
         eq() { return query; },
         order() { return query; },
         or() { return query; },
         limit() { return query; },
@@ -56,20 +59,23 @@ vi.mock("@/lib/supabase/client", () => ({
           fixture.accountWrites.push(values);
           return query;
         },
         then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
           if (action === "update") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
           if (table === "accounts") {
             fixture.accountReads += 1;
             return Promise.resolve({ data: fixture.accounts, error: fixture.accountReadError }).then(resolve, reject);
           }
           if (table === "transactions") {
+            fixture.transactionReads += 1;
+            const pending = fixture.transactionResponses.shift();
+            if (pending) return pending.then(resolve, reject);
             return Promise.resolve({ data: fixture.transactions, error: fixture.transactionReadError }).then(resolve, reject);
           }
           return Promise.resolve({ data: [], error: null }).then(resolve, reject);
         },
       };
       return query;
     },
   }),
 }));
 
@@ -139,28 +145,105 @@ beforeEach(() => {
   fixture.accounts = makeAccounts();
   fixture.transactions = makeTransactions();
   fixture.snapshot = snapshot("0.00");
   fixture.nextSnapshot = null;
   fixture.accountReadError = null;
   fixture.transactionReadError = null;
   fixture.financeReadError = null;
   fixture.accountWrites = [];
   fixture.applyCalls = [];
   fixture.accountReads = 0;
+  fixture.transactionReads = 0;
+  fixture.transactionResponses = [];
+  fixture.authResponses = [];
 });
 
 afterEach(() => {
   cleanup();
   cache.clear();
   vi.clearAllMocks();
 });
 
+test.each([false, true])("newer debt refresh survives an older response (old failure: %s)", async oldFailure => {
+  let resolveOld!: (value: any) => void;
+  fixture.transactionResponses = [new Promise(resolve => { resolveOld = resolve; })];
+  render(<><AccountsPage /><FinanceOperation command={{ kind: "reserve" }} label="Refresh finance" /></>, { wrapper });
+  await waitFor(() => expect(fixture.transactionReads).toBe(1));
+  fixture.accounts = makeAccounts().map(account => ({ ...account, name: account.id === fixture.cashId ? "Fresh wallet" : account.name }));
+  fixture.transactions = [{ ...makeTransactions()[4], amount: 300 }];
+  fireEvent.click(screen.getByRole("button", { name: "Refresh finance" }));
+  await waitFor(() => expect(fixture.transactionReads).toBe(2));
+  await screen.findAllByText(`-${formatCurrency(300)}`);
+  await act(async () => resolveOld({ data: makeTransactions(), error: oldFailure ? new Error("stale debt failure") : null }));
+  expect(screen.queryAllByText(`-${formatCurrency(300)}`).length).toBeGreaterThan(0);
+  expect(screen.queryByText("Unavailable")).toBeNull();
+  expect(screen.getByText("Fresh wallet")).not.toBeNull();
+  expect(fixture.accountWrites).toHaveLength(0);
+});
+
+test("wallet inclusion toggle keeps the summary caption and balance in the same scope", async () => {
+  render(<AccountsPage />, { wrapper });
+  await screen.findByLabelText("Net worth balance");
+  fireEvent.click(document.getElementById(`tile-networth-${fixture.excludedId}`)!);
+  await waitFor(() => expect(screen.getByLabelText("Actual wallet balance").getAttribute("data-money")).toBe("150000.00"));
+  expect(screen.getByText(/Aggregated balance across 2 accounts/)).not.toBeNull();
+});
+
+test("an older completed load cannot end a newer debt loading state", async () => {
+  let resolveOld!: (value: any) => void;
+  let resolveNew!: (value: any) => void;
+  fixture.transactionResponses = [
+    new Promise(resolve => { resolveOld = resolve; }),
+    new Promise(resolve => { resolveNew = resolve; }),
+  ];
+  render(<><AccountsPage /><FinanceOperation command={{ kind: "reserve" }} label="Refresh finance" /></>, { wrapper });
+  await waitFor(() => expect(fixture.transactionReads).toBe(1));
+  fixture.accounts = makeAccounts().map(account => ({ ...account, name: `${account.name} refreshed` }));
+  fireEvent.click(screen.getByRole("button", { name: "Refresh finance" }));
+  await waitFor(() => expect(fixture.transactionReads).toBe(2));
+  await act(async () => resolveOld({ data: makeTransactions(), error: null }));
+  expect(screen.getByText("Outstanding Debt:").parentElement?.textContent).toContain("...");
+  expect(screen.queryByLabelText("Net worth balance")).toBeNull();
+  await act(async () => resolveNew({ data: [{ ...makeTransactions()[4], amount: 300 }], error: null }));
+  expect(screen.getByText("Outstanding Debt:").parentElement?.textContent).toContain(`-${formatCurrency(300)}`);
+});
+
+test("late authentication cannot replace newer account metadata", async () => {
+  render(<><AccountsPage /><FinanceOperation command={{ kind: "reserve" }} label="Refresh finance" /></>, { wrapper });
+  await screen.findByLabelText("Net worth balance");
+  let resolveAuth!: (value: any) => void;
+  const authenticated = { data: { user: { id: fixture.userId } }, error: null };
+  fixture.authResponses = [Promise.resolve(authenticated), new Promise(resolve => { resolveAuth = resolve; })];
+  fixture.accounts = makeAccounts().map(account => ({ ...account, name: account.id === fixture.cashId ? "Old wallet" : account.name }));
+  fireEvent.click(screen.getByRole("button", { name: "Refresh finance" }));
+  await waitFor(() => expect(fixture.authResponses).toHaveLength(0));
+  fixture.accounts = makeAccounts().map(account => ({ ...account, name: account.id === fixture.cashId ? "Newest wallet" : account.name }));
+  fireEvent.click(screen.getByRole("button", { name: "Refresh finance" }));
+  await screen.findByText("Newest wallet");
+  await act(async () => resolveAuth(authenticated));
+  expect(screen.getByText("Newest wallet")).not.toBeNull();
+  expect(screen.queryByText("Old wallet")).toBeNull();
+});
+
+test("an account query failure invalidates outstanding debt reads", async () => {
+  let resolveOld!: (value: any) => void;
+  fixture.transactionResponses = [new Promise(resolve => { resolveOld = resolve; })];
+  render(<><AccountsPage /><FinanceOperation command={{ kind: "reserve" }} label="Refresh finance" /></>, { wrapper });
+  await waitFor(() => expect(fixture.transactionReads).toBe(1));
+  fixture.accountReadError = new Error("accounts unavailable");
+  fireEvent.click(screen.getByRole("button", { name: "Refresh finance" }));
+  await screen.findByText(/wallet balances could not be loaded/i);
+  await act(async () => resolveOld({ data: makeTransactions(), error: null }));
+  expect(screen.getByText("Outstanding Debt:").parentElement?.textContent).toContain("Unavailable");
+  expect(screen.queryByLabelText("Net worth balance")).toBeNull();
+});
+
 test("reservations update the mounted Wallets summary without changing its net worth", async () => {
   const before = snapshot("0.00");
   const after = snapshot("5000.00", "10000.00");
   fixture.nextSnapshot = after;
 
   render(
     <>
       <AccountsPage />
       <FinanceOperation command={{ kind: "reserve", goalId: "20000000-0000-4000-8000-000000000001", accountId: fixture.cashId, amount: "5000.00" }} label="Reserve 5,000" />
     </>,
