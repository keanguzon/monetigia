cb92691 feat: show wallet reserved and available funds consistently
 .../2026-10-06-goal-reservations/task-9-report.md  |  26 ++
 docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md     |   6 +
 src/app/(dashboard)/accounts/page.tsx              | 379 +++++++++++----------
 src/app/(dashboard)/dashboard/page.tsx             |  23 +-
 src/components/ui/financial-summary.tsx            | 116 +++++++
 src/hooks/use-data.ts                              |   7 +-
 tests/contributions.test.tsx                       |  13 +-
 tests/wallet-reservations.test.tsx                 | 251 ++++++++++++++
 8 files changed, 628 insertions(+), 193 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md
new file mode 100644
index 0000000..14e9a76
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md
@@ -0,0 +1,26 @@
+# Task 9 implementation report
+
+Date: 2026-10-07
+Branch: `codex/goal-reservations`
+
+## Changes
+
+- Wallets now shows actual, goal-reserved, and available balances from the finance snapshot while preserving the existing net-worth inclusion rules and credit-card separation. Reservation amounts use canonical decimal strings and integer cents for aggregation.
+- Wallets consumes the shared SWR account data so successful finance-operation revalidation updates a mounted page. Adding a wallet refreshes both account and finance snapshot data.
+- Removed fetch-time credit-card balance writes. Stored card debt remains authoritative for the card tile; the transaction-derived debt preview keeps its existing signs, month normalization, and filters. Debt read errors no longer appear as zero debt or allow a misleading preview.
+- Wallet and Dashboard readers now show an error instead of fabricated zero balances. Dashboard transaction, previous-period, and account-type reader failures propagate to its error state; dashboard metrics remain based on real accounts and transactions.
+- Added five focused UI/read tests. Stabilized the existing contributions test's `useAccounts` mock after verifying its fresh inline array on every render caused a maximum-update-depth loop with the new data refresh effect. Its snapshot now includes the matching active PHP wallet; existing assertions remain intact.
+- Added a rollout checklist for statement-anchored credit opening-balance comparison. No live balances were read and no correction values were invented.
+
+## Verification
+
+- `npx vitest run tests/wallet-reservations.test.tsx` — exit 0; 1 file, 5 tests passed.
+- `npx tsc --noEmit` — exit 0.
+- `npm test` — exit 0; Node tests 2/2; Vitest 8 files, 116 tests passed.
+- `npx vitest run tests/contributions.test.tsx` — exit 0; 1 file, 8 tests passed without maximum-update-depth warnings.
+- No SQL changed, so no database test was run. No live environment or database was accessed.
+- Rendered-browser verification remains with the separate Task 11 gate; the local API preview is blocked by the browser policy in this session.
+
+## Review boundary
+
+No migration, schema, deployment, push, or merge was performed. The debt audit is documented for an authorized pre-cutover operator; it still requires statement evidence and a read-only review against the actual deployment data.
diff --git a/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md b/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
index cebe1ca..5498150 100644
--- a/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
+++ b/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
@@ -55,19 +55,25 @@ Use an isolated Supabase project, apply the baseline and ledger migrations in or
 - `TEST_SUPABASE_SERVICE_ROLE_KEY`
 - `TEST_DATABASE_DISPOSABLE=true`
 - `TEST_DATABASE_URL`, a direct PostgreSQL connection URI used by `psql`; optionally `TEST_PSQL_PATH`.
 
 Then run `npm run test:db`. The test harness creates two independent users, signs each in, creates fixtures, and deletes the fixture users afterward. It never falls back to the application's live environment variables. Database test files run serially so upgrade checks cannot race other test files.
 
 For the local native PostgreSQL/PostgREST setup, use `TEST_DATABASE_ADAPTER` pointing to an ignored module exporting `queryAdmin(sql, params)`, `createUser(email)`, and `deleteUser(id)`. The adapter must return PostgreSQL rows and signed authenticated access tokens. This replaces GoTrue fixture setup only; schema, constraints, privileges, RLS, JWT verification, and HTTP database calls still execute in real PostgreSQL/PostgREST. The ignored local runner loads its own test configuration without reading the application's `.env`.
 
 The upgrade test builds and drops a uniquely named isolated schema in the disposable database. It verifies first-upgrade preservation and safe reapplication. Never run the test suite against production.
 
+## Credit-card opening-balance audit before cutover
+
+No live account balances were audited during local implementation. Before cutover, record each card's stored `accounts.balance` with its review timestamp and compare it with a statement-anchored ledger calculation: statement-confirmed opening debt plus card expenses and transfers from the card, less card income and transfers to the card, through the same cutoff. Record the statement date, transaction coverage, derived amount, stored amount, and difference for each card. If a trustworthy starting statement or complete transaction coverage is unavailable, mark the comparison unresolved and obtain a statement or other source evidence before proposing a correction.
+
+Keep this reconciliation separate from Wallets' normalized monthly debt buckets. Those buckets preserve the current payment and cash-advance preview signs and month filters; they do not establish an opening balance. Never overwrite stored credit debt with a month-derived sum during fetch or use a page load to repair a discrepancy. Any correction needs a separate review with source evidence and explicit confirmation.
+
 ## Coordinated cutover
 
 1. Capture the deployed-schema evidence above and audit existing debt discrepancies without correcting balances automatically.
 2. Apply reviewed additive migrations after deployment authorization. Verify legacy goals require review and newly created goals are confirmed.
 3. Update every financial writer to the atomic RPC lane, including expense, transfer, installments, deletion, legacy adoption, and lifecycle actions. Remove fetch-time balance writes.
 4. Audit old RPC grants and restrict direct transaction, balance, lifecycle, and allocation mutations as a coordinated cutover. Retain opening-balance account creation and safe metadata changes.
 5. Run integration and owner-isolation checks, then verify the user examples and cache refresh behavior.
 
 Once reservations exist, a rollback to legacy writers can corrupt available money. Preserve ledger history and use a forward fix or temporarily disable writes if the cutover fails.
diff --git a/src/app/(dashboard)/accounts/page.tsx b/src/app/(dashboard)/accounts/page.tsx
index 91850df..a41b99c 100644
--- a/src/app/(dashboard)/accounts/page.tsx
+++ b/src/app/(dashboard)/accounts/page.tsx
@@ -12,65 +12,80 @@ import {
   DropdownMenuContent,
   DropdownMenuLabel,
   DropdownMenuCheckboxItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
 } from "@/components/ui/dropdown-menu";
 import { ChevronDown, Plus, Wallet, Edit2, LayoutGrid, List } from "lucide-react";
 import { useToast } from "@/components/ui/use-toast";
 import { CardSkeleton } from "@/components/ui/skeleton";
 import { Skeleton } from "@/components/ui/skeleton";
-import { summaryPanelClass, summaryAmountClass, pageTitleClass } from "@/components/ui/financial-summary";
+import { summaryPanelClass, summaryAmountClass, pageTitleClass, summarizeWalletFunds, WalletFundsBreakdown } from "@/components/ui/financial-summary";
 import { motion, AnimatePresence } from "framer-motion";
 import { WalletTileCard } from "@/components/accounts/WalletTileCard";
 import { WalletLedgerView } from "@/components/accounts/WalletLedgerView";
 import { DebtScheduleSection } from "@/components/accounts/DebtScheduleSection";
+import { useAccounts } from "@/hooks/use-data";
+import { useGoals } from "@/hooks/use-goals";
 
 const AddAccountModal = dynamic(() => import("@/components/accounts/AddAccountModal"), {
   ssr: false,
 });
 
 const AddTransactionModal = dynamic(() => import("@/components/transactions/AddTransactionModal"), {
   ssr: false,
 });
 
 export default function AccountsPage() {
   const supabase = createClient();
   const sb = supabase as any;
+  const accountsQuery = useAccounts();
+  const goals = useGoals();
   const [accounts, setAccounts] = useState<any[]>([]);
   const [isModalOpen, setIsModalOpen] = useState(false);
   const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
   const [defaultTransactionAccountId, setDefaultTransactionAccountId] = useState<string | undefined>(undefined);
   const [isLoading, setIsLoading] = useState(true);
   const [interestRateDraft, setInterestRateDraft] = useState<Record<string, string>>({});
 
   const [isDebtLoading, setIsDebtLoading] = useState(false);
+  const [debtLoadError, setDebtLoadError] = useState<unknown>(null);
+  const [accountLoadError, setAccountLoadError] = useState<unknown>(null);
   const [debtByMonth, setDebtByMonth] = useState<Record<string, number>>({});
   const [expenseItemsByMonth, setExpenseItemsByMonth] = useState<Record<string, any[]>>({});
   const [selectedDebtMonths, setSelectedDebtMonths] = useState<string[]>([]);
   const [previewAfterPay, setPreviewAfterPay] = useState(false);
   const [isEditingOrder, setIsEditingOrder] = useState(false);
   const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
   const [accountToDelete, setAccountToDelete] = useState<string | null>(null);
   const [walletView, setWalletView] = useState<"tiles" | "details">("tiles");
   const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
   const [editingAccountName, setEditingAccountName] = useState("");
   const { toast } = useToast();
 
   const normalizeLogoFilename = (filename: string) => {
     const cleaned = filename.replace(/^\/?logos\//i, "").replace(/^\//, "");
     return cleaned.replace(/\.avif$/i, ".png");
   };
 
   useEffect(() => {
-    loadAccounts();
-  }, []);
+    if (accountsQuery.error) {
+      setAccountLoadError(accountsQuery.error);
+      setDebtLoadError(accountsQuery.error);
+      setAccounts([]);
+      setIsLoading(false);
+      setIsDebtLoading(false);
+      return;
+    }
+    if (accountsQuery.data === undefined) return;
+    void loadAccounts(accountsQuery.data);
+  }, [accountsQuery.data, accountsQuery.error]);
 
   useEffect(() => {
     setInterestRateDraft((prev) => {
       const next = { ...prev };
       for (const acc of accounts || []) {
         if (!acc?.id) continue;
         if (!acc?.is_savings) continue;
         if (next[acc.id] === undefined) {
           next[acc.id] = String(Number(acc?.interest_rate || 0));
         }
@@ -228,195 +243,152 @@ export default function AccountsPage() {
       return;
     }
 
     toast({ title: "Wallet renamed", description: "The wallet has been successfully renamed." });
     setEditingAccountId(null);
     loadAccounts();
   };
 
   const isCustomAccount = (account: any) => !account.icon && account.name !== "Cash on Hand";
 
-  const loadAccounts = async () => {
+  const loadAccounts = async (providedAccounts?: any[]) => {
     setIsLoading(true);
-    const {
-      data: { user },
-    } = await supabase.auth.getUser();
-
-    if (user?.id) {
-      let accountsList: any[] = [];
-
-      const { data, error } = await supabase
-        .from("accounts")
-        .select("*")
-        .eq("user_id", user.id)
-        .order("display_order", { ascending: true })
-        .order("created_at", { ascending: true });
-
-      if (error) {
-        const { data: fallbackData, error: fallbackErr } = await supabase
+    setAccountLoadError(null);
+    setIsDebtLoading(true);
+    try {
+      const {
+        data: { user },
+      } = await supabase.auth.getUser();
+      if (!user?.id) throw new Error("Not authenticated");
+
+      let accountsList: any[];
+      if (providedAccounts !== undefined) {
+        accountsList = providedAccounts;
+      } else {
+        const { data, error } = await supabase
           .from("accounts")
           .select("*")
           .eq("user_id", user.id)
+          .order("display_order", { ascending: true })
           .order("created_at", { ascending: true });
 
-        if (fallbackErr) {
-          console.error("Failed to load accounts", fallbackErr);
-          accountsList = [];
-        } else {
+        if (error) {
+          const { data: fallbackData, error: fallbackError } = await supabase
+            .from("accounts")
+            .select("*")
+            .eq("user_id", user.id)
+            .order("created_at", { ascending: true });
+          if (fallbackError) throw fallbackError;
           accountsList = fallbackData || [];
+        } else {
+          accountsList = data || [];
         }
-      } else {
-        accountsList = data || [];
       }
 
-      // Apply resilient fallback sorting using localStorage order if display_order is unpopulated
+      // Apply resilient fallback sorting using localStorage order if display_order is unpopulated.
       accountsList = sortAccountsWithFallback(accountsList, user.id);
       setAccounts(accountsList);
+      if (providedAccounts === undefined) {
+        await accountsQuery.mutate(accountsList, { revalidate: false });
+      }
+
+      const creditIds = accountsList
+        .filter((account: any) => account?.type === "credit_card")
+        .map((account: any) => account.id)
+        .filter(Boolean);
+
+      if (creditIds.length === 0) {
+        setDebtByMonth({});
+        setExpenseItemsByMonth({});
+        setSelectedDebtMonths([]);
+        setDebtLoadError(null);
+        return;
+      }
 
-      // Load credit-card (SpayLater) debt from transactions
-      setIsDebtLoading(true);
+      let txData: any[] | null;
+      let txError: unknown;
       try {
-        const creditIds = accountsList
-          .filter((a: any) => a?.type === "credit_card")
-          .map((a: any) => a.id)
-          .filter(Boolean);
-
-        if (creditIds.length === 0) {
-          setDebtByMonth({});
-          setExpenseItemsByMonth({});
-          setSelectedDebtMonths([]);
+        const result = await sb
+          .from("transactions")
+          .select(
+            "id, account_id, type, amount, description, date, transfer_to_account_id, category:categories(id,name,color), account:accounts!account_id(id,name,type)"
+          )
+          .eq("user_id", user.id)
+          .or(`account_id.in.(${creditIds.join(",")}),transfer_to_account_id.in.(${creditIds.join(",")})`)
+          .order("date", { ascending: false })
+          .limit(5000);
+        txData = result.data;
+        txError = result.error;
+      } catch (error) {
+        txData = null;
+        txError = error;
+      }
+
+      if (txError) {
+        setDebtLoadError(txError);
+        setDebtByMonth({});
+        setExpenseItemsByMonth({});
+        setSelectedDebtMonths([]);
+        return;
+      }
+
+      const byMonth: Record<string, number> = {};
+      const itemsByMonth: Record<string, any[]> = {};
+
+      (txData || []).forEach((transaction: any) => {
+        const monthKey = typeof transaction?.date === "string" ? transaction.date.slice(0, 7) : "unknown";
+        if (!byMonth[monthKey]) byMonth[monthKey] = 0;
+        if (!itemsByMonth[monthKey]) itemsByMonth[monthKey] = [];
+
+        const amount = Number(transaction?.amount || 0);
+        const isCreditSource = creditIds.includes(transaction?.account_id);
+        const isCreditDestination = creditIds.includes(transaction?.transfer_to_account_id);
+
+        // Credit expenses and advances add debt; card income and payments reduce it.
+        if (transaction.type === "expense" && isCreditSource) {
+          byMonth[monthKey] += amount;
+          itemsByMonth[monthKey].push(transaction);
+        } else if (transaction.type === "income" && isCreditSource) {
+          byMonth[monthKey] -= amount;
+        } else if (transaction.type === "transfer") {
+          if (isCreditDestination) byMonth[monthKey] -= amount;
+          if (isCreditSource) byMonth[monthKey] += amount;
+        }
+      });
+
+      // Carry historical overpayments into later months, matching the existing preview calculation.
+      const normalizedByMonth: Record<string, number> = {};
+      const ascendingMonths = Object.keys(byMonth)
+        .filter(month => month && month !== "unknown")
+        .sort((left, right) => (left < right ? -1 : 1));
+      let carry = 0;
+      for (const month of ascendingMonths) {
+        const next = Number(byMonth[month] || 0) + carry;
+        if (next < 0) {
+          normalizedByMonth[month] = 0;
+          carry = next;
         } else {
-          const { data: txData, error: txErr } = await sb
-            .from("transactions")
-            .select(
-              "id, account_id, type, amount, description, date, transfer_to_account_id, category:categories(id,name,color), account:accounts!account_id(id,name,type)"
-            )
-            .eq("user_id", user.id)
-            .or(
-              `account_id.in.(${creditIds.join(",")}),transfer_to_account_id.in.(${creditIds.join(",")})`
-            )
-            .order("date", { ascending: false })
-            .limit(5000);
-
-          if (txErr) {
-            console.error("Failed to load debt transactions", txErr);
-            setDebtByMonth({});
-            setExpenseItemsByMonth({});
-            setSelectedDebtMonths([]);
-          } else {
-            const byMonth: Record<string, number> = {};
-            const itemsByMonth: Record<string, any[]> = {};
-            const byCreditAccount: Record<string, number> = {};
-            creditIds.forEach((id: string) => {
-              byCreditAccount[id] = 0;
-            });
-
-            (txData || []).forEach((t: any) => {
-              const monthKey = typeof t?.date === "string" ? t.date.slice(0, 7) : "unknown";
-              if (!byMonth[monthKey]) byMonth[monthKey] = 0;
-              if (!itemsByMonth[monthKey]) itemsByMonth[monthKey] = [];
-
-              const amt = Number(t?.amount || 0);
-              const isCreditSource = creditIds.includes(t?.account_id);
-              const isCreditDestination = creditIds.includes(t?.transfer_to_account_id);
-
-              // Debt math rules:
-              // - expense on credit_card increases debt
-              // - income on credit_card decreases debt
-              // - transfer TO credit_card decreases debt (payment)
-              // - transfer FROM credit_card increases debt (cash advance / movement)
-              if (t.type === "expense" && isCreditSource) {
-                byMonth[monthKey] += amt;
-                byCreditAccount[t.account_id] = Number(byCreditAccount[t.account_id] || 0) + amt;
-                itemsByMonth[monthKey].push(t);
-              } else if (t.type === "income" && isCreditSource) {
-                byMonth[monthKey] -= amt;
-                byCreditAccount[t.account_id] = Number(byCreditAccount[t.account_id] || 0) - amt;
-              } else if (t.type === "transfer") {
-                if (isCreditDestination) byMonth[monthKey] -= amt;
-                if (isCreditSource) byMonth[monthKey] += amt;
-                if (isCreditDestination) {
-                  byCreditAccount[t.transfer_to_account_id] = Number(byCreditAccount[t.transfer_to_account_id] || 0) - amt;
-                }
-                if (isCreditSource) {
-                  byCreditAccount[t.account_id] = Number(byCreditAccount[t.account_id] || 0) + amt;
-                }
-              }
-            });
-
-            // Normalize month buckets so historical overpayments (negative month values)
-            // roll forward to later months instead of inflating visible month totals.
-            const normalizedByMonth: Record<string, number> = {};
-            const ascMonths = Object.keys(byMonth)
-              .filter((k) => k && k !== "unknown")
-              .sort((a, b) => (a < b ? -1 : 1));
-            let carry = 0;
-            for (const m of ascMonths) {
-              const raw = Number(byMonth[m] || 0);
-              const next = raw + carry;
-              if (next < 0) {
-                normalizedByMonth[m] = 0;
-                carry = next;
-              } else {
-                normalizedByMonth[m] = next;
-                carry = 0;
-              }
-            }
-
-            // Keep stored credit-card balances aligned with transaction-derived debt.
-            const nextCreditBalanceById: Record<string, number> = {};
-            creditIds.forEach((id: string) => {
-              nextCreditBalanceById[id] = Math.max(0, Number(byCreditAccount[id] || 0));
-            });
-
-            const creditUpdates = accountsList
-              .filter((a: any) => a?.type === "credit_card" && a?.id)
-              .map((a: any) => {
-                const nextBal = Number(nextCreditBalanceById[a.id] || 0);
-                const currentBal = Number(a?.balance || 0);
-                return { id: a.id, currentBal, nextBal };
-              })
-              .filter((u) => Math.abs(u.nextBal - u.currentBal) > 0.005);
-
-            if (creditUpdates.length > 0) {
-              const syncResults = await Promise.all(
-                creditUpdates.map((u) =>
-                  sb
-                    .from("accounts")
-                    .update({ balance: u.nextBal })
-                    .eq("id", u.id)
-                    .eq("user_id", user.id)
-                )
-              );
-
-              const hasSyncError = syncResults.some((r: any) => !!r?.error);
-              if (hasSyncError) {
-                console.error("Failed to sync one or more credit-card balances from debt history", syncResults);
-              } else {
-                accountsList = accountsList.map((a: any) =>
-                  a?.type === "credit_card" && a?.id
-                    ? { ...a, balance: Number(nextCreditBalanceById[a.id] || 0) }
-                    : a
-                );
-                setAccounts(accountsList);
-              }
-            }
-
-            setDebtByMonth(normalizedByMonth);
-            setExpenseItemsByMonth(itemsByMonth);
-          }
+          normalizedByMonth[month] = next;
+          carry = 0;
         }
-      } finally {
-        setIsDebtLoading(false);
       }
+
+      setDebtLoadError(null);
+      setDebtByMonth(normalizedByMonth);
+      setExpenseItemsByMonth(itemsByMonth);
+    } catch (error) {
+      setAccountLoadError(error);
+      setDebtLoadError(error);
+    } finally {
+      setIsLoading(false);
+      setIsDebtLoading(false);
     }
-    setIsLoading(false);
   };
 
   const handleDragStart = (index: number) => {
     setDraggedIndex(index);
   };
 
   const handleDragOver = (e: React.DragEvent, index: number) => {
     e.preventDefault();
     if (draggedIndex === null || draggedIndex === index) return;
 
@@ -458,27 +430,41 @@ export default function AccountsPage() {
 
       await Promise.allSettled(updates);
     } catch (err) {
       console.warn("Could not sync display_order to remote database:", err);
     }
 
     toast({ title: "Order saved", description: "Your wallet order has been updated." });
     setIsEditingOrder(false);
   };
 
-  const totalBalance = accounts.reduce((sum, acc) => sum + Number(acc.balance), 0);
-
-  const currentMoney = useMemo(() => {
-    return accounts
-      .filter((a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false)
-      .reduce((sum, acc) => sum + Number(acc.balance), 0);
-  }, [accounts]);
+  const walletSummaryResult = useMemo(() => {
+    if (!goals.financeSnapshot) return { summary: null, error: null as unknown };
+    try {
+      const localInclusion = new Map(accounts.map(account => [account.id, account.include_in_networth]));
+      const summaryAccounts = (accountsQuery.data ?? accounts).map(account =>
+        localInclusion.has(account.id)
+          ? { ...account, include_in_networth: localInclusion.get(account.id) }
+          : account
+      );
+      return {
+        summary: summarizeWalletFunds(summaryAccounts, goals.financeSnapshot.wallets),
+        error: null as unknown,
+      };
+    } catch (error) {
+      return { summary: null, error };
+    }
+  }, [accounts, accountsQuery.data, goals.financeSnapshot]);
+  const walletSummaryError = accountsQuery.error || accountLoadError || goals.isError || walletSummaryResult.error ||
+    (!goals.isLoading && !goals.financeSnapshot ? new Error("Finance snapshot is unavailable") : null);
+  const walletSummaryLoading = isLoading || accountsQuery.isLoading || goals.isLoading;
+  const currentMoney = walletSummaryResult.summary ? Number(walletSummaryResult.summary.netWorth) : 0;
 
   const sortedMonths = useMemo(() => {
     const keys = Object.keys(debtByMonth).filter((k) => {
       if (!k || k === "unknown") return false;
       const debt = Math.max(0, Number(debtByMonth[k] || 0));
       return debt > 0.005; // Only show months with meaningful outstanding debt
     });
     keys.sort((a, b) => (a < b ? 1 : -1));
     return keys;
   }, [debtByMonth]);
@@ -515,23 +501,23 @@ export default function AccountsPage() {
     return selectedDebtMonths.join(", ");
   }, [isAllMonthsSelected, selectedDebtMonths, sortedMonths.length]);
 
   const selectedDebt = useMemo(() => {
     if (sortedMonths.length === 0) return 0;
     const months = isAllMonthsSelected ? sortedMonths : selectedDebtMonths;
     return months.reduce((sum, m) => sum + Math.max(0, Number(debtByMonth[m] || 0)), 0);
   }, [debtByMonth, isAllMonthsSelected, selectedDebtMonths, sortedMonths]);
 
   const previewMoney = useMemo(() => {
-    if (!previewAfterPay) return currentMoney;
+    if (!previewAfterPay || debtLoadError) return currentMoney;
     return currentMoney - selectedDebt;
-  }, [currentMoney, previewAfterPay, selectedDebt]);
+  }, [currentMoney, debtLoadError, previewAfterPay, selectedDebt]);
 
   const defaultCreditAccountId = useMemo(() => {
     return accounts.find((a) => a?.type === "credit_card")?.id;
   }, [accounts]);
 
   const handlePayDebt = (accountId?: string) => {
     const targetId = accountId || defaultCreditAccountId;
     if (targetId) {
       setDefaultTransactionAccountId(targetId);
     }
@@ -545,65 +531,71 @@ export default function AccountsPage() {
 
   return (
     <>
       <div className="space-y-6 animate-in fade-in duration-500">
         {/* Header */}
         <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
           <div className="space-y-1">
             <div className="flex items-center gap-2.5">
               <h1 className={pageTitleClass}>Wallets</h1>
               <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
-                {isLoading ? <Skeleton className="h-4 w-14" /> : `${accounts.length} Total`}
+                {walletSummaryLoading ? <Skeleton className="h-4 w-14" /> : accountLoadError ? "Unavailable" : `${accounts.length} Total`}
               </span>
             </div>
             <p className="text-sm text-muted-foreground">
               Manage your financial wallets and accounts
             </p>
           </div>
         </div>
 
         {/* ─── Editorial Balance Masthead (No nested card-in-card) ─── */}
-        <div className={summaryPanelClass} aria-busy={isLoading}>
+        <div className={summaryPanelClass} aria-busy={walletSummaryLoading}>
           <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
             <div className="space-y-1">
               <div className="flex items-center gap-2">
                 <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                   Liquid Assets & Net Worth
                 </span>
               </div>
               <div className="flex flex-wrap items-baseline gap-2.5">
                 <div className={`${summaryAmountClass} text-foreground`}>
-                  {isLoading ? <Skeleton className="h-9 w-48" /> : formatCurrency(previewAfterPay ? previewMoney : currentMoney)}
+                  {walletSummaryLoading ? <Skeleton className="h-9 w-48" /> : walletSummaryError || !walletSummaryResult.summary ? (
+                    <span>Unavailable</span>
+                  ) : (
+                    <output aria-label="Net worth balance" data-money={previewAfterPay && !debtLoadError ? previewMoney.toFixed(2) : walletSummaryResult.summary.netWorth}>
+                      {formatCurrency(previewAfterPay && !debtLoadError ? previewMoney : currentMoney)}
+                    </output>
+                  )}
                 </div>
-                {previewAfterPay && (
+                {previewAfterPay && !debtLoadError && !walletSummaryError && (
                   <span className="text-xs tabular-nums text-muted-foreground font-medium">
                     (reflecting -{formatCurrency(Math.abs(selectedDebt))} debt deduction)
                   </span>
                 )}
               </div>
               <div className="text-xs text-muted-foreground">
-                {isLoading ? <Skeleton className="h-4 w-64 max-w-full" /> : <>Aggregated balance across {accounts.filter((a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false).length} accounts (excluding credit card debt).</>}
+                {walletSummaryLoading ? <Skeleton className="h-4 w-64 max-w-full" /> : walletSummaryError ? "Wallet balance details are unavailable." : <>Aggregated balance across {(accountsQuery.data ?? accounts).filter((a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false).length} accounts (excluding credit card debt).</>}
               </div>
             </div>
 
             {/* Inline Debt Deduction Bar */}
             <div className="flex flex-wrap items-center gap-2 pt-1 lg:pt-0">
               <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs">
                 <span className="text-muted-foreground">Outstanding Debt:</span>
                 <span className="font-heading tabular-nums font-bold text-rose-600 dark:text-rose-400">
-                  {isDebtLoading ? "..." : `-${formatCurrency(Math.abs(selectedDebt))}`}
+                  {isDebtLoading ? "..." : debtLoadError ? "Unavailable" : `-${formatCurrency(Math.abs(selectedDebt))}`}
                 </span>
               </div>
 
               <DropdownMenu>
                 <DropdownMenuTrigger asChild>
-                  <Button size="sm" variant="outline" className="h-8 text-xs font-medium bg-background" disabled={isDebtLoading || sortedMonths.length === 0}>
+                  <Button size="sm" variant="outline" className="h-8 text-xs font-medium bg-background" disabled={isDebtLoading || !!debtLoadError || sortedMonths.length === 0}>
                     {isAllMonthsSelected ? "All months" : selectedMonthsLabel}
                     <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-70" />
                   </Button>
                 </DropdownMenuTrigger>
                 <DropdownMenuContent align="end" className="w-56">
                   <DropdownMenuLabel>Filter by Month</DropdownMenuLabel>
                   <DropdownMenuSeparator />
                   <DropdownMenuCheckboxItem
                     checked={isAllMonthsSelected}
                     onSelect={(e) => e.preventDefault()}
@@ -644,27 +636,32 @@ export default function AccountsPage() {
                       {m}
                     </DropdownMenuCheckboxItem>
                   ))}
                 </DropdownMenuContent>
               </DropdownMenu>
 
               <Button
                 size="sm"
                 variant={previewAfterPay ? "secondary" : "outline"}
                 onClick={() => setPreviewAfterPay((v) => !v)}
-                disabled={isDebtLoading}
+                disabled={isDebtLoading || !!debtLoadError}
                 className="h-8 text-xs font-medium"
               >
                 {previewAfterPay ? "Deduct Debt: Active" : "Deduct Debt: Off"}
               </Button>
             </div>
           </div>
+          <WalletFundsBreakdown
+            summary={walletSummaryResult.summary}
+            isLoading={walletSummaryLoading}
+            error={walletSummaryError}
+          />
         </div>
 
         {/* ─── Wallets & Accounts Section (No outer card, Dual-View: Tiles & Ledger) ─── */}
         <div className="space-y-4">
           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/40">
             <div>
               <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                 <span>Wallets & Accounts</span>
                 {accounts && accounts.length > 0 && (
                   <span className="text-xs px-2 py-0.5 rounded-full font-mono font-medium bg-muted text-muted-foreground">
@@ -815,20 +812,24 @@ export default function AccountsPage() {
                     setAccountToDelete={setAccountToDelete}
                     toggleIncludeInNetworth={toggleIncludeInNetworth}
                     interestRateDraft={interestRateDraft}
                     setInterestRateDraft={setInterestRateDraft}
                     saveInterestRate={saveInterestRate}
                     onPayDebt={handlePayDebt}
                   />
                 </motion.div>
               )}
             </AnimatePresence>
+          ) : !isLoading && accountLoadError ? (
+            <p role="alert" className="rounded-xl border border-border/60 bg-card/20 px-4 py-6 text-center text-sm text-muted-foreground">
+              Wallets could not be loaded. Refresh the page to try again.
+            </p>
           ) : !isLoading ? (
             <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-border/60 bg-card/20 text-center">
               <Wallet className="h-10 w-10 text-muted-foreground/40 mb-3" />
               <p className="text-base font-semibold text-foreground">No wallets configured</p>
               <p className="text-xs text-muted-foreground max-w-sm mb-4 mt-1">
                 Add your bank accounts, digital e-wallets, or cash on hand to track your net worth and expenses.
               </p>
               <Button onClick={() => setIsModalOpen(true)} size="sm" className="font-semibold gap-1.5">
                 <Plus className="h-4 w-4" />
                 Add Your First Wallet
@@ -838,36 +839,42 @@ export default function AccountsPage() {
             <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 md:grid-cols-3 lg:grid-cols-4">
               <CardSkeleton />
               <CardSkeleton />
               <CardSkeleton />
               <CardSkeleton />
             </div>
           )}
         </div>
 
         {/* ─── PayLater & Credit Schedule (No outer card, hairline statement ledger) ─── */}
-        <DebtScheduleSection
-          isDebtLoading={isDebtLoading}
-          sortedMonths={sortedMonths}
-          debtByMonth={debtByMonth}
-          expenseItemsByMonth={expenseItemsByMonth}
-          onPayDebt={handlePayDebt}
-          defaultCreditAccountId={defaultCreditAccountId}
-        />
+        {debtLoadError ? (
+          <p role="alert" className="text-sm text-muted-foreground">
+            Credit debt history could not be loaded. Refresh the page to try again.
+          </p>
+        ) : (
+          <DebtScheduleSection
+            isDebtLoading={isDebtLoading}
+            sortedMonths={sortedMonths}
+            debtByMonth={debtByMonth}
+            expenseItemsByMonth={expenseItemsByMonth}
+            onPayDebt={handlePayDebt}
+            defaultCreditAccountId={defaultCreditAccountId}
+          />
+        )}
       </div >
 
       {/* Add Wallet Modal */}
       <AddAccountModal
         isOpen={isModalOpen}
         onClose={() => {
           setIsModalOpen(false);
-          loadAccounts();
+          void goals.refresh().catch(() => undefined);
         }}
         existingAccounts={accounts.map((acc) => ({ icon: acc.icon, is_savings: acc.is_savings }))}
       />
 
       <AddTransactionModal
         isOpen={isAddTransactionOpen}
         defaultAccountId={defaultTransactionAccountId}
         onClose={() => {
           setIsAddTransactionOpen(false);
           setDefaultTransactionAccountId(undefined);
diff --git a/src/app/(dashboard)/dashboard/page.tsx b/src/app/(dashboard)/dashboard/page.tsx
index 4a30654..adeb326 100644
--- a/src/app/(dashboard)/dashboard/page.tsx
+++ b/src/app/(dashboard)/dashboard/page.tsx
@@ -61,25 +61,26 @@ export default function DashboardPage() {
     return {
       currentStart: toDateString(currentStart),
       currentEnd: toDateString(end),
       previousStart: toDateString(previousStart),
       previousEnd: toDateString(previousEnd),
     };
   };
 
   const { currentStart, currentEnd, previousStart, previousEnd } = getDateRange(dateRange);
 
-  const { data: accounts = [], isLoading: isLoadingAccounts } = useAccounts();
-  const { data: transactions = [], isLoading: isLoadingTx } = useRecentTransactions();
-  const { data: stats, isLoading: isLoadingStats } = useDashboardStats(currentStart, currentEnd, previousStart, previousEnd);
+  const { data: accounts = [], isLoading: isLoadingAccounts, error: accountsError } = useAccounts();
+  const { data: transactions = [], isLoading: isLoadingTx, error: transactionsError } = useRecentTransactions();
+  const { data: stats, isLoading: isLoadingStats, error: statsError } = useDashboardStats(currentStart, currentEnd, previousStart, previousEnd);
 
   const loading = isLoadingAccounts || isLoadingTx || isLoadingStats;
+  const dataError = accountsError || transactionsError || statsError;
   const monthlyIncome = stats?.monthlyIncome || 0;
   const monthlyExpenses = stats?.monthlyExpenses || 0;
   const lastMonthIncome = stats?.lastMonthIncome || 0;
   const lastMonthExpenses = stats?.lastMonthExpenses || 0;
 
   const networthAccounts = accounts.filter(
     (a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false
   );
   const currentMoney = networthAccounts.reduce((sum, acc) => sum + Number(acc.balance), 0) || 0;
   
@@ -142,20 +143,36 @@ export default function DashboardPage() {
           <h2 className={pageTitleClass}>Dashboard</h2>
           <p className="text-xs sm:text-sm text-muted-foreground">
             Your financial overview at a glance.
           </p>
         </div>
         <SummarySkeleton columns={4} />
       </div>
     );
   }
 
+  if (dataError) {
+    return (
+      <div className="space-y-6">
+        <div>
+          <h2 className={pageTitleClass}>Dashboard</h2>
+          <p className="text-xs sm:text-sm text-muted-foreground">
+            Your financial overview at a glance.
+          </p>
+        </div>
+        <p role="alert" className={summaryPanelClass + " text-sm text-muted-foreground"}>
+          Your financial overview could not be loaded. Refresh the page to try again.
+        </p>
+      </div>
+    );
+  }
+
   return (
     <div className="space-y-6 animate-in fade-in duration-500">
       <div className="flex flex-wrap items-start justify-between gap-3">
         <div>
           <h2 className={pageTitleClass}>Dashboard</h2>
           <p className="text-xs sm:text-sm text-muted-foreground">
             Your financial overview at a glance.
           </p>
         </div>
         <div className="flex items-center gap-2">
diff --git a/src/components/ui/financial-summary.tsx b/src/components/ui/financial-summary.tsx
index 43c1aa7..afdc504 100644
--- a/src/components/ui/financial-summary.tsx
+++ b/src/components/ui/financial-summary.tsx
@@ -1,16 +1,132 @@
 import { Skeleton } from "./skeleton";
+import type { WalletFunds, Money } from "@/lib/goals/contracts";
+import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";
 
 export const summaryPanelClass = "rounded-2xl border border-border/40 bg-card/40 p-5 sm:p-7 shadow-sm";
 export const summaryAmountClass = "text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight";
 export const pageTitleClass = "text-2xl sm:text-3xl font-bold tracking-tight text-foreground";
 
+type WalletSummaryAccount = {
+  id: string;
+  balance: number | string | null;
+  type?: string | null;
+  include_in_networth?: boolean | null;
+  currency?: string | null;
+  is_active?: boolean | null;
+};
+
+export type WalletFundsSummary = {
+  netWorth: Money;
+  actual: Money;
+  reserved: Money;
+  available: Money;
+};
+
+function addCents(total: number, amount: number): number {
+  const result = total + amount;
+  if (!Number.isSafeInteger(result)) throw new Error("Wallet total exceeds the safe centavo range");
+  return result;
+}
+
+function accountBalanceCents(balance: number | string | null): number {
+  const amount = Number(balance ?? 0);
+  const cents = Math.round(amount * 100);
+  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents)) {
+    throw new Error("Wallet balance is not a valid amount");
+  }
+  return cents;
+}
+
+export function summarizeWalletFunds(accounts: WalletSummaryAccount[], wallets: WalletFunds[]): WalletFundsSummary {
+  const balances = new Map(wallets.map(wallet => [wallet.accountId, wallet]));
+  let actual = 0;
+  let reserved = 0;
+  let available = 0;
+
+  for (const account of accounts) {
+    if (account.type === "credit_card" || account.include_in_networth === false) continue;
+
+    const funds = balances.get(account.id);
+    if (!funds && account.currency === "PHP" && account.is_active === true) {
+      throw new Error("An eligible wallet is missing from the finance snapshot");
+    }
+
+    if (funds) {
+      actual = addCents(actual, toMinorUnits(funds.actual));
+      reserved = addCents(reserved, toMinorUnits(funds.reserved));
+      available = addCents(available, toMinorUnits(funds.available));
+    } else {
+      const balance = accountBalanceCents(account.balance);
+      actual = addCents(actual, balance);
+      available = addCents(available, balance);
+    }
+  }
+
+  return {
+    netWorth: fromMinorUnits(actual),
+    actual: fromMinorUnits(actual),
+    reserved: fromMinorUnits(reserved),
+    available: fromMinorUnits(available),
+  };
+}
+
+export function WalletFundsBreakdown({
+  summary,
+  isLoading,
+  error,
+}: {
+  summary: WalletFundsSummary | null;
+  isLoading: boolean;
+  error?: unknown;
+}) {
+  if (isLoading) {
+    return (
+      <div role="status" aria-label="Loading wallet balances" className="mt-5 grid grid-cols-1 gap-4 border-t border-border/30 pt-4 sm:grid-cols-3 sm:gap-6">
+        {Array.from({ length: 3 }, (_, index) => (
+          <div key={index} className="space-y-2">
+            <Skeleton className="h-3 w-32" />
+            <Skeleton className="h-6 w-36 max-w-full" />
+          </div>
+        ))}
+      </div>
+    );
+  }
+
+  if (error || !summary) {
+    return (
+      <p role="alert" className="mt-5 border-t border-border/30 pt-4 text-sm text-muted-foreground">
+        Wallet balances could not be loaded. Refresh the page to try again.
+      </p>
+    );
+  }
+
+  const values = [
+    { label: "Actual wallet balance", amount: summary.actual },
+    { label: "Reserved for goals", amount: summary.reserved },
+    { label: "Available to spend", amount: summary.available },
+  ];
+
+  return (
+    <div role="group" aria-label="Wallet funds summary" className="mt-5 grid grid-cols-1 gap-4 border-t border-border/30 pt-4 sm:grid-cols-3 sm:gap-6">
+      {values.map(({ label, amount }, index) => (
+        <div key={label} className={index > 0 ? "border-t border-border/30 pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0" : "min-w-0"}>
+          <p className="text-xs text-muted-foreground">{label}</p>
+          <output aria-label={label} data-money={amount} className="mt-1 block break-words font-heading text-lg font-bold tabular-nums text-foreground">
+            {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(amount))}
+          </output>
+        </div>
+      ))}
+    </div>
+  );
+}
+
 export function SummarySkeleton({ columns = 3 }: { columns?: 3 | 4 }) {
   return (
     <div role="status" aria-label="Loading summary" className={summaryPanelClass}>
       <div
         className={`grid grid-cols-1 gap-6 sm:gap-8 ${
           columns === 4
             ? "sm:grid-cols-2 lg:grid-cols-4"
             : "sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/30"
         }`}
       >
diff --git a/src/hooks/use-data.ts b/src/hooks/use-data.ts
index 405d9fc..199a73d 100644
--- a/src/hooks/use-data.ts
+++ b/src/hooks/use-data.ts
@@ -83,28 +83,33 @@ export function useDashboardStats(
           .gte("date", currentStart)
           .lte("date", currentEnd),
         supabase
           .from("transactions")
           .select("type, amount, account_id, transfer_to_account_id")
           .eq("user_id", user.id)
           .gte("date", previousStart)
           .lte("date", previousEnd)
       ]);
 
+      if (monthTxData.error) throw monthTxData.error;
+      if (lastMonthTxData.error) throw lastMonthTxData.error;
+
       const monthTransactions = monthTxData.data || [];
       const lastMonthTransactions = lastMonthTxData.data || [];
 
       // We need accounts to check for credit_card types (for transfers/debt payments)
-      const { data: accountsData } = await supabase
+      const { data: accountsData, error: accountsError } = await supabase
         .from("accounts")
         .select("id, type")
         .eq("user_id", user.id);
+
+      if (accountsError) throw accountsError;
       
       const accountTypeById = new Map<string, string>();
       (accountsData || []).forEach(a => accountTypeById.set(a.id, a.type));
 
       const isCredit = (accountId?: string | null) => {
         if (!accountId) return false;
         return accountTypeById.get(accountId) === "credit_card";
       };
 
       const income = monthTransactions
diff --git a/tests/contributions.test.tsx b/tests/contributions.test.tsx
index db21073..e1d744f 100644
--- a/tests/contributions.test.tsx
+++ b/tests/contributions.test.tsx
@@ -11,24 +11,25 @@ import AccountsPage from "@/app/(dashboard)/accounts/page";
 import { writeFileSync, mkdirSync } from "node:fs";
 
 const db = vi.hoisted(() => ({
   commands: [] as any[], transactions: [] as any[], failInsert: false, delayLoad: null as Promise<void> | null,
   userId: "10000000-0000-4000-8000-000000000001",
   phoneId: "20000000-0000-4000-8000-000000000001",
   laptopId: "20000000-0000-4000-8000-000000000002",
   cashId: "30000000-0000-4000-8000-000000000001",
   bankId: "30000000-0000-4000-8000-000000000002",
   debtId: "30000000-0000-4000-8000-000000000003",
+  accounts: [] as any[],
 }));
 vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/dashboard" }));
 vi.mock("@/hooks/use-data", () => ({
-  useAccounts: () => ({ data: [{ id: db.cashId, balance: 10000, type: "cash" }], isLoading: false }),
+  useAccounts: () => ({ data: db.accounts, isLoading: false, error: null }),
   useRecentTransactions: () => ({ data: [], isLoading: false }),
   useDashboardStats: () => ({ data: { monthlyIncome: 15000, monthlyExpenses: 5000, lastMonthIncome: 12000, lastMonthExpenses: 4000 }, isLoading: false }),
 }));
 vi.mock("@/lib/supabase/client", () => {
   const accounts = [
     { id: db.cashId, name: "Cash", type: "cash", balance: 10000, currency: "PHP", is_active: true },
     { id: db.bankId, name: "Bank", type: "bank", balance: 0, currency: "PHP", is_active: true },
     { id: db.debtId, name: "PayLater", type: "credit_card", balance: 0, currency: "PHP", is_active: true },
   ];
   const goals = [{ id: db.phoneId, name: "phone" }, { id: db.laptopId, name: "laptop" }];
@@ -72,21 +73,21 @@ vi.mock("@/lib/supabase/client", () => {
           updated_at: "2026-01-01T00:00:00Z",
           goalId: goal.id,
           reserved: "0.00",
           spent: "0.00",
           progressAmount: "0.00",
           remaining: "5000.00",
           progressPercent: 0,
           walletReservations: [],
           legacyTaggedAmount: "0.00",
         })),
-        wallets: [],
+        wallets: [{ accountId: db.cashId, actual: "10000.00", reserved: "0.00", available: "10000.00" }],
       }, error: null };
       });
       const builder: any = {
         setHeader() { return builder; },
         then(resolve: any, reject: any) { return response.then(resolve, reject); },
       };
       return builder;
     },
     from(table: string) {
       let inserted: any = null;
@@ -110,21 +111,27 @@ vi.mock("@/lib/supabase/client", () => {
   }) };
 });
 
 function Progress() {
   const { goals } = useGoals();
   const phone = goals.find(g => g.id === db.phoneId);
   return <output aria-label="Phone funding">{phone?.saved ?? 0}/{phone?.progressPercent ?? 0}</output>;
 }
 
 const config = { dedupingInterval: 0, revalidateOnFocus: false };
-beforeEach(() => { db.transactions = []; db.commands = []; db.failInsert = false; db.delayLoad = null; });
+beforeEach(() => {
+  db.transactions = [];
+  db.commands = [];
+  db.failInsert = false;
+  db.delayLoad = null;
+  db.accounts = [{ id: db.cashId, name: "Cash", type: "cash", currency: "PHP", is_active: true, include_in_networth: true, balance: 10000 }];
+});
 afterEach(cleanup);
 
 test("goal shortcut selects the goal, leaves wallet empty and resets between openings", async () => {
   const view = render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "phone" });
   expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe(db.phoneId);
   expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe("");
   view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen={false} onClose={() => {}} /></SWRConfig>);
   view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.laptopId} /></SWRConfig>);
   await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe(db.laptopId));
diff --git a/tests/wallet-reservations.test.tsx b/tests/wallet-reservations.test.tsx
new file mode 100644
index 0000000..43836b8
--- /dev/null
+++ b/tests/wallet-reservations.test.tsx
@@ -0,0 +1,251 @@
+import React from "react";
+import { afterEach, beforeEach, expect, test, vi } from "vitest";
+import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
+import userEvent from "@testing-library/user-event";
+import { SWRConfig } from "swr";
+import AccountsPage from "@/app/(dashboard)/accounts/page";
+import DashboardPage from "@/app/(dashboard)/dashboard/page";
+import { useGoals } from "@/hooks/use-goals";
+import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
+import { formatCurrency } from "@/lib/utils";
+
+const fixture = vi.hoisted(() => {
+  const userId = "10000000-0000-4000-8000-000000000001";
+  const cashId = "30000000-0000-4000-8000-000000000001";
+  const excludedId = "30000000-0000-4000-8000-000000000002";
+  const creditId = "30000000-0000-4000-8000-000000000003";
+  return {
+    userId,
+    cashId,
+    excludedId,
+    creditId,
+    accounts: [] as any[],
+    transactions: [] as any[],
+    snapshot: { goals: [], wallets: [] } as any,
+    nextSnapshot: null as any,
+    accountReadError: null as unknown,
+    transactionReadError: null as unknown,
+    financeReadError: null as unknown,
+    accountWrites: [] as any[],
+    applyCalls: [] as any[],
+    accountReads: 0,
+  };
+});
+
+vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
+vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
+
+vi.mock("@/lib/supabase/client", () => ({
+  createClient: () => ({
+    auth: {
+      getUser: async () => ({ data: { user: { id: fixture.userId } }, error: null }),
+      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
+    },
+    from: (table: string) => {
+      let action: "select" | "update" = "select";
+      const query: any = {
+        select() { return query; },
+        eq() { return query; },
+        order() { return query; },
+        or() { return query; },
+        limit() { return query; },
+        gte() { return query; },
+        lte() { return query; },
+        update(values: unknown) {
+          action = "update";
+          fixture.accountWrites.push(values);
+          return query;
+        },
+        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
+          if (action === "update") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
+          if (table === "accounts") {
+            fixture.accountReads += 1;
+            return Promise.resolve({ data: fixture.accounts, error: fixture.accountReadError }).then(resolve, reject);
+          }
+          if (table === "transactions") {
+            return Promise.resolve({ data: fixture.transactions, error: fixture.transactionReadError }).then(resolve, reject);
+          }
+          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
+        },
+      };
+      return query;
+    },
+  }),
+}));
+
+vi.mock("@/lib/goals/client", () => ({
+  fetchGoalFinance: vi.fn(async () => {
+    if (fixture.financeReadError) throw fixture.financeReadError;
+    return fixture.snapshot;
+  }),
+  fetchGoalHistory: vi.fn(async () => []),
+  fetchGoalWalletMetadata: vi.fn(async () => []),
+  applyFinancialCommand: vi.fn(async (...args: unknown[]) => {
+    fixture.applyCalls.push(args);
+    if (fixture.nextSnapshot) fixture.snapshot = fixture.nextSnapshot;
+    return { operationId: "40000000-0000-4000-8000-000000000001", transactionIds: [], replayed: false };
+  }),
+}));
+
+const cache = new Map();
+const wrapper = ({ children }: { children: React.ReactNode }) => (
+  <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>
+    {children}
+  </SWRConfig>
+);
+
+function snapshot(mainReserved: string, excludedReserved = "0.00") {
+  const mainAvailable = (3000000 - Number(mainReserved.replace(".", ""))) / 100;
+  const excludedAvailable = (12000000 - Number(excludedReserved.replace(".", ""))) / 100;
+  return {
+    goals: [],
+    wallets: [
+      { accountId: fixture.cashId, actual: "30000.00", reserved: mainReserved, available: mainAvailable.toFixed(2) },
+      { accountId: fixture.excludedId, actual: "120000.00", reserved: excludedReserved, available: excludedAvailable.toFixed(2) },
+    ],
+  };
+}
+
+function makeAccounts() {
+  return [
+    { id: fixture.cashId, user_id: fixture.userId, name: "GoTyme", type: "bank", currency: "PHP", is_active: true, balance: 30000, include_in_networth: true, display_order: 0 },
+    { id: fixture.excludedId, user_id: fixture.userId, name: "Excluded wallet", type: "cash", currency: "PHP", is_active: true, balance: 120000, include_in_networth: false, display_order: 1 },
+    { id: fixture.creditId, user_id: fixture.userId, name: "PayLater", type: "credit_card", currency: "PHP", is_active: true, balance: 8000, include_in_networth: true, display_order: 2 },
+  ];
+}
+
+function makeTransactions() {
+  return [
+    { id: "expense-cash", user_id: fixture.userId, account_id: fixture.cashId, transfer_to_account_id: null, type: "expense", amount: 1000, date: "2026-10-02", description: "Cash expense", category: null, account: { name: "GoTyme" } },
+    { id: "income-cash", user_id: fixture.userId, account_id: fixture.cashId, transfer_to_account_id: null, type: "income", amount: 2500, date: "2026-10-03", description: "Salary", category: null, account: { name: "GoTyme" } },
+    { id: "credit-september-expense", user_id: fixture.userId, account_id: fixture.creditId, transfer_to_account_id: null, type: "expense", amount: 500, date: "2026-09-05", description: "September purchase", category: null, account: { name: "PayLater" } },
+    { id: "credit-september-cash-advance", user_id: fixture.userId, account_id: fixture.creditId, transfer_to_account_id: fixture.cashId, type: "transfer", amount: 200, date: "2026-09-20", description: "Cash advance", category: null, account: { name: "PayLater" } },
+    { id: "credit-october-expense", user_id: fixture.userId, account_id: fixture.creditId, transfer_to_account_id: null, type: "expense", amount: 1000, date: "2026-10-01", description: "October purchase", category: null, account: { name: "PayLater" } },
+    { id: "credit-october-payment", user_id: fixture.userId, account_id: fixture.cashId, transfer_to_account_id: fixture.creditId, type: "transfer", amount: 100, date: "2026-10-04", description: "Debt payment", category: null, account: { name: "GoTyme" } },
+  ];
+}
+
+function FinanceOperation({ command, label }: { command: any; label: string }) {
+  const goals = useGoals();
+  return (
+    <button type="button" onClick={() => void applyAndRefreshFinancialCommand("40000000-0000-4000-8000-000000000002", command, undefined, goals.refresh)}>
+      {label}
+    </button>
+  );
+}
+
+beforeEach(() => {
+  cache.clear();
+  fixture.accounts = makeAccounts();
+  fixture.transactions = makeTransactions();
+  fixture.snapshot = snapshot("0.00");
+  fixture.nextSnapshot = null;
+  fixture.accountReadError = null;
+  fixture.transactionReadError = null;
+  fixture.financeReadError = null;
+  fixture.accountWrites = [];
+  fixture.applyCalls = [];
+  fixture.accountReads = 0;
+});
+
+afterEach(() => {
+  cleanup();
+  cache.clear();
+  vi.clearAllMocks();
+});
+
+test("reservations update the mounted Wallets summary without changing its net worth", async () => {
+  const before = snapshot("0.00");
+  const after = snapshot("5000.00", "10000.00");
+  fixture.nextSnapshot = after;
+
+  render(
+    <>
+      <AccountsPage />
+      <FinanceOperation command={{ kind: "reserve", goalId: "20000000-0000-4000-8000-000000000001", accountId: fixture.cashId, amount: "5000.00" }} label="Reserve 5,000" />
+    </>,
+    { wrapper },
+  );
+
+  const beforeNetWorth = await screen.findByLabelText("Net worth balance");
+  await waitFor(() => expect(screen.getByLabelText("Available to spend").getAttribute("data-money")).toBe("30000.00"));
+  const initialNetWorth = beforeNetWorth.getAttribute("data-money");
+  expect(initialNetWorth).toBe("30000.00");
+  expect(screen.getByLabelText("Actual wallet balance").getAttribute("data-money")).toBe("30000.00");
+  expect(screen.getByLabelText("Reserved for goals").getAttribute("data-money")).toBe("0.00");
+
+  fireEvent.click(screen.getByRole("button", { name: "Reserve 5,000" }));
+
+  await waitFor(() => expect(screen.getByLabelText("Reserved for goals").getAttribute("data-money")).toBe("5000.00"));
+  const afterNetWorth = screen.getByLabelText("Net worth balance").getAttribute("data-money");
+  const afterAvailable = screen.getByLabelText("Available to spend").getAttribute("data-money");
+  expect(afterNetWorth).toBe(initialNetWorth);
+  expect(afterAvailable).toBe("25000.00");
+  expect(fixture.applyCalls).toHaveLength(1);
+});
+
+test("wallet loading and read failures never display fabricated zero balances", async () => {
+  fixture.accountReadError = new Error("accounts unavailable");
+
+  render(<AccountsPage />, { wrapper });
+
+  expect(screen.queryByLabelText("Available to spend")).toBeNull();
+  expect(screen.queryByText(formatCurrency(0))).toBeNull();
+  expect(await screen.findByText(/wallet balances could not be loaded/i)).not.toBeNull();
+  expect(screen.queryByText(formatCurrency(0))).toBeNull();
+});
+
+test("Wallets keeps stored card debt while preserving credit previews and filters", async () => {
+  const user = userEvent.setup();
+  render(<AccountsPage />, { wrapper });
+
+  expect(await screen.findByText("Statement Balance")).not.toBeNull();
+  expect(screen.getByText(`-${formatCurrency(8000)}`)).not.toBeNull();
+  expect(fixture.accountWrites.some(write => Object.prototype.hasOwnProperty.call(write, "balance"))).toBe(false);
+  expect(screen.getByText(`-${formatCurrency(1600)}`)).not.toBeNull();
+
+  fireEvent.click(screen.getByRole("button", { name: "Deduct Debt: Off" }));
+  expect(screen.getByLabelText("Net worth balance").getAttribute("data-money")).toBe("28400.00");
+
+  await user.click(screen.getByRole("button", { name: "All months" }));
+  await user.click(await screen.findByRole("menuitemcheckbox", { name: "2026-10" }));
+  await user.keyboard("{Escape}");
+  expect(screen.getByRole("button", { name: "2026-09" })).not.toBeNull();
+  expect(screen.getByRole("button", { name: "Deduct Debt: Active" })).not.toBeNull();
+  expect(screen.getByLabelText("Net worth balance").getAttribute("data-money")).toBe("29300.00");
+});
+
+test("Dashboard totals remain transaction-based after a reservation release", async () => {
+  fixture.snapshot = snapshot("5000.00");
+  fixture.nextSnapshot = snapshot("0.00");
+
+  render(
+    <>
+      <DashboardPage />
+      <FinanceOperation command={{ kind: "release", goalId: "20000000-0000-4000-8000-000000000001", accountId: fixture.cashId, amount: "5000.00" }} label="Release 5,000" />
+    </>,
+    { wrapper },
+  );
+
+  await screen.findByText(formatCurrency(2500));
+  expect(screen.getByText(formatCurrency(30000))).not.toBeNull();
+  expect(screen.getByText(formatCurrency(1100))).not.toBeNull();
+  const accountReadsBeforeRelease = fixture.accountReads;
+
+  fireEvent.click(screen.getByRole("button", { name: "Release 5,000" }));
+
+  await waitFor(() => expect(fixture.applyCalls).toHaveLength(1));
+  await waitFor(() => expect(fixture.accountReads).toBeGreaterThan(accountReadsBeforeRelease));
+  expect(screen.getByText(formatCurrency(2500))).not.toBeNull();
+  expect(screen.getByText(formatCurrency(1100))).not.toBeNull();
+  expect(screen.getByText(formatCurrency(30000))).not.toBeNull();
+});
+
+test("Dashboard shows a read error instead of zeroed metrics", async () => {
+  fixture.transactionReadError = new Error("transaction history unavailable");
+
+  render(<DashboardPage />, { wrapper });
+
+  expect((await screen.findByRole("alert")).textContent).toMatch(/financial overview could not be loaded/i);
+  expect(screen.queryByText(formatCurrency(0))).toBeNull();
+});
