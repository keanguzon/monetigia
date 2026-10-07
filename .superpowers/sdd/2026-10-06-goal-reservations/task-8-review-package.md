605057d feat: confirm automatic goal releases in transaction flow
 .../2026-10-06-goal-reservations/task-8-report.md  |  91 ++++++
 src/app/(dashboard)/transactions/page.tsx          | 113 +++----
 src/components/goals/GoalSelector.tsx              |   6 +-
 .../transactions/AddTransactionModal.tsx           | 364 ++++-----------------
 src/components/transactions/GoalReleaseNotice.tsx  |  47 +++
 .../transactions/TransactionDetailModal.tsx        |  42 ++-
 src/hooks/use-transaction-submit.ts                | 146 +++++++++
 src/lib/goals/client.ts                            |   5 +
 .../202610060004_goal_transaction_operations.sql   |  14 +-
 .../202610060005_goal_lifecycle_operations.sql     |  22 +-
 supabase/schema.sql                                |  36 +-
 tests/contributions.test.tsx                       |  30 +-
 tests/database/financial-transactions.test.mjs     |  64 +++-
 tests/goal-actions.test.tsx                        |  10 +
 tests/transaction-release.test.tsx                 | 342 +++++++++++++++++++
 15 files changed, 913 insertions(+), 419 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-8-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-8-report.md
new file mode 100644
index 0000000..3bfccf9
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-8-report.md
@@ -0,0 +1,91 @@
+# Task 8 implementation report
+
+## Scope and implementation
+
+- Replaced every transaction insert/account balance update sequence in AddTransactionModal with quoteTransaction and applyAndRefreshFinancialCommand, including installments. Existing Expense defaults, defaultAccountId callers, the empty amount/wallet Spend shortcut, debt previews and installment dates remain supported. The removed standalone form was not restored.
+- Added useTransactionSubmit with editing, quoting, review, saving and saved phases. Release proposals require an explicit click on Release funds and save. Zero-release initial quotes can save directly; a stale quote always returns to review for another confirmation. Form edits and dialog closure invalidate pending quotes, and late responses cannot restore them.
+- A user-scoped controller retains an unresolved confirmed request, command and quote across reset, dialog closure, unmount and reopen. Synchronous guards prevent duplicate writes. Unknown retries retain the same UUID; definite database rejection permits correction with a new UUID. Live session checks block an old user's command without discarding an already unresolved request.
+- Added custom per-goal release amounts, shortfall validation and server re-quotation before confirmation. Insufficient money and command errors display human guidance/HINT text without raw SQL error messages.
+- Income excludes goal tags. Cash transfer goal selection means an explicitly entered reservationMoves amount to carry; credit payment selection lists debt goals and consumes their reservation. Credit purchases and installments retain an informational goal association and state that they do not fund or spend from the goal.
+- Wallet choices require active PHP accounts. Normal cash choices are generic non-credit wallets, including GoTyme; userPayLater remains a credit purchase/payment account and cannot back a reservation.
+- Added a user-scoped deletion controller using delete_transaction with an idempotency UUID. Unknown deletions survive page unmount and block a replacement deletion until recovered. Both local transaction data and shared financial caches refresh, even when one refresh fails. A committed deletion/transaction remains saved and cannot be submitted again following a refresh failure.
+- Transaction details use owned goal history and the complete finance snapshot, retaining archived goal names. Spending, carried reservations and unrelated automatic releases have distinct labels. The history adapter now exposes an optional linkedTransactionIds list, validated as UUIDs from the owned operation result, so null-transaction-id automatic releases remain associated with their real operation without inventing an event transaction ID.
+- Detail/deletion dialogs now use Radix for focus containment and keyboard dismissal. New confirmation/retry/cancel controls have 44px minimum heights; the detail and entry panels scroll within 90dvh. The entry form keeps the existing theme/layout and reduced-motion transfer state.
+
+## Controller-approved narrow SQL corrections
+
+The original Task 4 SQL rejected all credit-expense goal tags, contrary to the approved informational-purchase behavior. The controller explicitly expanded Task 8 to correct this gap in migration 004 and the schema bundle.
+
+- Quote validates ownership, active/confirmed goal state for a tagged credit expense, but does not require or consume a cash reservation. Credit income and transfer tags remain invalid.
+- Apply keeps the tag on the real purchase/installment rows, books total debt once, and skips goal allocation events for credit expenses.
+- Native database tests cover single and installment tagged purchases with zero reservations, unchanged progress, replay, deletion of a selected installment, foreign goal rejection and rejected income/transfer tags.
+
+Reapplication exposed another previously existing gap: migration 005 retained an older private transaction helper after migration 004 was reapplied. The controller explicitly authorized the minimal 005/schema-bundle correction.
+
+- Resolve the exact public signature goal_finance_apply(uuid,jsonb,jsonb).
+- Identify the 004 implementation by its positive goal_normalize_transaction marker and absence of delegation to goal_transaction_apply. Identify the 005 dispatcher by the inverse checks; reject ambiguous/missing definitions.
+- For an existing helper, transfer pg_get_functiondef only when the public function is the 004 implementation. Replace exactly the canonical function header, preserving its body, defaults, SECURITY DEFINER and search path.
+- Standalone 005 reapplication leaves the private helper intact. Fresh rename requires the 004 implementation. The existing private-lane grant revocation still runs.
+- A behavior regression reapplies 004, 005 and standalone 005, then saves a tagged credit purchase, verifies zero allocations/progress, exercises lifecycle close, and checks denied direct helper grants.
+
+## TDD evidence
+
+1. `npx vitest run tests/transaction-release.test.tsx`
+   - Initial missing-hook import demonstrated the missing feature but did not count as the behavioral RED run.
+   - With a no-op interface scaffold, the behavioral RED run reported **9 failed / 2 passed**. Expected examples: phase remained editing instead of review/saved; no quote/apply calls; no Release funds and save button.
+   - GREEN after controller/modal integration: **11/11 passed**.
+2. Focused additions caught missing type-change invalidation and deletion API (**3 failed / 11 passed**), then passed **14/14** after integration.
+3. Detail/history linkage RED: `npx vitest run tests/transaction-release.test.tsx tests/goal-actions.test.tsx` reported **2 failed / 36 passed**, with missing spend/carry/release detail and missing linkedTransactionIds. GREEN: **38/38**.
+4. Delayed zero-release quote RED reported **2 failed / 17 passed**: unmount and auth switch still wrote. Guards then passed **19/19**.
+5. Live session mismatch/active-wallet RED reported **3 failed / 23 passed**: unresolved request was discarded on session mismatch, and null-active wallet remained selectable. GREEN after preserving requests and strict wallet eligibility: release **26/26** plus contributions **8/8**.
+6. `node .superpowers/local-db/run-test.mjs tests/database/financial-transactions.test.mjs`
+   - Credit goal-tag RED: **11 passed / 2 failed**, both with INVALID_STATE on the required informational tag.
+   - Credit correction GREEN: **13/13 passed**.
+   - Reapplication RED: helper used the old spend behavior, producing **1 allocation instead of 0**. The same run also exposed a test's unordered wallet assumption, corrected to find the wallet by ID.
+   - Reapplication correction GREEN: **14/14 passed**.
+
+## Final verification
+
+- `npm test`: **2/2 Node tests and 111/111 Vitest tests in 7 files passed**, exit 0. No test warnings/errors.
+- `npx tsc --noEmit`: **exit 0**, no diagnostics.
+- `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/financial-transactions.test.mjs tests/database/goal-lifecycle.test.mjs tests/database/ledger.test.mjs tests/database/reservations.test.mjs`: **57/57 passed**, exit 0, zero skipped/cancelled.
+- `node .superpowers/local-db/restore-task-8.mjs`: reapplied the actual 004 and 005 migration files after the older reservation suite reset the dispatcher. Verified the public function delegates to the transaction helper, the private helper uses cash-only goal spending, both retain SECURITY DEFINER and `search_path=pg_catalog, public`, and authenticated direct helper execution is false. No manual helper-body patch was used.
+- `git diff --check`: exit 0. Git emitted only the workspace's existing LF-to-CRLF conversion notices.
+- Read-only source search found no transaction insert/account update sequence or delete_transaction_atomic call in transaction UI. Existing Accounts fetch-time balance update is the separate Task 9 scope.
+
+## Antislop and accessibility evidence
+
+Direction comes from the binding brief: existing Manrope/Bricolage, restrained emerald, ENERGY 1 / RHYTHM 2 / MOTION 1. The release notice exists to explain the exact goals/amounts affected; its separated summary and confirmation actions provide the hierarchy. No visual assets, decorative sections or fictional claims were added.
+
+- PASS, functional states: real UI tests exercise review, decline, custom inputs, confirm, edit, unknown retry, saved feedback, loading invalidation and human errors. Controls have actual handlers and duplicate guards.
+- PASS, command safety: explicit pre-confirmation zero-write assertion, post-confirmation one-write assertion, same request identity across unknown retry, fresh stale confirmation and saved/no-resubmit assertions.
+- PASS, scoped theme text contrast: contrast-check.py reports white on emerald-700 **5.48:1**, emerald-400 on slate-950 **10.49:1**, red-700 on white **6.47:1**, and red-300 on slate-950 **10.63:1** for the added action/error colors. Existing global theme tokens were not changed.
+- PASS, keyboard structure: Radix dialogs preserve keyboard focus containment/dismissal; retained Escape cancellation coverage passes. New entry/detail close and release/deletion/retry targets have minimum 44px hit areas and focus rings.
+- PASS, local source resilience review: modal widths are fluid with narrow-screen margins; custom controls stack on phones and confirmation actions can reflow; scroll height uses dvh; no new fixed desktop-width content or image dependency.
+- Scope limit: actual 375/768/1280 viewport, light/dark browser click-through and reduced-motion visual acceptance belong to Task 11 and were not claimed here. No build or live/cloud database write was run.
+
+## Files changed
+
+- src/hooks/use-transaction-submit.ts (new)
+- src/components/transactions/GoalReleaseNotice.tsx (new)
+- src/components/transactions/AddTransactionModal.tsx
+- src/components/transactions/TransactionDetailModal.tsx
+- src/components/goals/GoalSelector.tsx
+- src/app/(dashboard)/transactions/page.tsx
+- src/lib/goals/client.ts
+- supabase/migrations/202610060004_goal_transaction_operations.sql
+- supabase/migrations/202610060005_goal_lifecycle_operations.sql
+- supabase/schema.sql
+- tests/transaction-release.test.tsx (new)
+- tests/contributions.test.tsx
+- tests/goal-actions.test.tsx
+- tests/database/financial-transactions.test.mjs
+- .superpowers/sdd/2026-10-06-goal-reservations/task-8-report.md
+
+The disposable restore script is ignored local harness material. Controller progress/local-preview reports remain unstaged and were not edited by this implementer.
+
+## Self-review and remaining scope
+
+- Reviewed command identity, late quote/user switching, release confirmation, error guidance, SQL atomic/debt behavior, helper grants and source diff. All required checks pass.
+- No new runtime dependencies, cloud action, push, merge or deployment.
+- Manual browser acceptance remains Task 11; legacy review remains Task 10. No known blocking concern for Task 8 handoff.
diff --git a/src/app/(dashboard)/transactions/page.tsx b/src/app/(dashboard)/transactions/page.tsx
index 616cea0..c4e1f5c 100644
--- a/src/app/(dashboard)/transactions/page.tsx
+++ b/src/app/(dashboard)/transactions/page.tsx
@@ -1,13 +1,15 @@
 "use client";
 
 import { useState, useEffect } from "react";
+import * as Dialog from "@radix-ui/react-dialog";
+import { useTransactionDelete } from "@/hooks/use-transaction-submit";
 import dynamic from "next/dynamic";
 import { createClient } from "@/lib/supabase/client";
 import { Button } from "@/components/ui/button";
 import { formatCurrency, formatDate, isValidUuid } from "@/lib/utils";
 import { Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Trash2, Search } from "lucide-react";
 import { useToast } from "@/components/ui/use-toast";
 import { TableSkeleton } from "@/components/ui/skeleton";
 import { Input } from "@/components/ui/input";
 
 const AddTransactionModal = dynamic(() => import("@/components/transactions/AddTransactionModal"), {
@@ -23,87 +25,69 @@ export default function TransactionsPage() {
   const supabase = createClient();
   const sb = supabase as any;
   const { toast } = useToast();
   const [transactions, setTransactions] = useState<any[]>([]);
   const [isModalOpen, setIsModalOpen] = useState(false);
   const [isLoading, setIsLoading] = useState(true);
   const [filter, setFilter] = useState<"all" | "expense" | "income" | "transfer">("all");
   const [refreshKey, setRefreshKey] = useState(0);
   const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
   const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
-  const [isDeleting, setIsDeleting] = useState(false);
+  const deletion = useTransactionDelete(loadTransactions);
+  const isDeleting = deletion.isDeleting;
   const [searchQuery, setSearchQuery] = useState("");
 
   useEffect(() => {
-    loadTransactions();
+    void loadTransactions().catch(() => {});
   }, [refreshKey]);
 
-  const deleteTransaction = async (transaction: any) => {
-    setIsDeleting(true);
-    try {
-      if (!transaction?.id || !isValidUuid(transaction.id)) {
-        toast({ title: "Error", description: "Invalid transaction id", variant: "destructive" });
-        return;
-      }
-
-      const { data: { user } } = await supabase.auth.getUser();
-      if (!user?.id) {
-        toast({ title: "Not signed in", description: "You must be signed in to delete transactions", variant: "destructive" });
-        return;
-      }
-
-      const { error: deleteError } = await sb.rpc('delete_transaction_atomic', {
-        p_transaction_id: transaction.id,
-        p_user_id: user.id
-      });
-
-      if (deleteError) {
-        toast({ title: "Error", description: deleteError.message, variant: "destructive" });
-        return;
-      }
+  useEffect(() => {
+    if (!deletion.savedTransactionId) return;
+    setDeleteConfirm(null);
+    setTransactions(current => current.filter(transaction => transaction.id !== deletion.savedTransactionId));
+  }, [deletion.savedTransactionId]);
 
-      toast({ title: "Transaction deleted", description: "Transaction and balance have been reverted." });
-      setDeleteConfirm(null);
-      setRefreshKey(prev => prev + 1);
-    } catch (err) {
-      toast({ title: "Error", description: "An unexpected error occurred", variant: "destructive" });
-    } finally {
-      setIsDeleting(false);
+  const deleteTransaction = async (transaction: any) => {
+    if (!transaction?.id || !isValidUuid(transaction.id)) {
+      toast({ title: "Cannot delete transaction", description: "This transaction could not be identified.", variant: "destructive" });
+      return;
     }
+    await deletion.remove(transaction.id);
   };
 
-  const loadTransactions = async () => {
+  async function loadTransactions() {
     setIsLoading(true);
     const {
       data: { user },
     } = await supabase.auth.getUser();
 
     if (user?.id) {
 
       const { data, error } = await sb
         .from("transactions")
         .select(
-          "id, user_id, account_id, category_id, type, amount, description, date, transfer_to_account_id, created_at, category:categories(id,name,color), account:accounts!account_id(id,name,type), transfer_to_account:accounts!transfer_to_account_id(id,name,type)"
+          "id, user_id, account_id, category_id, goal_id, type, amount, description, date, transfer_to_account_id, created_at, category:categories(id,name,color), account:accounts!account_id(id,name,type), transfer_to_account:accounts!transfer_to_account_id(id,name,type)"
         )
         .eq("user_id", user.id)
         .order("date", { ascending: false })
         .order("created_at", { ascending: false })
         .limit(50);
 
       if (error) {
         console.error("Failed to load transactions", error);
         toast({
           title: "Failed to load transactions",
-          description: error.message,
+          description: "The transaction list could not refresh. Try refreshing the page.",
           variant: "destructive",
         });
-        setTransactions([]);
+        setIsLoading(false);
+        throw new Error("The transaction list could not refresh.");
       } else {
         setTransactions(data || []);
       }
     }
     setIsLoading(false);
   };
 
   const filteredTransactions =
     filter === "all" ? transactions : transactions.filter((t) => t.type === filter);
 
@@ -123,20 +107,22 @@ export default function TransactionsPage() {
       (t.description?.toLowerCase().includes(query)) ||
       (t.category?.name?.toLowerCase().includes(query)) ||
       (t.amount?.toString().includes(query)) ||
       (t.account?.name?.toLowerCase().includes(query)) ||
       (t.transfer_to_account?.name?.toLowerCase().includes(query))
     );
   });
 
   return (
     <>
+      {deletion.error && <div role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300 space-y-2"><p>{deletion.error}</p>{deletion.pendingTransactionId && <button type="button" disabled={isDeleting} onClick={() => { void deletion.remove(deletion.pendingTransactionId!); }} className="min-h-11 px-4 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Retry same deletion</button>}</div>}
+      {deletion.savedTransactionId && <p role="status" className="mb-4 text-sm">{deletion.refreshError ? "Transaction deleted. Some views could not refresh. Refresh the page; do not delete it again." : "Transaction deleted and wallet balances updated."}</p>}
       <div className="space-y-6">
         <div className="space-y-4">
           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
             <div>
               <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Transactions</h2>
               <p className="text-xs sm:text-sm text-muted-foreground">
                 View and manage your complete financial history
               </p>
             </div>
             <Button
@@ -151,21 +137,21 @@ export default function TransactionsPage() {
           {/* Filter Chips & Search Bar */}
           <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
             <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
               {(["all", "expense", "income", "transfer"] as const).map((type) => (
                 <button
                   key={type}
                   type="button"
                   onClick={() => setFilter(type)}
                   className={`h-7 px-3 rounded-lg text-xs font-medium capitalize transition-all ${
                     filter === type
-                      ? "bg-primary text-primary-foreground shadow-xs"
+                      ? "bg-emerald-700 text-white dark:bg-emerald-400 dark:text-slate-950 shadow-xs"
                       : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted"
                   }`}
                 >
                   {type}
                 </button>
               ))}
             </div>
 
             <div className="relative w-full sm:w-64">
               <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
@@ -254,21 +240,22 @@ export default function TransactionsPage() {
                           {transaction.type === "income" ? "+" : transaction.type === "expense" ? "-" : ""}
                           {formatCurrency(Number(transaction.amount))}
                         </span>
                       </div>
                       <button
                         type="button"
                         onClick={(e) => {
                           e.stopPropagation();
                           setDeleteConfirm(transaction);
                         }}
-                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
+                        aria-label="Delete transaction"
+                        className="min-h-11 min-w-11 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary transition-opacity p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
                         title={transaction?.id ? "Delete transaction" : ""}
                       >
                         <Trash2 className="h-4 w-4" />
                       </button>
                     </div>
                   </div>
                 ))}
               </div>
             ) : !isLoading ? (
               <div className="flex flex-col items-center justify-center py-12 text-center">
@@ -282,58 +269,34 @@ export default function TransactionsPage() {
                   Add Transaction
                 </Button>
               </div>
             ) : (
               <TableSkeleton rows={8} />
             )}
           </div>
         </div>
       </div>
 
-      {/* Delete Confirmation Modal */}
-      {deleteConfirm && (
-        <div
-          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
-          onClick={() => setDeleteConfirm(null)}
-        >
-          <div
-            className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl animate-in slide-in-from-bottom-4 duration-300 m-4"
-            onClick={(e) => e.stopPropagation()}
-          >
-            <div className="p-6">
-              <h3 className="text-xl font-semibold mb-2 text-red-500">Delete Transaction?</h3>
-              <p className="text-muted-foreground mb-6">
-                This will remove the transaction and revert the balance. This action cannot be undone.
-              </p>
-              <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg mb-6 text-sm">
-                <p className="font-medium">{deleteConfirm.description || deleteConfirm.category?.name || "Transaction"}</p>
-                <p className="text-muted-foreground">{formatCurrency(Number(deleteConfirm.amount))} • {formatDate(deleteConfirm.date)}</p>
-              </div>
-              <div className="flex gap-3">
-                <button
-                  onClick={() => setDeleteConfirm(null)}
-                  className="flex-1 px-4 py-2 border rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
-                >
-                  Cancel
-                </button>
-                <button
-                  onClick={() => deleteTransaction(deleteConfirm)}
-                  disabled={isDeleting}
-                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
-                >
-                  {isDeleting ? "Deleting..." : "Delete"}
-                </button>
-              </div>
+      <Dialog.Root open={!!deleteConfirm} onOpenChange={open => { if (!open && !isDeleting) setDeleteConfirm(null); }}>
+        <Dialog.Portal>
+          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
+          <Dialog.Content onEscapeKeyDown={event => { if (isDeleting) event.preventDefault(); }} onPointerDownOutside={event => { if (isDeleting) event.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-card text-card-foreground p-6 shadow-xl">
+            <Dialog.Title className="text-xl font-semibold mb-2">Delete transaction?</Dialog.Title>
+            <Dialog.Description className="text-sm text-muted-foreground mb-6">This removes the transaction and reverses its wallet balances and goal effects. The deletion may be refused if the money or carried reservation has already been used.</Dialog.Description>
+            {deleteConfirm && <p className="mb-6 text-sm">{deleteConfirm.description || "Transaction"} · {formatCurrency(Number(deleteConfirm.amount))}</p>}
+            <div className="flex gap-3">
+              <button type="button" disabled={isDeleting} onClick={() => setDeleteConfirm(null)} className="min-h-11 flex-1 px-4 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Cancel</button>
+              <button type="button" onClick={() => { void deleteTransaction(deleteConfirm); }} disabled={isDeleting || !!deletion.pendingTransactionId && deletion.pendingTransactionId !== deleteConfirm?.id} className="min-h-11 flex-1 px-4 bg-red-700 text-white dark:bg-red-400 dark:text-slate-950 rounded-lg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary">{isDeleting ? "Deleting..." : "Delete"}</button>
             </div>
-          </div>
-        </div>
-      )}
+          </Dialog.Content>
+        </Dialog.Portal>
+      </Dialog.Root>
 
       {/* Add Transaction Modal */}
       <AddTransactionModal
         isOpen={isModalOpen}
         onClose={() => {
           setIsModalOpen(false);
           setRefreshKey(prev => prev + 1);
         }}
       />
 
diff --git a/src/components/goals/GoalSelector.tsx b/src/components/goals/GoalSelector.tsx
index 4403287..2a3e494 100644
--- a/src/components/goals/GoalSelector.tsx
+++ b/src/components/goals/GoalSelector.tsx
@@ -1,16 +1,16 @@
 "use client";
 
 import { useGoals } from "@/hooks/use-goals";
 
-export function GoalSelector({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
+export function GoalSelector({ value, onChange, disabled = false, meaning = "spend", debtOnly = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; meaning?: "spend" | "carry" | "purchase"; debtOnly?: boolean }) {
   const { goals, isLoading, isError } = useGoals();
   return <div>
     <label htmlFor="transaction-goal" className="block text-sm font-medium mb-2">Goal (Optional)</label>
     <select id="transaction-goal" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || isLoading || !!isError}
       className="w-full rounded-lg border bg-background px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
       <option value="">{isLoading ? "Loading goals..." : "No goal"}</option>
-      {goals.filter((goal) => !goal.is_completed || goal.id === value).map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}
+      {goals.filter(goal => goal.status === "active" && goal.review_state === "confirmed" && goal.archived_at === null && (!debtOnly || goal.category === "debt")).map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}
     </select>
-    <p className="mt-2 text-xs text-muted-foreground">{isError ? "Goals could not be loaded. Close and reopen to try again." : "This recorded expense or transfer adds to the selected goal’s funded amount."}</p>
+    <p className="mt-2 text-xs text-muted-foreground">{isError ? "Goals could not be loaded. Close and reopen to try again." : meaning === "purchase" ? "Informational purchase history only. This credit purchase does not fund the goal or use its cash reservation." : meaning === "carry" ? "Carry the amount entered below to the destination wallet. This moves an existing reservation; it does not add funding." : "Spend money already reserved for this goal in the selected wallet."}</p>
   </div>;
 }
diff --git a/src/components/transactions/AddTransactionModal.tsx b/src/components/transactions/AddTransactionModal.tsx
index b5167d2..c7e02e2 100644
--- a/src/components/transactions/AddTransactionModal.tsx
+++ b/src/components/transactions/AddTransactionModal.tsx
@@ -1,82 +1,87 @@
 "use client";
 
 import React, { useEffect, useState } from "react";
 import Link from "next/link";
-import { useRouter } from "next/navigation";
 import { createClient } from "@/lib/supabase/client";
-import { useToast } from "@/components/ui/use-toast";
 import { X, ArrowUpRight, ArrowDownLeft, ArrowLeftRight } from "lucide-react";
 import { formatCurrency } from "@/lib/utils";
 import { GoalSelector } from "@/components/goals/GoalSelector";
-import { contributionGoalId } from "@/lib/goal-funding";
-import { refreshFinancialData } from "@/lib/refresh-financial-data";
+import { useTransactionSubmit } from "@/hooks/use-transaction-submit";
+import { useGoals } from "@/hooks/use-goals";
+import { parseMoney } from "@/lib/goals/summary";
+import { GoalReleaseNotice } from "./GoalReleaseNotice";
 import * as Dialog from "@radix-ui/react-dialog";
 
 interface AddTransactionModalProps {
   isOpen: boolean;
   onClose: () => void;
   defaultAccountId?: string;
   defaultGoalId?: string;
 }
 
 export default function AddTransactionModal({ isOpen, onClose, defaultAccountId, defaultGoalId }: AddTransactionModalProps) {
   const supabase = createClient();
   const sb = supabase as any;
-  const router = useRouter();
-  const { toast } = useToast();
+  const submit = useTransactionSubmit();
+  const { financeSnapshot } = useGoals();
 
   const [accounts, setAccounts] = useState<any[]>([]);
   const [categories, setCategories] = useState<any[]>([]);
 
   const [accountId, setAccountId] = useState<string>("");
   const [categoryId, setCategoryId] = useState<string>("");
   const [goalId, setGoalId] = useState("");
   const [type, setType] = useState<"income" | "expense" | "transfer">("expense");
   const [amount, setAmount] = useState("");
   const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
   const [description, setDescription] = useState("");
   const [transferToAccountId, setTransferToAccountId] = useState<string>("");
-  const [isLoading, setIsLoading] = useState(false);
+  const isLoading = submit.phase === "saving" || submit.phase === "quoting";
+  const [formError, setFormError] = useState("");
+  const [carryAmount, setCarryAmount] = useState("");
   const [isDataLoading, setIsDataLoading] = useState(true);
   const [dataError, setDataError] = useState("");
   const [debtPaymentMonth, setDebtPaymentMonth] = useState<string>(new Date().toISOString().slice(0, 7));
   const [debtByMonthForPaymentTarget, setDebtByMonthForPaymentTarget] = useState<Record<string, number>>({});
   const [isDebtMonthLoading, setIsDebtMonthLoading] = useState(false);
 
   const [isPayLater, setIsPayLater] = useState(false);
   const [payLaterAccountId, setPayLaterAccountId] = useState<string>("");
   const [installments, setInstallments] = useState<number>(1);
   const [startMonth, setStartMonth] = useState<string>(new Date().toISOString().slice(0, 7));
 
-  const debtAccounts = accounts.filter((a: any) => a?.type === "credit_card");
-
   useEffect(() => {
     let cancelled = false;
+    submit.reset();
     if (isOpen) {
       setIsDataLoading(true);
       setDataError("");
       setAccountId("");
       setAccounts([]);
       setGoalId(defaultGoalId || "");
       setType("expense");
       setAmount("");
       setDescription("");
+      setFormError("");
+      setCarryAmount("");
+      setDate(new Date().toISOString().slice(0, 10));
+      setStartMonth(new Date().toISOString().slice(0, 7));
       setIsPayLater(false);
       setInstallments(1);
       setTransferToAccountId("");
       loadData(defaultAccountId, () => !cancelled)
         .catch(() => { if (!cancelled) setDataError("Could not load accounts. Close and reopen to try again."); })
         .finally(() => { if (!cancelled) setIsDataLoading(false); });
     }
     return () => { cancelled = true; };
-  }, [isOpen, defaultAccountId, defaultGoalId]);
+  }, [isOpen, defaultAccountId, defaultGoalId, submit.reset]);
 
   useEffect(() => {
     // Auto-select first matching category when type changes
     if (type === "transfer") {
       setCategoryId("transfer");
     } else {
       const matchingCats = categories.filter(c => c.type === type);
       if (matchingCats.length > 0) {
         setCategoryId(matchingCats[0]?.id ?? "");
       }
@@ -90,21 +95,21 @@ export default function AddTransactionModal({ isOpen, onClose, defaultAccountId,
       setInstallments(1);
     }
   }, [type]);
 
   const loadData = async (preferredAccountId: string | undefined, isCurrent: () => boolean) => {
     const { data: { user } } = await supabase.auth.getUser();
     if (!isCurrent()) return;
     if (!user?.id) throw new Error("Not signed in");
 
     const { data: accountsData, error: accountsError } = await sb.from("accounts").select("*").eq("user_id", user.id).order("name");
-    const accountsList = (accountsData ?? []) as any[];
+    const accountsList = ((accountsData ?? []) as any[]).filter(a => a.is_active === true && a.currency === "PHP");
 
     const { data: catsData, error: categoriesError } = await sb.from("categories").select("*").order("name");
     if (!isCurrent()) return;
     if (accountsError || categoriesError) throw accountsError || categoriesError;
     const catsList = (catsData ?? []) as any[];
     setAccounts(accountsList);
     setCategories(catsList);
 
     if (accountsList.length > 0) {
       const preferred = preferredAccountId
@@ -231,348 +236,93 @@ export default function AddTransactionModal({ isOpen, onClose, defaultAccountId,
     try {
       const d = new Date(`${debtPaymentMonth}-01T00:00:00`);
       return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
     } catch {
       return debtPaymentMonth;
     }
   })();
 
   const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
-    if (isDataLoading || isLoading || dataError) return;
-    setIsLoading(true);
-
+    if (isDataLoading || isLoading || dataError || submit.phase === "saved" || submit.phase === "review") return;
+    setFormError("");
     try {
-      const { data: { user } } = await supabase.auth.getUser();
-      if (!user?.id) {
-        toast({ title: "Not signed in", description: "You must be signed in to add transactions", variant: "destructive" });
-        return;
-      }
-
-      const amt = Number(amount);
-      const effectiveAccountId = type === "expense" && isPayLater ? payLaterAccountId : accountId;
-      if (!effectiveAccountId || !Number.isFinite(amt) || amt <= 0) {
-        toast({ title: "Missing fields", description: "Please select wallet and amount", variant: "destructive" });
-        return;
-      }
-
-      if (accounts.length === 0) {
-        toast({ title: "No wallets", description: "Please create a wallet first", variant: "destructive" });
-        return;
-      }
-
-      if (type === "expense" && isPayLater && !effectiveAccountId) {
-        toast({ title: "Missing fields", description: "Please select a PayLater/Credit Card wallet", variant: "destructive" });
-        return;
-      }
-
-      // Prevent negative debt on credit cards when reducing debt.
-      // - income on credit_card reduces debt (balance - amt)
-      // - transfer TO credit_card reduces debt (dst - amt)
-      if (type === "income") {
-        const accMeta = getAccount(effectiveAccountId);
-        if (accMeta?.type === "credit_card") {
-          const { data: accRow, error: accErr } = await sb
-            .from("accounts")
-            .select("balance")
-            .eq("id", effectiveAccountId)
-            .single();
-          if (accErr) {
-            toast({ title: "Error", description: "Failed to validate debt balance", variant: "destructive" });
-            return;
-          }
-          const currentDebt = Number(accRow?.balance || 0);
-          if (currentDebt - amt < 0) {
-            toast({
-              title: "Payment too large",
-              description: `This would make your debt negative. Current debt: ${formatCurrency(currentDebt)}.`,
-              variant: "destructive",
-            });
-            return;
-          }
-        }
-      }
-
-      if (type === "transfer") {
-        const dstMeta = getAccount(transferToAccountId);
-        if (dstMeta?.type === "credit_card") {
-          // Month-level guard: only allow paying up to the selected month's remaining debt.
-          if (isDebtPayment) {
-            if (isDebtMonthLoading) {
-              toast({ title: "Please wait", description: "Loading debt month details...", variant: "destructive" });
-              return;
-            }
-
-            const monthDebt = Math.max(0, Number(selectedDebtMonthAmount || 0));
-            const label = selectedDebtMonthLabel || debtPaymentMonth;
-
-            if (!debtPaymentMonth) {
-              toast({ title: "Missing month", description: "Please select a debt month to pay", variant: "destructive" });
-              return;
-            }
-
-            if (monthDebt <= 0) {
-              toast({
-                title: "No debt for this month",
-                description: `There is no remaining debt for ${label}. Pick a different month.`,
-                variant: "destructive",
-              });
-              return;
-            }
-
-            if (amt - monthDebt > 1e-9) {
-              toast({
-                title: "Payment too large",
-                description: `Max for ${label} is ${formatCurrency(monthDebt)}.`,
-                variant: "destructive",
-              });
-              return;
-            }
-          }
-
-          const { data: dstRow, error: dstErr } = await sb
-            .from("accounts")
-            .select("balance")
-            .eq("id", transferToAccountId)
-            .single();
-          if (dstErr) {
-            toast({ title: "Error", description: "Failed to validate debt balance", variant: "destructive" });
-            return;
-          }
-          const currentDebt = Number(dstRow?.balance || 0);
-          if (currentDebt - amt < 0) {
-            toast({
-              title: "Payment too large",
-              description: `You can only pay up to ${formatCurrency(currentDebt)} for this debt account.`,
-              variant: "destructive",
-            });
-            return;
-          }
-        }
-      }
-
-      // Prevent negative balances (no overdraft) for non-credit accounts.
-      if (type === "expense" || type === "transfer") {
-        if (type === "transfer") {
-          if (!transferToAccountId) {
-            toast({ title: "Missing fields", description: "Please select a destination wallet", variant: "destructive" });
-            return;
-          }
-          if (transferToAccountId === effectiveAccountId) {
-            toast({ title: "Invalid transfer", description: "Source and destination wallets must be different", variant: "destructive" });
-            return;
-          }
-        }
-
-        const srcAcc = getAccount(effectiveAccountId);
-        const srcType = srcAcc?.type;
-        const currentBal = Number(srcAcc?.balance || 0);
-
-        // Credit cards are tracked as "debt" (balance can grow with purchases).
-        // Only block overdraft for non-credit wallets.
-        if (srcType !== "credit_card") {
-          const nextBal = currentBal - amt;
-          if (nextBal < 0) {
-            toast({
-              title: "Not enough balance",
-              description: `Not enough money in ${srcAcc?.name || "this wallet"}. Available: ₱${currentBal.toFixed(2)}.`,
-              variant: "destructive",
-            });
-            return;
-          }
-        }
-      }
-
-      // Insert transaction(s) - for PayLater with installments, create multiple transactions
-      if (type === "expense" && isPayLater && installments > 1) {
-        const installmentAmount = amt / installments;
-        const transactions = [];
-
-        for (let i = 0; i < installments; i++) {
-          const installmentDate = new Date(startMonth + "-01");
-          installmentDate.setMonth(installmentDate.getMonth() + i);
-          const dateStr = installmentDate.toISOString().slice(0, 10);
-
-          transactions.push({
-            user_id: user.id,
-            account_id: effectiveAccountId,
-            category_id: categoryId || null,
-            goal_id: contributionGoalId(type, goalId),
-            type,
-            amount: installmentAmount,
-            description: `${description} (Installment ${i + 1}/${installments})`,
-            date: dateStr,
-            transfer_to_account_id: null,
-          });
-        }
-
-        const { error } = await sb.from("transactions").insert(transactions);
-        if (error) {
-          toast({ title: "Error", description: error.message, variant: "destructive" });
-          return;
-        }
-
-        // Update debt account balance (sum of all installments)
-        const { data: acc } = await sb.from("accounts").select("balance").eq("id", effectiveAccountId).single();
-        const current = Number(acc?.balance || 0);
-        const newBal = current + amt; // Debt increases by total amount
-        await sb.from("accounts").update({ balance: newBal }).eq("id", effectiveAccountId);
-      } else {
-        // Single transaction
-        const transactionDate = isDebtPayment
-          ? `${debtPaymentMonth}-01`
-          : (type === "expense" && isPayLater)
-            ? new Date(startMonth + "-01").toISOString().slice(0, 10)
-            : date;
-        const finalDescription = (() => {
-          const trimmed = (description || "").trim();
-          if (trimmed) return trimmed;
-          if (!isDebtPayment) return "";
-          const label = selectedDebtMonthLabel || debtPaymentMonth;
-          return `Debt - ${label}`;
-        })();
-        const { error } = await sb.from("transactions").insert({
-          user_id: user.id,
-          account_id: effectiveAccountId,
-          category_id: type === "transfer" ? null : (categoryId || null),
-          goal_id: contributionGoalId(type, goalId),
-          type,
-          amount: amt,
-          description: finalDescription,
-          date: transactionDate,
-          transfer_to_account_id: type === "transfer" ? transferToAccountId || null : null,
-        }).select();
-
-        if (error) {
-          toast({ title: "Error", description: error.message, variant: "destructive" });
-          return;
-        }
-
-        // Update balances for single transaction
-        const effAcc = getAccount(effectiveAccountId);
-        const effType = effAcc?.type;
-
-        if (type === "income") {
-          const { data: acc } = await sb.from("accounts").select("balance").eq("id", effectiveAccountId).single();
-          const current = Number(acc?.balance || 0);
-          const newBal = effType === "credit_card" ? current - amt : current + amt;
-          await sb.from("accounts").update({ balance: newBal }).eq("id", effectiveAccountId);
-        } else if (type === "expense") {
-          const { data: acc } = await sb.from("accounts").select("balance").eq("id", effectiveAccountId).single();
-          const current = Number(acc?.balance || 0);
-          const newBal = effType === "credit_card" ? current + amt : current - amt;
-          await sb.from("accounts").update({ balance: newBal }).eq("id", effectiveAccountId);
-        } else if (type === "transfer") {
-          const { data: src } = await sb.from("accounts").select("balance").eq("id", effectiveAccountId).single();
-          const { data: dst } = await sb.from("accounts").select("balance").eq("id", transferToAccountId).single();
-
-          const srcMeta = getAccount(effectiveAccountId);
-          const dstMeta = getAccount(transferToAccountId);
-
-          if (!dst) {
-            toast({ title: "Error", description: "Transfer destination not found", variant: "destructive" });
-          } else {
-            const srcCurrent = Number(src?.balance || 0);
-            const dstCurrent = Number(dst?.balance || 0);
-
-            // For credit cards, balance is "debt":
-            // - Paying a credit card (transfer to credit_card) reduces debt (dst - amt)
-            // - Sending from credit card increases debt (src + amt)
-            const nextSrc = srcMeta?.type === "credit_card" ? srcCurrent + amt : srcCurrent - amt;
-            const nextDst = dstMeta?.type === "credit_card" ? dstCurrent - amt : dstCurrent + amt;
-
-            await sb.from("accounts").update({ balance: nextSrc }).eq("id", effectiveAccountId);
-            await sb.from("accounts").update({ balance: nextDst }).eq("id", transferToAccountId);
-          }
-        }
-      }
-
-      await refreshFinancialData();
-      toast({
-        title: "Transaction added",
-        description: isPayLater && installments > 1
-          ? `Created ${installments} installments successfully.`
-          : "Your transaction was saved."
+      const exactAmount = parseMoney(amount);
+      if (!effectiveAccountId || exactAmount === "0.00") { setFormError("Select a wallet and enter an amount greater than zero."); return; }
+      if (type === "transfer" && (!transferToAccountId || transferToAccountId === effectiveAccountId)) { setFormError("Choose a different destination wallet."); return; }
+      const cashTransfer = type === "transfer" && !isDebtPayment;
+      const selectedGoalId = type === "income" ? null : goalId || null;
+      await submit.quote({
+        type, accountId: effectiveAccountId, transferToAccountId: type === "transfer" ? transferToAccountId : null,
+        categoryId: type === "transfer" ? null : categoryId || null, goalId: cashTransfer ? null : selectedGoalId,
+        amount: exactAmount, description: description.trim() || (isDebtPayment ? `Debt - ${selectedDebtMonthLabel || debtPaymentMonth}` : null),
+        date: isDebtPayment ? `${debtPaymentMonth}-01` : type === "expense" && isPayLater ? `${startMonth}-01` : date,
+        installments: type === "expense" && isPayLater ? { count: installments } : null,
+        reservationMoves: cashTransfer && selectedGoalId ? [{ goalId: selectedGoalId, amount: parseMoney(carryAmount) }] : [],
       });
-
-      // Reset form
-      setAmount("");
-      setDescription("");
-      setDate(new Date().toISOString().slice(0, 10));
-      setIsPayLater(false);
-      setInstallments(1);
-      setStartMonth(new Date().toISOString().slice(0, 7));
-
-      // Small delay to ensure DB has updated before closing
-      setTimeout(() => {
-        onClose();
-      }, 100);
-    } catch (err) {
-      toast({ title: "Error", description: "An unexpected error occurred", variant: "destructive" });
-    } finally {
-      setIsLoading(false);
-    }
+    } catch { setFormError("Enter valid amounts with no more than two decimal places."); }
   };
+  const close = () => { submit.reset(); onClose(); };
 
   if (!isOpen) return null;
 
   return (
-    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open && !isLoading) onClose(); }}>
+    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open && !isLoading) close(); }}>
       <Dialog.Portal>
       <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
-      <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground rounded-2xl w-[calc(100%-2rem)] max-w-lg max-h-[90vh] overflow-y-auto shadow-xl" onEscapeKeyDown={(event) => { if (isLoading) event.preventDefault(); }} onPointerDownOutside={(event) => { if (isLoading) event.preventDefault(); }}>
+      <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground rounded-2xl w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto shadow-xl" onEscapeKeyDown={(event) => { if (isLoading) event.preventDefault(); }} onPointerDownOutside={(event) => { if (isLoading) event.preventDefault(); }}>
         {/* Modal Header */}
         <div className="flex items-center justify-between p-6 border-b dark:border-slate-700">
           <Dialog.Title className="text-xl font-semibold">Add Transaction</Dialog.Title>
           <button
-            onClick={onClose}
+            onClick={close}
             disabled={isLoading}
             aria-label="Close transaction form"
-            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all duration-200 hover:rotate-90"
+            className="min-h-11 min-w-11 p-2 hover:bg-muted rounded-lg focus-visible:ring-2 focus-visible:ring-primary"
           >
             <X className="h-5 w-5" />
           </button>
         </div>
 
         <form onSubmit={handleSubmit}>
-          {dataError && <p role="alert" className="px-6 pt-4 text-sm text-destructive">{dataError}</p>}
-          <fieldset disabled={isDataLoading || isLoading} className="p-6 space-y-6 min-w-0">
+          {dataError && <p role="alert" className="px-6 pt-4 text-sm text-red-700 dark:text-red-300">{dataError}</p>}
+          <fieldset onChange={() => { submit.reset(); setFormError(""); }} disabled={isDataLoading || isLoading || submit.unresolved || submit.phase === "saved"} className="p-6 space-y-6 min-w-0">
             {/* Transaction Type Selector */}
             <div>
               <label className="block text-sm font-medium mb-3">Transaction Type</label>
               <div className="grid grid-cols-3 gap-2">
                 <button
                   type="button"
-                  onClick={() => setType("expense")}
-                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-all duration-200 ${type === "expense"
+                  onClick={() => { submit.reset(); setType("expense"); }}
+                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-colors duration-200 motion-reduce:transition-none ${type === "expense"
                     ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                     : "border-gray-200 dark:border-slate-700 hover:border-red-300"
                     }`}
                 >
                   <ArrowUpRight className={`h-6 w-6 mb-2 ${type === "expense" ? "text-red-500" : "text-gray-400"}`} />
                   <span className={`text-sm font-medium ${type === "expense" ? "text-red-500" : ""}`}>Expense</span>
                 </button>
                 <button
                   type="button"
-                  onClick={() => setType("income")}
-                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-all duration-200 ${type === "income"
+                  onClick={() => { submit.reset(); setType("income"); }}
+                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-colors duration-200 motion-reduce:transition-none ${type === "income"
                     ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                     : "border-gray-200 dark:border-slate-700 hover:border-green-300"
                     }`}
                 >
                   <ArrowDownLeft className={`h-6 w-6 mb-2 ${type === "income" ? "text-green-500" : "text-gray-400"}`} />
                   <span className={`text-sm font-medium ${type === "income" ? "text-green-500" : ""}`}>Income</span>
                 </button>
                 <button
                   type="button"
-                  onClick={() => setType("transfer")}
-                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-all duration-200 ${type === "transfer"
+                  onClick={() => { submit.reset(); setType("transfer"); }}
+                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-colors duration-200 motion-reduce:transition-none ${type === "transfer"
                     ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                     : "border-gray-200 dark:border-slate-700 hover:border-blue-300"
                     }`}
                 >
                   <ArrowLeftRight className={`h-6 w-6 mb-2 ${type === "transfer" ? "text-blue-500" : "text-gray-400"}`} />
                   <span className={`text-sm font-medium ${type === "transfer" ? "text-blue-500" : ""}`}>Transfer</span>
                 </button>
               </div>
             </div>
 
@@ -637,21 +387,21 @@ export default function AddTransactionModal({ isOpen, onClose, defaultAccountId,
               {isPayLater && type === "expense" && accounts.filter((a: any) => a?.type === "credit_card").length === 0 && (
                 <p className="mt-2 text-xs text-muted-foreground">
                   No PayLater/Debt accounts yet. Create one in Accounts (type: Credit Card) and name it “SpayLater”.
                 </p>
               )}
             </div>
 
             {/* PayLater / Credit Card purchase */}
             {type === "expense" && (
               <div className="rounded-lg border p-4 space-y-3">
-                <label className="flex items-center gap-2 text-sm font-medium">
+                <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                   <input
                     type="checkbox"
                     checked={isPayLater}
                     onChange={(e) => setIsPayLater(e.target.checked)}
                     className="h-4 w-4"
                   />
                   PayLater purchase (adds to debt)
                 </label>
                 <p className="text-xs text-muted-foreground">
                   If enabled, this expense will be recorded under your PayLater/Debt account. Your cash accounts won’t go down until you record a payment.
@@ -698,21 +448,21 @@ export default function AddTransactionModal({ isOpen, onClose, defaultAccountId,
                       <p className="text-xs text-muted-foreground">
                         Full payment due in {startMonth}
                       </p>
                     )}
                   </div>
                 )}              </div>
             )}
 
             {/* Transfer To Account */}
             {type === "transfer" && (
-              <div className="animate-in slide-in-from-top duration-200">
+              <div className="animate-in slide-in-from-top duration-200 motion-reduce:animate-none">
                 <label htmlFor="transferTo" className="block text-sm font-medium mb-2">To Account</label>
                 <select
                   id="transferTo"
                   value={transferToAccountId}
                   onChange={(e) => {
                     const nextId = e.target.value;
                     setTransferToAccountId(nextId);
                     const nextAcc = getAccount(nextId);
                     if (nextAcc?.type === "credit_card") {
                       const month = debtPaymentMonth || new Date().toISOString().slice(0, 7);
@@ -782,21 +532,25 @@ export default function AddTransactionModal({ isOpen, onClose, defaultAccountId,
                 >
                   <option value="">No category</option>
                   {categories.filter(c => c.type === type).map((c) => (
                     <option value={c.id} key={c.id}>{c.name}</option>
                   ))}
                 </select>
               )}
             </div>
 
             {/* Date */}
-            {(type === "expense" || type === "transfer") && <GoalSelector value={goalId} onChange={setGoalId} disabled={isLoading} />}
+            {(type === "expense" || type === "transfer") && <GoalSelector value={goalId} onChange={setGoalId} disabled={isLoading} meaning={isPayLater ? "purchase" : type === "transfer" && !isDebtPayment ? "carry" : "spend"} debtOnly={isDebtPayment} />}
+            {type === "transfer" && !isDebtPayment && goalId && <div>
+              <label htmlFor="carry-amount" className="block text-sm font-medium mb-2">Reservation to carry</label>
+              <input id="carry-amount" type="number" min="0.01" step="0.01" required value={carryAmount} onChange={event => setCarryAmount(event.target.value)} className="min-h-11 w-full px-4 py-3 border rounded-lg bg-background focus-visible:ring-2 focus-visible:ring-primary" />
+            </div>}
 
             <div>
               <label htmlFor="date" className="block text-sm font-medium mb-2">Date</label>
               <input
                 type="date"
                 id="date"
                 value={date}
                 onChange={(e) => setDate(e.target.value)}
                 className="w-full px-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-primary transition-all appearance-none block min-w-full bg-transparent"
                 required
@@ -810,34 +564,38 @@ export default function AddTransactionModal({ isOpen, onClose, defaultAccountId,
                 type="text"
                 id="description"
                 value={description}
                 onChange={(e) => setDescription(e.target.value)}
                 className="w-full px-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-primary transition-all"
                 placeholder="Enter description"
               />
             </div>
           </fieldset>
 
+          {(formError || submit.error) && <p role="alert" className="px-6 pb-4 text-sm text-red-700 dark:text-red-300">{formError || submit.error}</p>}
+          {submit.phase === "review" && !submit.unresolved && submit.transactionQuote && submit.draft && <GoalReleaseNotice key={JSON.stringify(submit.transactionQuote)} quote={submit.transactionQuote} draft={submit.draft} snapshot={financeSnapshot} disabled={isLoading} onChange={releases => { void submit.quote(submit.draft!, releases); }} onConfirm={() => { void submit.confirm(); }} onCancel={submit.reset} />}
+          {submit.unresolved && <div className="px-6 pb-6 space-y-3"><p className="text-sm">Pending transaction: {formatCurrency(Number(submit.draft?.amount))}. Its original wallet, quote and save request are retained.</p><button type="button" disabled={isLoading} onClick={() => { void submit.confirm(); }} className="min-h-11 px-4 py-3 bg-emerald-700 text-white dark:bg-emerald-400 dark:text-slate-950 rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Retry same transaction</button></div>}
+          {submit.phase === "saved" && <p role="status" className="px-6 pb-4 text-sm">{submit.refreshError ? "Transaction saved. Some views could not refresh. Close and refresh the page; do not save it again." : "Transaction saved."}</p>}
           {/* Modal Footer */}
           <div className="flex gap-3 p-6 border-t dark:border-slate-700">
             <button
               type="button"
-              onClick={onClose}
+              onClick={close}
               disabled={isLoading}
-              className="flex-1 px-4 py-3 border rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-all duration-200 font-medium"
+              className="flex-1 px-4 py-3 border rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-200 motion-reduce:transition-none font-medium"
             >
-              Cancel
+              {submit.phase === "saved" ? "Close" : "Cancel"}
             </button>
             <button
               type="submit"
-              disabled={isLoading || isDataLoading || !!dataError || accounts.length === 0}
-              className="flex-1 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium hover:shadow-lg"
+              disabled={isLoading || isDataLoading || !!dataError || accounts.length === 0 || submit.phase === "review" || submit.phase === "saved"}
+              className="flex-1 px-4 py-3 bg-emerald-700 text-white dark:bg-emerald-400 dark:text-slate-950 rounded-lg hover:bg-emerald-800 dark:hover:bg-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 motion-reduce:transition-none font-medium hover:shadow-lg"
             >
-              {isLoading ? "Adding..." : isDataLoading ? "Loading accounts..." : "Add Transaction"}
+              {isLoading ? "Checking..." : isDataLoading ? "Loading accounts..." : submit.phase === "saved" ? "Saved" : "Add Transaction"}
             </button>
           </div>
         </form>
       </Dialog.Content>
       </Dialog.Portal>
     </Dialog.Root>
   );
 }
diff --git a/src/components/transactions/GoalReleaseNotice.tsx b/src/components/transactions/GoalReleaseNotice.tsx
new file mode 100644
index 0000000..b4a9504
--- /dev/null
+++ b/src/components/transactions/GoalReleaseNotice.tsx
@@ -0,0 +1,47 @@
+"use client";
+
+import { useState } from "react";
+import { parseMoney, toMinorUnits } from "@/lib/goals/summary";
+import type { GoalFinanceSnapshot, ReleaseLine, TransactionDraft, TransactionQuote } from "@/lib/goals/contracts";
+import { formatCurrency } from "@/lib/utils";
+
+export function GoalReleaseNotice({ quote, draft, snapshot, disabled, onChange, onConfirm, onCancel }: {
+  quote: TransactionQuote; draft: TransactionDraft; snapshot?: GoalFinanceSnapshot; disabled: boolean;
+  onChange: (releases: ReleaseLine[]) => void; onConfirm: () => void; onCancel: () => void;
+}) {
+  const [custom, setCustom] = useState(false);
+  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(quote.releases.map(line => [line.goalId, line.amount])));
+  const [error, setError] = useState("");
+  const goalName = (id: string) => snapshot?.goals.find(goal => goal.id === id)?.name ?? "Goal";
+  const eligible = (snapshot?.goals ?? []).filter(goal => goal.status === "active" && goal.review_state === "confirmed" && goal.archived_at === null && goal.id !== draft.goalId &&
+    goal.walletReservations.some(line => line.accountId === draft.accountId && toMinorUnits(line.amount) > 0));
+  const applyCustom = () => {
+    try {
+      const releases = eligible.flatMap(goal => {
+        const amount = parseMoney(amounts[goal.id] || "0");
+        return amount === "0.00" ? [] : [{ goalId: goal.id, accountId: draft.accountId, amount }];
+      });
+      if (releases.reduce((total, line) => total + toMinorUnits(line.amount), 0) !== quote.releases.reduce((total, line) => total + toMinorUnits(line.amount), 0)) {
+        setError("Release amounts must add up to the shortfall shown above."); return;
+      }
+      setError(""); onChange(releases);
+    } catch { setError("Enter amounts with no more than two decimal places."); }
+  };
+  return <section aria-labelledby="release-heading" className="mx-6 mb-6 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
+    <h3 id="release-heading" className="font-semibold">Review goal releases</h3>
+    <p className="text-sm">This transaction needs money set aside for goals. Saving will release:</p>
+    <ul className="space-y-1 text-sm">{quote.releases.map(line => <li key={line.goalId}>{goalName(line.goalId)}: {formatCurrency(Number(line.amount))}</li>)}</ul>
+    <p className="text-xs text-muted-foreground">Actual {formatCurrency(Number(quote.actual))} · Reserved {formatCurrency(Number(quote.reserved))} · Available {formatCurrency(Number(quote.available))}</p>
+    <p className="text-sm">These goals will have less reserved money. This release does not count as goal spending.</p>
+    {eligible.length > 1 && <button type="button" disabled={disabled} onClick={() => setCustom(!custom)} className="min-h-11 px-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">{custom ? "Use proposed releases" : "Choose release amounts"}</button>}
+    {custom && <div className="space-y-3">
+      {eligible.map(goal => <div key={goal.id}><label htmlFor={`release-${goal.id}`} className="block text-sm mb-1">Release from {goal.name}</label><input id={`release-${goal.id}`} type="number" step="0.01" min="0" disabled={disabled} value={amounts[goal.id] ?? ""} onChange={event => { setAmounts({ ...amounts, [goal.id]: event.target.value }); setError(""); }} className="min-h-11 w-full rounded-lg border bg-background px-3 focus-visible:ring-2 focus-visible:ring-primary" /></div>)}
+      <button type="button" disabled={disabled} onClick={applyCustom} className="min-h-11 px-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Review these releases</button>
+    </div>}
+    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
+    <div className="flex flex-col sm:flex-row gap-3">
+      <button type="button" disabled={disabled} onClick={onCancel} className="min-h-11 flex-1 px-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Keep reservations</button>
+      <button type="button" disabled={disabled || custom} onClick={onConfirm} className="min-h-11 flex-1 px-3 rounded-lg bg-emerald-700 text-white dark:bg-emerald-400 dark:text-slate-950 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary">Release funds and save</button>
+    </div>
+  </section>;
+}
diff --git a/src/components/transactions/TransactionDetailModal.tsx b/src/components/transactions/TransactionDetailModal.tsx
index 524dea0..fdfd81b 100644
--- a/src/components/transactions/TransactionDetailModal.tsx
+++ b/src/components/transactions/TransactionDetailModal.tsx
@@ -1,12 +1,17 @@
 "use client";
 
+import * as Dialog from "@radix-ui/react-dialog";
+import { useGoals } from "@/hooks/use-goals";
+import { useGoalHistory } from "@/hooks/use-goal-finance";
+import type { GoalFinanceGoal } from "@/lib/goals/contracts";
+
 import { Button } from "@/components/ui/button";
 import Tooltip from "@/components/ui/tooltip";
 import { formatCurrency, formatDate } from "@/lib/utils";
 import { 
   X, 
   ArrowDownLeft, 
   ArrowUpRight, 
   ArrowLeftRight, 
   Calendar, 
   Tag, 
@@ -15,26 +20,39 @@ import {
   Clock
 } from "lucide-react";
 
 interface TransactionDetailModalProps {
   isOpen: boolean;
   onClose: () => void;
   transaction: any;
   onRequestDelete?: (tx: any) => void;
 }
 
+function GoalTransactionHistory({ goal, userId, transactionId }: { goal: GoalFinanceGoal; userId: string | null; transactionId: string }) {
+  const history = useGoalHistory(userId, goal.id);
+  if (history.error) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{goal.name} history could not be loaded.</p>;
+  const effects = (history.data ?? []).filter(event => event.transaction_id === transactionId || event.linkedTransactionIds?.includes(transactionId));
+  return <>{effects.map(event => {
+    if (event.kind === "spend" || event.kind === "legacy_spent") return <p key={event.id} className="text-sm">Spent from {goal.name}: {formatCurrency(Number(event.spent_delta))}</p>;
+    if (event.kind === "move_out") return <p key={event.id} className="text-sm">Carried {goal.name} reservation: {formatCurrency(-Number(event.reserved_delta))} from {event.accountName}</p>;
+    if (event.kind === "release" && event.operationKind === "transaction") return <p key={event.id} className="text-sm">Automatic release from {goal.name}: {formatCurrency(-Number(event.reserved_delta))}. This is not goal spending.</p>;
+    return null;
+  })}</>;
+}
+
 export default function TransactionDetailModal({
   isOpen,
   onClose,
   transaction,
   onRequestDelete
 }: TransactionDetailModalProps) {
+  const { financeSnapshot, userId } = useGoals();
   if (!isOpen || !transaction) return null;
 
   const getTypeColor = () => {
     switch (transaction.type) {
       case "income": return "text-green-500 bg-green-500/10";
       case "expense": return "text-red-500 bg-red-500/10";
       case "transfer": return "text-blue-500 bg-blue-500/10";
       default: return "text-slate-500 bg-slate-500/10";
     }
   };
@@ -42,47 +60,45 @@ export default function TransactionDetailModal({
   const getIcon = () => {
     switch (transaction.type) {
       case "income": return <ArrowDownLeft className="h-6 w-6" />;
       case "expense": return <ArrowUpRight className="h-6 w-6" />;
       case "transfer": return <ArrowLeftRight className="h-6 w-6" />;
       default: return <FileText className="h-6 w-6" />;
     }
   };
 
   return (
-    <div
-      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200"
-      onClick={onClose}
-    >
-      <div
-        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden shadow-xl animate-in slide-in-from-bottom-4 duration-300"
-        onClick={(e) => e.stopPropagation()}
-      >
+    <Dialog.Root open={isOpen} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
+      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
+      <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground rounded-2xl w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto shadow-xl">
         {/* Header/Banner */}
         <div className={`p-8 flex flex-col items-center justify-center text-center ${getTypeColor()}`}>
           <div className="p-4 rounded-full bg-white dark:bg-slate-800 shadow-sm mb-4">
             {getIcon()}
           </div>
-          <h3 className="text-xl font-bold capitalize mb-1">{transaction.type} Details</h3>
+          <Dialog.Title className="text-xl font-bold capitalize mb-1">{transaction.type} Details</Dialog.Title>
           <p className="text-2xl font-black tracking-tight">
             {formatCurrency(Number(transaction.amount))}
           </p>
         </div>
 
         <button 
           onClick={onClose}
-          className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
+          aria-label="Close transaction details"
+          className="absolute top-4 right-4 min-h-11 min-w-11 p-2 rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
         >
           <X className="h-5 w-5" />
         </button>
 
         <div className="p-6 space-y-6">
+          {transaction.goal_id && transaction.account?.type === "credit_card" && <p className="text-sm">Informational purchase for {financeSnapshot?.goals.find(goal => goal.id === transaction.goal_id)?.name ?? "a goal"}. This credit purchase does not fund the goal or use its reservation.</p>}
+          {financeSnapshot?.goals.map(goal => <GoalTransactionHistory key={goal.id} goal={goal} userId={userId} transactionId={transaction.id} />)}
           <div className="grid gap-4">
             {/* Description */}
             <div className="flex items-start gap-4">
               <div className="mt-1 p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                 <FileText className="h-4 w-4 text-slate-500" />
               </div>
               <div>
                 <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Description</p>
                 <p className="font-medium text-slate-900 dark:text-slate-100">
                   {transaction.description || "No description provided"}
@@ -184,23 +200,23 @@ export default function TransactionDetailModal({
                 Close
               </Button>
               {/* Styled tooltip wraps the Delete button */}
               <Tooltip content={transaction?.id ? "Delete transaction\nRevert balances" : "Cannot delete this transaction"}>
                 <button
                   onClick={() => {
                     if (onRequestDelete) onRequestDelete(transaction);
                     onClose();
                   }}
                   disabled={!transaction?.id}
-                  className={`min-w-[100px] h-12 text-base font-semibold rounded-lg transition-colors ${transaction?.id ? "bg-red-500 text-white hover:bg-red-600" : "bg-red-500/30 text-white/60 cursor-not-allowed"}`}
+                  className={`min-w-[100px] h-12 text-base font-semibold rounded-lg transition-colors ${transaction?.id ? "bg-red-700 text-white hover:bg-red-800 dark:bg-red-400 dark:text-slate-950 dark:hover:bg-red-300" : "bg-red-500/30 text-white/60 cursor-not-allowed"}`}
                   title={transaction?.id ? "Delete transaction" : ""}
                 >
                   Delete
                 </button>
               </Tooltip>
             </div>
           </div>
         </div>
-      </div>
-    </div>
+      </Dialog.Content>
+    </Dialog.Portal></Dialog.Root>
   );
 }
diff --git a/src/hooks/use-transaction-submit.ts b/src/hooks/use-transaction-submit.ts
new file mode 100644
index 0000000..b5994ec
--- /dev/null
+++ b/src/hooks/use-transaction-submit.ts
@@ -0,0 +1,146 @@
+import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
+import { useGoals } from "@/hooks/use-goals";
+import { FinancialCommandError, financialCommandMessage, quoteTransaction } from "@/lib/goals/client";
+import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
+import { createClient } from "@/lib/supabase/client";
+import type { FinancialCommand, FinancialResult, ReleaseLine, TransactionDraft, TransactionQuote } from "@/lib/goals/contracts";
+
+type Phase = "editing" | "quoting" | "review" | "saving" | "saved";
+type Attempt = { requestId: string; command: FinancialCommand; quote: TransactionQuote };
+type State = { phase: Phase; error: string | null; saved: FinancialResult | null; refreshError: unknown | null;
+  transactionQuote: TransactionQuote | null; draft: TransactionDraft | null; unresolved: boolean };
+type Controller = { state: State; attempt: Attempt | null; revision: number; listeners: Set<() => void> };
+const empty = (): State => ({ phase: "editing", error: null, saved: null, refreshError: null, transactionQuote: null, draft: null, unresolved: false });
+// An unresolved write belongs to the user, not the lifetime of a dialog.
+const controllers = new Map<string, Controller>();
+const signedOut: Controller = { state: empty(), attempt: null, revision: 0, listeners: new Set() };
+function forUser(userId: string | null): Controller {
+  if (!userId) return signedOut;
+  let controller = controllers.get(userId);
+  if (!controller) { controller = { state: empty(), attempt: null, revision: 0, listeners: new Set() }; controllers.set(userId, controller); }
+  return controller;
+}
+function update(controller: Controller, patch: Partial<State>) {
+  controller.state = { ...controller.state, ...patch };
+  controller.listeners.forEach(listener => listener());
+}
+function message(error: unknown, fallback: string) {
+  return error instanceof FinancialCommandError ? financialCommandMessage(error, fallback) : fallback;
+}
+
+export function useTransactionSubmit() {
+  const { userId, refresh } = useGoals();
+  const controller = forUser(userId);
+  const currentUser = useRef(userId);
+  currentUser.current = userId;
+  const alive = useRef(true);
+  useEffect(() => {
+    alive.current = true;
+    return () => {
+      alive.current = false;
+      if (controller.state.phase === "quoting") {
+        controller.revision += 1;
+        update(controller, empty());
+      }
+    };
+  }, [controller]);
+  const subscribe = useCallback((listener: () => void) => { controller.listeners.add(listener); return () => { controller.listeners.delete(listener); }; }, [controller]);
+  const state = useSyncExternalStore(subscribe, () => controller.state, () => controller.state);
+
+  const reset = useCallback(() => {
+    if (controller.attempt || controller.state.phase === "saving") return;
+    controller.revision += 1;
+    update(controller, empty());
+  }, [controller]);
+
+  const fetchQuote = async (draft: TransactionDraft, releases?: ReleaseLine[], requireConfirmation = false) => {
+    if (!userId || currentUser.current !== userId || !alive.current || controller.attempt || controller.state.phase === "saving" || controller.state.phase === "saved") return;
+    const revision = ++controller.revision;
+    update(controller, { phase: "quoting", error: null, transactionQuote: null, draft });
+    try {
+      const next = await quoteTransaction(draft, releases);
+      if (controller.revision !== revision || currentUser.current !== userId || !alive.current) return;
+      update(controller, { phase: "review", transactionQuote: next });
+      if (!requireConfirmation && next.releases.length === 0) await confirm();
+    } catch (error) {
+      if (controller.revision !== revision) return;
+      update(controller, { phase: "editing", error: message(error, "Could not check this transaction. Try again.") });
+    }
+  };
+
+  const confirm = async () => {
+    if (!userId || currentUser.current !== userId || !alive.current || controller.state.phase !== "review") return;
+    const { draft, transactionQuote } = controller.state;
+    if (!draft || !transactionQuote) return;
+    const wasUnresolved = controller.state.unresolved;
+    const attempt = controller.attempt ?? { requestId: crypto.randomUUID(), command: { kind: "transaction", draft } as FinancialCommand, quote: transactionQuote };
+    controller.attempt = attempt;
+    update(controller, { phase: "saving", error: null });
+    try {
+      const { data: { user } } = await createClient().auth.getUser();
+      if (user?.id !== userId || currentUser.current !== userId) {
+        if (!wasUnresolved) controller.attempt = null;
+        update(controller, { phase: wasUnresolved ? "review" : "editing", error: "Sign in to the account that started this transaction before retrying." });
+        return;
+      }
+      const outcome = await applyAndRefreshFinancialCommand(attempt.requestId, attempt.command, attempt.quote, refresh);
+      controller.attempt = null;
+      update(controller, { phase: "saved", saved: outcome.saved, refreshError: outcome.refreshError, unresolved: false });
+    } catch (error) {
+      if (!(error instanceof FinancialCommandError) || error.outcome === "unknown") {
+        update(controller, { phase: "review", unresolved: true, error: "The save could not be confirmed. Retry this same transaction before starting another." });
+        return;
+      }
+      controller.attempt = null;
+      update(controller, { phase: "editing", unresolved: false, error: message(error, "This transaction could not be saved. Review the details and try again.") });
+      if (error.code === "STALE_QUOTE") {
+        await fetchQuote(draft, undefined, true);
+        if (controller.state.phase === "review") update(controller, { error: "Wallet reservations changed. Review the updated amounts and confirm again." });
+      }
+    }
+  };
+
+  return { ...state, quote: fetchQuote, confirm, reset };
+}
+
+type DeleteState = { isDeleting: boolean; pendingTransactionId: string | null; savedTransactionId: string | null; error: string | null; refreshError: unknown | null };
+type DeleteController = { state: DeleteState; requestId: string | null; listeners: Set<() => void> };
+const deletions = new Map<string, DeleteController>();
+export function useTransactionDelete(refreshList: () => Promise<unknown>) {
+  const { userId, refresh } = useGoals();
+  const key = userId ?? "signed-out";
+  if (!deletions.has(key)) deletions.set(key, { state: { isDeleting: false, pendingTransactionId: null, savedTransactionId: null, error: null, refreshError: null }, requestId: null, listeners: new Set() });
+  const controller = deletions.get(key)!;
+  const currentUser = useRef(userId);
+  currentUser.current = userId;
+  const subscribe = useCallback((listener: () => void) => { controller.listeners.add(listener); return () => { controller.listeners.delete(listener); }; }, [controller]);
+  const state = useSyncExternalStore(subscribe, () => controller.state, () => controller.state);
+  const patch = (values: Partial<DeleteState>) => { controller.state = { ...controller.state, ...values }; controller.listeners.forEach(listener => listener()); };
+  const remove = async (transactionId: string) => {
+    if (!userId || currentUser.current !== userId || controller.state.isDeleting || controller.state.savedTransactionId === transactionId || (controller.state.pendingTransactionId && controller.state.pendingTransactionId !== transactionId)) return;
+    const wasUnresolved = controller.requestId !== null;
+    controller.requestId ??= crypto.randomUUID();
+    patch({ isDeleting: true, pendingTransactionId: transactionId, error: null, savedTransactionId: null, refreshError: null });
+    try {
+      const { data: { user } } = await createClient().auth.getUser();
+      if (user?.id !== userId || currentUser.current !== userId) {
+        if (!wasUnresolved) controller.requestId = null;
+        patch({ isDeleting: false, pendingTransactionId: wasUnresolved ? transactionId : null, error: "Sign in to the account that started this deletion before retrying." });
+        return;
+      }
+      const outcome = await applyAndRefreshFinancialCommand(controller.requestId, { kind: "delete_transaction", transactionId }, undefined, async () => {
+        const results = await Promise.allSettled([refresh(), refreshList()]);
+        const failure = results.find(result => result.status === "rejected");
+        if (failure?.status === "rejected") throw failure.reason;
+      });
+      controller.requestId = null;
+      patch({ isDeleting: false, pendingTransactionId: null, savedTransactionId: transactionId, refreshError: outcome.refreshError });
+    } catch (error) {
+      const unknown = !(error instanceof FinancialCommandError) || error.outcome === "unknown";
+      if (!unknown) controller.requestId = null;
+      patch({ isDeleting: false, pendingTransactionId: unknown ? transactionId : null,
+        error: unknown ? "The deletion could not be confirmed. Retry the same deletion before deleting another transaction." : message(error, "This transaction could not be deleted. Review its wallet and reservations.") });
+    }
+  };
+  return { ...state, remove };
+}
diff --git a/src/lib/goals/client.ts b/src/lib/goals/client.ts
index bc83ba1..d0fe4f8 100644
--- a/src/lib/goals/client.ts
+++ b/src/lib/goals/client.ts
@@ -62,20 +62,21 @@ export class SupersededGoalFinanceRequestError extends Error {
     super("The signed-in user changed while the goal snapshot was loading.");
     this.name = "SupersededGoalFinanceRequestError";
   }
 }
 
 export type GoalWalletMetadata = { id: string; name: string; type: string; currency: string; is_active: boolean };
 export type GoalHistoryEntry = Omit<AllocationEvent, "kind"> & {
   kind: AllocationEvent["kind"] | "transaction_reversal";
   accountName: string;
   operationKind: FinancialCommand["kind"] | null;
+  linkedTransactionIds?: string[];
 };
 
 function normalizeDatabaseDecimal(value: unknown): string {
   if (typeof value !== "string" || !/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) {
     throw new Error("Allocation history contains an invalid decimal amount.");
   }
   const negative = value.startsWith("-");
   const unsigned = negative ? value.slice(1) : value;
   const [whole, fraction = ""] = unsigned.split(".");
   const normalized = `${whole}.${fraction.padEnd(2, "0")}`;
@@ -123,20 +124,23 @@ export async function fetchGoalHistory(userId: string, goalId: string): Promise<
       .select("id,command,result,created_at")
       .eq("user_id", userId)
       .in("id", operationIds),
   ]);
   if (accountResult.error) throw accountResult.error;
   if (sourceOperationResult.error) throw sourceOperationResult.error;
   const accountNames = new Map<string, string>((accountResult.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name]));
   type OperationRow = { id: string; command: { kind?: unknown; transactionId?: unknown }; result?: { transactionIds?: unknown }; created_at: string };
   const sourceOperations = (sourceOperationResult.data ?? []) as OperationRow[];
   const sourceOperationsById = new Map<string, OperationRow>(sourceOperations.map(row => [row.id, row]));
+  const operationTransactionLinks = new Map(sourceOperations.map(row => [row.id,
+    row.result?.transactionIds === undefined ? [] : z.array(z.string().uuid()).parse(row.result.transactionIds),
+  ]));
   const transactionIds = Array.from(new Set(events.flatMap(event => {
     if (event.transaction_id) return [event.transaction_id];
     const operation = sourceOperationsById.get(event.operation_id);
     return Array.isArray(operation?.result?.transactionIds)
       ? operation.result.transactionIds.filter((value): value is string => typeof value === "string")
       : [];
   })));
   const reversalOperationsResult = transactionIds.length === 0 ? { data: [], error: null } : await db.from("financial_operations")
     .select("id,command,result,created_at")
     .eq("user_id", userId)
@@ -154,20 +158,21 @@ export async function fetchGoalHistory(userId: string, goalId: string): Promise<
   for (const row of reversalOperations) {
     const command = row.command;
     if (command?.kind === "delete_transaction" && typeof command.transactionId === "string") {
       deleteOperationByTransactionId.set(command.transactionId, row);
     }
   }
   const rows: GoalHistoryEntry[] = events.map(event => ({
     ...event,
     accountName: accountNames.get(event.account_id) ?? "Wallet",
     operationKind: operationKinds.get(event.operation_id) ?? null,
+    linkedTransactionIds: operationTransactionLinks.get(event.operation_id) ?? [],
   }));
   const reversedEventIds = new Set(events.filter(event => event.kind === "reversal" && event.reversal_of !== null).map(event => event.reversal_of));
   for (const event of events) {
     if (reversedEventIds.has(event.id)) continue;
     const source = sourceOperationsById.get(event.operation_id);
     const linkedIds = event.transaction_id ? [event.transaction_id] : Array.isArray(source?.result?.transactionIds)
       ? source.result.transactionIds.filter((value): value is string => typeof value === "string")
       : [];
     for (const transactionId of linkedIds) {
       const deletion = deleteOperationByTransactionId.get(transactionId);
diff --git a/supabase/migrations/202610060004_goal_transaction_operations.sql b/supabase/migrations/202610060004_goal_transaction_operations.sql
index 310da8c..cc27d0e 100644
--- a/supabase/migrations/202610060004_goal_transaction_operations.sql
+++ b/supabase/migrations/202610060004_goal_transaction_operations.sql
@@ -77,26 +77,28 @@ BEGIN
     IF v_src.id=v_dst.id THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     IF v_dst.is_active IS DISTINCT FROM true OR v_dst.currency IS DISTINCT FROM 'PHP' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
   ELSIF v_draft->>'transferToAccountId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF jsonb_typeof(v_draft->'installments')<>'null' AND
     (v_draft->>'type'<>'expense' OR v_src.type<>'credit_card' OR extract(day FROM (v_draft->>'date')::date)<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF v_draft->>'goalId' IS NOT NULL THEN
     SELECT * INTO v_goal FROM public.goals WHERE id=(v_draft->>'goalId')::uuid AND user_id=v_owner;
     IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
     IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
     IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
-    IF v_src.type='credit_card' OR v_draft->>'type'='income' OR
+    IF v_draft->>'type'='income' OR (v_src.type='credit_card' AND v_draft->>'type'<>'expense') OR
       (v_draft->>'type'='transfer' AND (v_dst.type<>'credit_card' OR v_goal.category<>'debt')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
-    SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
-      WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
-    IF v_funds<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
-    v_spending := v_amount;
+    IF v_src.type<>'credit_card' THEN
+      SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
+        WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
+      IF v_funds<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+      v_spending := v_amount;
+    END IF;
   END IF;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
     SELECT * INTO v_goal FROM public.goals WHERE id=(v_line->>'goalId')::uuid AND user_id=v_owner;
     IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
     IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
     IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     IF v_draft->>'type'<>'transfer' OR v_src.type='credit_card' OR v_dst.type='credit_card' OR v_spending>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
       WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
     IF v_funds<(v_line->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
@@ -238,21 +240,21 @@ BEGIN
     INSERT INTO public.transactions(user_id,account_id,transfer_to_account_id,category_id,goal_id,type,amount,description,date)
       VALUES(v_owner,v_src.id,v_dst.id,(v_draft->>'categoryId')::uuid,(v_draft->>'goalId')::uuid,v_draft->>'type',v_piece,v_description,v_date) RETURNING id INTO v_transaction;
     v_ids := v_ids || jsonb_build_array(v_transaction);
   END LOOP;
   UPDATE public.accounts SET balance=coalesce(balance,0)+CASE
     WHEN v_draft->>'type'='income' THEN CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END
     ELSE CASE WHEN type='credit_card' THEN v_amount ELSE -v_amount END END WHERE id=v_src.id AND user_id=v_owner;
   IF v_draft->>'type'='transfer' THEN
     UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END WHERE id=v_dst.id AND user_id=v_owner;
   END IF;
-  IF v_draft->>'goalId' IS NOT NULL THEN
+  IF v_draft->>'goalId' IS NOT NULL AND v_src.type<>'credit_card' THEN
     INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id)
       VALUES(v_owner,(v_draft->>'goalId')::uuid,v_src.id,v_operation,'spend',-v_amount,v_amount,v_transaction);
   END IF;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
     INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,transaction_id) VALUES
       (v_owner,(v_line->>'goalId')::uuid,v_src.id,v_operation,'move_out',-(v_line->>'amount')::numeric,v_transaction),
       (v_owner,(v_line->>'goalId')::uuid,v_dst.id,v_operation,'move_in',(v_line->>'amount')::numeric,v_transaction);
   END LOOP;
   v_result := jsonb_build_object('operationId',v_operation,'transactionIds',v_ids,'replayed',false);
   UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=v_operation AND user_id=v_owner;
diff --git a/supabase/migrations/202610060005_goal_lifecycle_operations.sql b/supabase/migrations/202610060005_goal_lifecycle_operations.sql
index a8e5e1d..b25cf74 100644
--- a/supabase/migrations/202610060005_goal_lifecycle_operations.sql
+++ b/supabase/migrations/202610060005_goal_lifecycle_operations.sql
@@ -1,14 +1,34 @@
 BEGIN;
-DO $$ BEGIN
+DO $$
+DECLARE
+  v_public regprocedure := to_regprocedure('public.goal_finance_apply(uuid,jsonb,jsonb)');
+  v_body text; v_definition text;
+  v_header constant text := 'CREATE OR REPLACE FUNCTION public.goal_finance_apply(';
+BEGIN
+  IF v_public IS NULL THEN RAISE EXCEPTION 'Transaction dispatcher is missing'; END IF;
+  SELECT prosrc INTO v_body FROM pg_proc WHERE oid=v_public;
   IF to_regprocedure('public.goal_transaction_apply(uuid,jsonb,jsonb)') IS NULL THEN
+    IF position('public.goal_normalize_transaction' IN v_body)=0 OR position('public.goal_transaction_apply' IN v_body)>0 THEN
+      RAISE EXCEPTION 'Expected transaction implementation before lifecycle dispatcher';
+    END IF;
     ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_transaction_apply;
+  ELSE
+    IF position('public.goal_normalize_transaction' IN v_body)>0 AND position('public.goal_transaction_apply' IN v_body)=0 THEN
+      v_definition := pg_get_functiondef(v_public);
+      IF left(v_definition,length(v_header))<>v_header THEN RAISE EXCEPTION 'Unexpected transaction function definition'; END IF;
+      EXECUTE 'CREATE OR REPLACE FUNCTION public.goal_transaction_apply(' || substr(v_definition,length(v_header)+1);
+    ELSIF position('public.goal_transaction_apply' IN v_body)>0 AND position('public.goal_normalize_transaction' IN v_body)=0 THEN
+      NULL;
+    ELSE
+      RAISE EXCEPTION 'Ambiguous transaction dispatcher definition';
+    END IF;
   END IF;
 END $$;
 REVOKE ALL ON FUNCTION public.goal_transaction_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
 
 CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE
   v_owner uuid := auth.uid(); v_kind text; v_goal_id uuid; v_target_id uuid; v_transaction_id uuid;
   v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
   v_goal public.goals%ROWTYPE; v_target public.goals%ROWTYPE;
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 42b3907..2818d9a 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -495,26 +495,28 @@ BEGIN
     IF v_src.id=v_dst.id THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     IF v_dst.is_active IS DISTINCT FROM true OR v_dst.currency IS DISTINCT FROM 'PHP' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
   ELSIF v_draft->>'transferToAccountId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF jsonb_typeof(v_draft->'installments')<>'null' AND
     (v_draft->>'type'<>'expense' OR v_src.type<>'credit_card' OR extract(day FROM (v_draft->>'date')::date)<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF v_draft->>'goalId' IS NOT NULL THEN
     SELECT * INTO v_goal FROM public.goals WHERE id=(v_draft->>'goalId')::uuid AND user_id=v_owner;
     IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
     IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
     IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
-    IF v_src.type='credit_card' OR v_draft->>'type'='income' OR
+    IF v_draft->>'type'='income' OR (v_src.type='credit_card' AND v_draft->>'type'<>'expense') OR
       (v_draft->>'type'='transfer' AND (v_dst.type<>'credit_card' OR v_goal.category<>'debt')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
-    SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
-      WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
-    IF v_funds<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
-    v_spending := v_amount;
+    IF v_src.type<>'credit_card' THEN
+      SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
+        WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
+      IF v_funds<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+      v_spending := v_amount;
+    END IF;
   END IF;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
     SELECT * INTO v_goal FROM public.goals WHERE id=(v_line->>'goalId')::uuid AND user_id=v_owner;
     IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
     IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
     IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     IF v_draft->>'type'<>'transfer' OR v_src.type='credit_card' OR v_dst.type='credit_card' OR v_spending>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
       WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
     IF v_funds<(v_line->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
@@ -656,44 +658,64 @@ BEGIN
     INSERT INTO public.transactions(user_id,account_id,transfer_to_account_id,category_id,goal_id,type,amount,description,date)
       VALUES(v_owner,v_src.id,v_dst.id,(v_draft->>'categoryId')::uuid,(v_draft->>'goalId')::uuid,v_draft->>'type',v_piece,v_description,v_date) RETURNING id INTO v_transaction;
     v_ids := v_ids || jsonb_build_array(v_transaction);
   END LOOP;
   UPDATE public.accounts SET balance=coalesce(balance,0)+CASE
     WHEN v_draft->>'type'='income' THEN CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END
     ELSE CASE WHEN type='credit_card' THEN v_amount ELSE -v_amount END END WHERE id=v_src.id AND user_id=v_owner;
   IF v_draft->>'type'='transfer' THEN
     UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END WHERE id=v_dst.id AND user_id=v_owner;
   END IF;
-  IF v_draft->>'goalId' IS NOT NULL THEN
+  IF v_draft->>'goalId' IS NOT NULL AND v_src.type<>'credit_card' THEN
     INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id)
       VALUES(v_owner,(v_draft->>'goalId')::uuid,v_src.id,v_operation,'spend',-v_amount,v_amount,v_transaction);
   END IF;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
     INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,transaction_id) VALUES
       (v_owner,(v_line->>'goalId')::uuid,v_src.id,v_operation,'move_out',-(v_line->>'amount')::numeric,v_transaction),
       (v_owner,(v_line->>'goalId')::uuid,v_dst.id,v_operation,'move_in',(v_line->>'amount')::numeric,v_transaction);
   END LOOP;
   v_result := jsonb_build_object('operationId',v_operation,'transactionIds',v_ids,'replayed',false);
   UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=v_operation AND user_id=v_owner;
   RETURN v_result;
 END $$;
 REVOKE ALL ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) FROM PUBLIC,anon;
 REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) TO authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
 NOTIFY pgrst, 'reload schema';
 COMMIT;
 
 BEGIN;
-DO $$ BEGIN
+DO $$
+DECLARE
+  v_public regprocedure := to_regprocedure('public.goal_finance_apply(uuid,jsonb,jsonb)');
+  v_body text; v_definition text;
+  v_header constant text := 'CREATE OR REPLACE FUNCTION public.goal_finance_apply(';
+BEGIN
+  IF v_public IS NULL THEN RAISE EXCEPTION 'Transaction dispatcher is missing'; END IF;
+  SELECT prosrc INTO v_body FROM pg_proc WHERE oid=v_public;
   IF to_regprocedure('public.goal_transaction_apply(uuid,jsonb,jsonb)') IS NULL THEN
+    IF position('public.goal_normalize_transaction' IN v_body)=0 OR position('public.goal_transaction_apply' IN v_body)>0 THEN
+      RAISE EXCEPTION 'Expected transaction implementation before lifecycle dispatcher';
+    END IF;
     ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_transaction_apply;
+  ELSE
+    IF position('public.goal_normalize_transaction' IN v_body)>0 AND position('public.goal_transaction_apply' IN v_body)=0 THEN
+      v_definition := pg_get_functiondef(v_public);
+      IF left(v_definition,length(v_header))<>v_header THEN RAISE EXCEPTION 'Unexpected transaction function definition'; END IF;
+      EXECUTE 'CREATE OR REPLACE FUNCTION public.goal_transaction_apply(' || substr(v_definition,length(v_header)+1);
+    ELSIF position('public.goal_transaction_apply' IN v_body)>0 AND position('public.goal_normalize_transaction' IN v_body)=0 THEN
+      NULL;
+    ELSE
+      RAISE EXCEPTION 'Ambiguous transaction dispatcher definition';
+    END IF;
   END IF;
 END $$;
 REVOKE ALL ON FUNCTION public.goal_transaction_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
 
 CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE
   v_owner uuid := auth.uid(); v_kind text; v_goal_id uuid; v_target_id uuid; v_transaction_id uuid;
   v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
   v_goal public.goals%ROWTYPE; v_target public.goals%ROWTYPE;
diff --git a/tests/contributions.test.tsx b/tests/contributions.test.tsx
index 29745f4..db21073 100644
--- a/tests/contributions.test.tsx
+++ b/tests/contributions.test.tsx
@@ -4,49 +4,58 @@ import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/re
 import userEvent from "@testing-library/user-event";
 import { SWRConfig } from "swr";
 import AddTransactionModal from "@/components/transactions/AddTransactionModal";
 import { useGoals } from "@/hooks/use-goals";
 import GoalsPage from "@/app/(dashboard)/goals/page";
 import DashboardPage from "@/app/(dashboard)/dashboard/page";
 import AccountsPage from "@/app/(dashboard)/accounts/page";
 import { writeFileSync, mkdirSync } from "node:fs";
 
 const db = vi.hoisted(() => ({
-  transactions: [] as any[], failInsert: false, delayLoad: null as Promise<void> | null,
+  commands: [] as any[], transactions: [] as any[], failInsert: false, delayLoad: null as Promise<void> | null,
   userId: "10000000-0000-4000-8000-000000000001",
   phoneId: "20000000-0000-4000-8000-000000000001",
   laptopId: "20000000-0000-4000-8000-000000000002",
   cashId: "30000000-0000-4000-8000-000000000001",
   bankId: "30000000-0000-4000-8000-000000000002",
   debtId: "30000000-0000-4000-8000-000000000003",
 }));
 vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/dashboard" }));
 vi.mock("@/hooks/use-data", () => ({
   useAccounts: () => ({ data: [{ id: db.cashId, balance: 10000, type: "cash" }], isLoading: false }),
   useRecentTransactions: () => ({ data: [], isLoading: false }),
   useDashboardStats: () => ({ data: { monthlyIncome: 15000, monthlyExpenses: 5000, lastMonthIncome: 12000, lastMonthExpenses: 4000 }, isLoading: false }),
 }));
 vi.mock("@/lib/supabase/client", () => {
   const accounts = [
-    { id: db.cashId, name: "Cash", type: "cash", balance: 10000 },
-    { id: db.bankId, name: "Bank", type: "bank", balance: 0 },
-    { id: db.debtId, name: "PayLater", type: "credit_card", balance: 0 },
+    { id: db.cashId, name: "Cash", type: "cash", balance: 10000, currency: "PHP", is_active: true },
+    { id: db.bankId, name: "Bank", type: "bank", balance: 0, currency: "PHP", is_active: true },
+    { id: db.debtId, name: "PayLater", type: "credit_card", balance: 0, currency: "PHP", is_active: true },
   ];
   const goals = [{ id: db.phoneId, name: "phone" }, { id: db.laptopId, name: "laptop" }];
   return { createClient: () => ({
     auth: {
       getUser: async () => ({ data: { user: { id: db.userId } } }),
       getSession: async () => ({ data: { session: { user: { id: db.userId }, access_token: "fixture-token" } }, error: null }),
       onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
     },
-    rpc(name: string) {
+    rpc(name: string, args: any) {
       const response = Promise.resolve().then(() => {
+        if (name === "goal_transaction_quote") return { data: { fingerprint: "quote", actual: "30000.00", reserved: "0.00", available: "30000.00", releases: [] }, error: null };
+        if (name === "goal_finance_apply") {
+          if (db.failInsert) return { data: null, error: { message: "INVALID_STATE", hint: "Save failed" } };
+          db.commands.push(args.p_command);
+          const draft = args.p_command.draft;
+          const count = draft.installments?.count ?? 1;
+          for (let i = 0; i < count; i++) db.transactions.push({ amount: Number(draft.amount) / count, goal_id: draft.goalId });
+          return { data: { operationId: "40000000-0000-4000-8000-000000000004", transactionIds: db.transactions.map((_, index) => `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`), replayed: false }, error: null };
+        }
         if (name !== "goal_finance_snapshot") return { data: null, error: null };
         return { data: {
         goals: goals.map(goal => ({
           ...goal,
           user_id: db.userId,
           target_amount: "5000.00",
           current_amount: "0.00",
           target_date: null,
           color: null,
           icon: null,
@@ -101,45 +110,46 @@ vi.mock("@/lib/supabase/client", () => {
   }) };
 });
 
 function Progress() {
   const { goals } = useGoals();
   const phone = goals.find(g => g.id === db.phoneId);
   return <output aria-label="Phone funding">{phone?.saved ?? 0}/{phone?.progressPercent ?? 0}</output>;
 }
 
 const config = { dedupingInterval: 0, revalidateOnFocus: false };
-beforeEach(() => { db.transactions = []; db.failInsert = false; db.delayLoad = null; });
+beforeEach(() => { db.transactions = []; db.commands = []; db.failInsert = false; db.delayLoad = null; });
 afterEach(cleanup);
 
 test("goal shortcut selects the goal, leaves wallet empty and resets between openings", async () => {
   const view = render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "phone" });
   expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe(db.phoneId);
   expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe("");
   view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen={false} onClose={() => {}} /></SWRConfig>);
   view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.laptopId} /></SWRConfig>);
   await waitFor(() => expect((screen.getByLabelText("Goal (Optional)") as HTMLSelectElement).value).toBe(db.laptopId));
 });
 
-test.each(["Expense", "Transfer", "Income"])("%s saves correct goal association and refreshes actual progress", async (type) => {
+test.each(["Expense", "Transfer", "Income"])("%s sends its explicit goal meaning and refreshes progress", async (type) => {
   const user = userEvent.setup();
   render(<SWRConfig value={config}><Progress /><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "phone" });
   await user.click(screen.getByRole("button", { name: type }));
   await user.selectOptions(screen.getByLabelText(type === "Transfer" ? "From Account" : "Account"), db.cashId);
-  if (type === "Transfer") await user.selectOptions(screen.getByLabelText("To Account"), db.bankId);
+  if (type === "Transfer") { await user.selectOptions(screen.getByLabelText("To Account"), db.bankId); await user.type(screen.getByLabelText("Reservation to carry"), "500"); }
   if (type === "Income") expect(screen.queryByLabelText("Goal (Optional)")).toBeNull();
   await user.type(screen.getByLabelText("Amount"), "500");
   await user.click(screen.getByRole("button", { name: "Add Transaction" }));
   await waitFor(() => expect(db.transactions).toHaveLength(1));
-  expect(db.transactions[0].goal_id).toBe(type === "Income" ? null : db.phoneId);
+  expect(db.transactions[0].goal_id).toBe(type === "Expense" ? db.phoneId : null);
+  expect(db.commands[0].draft.reservationMoves).toEqual(type === "Transfer" ? [{ goalId: db.phoneId, amount: "500.00" }] : []);
   await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe("0/0"));
 });
 
 test("failed save and cancellation do not add funding; Escape closes the dialog", async () => {
   db.failInsert = true;
   const close = vi.fn();
   const user = userEvent.setup();
   render(<SWRConfig value={config}><AddTransactionModal isOpen onClose={close} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "phone" });
   await user.selectOptions(screen.getByLabelText("Account"), db.cashId);
@@ -158,21 +168,21 @@ test("reopening a contribution cannot submit a wallet retained from the previous
   await user.selectOptions(screen.getByLabelText("Account"), db.cashId);
   view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen={false} onClose={() => {}} /></SWRConfig>);
   let release!: () => void;
   db.delayLoad = new Promise<void>(resolve => { release = resolve; });
   view.rerender(<SWRConfig value={config}><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.laptopId} /></SWRConfig>);
   expect((screen.getByRole("button", { name: /Add Transaction|Loading accounts/ }) as HTMLButtonElement).disabled).toBe(true);
   release();
   await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe(""));
 });
 
-test("legacy goal-tagged installments remain history and do not reserve funds", async () => {
+test("credit goal-tagged installments remain informational and do not reserve funds", async () => {
   const user = userEvent.setup();
   const view = render(<SWRConfig value={config}><Progress /><AddTransactionModal isOpen onClose={() => {}} defaultGoalId={db.phoneId} /></SWRConfig>);
   await screen.findByRole("option", { name: "Cash" });
   await user.click(screen.getByLabelText("PayLater purchase (adds to debt)"));
   await user.selectOptions(screen.getByLabelText("Installments"), "3");
   await user.type(screen.getByLabelText("Amount"), "300");
   await user.click(screen.getByRole("button", { name: "Add Transaction" }));
   await waitFor(() => expect(db.transactions).toHaveLength(3));
   expect(db.transactions.map(tx => [tx.amount, tx.goal_id])).toEqual([[100, db.phoneId], [100, db.phoneId], [100, db.phoneId]]);
   await waitFor(() => expect(screen.getByLabelText("Phone funding").textContent).toBe("0/0"));
diff --git a/tests/database/financial-transactions.test.mjs b/tests/database/financial-transactions.test.mjs
index f785848..ed581cc 100644
--- a/tests/database/financial-transactions.test.mjs
+++ b/tests/database/financial-transactions.test.mjs
@@ -212,21 +212,21 @@ test('credit installments distribute centavos and book debt once; debt goal paym
     const f = await setup(t);
     const credit = requireSuccess(await f.owner.client.from('accounts').insert({
         user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0
     }).select().single());
     const d = draft(f, { accountId: credit.id, amount: '1000.01', installments: { count: 3 } });
     const result = await save(f, d);
     assert.equal(result.transactionIds.length, 3);
     const tx = (await rows(f))[3];
     assert.deepEqual(tx.sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.amount, t.date]), [[333.34, '2026-10-01'], [333.34, '2026-11-01'], [333.33, '2026-12-01']]);
     assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 1000.01);
-    assert.equal((await quote(f, { ...d, goalId: f.owner.goal.id })).error?.message, 'INVALID_STATE');
+    assert.deepEqual(requireSuccess(await quote(f, { ...d, goalId: f.owner.goal.id })).releases, []);
     requireSuccess(await f.owner.client.from('goals').update({ category: 'debt' }).eq('id', f.owner.goal.id));
     await reserve(f);
     await save(f, draft(f, {
         type: 'transfer', amount: '333.34', transferToAccountId: credit.id, goalId: f.owner.goal.id
     }));
     const s = await snap(f);
     assert.equal(s.goals[0].spent, '333.34');
     assert.equal(s.goals[0].reserved, '4666.66');
     assert.equal((await quote(f, draft(f, { type: 'transfer', amount: '1.00', transferToAccountId: credit.id }))).error?.message, 'INVALID_STATE');
 });
@@ -301,10 +301,72 @@ test('credit signs and negative month credits carry forward authoritatively', as
     assert.deepEqual(await rows(f), baseline);
     await save(f, draft(f, { type: 'transfer', transferToAccountId: credit.id, amount: '500.00' }));
     assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 0);
     await save(f, draft(f, {
         type: 'transfer', accountId: credit.id, transferToAccountId: f.owner.account.id, amount: '10.00'
     }));
     const s = await snap(f);
     assert.equal(s.wallets.find(w => w.accountId === credit.id).actual, '10.00');
     assert.equal(s.wallets.find(w => w.accountId === f.owner.account.id).actual, '29510.00');
 });
+
+test('credit goal tags are informational for purchases and installments, replay and deletion invent no goal funds', async (t) => {
+    const f = await setup(t);
+    const credit = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'userPayLater', type: 'credit_card', balance: 0 }).select().single());
+    const initial = await snap(f);
+    const ordinary = draft(f, { accountId: credit.id, goalId: f.owner.goal.id, amount: '100.00' });
+    const first = await save(f, ordinary);
+    assert.equal(first.transactionIds.length, 1);
+    const installmentDraft = draft(f, { accountId: credit.id, goalId: f.owner.goal.id, amount: '1000.01', installments: { count: 3 } });
+    const q = requireSuccess(await quote(f, installmentDraft));
+    const requestId = randomUUID();
+    const command = { kind: 'transaction', draft: installmentDraft };
+    const result = requireSuccess(await apply(f, command, q, requestId));
+    assert.equal(result.transactionIds.length, 3);
+    assert.equal(requireSuccess(await apply(f, command, q, requestId)).replayed, true);
+    const persisted = await rows(f);
+    assert.equal(persisted[3].length, 4);
+    assert.ok(persisted[3].every(tx => tx.goal_id === f.owner.goal.id));
+    assert.equal(persisted[2].length, 0);
+    const after = await snap(f);
+    assert.equal(after.goals[0].reserved, '0.00');
+    assert.equal(after.goals[0].spent, '0.00');
+    assert.equal(after.goals[0].progressAmount, '0.00');
+    assert.deepEqual(after.wallets.find(wallet => wallet.accountId === f.owner.account.id), initial.wallets.find(wallet => wallet.accountId === f.owner.account.id));
+    assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 1100.01);
+    const baseline = await rows(f);
+    assert.equal((await quote(f, { ...ordinary, goalId: f.other.goal.id })).error?.message, 'NOT_ALLOWED');
+    assert.equal((await quote(f, { ...ordinary, type: 'income' })).error?.message, 'INVALID_STATE');
+    assert.equal((await quote(f, { ...ordinary, type: 'transfer', transferToAccountId: f.owner.account.id })).error?.message, 'INVALID_STATE');
+    assert.deepEqual(await rows(f), baseline);
+    await applyMigration('202610060005_goal_lifecycle_operations.sql');
+    const transactionId = result.transactionIds[0];
+    const deleteRequestId = randomUUID();
+    const deletion = { kind: 'delete_transaction', transactionId };
+    requireSuccess(await apply(f, deletion, null, deleteRequestId));
+    assert.equal(requireSuccess(await apply(f, deletion, null, deleteRequestId)).replayed, true);
+    const deleted = await rows(f);
+    assert.equal(deleted[3].length, 3);
+    assert.equal(deleted[2].length, 0);
+    assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 766.67);
+    const final = await snap(f);
+    assert.equal(final.goals[0].reserved, '0.00');
+    assert.equal(final.goals[0].spent, '0.00');
+    assert.equal(final.goals[0].progressAmount, '0.00');
+});
+
+test('ordered transaction and lifecycle reapplication refreshes the private helper; standalone lifecycle remains idempotent', async (t) => {
+    const f = await setup(t);
+    await applyMigration('202610060004_goal_transaction_operations.sql');
+    await applyMigration('202610060005_goal_lifecycle_operations.sql');
+    await applyMigration('202610060005_goal_lifecycle_operations.sql');
+    const credit = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0 }).select().single());
+    const result = await save(f, draft(f, { accountId: credit.id, goalId: f.owner.goal.id, amount: '1.00' }));
+    assert.equal(result.transactionIds.length, 1);
+    assert.equal((await rows(f))[2].length, 0);
+    assert.equal((await snap(f)).goals[0].progressAmount, '0.00');
+    requireSuccess(await apply(f, { kind: 'close', goalId: f.owner.goal.id, status: 'completed', leftovers: null }));
+    assert.equal((await snap(f)).goals[0].status, 'completed');
+    const { queryAdmin } = await databaseRuntime();
+    const grants = await queryAdmin("SELECT has_function_privilege('authenticated','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS authenticated, has_function_privilege('anon','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS anon, has_function_privilege('service_role','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS service");
+    assert.deepEqual(grants, [{ authenticated: false, anon: false, service: false }]);
+});
diff --git a/tests/goal-actions.test.tsx b/tests/goal-actions.test.tsx
index 6489ab0..9980b16 100644
--- a/tests/goal-actions.test.tsx
+++ b/tests/goal-actions.test.tsx
@@ -374,20 +374,30 @@ describe("goal closure and history", () => {
     expect(state.readCalls).toContainEqual({ table: "accounts", method: "eq", column: "user_id", value: userId });
     expect(state.readCalls).toContainEqual({ table: "financial_operations", method: "eq", column: "user_id", value: userId });
     expect(state.readCalls.find(call => call.table === "goal_allocation_events" && call.method === "select").columns).toContain("reserved_delta::text");
   });
 
   test("history rejects a database decimal with more than two places instead of rounding it", async () => {
     state.events = [event({ reserved_delta: "1.005" })];
     await expect(fetchGoalHistory(userId, laptopId)).rejects.toThrow(/invalid decimal/i);
   });
 
+  test("automatic release history carries validated operation transaction links without inventing a transaction id", async () => {
+    const transactionId = "60000000-0000-4000-8000-000000000006";
+    state.events = [event({ kind: "release", reserved_delta: "-3.00", transaction_id: null })];
+    state.operations = [{ id: operationId, command: { kind: "transaction" }, result: { operationId, transactionIds: [transactionId], replayed: false } }];
+    const history = await fetchGoalHistory(userId, laptopId);
+    expect(history[0]).toMatchObject({ transaction_id: null, linkedTransactionIds: [transactionId], operationKind: "transaction" });
+    state.operations[0].result.transactionIds = ["not-a-uuid"];
+    await expect(fetchGoalHistory(userId, laptopId)).rejects.toThrow();
+  });
+
   test("history records deleted-transaction reversals without inventing an allocation amount", async () => {
     const transactionId = "60000000-0000-4000-8000-000000000006";
     const deletionOperationId = "40000000-0000-4000-8000-000000000008";
     state.events = [event({ kind: "release", reserved_delta: "-5.00", operation_id: operationId, transaction_id: transactionId })];
     state.operations = [
       { id: operationId, command: { kind: "release" }, result: {} },
       { id: deletionOperationId, command: { kind: "delete_transaction", transactionId }, created_at: "2026-10-06T00:00:00Z" },
     ];
     const history = await fetchGoalHistory(userId, laptopId);
     expect(history).toHaveLength(2);
diff --git a/tests/transaction-release.test.tsx b/tests/transaction-release.test.tsx
new file mode 100644
index 0000000..dc8bf21
--- /dev/null
+++ b/tests/transaction-release.test.tsx
@@ -0,0 +1,342 @@
+import React from "react";
+import { afterEach, beforeEach, expect, test, vi } from "vitest";
+import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
+import { useTransactionSubmit, useTransactionDelete } from "@/hooks/use-transaction-submit";
+import AddTransactionModal from "@/components/transactions/AddTransactionModal";
+import TransactionDetailModal from "@/components/transactions/TransactionDetailModal";
+import { FinancialCommandError, applyFinancialCommand, quoteTransaction } from "@/lib/goals/client";
+import type { TransactionDraft, TransactionQuote } from "@/lib/goals/contracts";
+
+const fixture = vi.hoisted(() => ({ userId: "user", authUserId: undefined as string | null | undefined, refresh: vi.fn(), history: [] as any[], accounts: [
+  { id: "cash", name: "GoTyme", type: "bank", currency: "PHP", is_active: true, balance: 30000 },
+  { id: "bank", name: "Cash", type: "cash", currency: "PHP", is_active: true, balance: 20000 },
+  { id: "credit", name: "userPayLater", type: "credit_card", currency: "PHP", is_active: true, balance: 0 },
+], goals: [
+  { id: "laptop", name: "Laptop", status: "active", review_state: "confirmed", archived_at: null, category: "Savings", walletReservations: [{ accountId: "cash", amount: "5000.00" }] },
+  { id: "phone", name: "Phone", status: "active", review_state: "confirmed", archived_at: null, category: "Savings", walletReservations: [{ accountId: "cash", amount: "5000.00" }] },
+] }));
+vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ userId: fixture.userId, goals: fixture.goals, financeSnapshot: { goals: fixture.goals }, refresh: fixture.refresh, isLoading: false, isError: null }) }));
+vi.mock("@/hooks/use-goal-finance", () => ({ useGoalHistory: (_userId: string, goalId: string) => ({ data: fixture.history.filter(event => event.goal_id === goalId), isLoading: false, error: null }) }));
+vi.mock("@/lib/goals/client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/goals/client")>(), applyFinancialCommand: vi.fn(), quoteTransaction: vi.fn() }));
+vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
+vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: fixture.authUserId === null ? null : { id: fixture.authUserId ?? fixture.userId } } }) }, from(table: string) { const builder: any = { select: () => builder, eq: () => builder, order: () => builder, or: () => builder, limit: () => builder, then: (resolve: any) => Promise.resolve({ data: table === "accounts" ? fixture.accounts : [], error: null }).then(resolve) }; return builder; } }) }));
+
+const draft: TransactionDraft = { type: "expense", accountId: "cash", transferToAccountId: null, categoryId: null, goalId: null, amount: "28000.00", description: null, date: "2026-10-07", installments: null, reservationMoves: [] };
+const proposal: TransactionQuote = { fingerprint: "first", actual: "30000.00", reserved: "5000.00", available: "25000.00", releases: [{ goalId: "laptop", accountId: "cash", amount: "3000.00" }] };
+let sequence = 0;
+beforeEach(() => { fixture.authUserId = undefined; fixture.history = []; fixture.userId = `user-${++sequence}`; vi.mocked(quoteTransaction).mockReset().mockResolvedValue(proposal); vi.mocked(applyFinancialCommand).mockReset().mockResolvedValue({ operationId: "op", transactionIds: ["tx"], replayed: false }); fixture.refresh.mockReset().mockResolvedValue(undefined); });
+afterEach(cleanup);
+
+async function quoteHook() { const hook = renderHook(() => useTransactionSubmit()); await act(() => hook.result.current.quote(draft)); return hook; }
+
+test("a release quote waits for explicit confirmation and applies only once", async () => {
+  const hook = await quoteHook();
+  expect(hook.result.current.phase).toBe("review");
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+  await act(() => Promise.all([hook.result.current.confirm(), hook.result.current.confirm()]));
+  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
+  expect(applyFinancialCommand).toHaveBeenCalledWith(expect.any(String), { kind: "transaction", draft }, proposal);
+  expect(hook.result.current.phase).toBe("saved");
+});
+
+test("declining a proposal writes nothing and editing invalidates it", async () => {
+  const hook = await quoteHook();
+  act(() => hook.result.current.reset());
+  await act(() => hook.result.current.confirm());
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+  expect(hook.result.current.phase).toBe("editing");
+});
+
+test("a late quote cannot restore confirmation after editing", async () => {
+  let resolve!: (value: TransactionQuote) => void;
+  vi.mocked(quoteTransaction).mockReturnValue(new Promise(r => { resolve = r; }));
+  const hook = renderHook(() => useTransactionSubmit());
+  let pending!: Promise<void>;
+  act(() => { pending = hook.result.current.quote(draft); });
+  act(() => hook.result.current.reset());
+  await act(async () => { resolve(proposal); await pending; });
+  expect(hook.result.current.phase).toBe("editing");
+  await act(() => hook.result.current.confirm());
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+});
+
+test("stale quotes refresh into review and need fresh confirmation", async () => {
+  const fresh = { ...proposal, fingerprint: "fresh", releases: [{ ...proposal.releases[0], amount: "4000.00" }] };
+  const hook = await quoteHook();
+  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "STALE_QUOTE", code: "STALE_QUOTE", outcome: "rejected" }));
+  vi.mocked(quoteTransaction).mockResolvedValue(fresh);
+  await act(() => hook.result.current.confirm());
+  expect(hook.result.current.phase).toBe("review");
+  expect(hook.result.current.transactionQuote).toEqual(fresh);
+  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
+  await act(() => hook.result.current.confirm());
+  expect(applyFinancialCommand).toHaveBeenCalledTimes(2);
+  expect(vi.mocked(applyFinancialCommand).mock.calls[1][2]).toEqual(fresh);
+});
+
+test("unknown outcomes survive reset and unmount, retrying the same UUID, command and quote", async () => {
+  const hook = await quoteHook();
+  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
+  await act(() => hook.result.current.confirm());
+  const first = vi.mocked(applyFinancialCommand).mock.calls[0];
+  act(() => hook.result.current.reset());
+  hook.unmount();
+  const reopened = renderHook(() => useTransactionSubmit());
+  await act(() => reopened.result.current.quote({ ...draft, amount: "100.00" }));
+  expect(quoteTransaction).toHaveBeenCalledTimes(1);
+  await act(() => reopened.result.current.confirm());
+  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(first);
+  expect(reopened.result.current.phase).toBe("saved");
+});
+
+test("zero releases save directly; refresh failures remain saved and cannot resubmit", async () => {
+  vi.mocked(quoteTransaction).mockResolvedValue({ ...proposal, releases: [] });
+  fixture.refresh.mockRejectedValue(new Error("refresh offline"));
+  const hook = await quoteHook();
+  expect(hook.result.current.phase).toBe("saved");
+  expect(hook.result.current.refreshError).toBeTruthy();
+  await act(() => hook.result.current.confirm());
+  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
+});
+
+test("server rejection uses its human hint and permits correction with a fresh request", async () => {
+  const hook = await quoteHook();
+  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "INVALID_STATE", code: "INVALID_STATE", hint: "Choose an active wallet.", outcome: "rejected" }));
+  await act(() => hook.result.current.confirm());
+  expect(hook.result.current.error).toBe("Choose an active wallet.");
+  act(() => hook.result.current.reset());
+  await act(() => hook.result.current.quote(draft));
+  await act(() => hook.result.current.confirm());
+  const calls = vi.mocked(applyFinancialCommand).mock.calls;
+  expect(calls[1][0]).not.toBe(calls[0][0]);
+});
+
+test("custom release breakdown is quoted exactly before confirmation", async () => {
+  const hook = await quoteHook();
+  const releases = [{ goalId: "phone", accountId: "cash", amount: "2000.00" }, { goalId: "laptop", accountId: "cash", amount: "1000.00" }];
+  vi.mocked(quoteTransaction).mockResolvedValue({ ...proposal, releases });
+  await act(() => hook.result.current.quote(draft, releases));
+  expect(quoteTransaction).toHaveBeenLastCalledWith(draft, releases);
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+  await act(() => hook.result.current.confirm());
+  expect(vi.mocked(applyFinancialCommand).mock.calls[0][2]?.releases).toEqual(releases);
+});
+
+test("ordinary expense shows Laptop release, declining writes nothing, then confirmation writes once", async () => {
+  render(<AddTransactionModal isOpen onClose={() => {}} />);
+  await screen.findByRole("option", { name: "GoTyme" });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  await screen.findByRole("button", { name: "Release funds and save" });
+  expect(screen.getByText(/Laptop.*3,000/)).toBeTruthy();
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+  fireEvent.click(screen.getByRole("button", { name: "Keep reservations" }));
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  await screen.findByRole("button", { name: "Release funds and save" });
+  fireEvent.click(screen.getByRole("button", { name: "Release funds and save" }));
+  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(1));
+});
+
+test.each(["Amount", "Account"])("editing %s removes the prior release confirmation", async label => {
+  render(<AddTransactionModal isOpen onClose={() => {}} />);
+  await screen.findByRole("option", { name: "GoTyme" });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  await screen.findByRole("button", { name: "Release funds and save" });
+  fireEvent.change(screen.getByLabelText(label), { target: { value: label === "Amount" ? "20000" : "bank" } });
+  await waitFor(() => expect(screen.queryByRole("button", { name: "Release funds and save" })).toBeNull());
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+});
+
+test("deletion uses a financial command, refreshes local and shared data, and retains UUID through unknown retry", async () => {
+  const localRefresh = vi.fn().mockResolvedValue(undefined);
+  const hook = renderHook(() => useTransactionDelete(localRefresh));
+  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
+  await act(() => hook.result.current.remove("tx"));
+  const first = vi.mocked(applyFinancialCommand).mock.calls[0];
+  expect(first[1]).toEqual({ kind: "delete_transaction", transactionId: "tx" });
+  hook.unmount();
+  const reopened = renderHook(() => useTransactionDelete(localRefresh));
+  await act(() => reopened.result.current.remove("other-tx"));
+  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
+  await act(() => reopened.result.current.remove("tx"));
+  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(first);
+  expect(localRefresh).toHaveBeenCalledTimes(1);
+  expect(fixture.refresh).toHaveBeenCalledTimes(1);
+  expect(reopened.result.current.savedTransactionId).toBe("tx");
+});
+
+test("a committed deletion with failed local refresh stays saved, while shared refresh still runs", async () => {
+  const localRefresh = vi.fn().mockRejectedValue(new Error("list unavailable"));
+  const hook = renderHook(() => useTransactionDelete(localRefresh));
+  await act(() => Promise.all([hook.result.current.remove("tx"), hook.result.current.remove("tx")]));
+  expect(hook.result.current.savedTransactionId).toBe("tx");
+  expect(hook.result.current.refreshError).toBeTruthy();
+  expect(fixture.refresh).toHaveBeenCalledTimes(1);
+  await act(() => hook.result.current.remove("tx"));
+  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
+});
+
+test("switching transaction type invalidates a release review", async () => {
+  render(<AddTransactionModal isOpen onClose={() => {}} />);
+  await screen.findByRole("option", { name: "GoTyme" });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  await screen.findByRole("button", { name: "Release funds and save" });
+  fireEvent.click(screen.getByRole("button", { name: "Income" }));
+  expect(screen.queryByRole("button", { name: "Release funds and save" })).toBeNull();
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+});
+
+test("detail distinguishes actual goal spend, carried reservations and unrelated automatic releases", () => {
+  fixture.history = [
+    { id: "spend", goal_id: "laptop", kind: "spend", transaction_id: "tx", reserved_delta: "-1000.00", spent_delta: "1000.00", accountName: "GoTyme" },
+    { id: "carry", goal_id: "phone", kind: "move_out", transaction_id: "tx", reserved_delta: "-500.00", spent_delta: "0.00", accountName: "GoTyme" },
+    { id: "release", goal_id: "phone", kind: "release", transaction_id: null, linkedTransactionIds: ["tx"], reserved_delta: "-3000.00", spent_delta: "0.00", operationKind: "transaction", accountName: "GoTyme" },
+    { id: "unrelated", goal_id: "phone", kind: "spend", transaction_id: "other", reserved_delta: "-999.00", spent_delta: "999.00", accountName: "GoTyme" },
+  ];
+  render(<TransactionDetailModal isOpen onClose={() => {}} transaction={{ id: "tx", type: "expense", amount: 1000, date: "2026-10-07", created_at: "2026-10-07", account: { name: "GoTyme" } }} />);
+  expect(screen.getByText(/Spent from Laptop.*1,000/)).toBeTruthy();
+  expect(screen.getByText(/Carried Phone reservation.*500/)).toBeTruthy();
+  expect(screen.getByText(/Automatic release from Phone.*3,000/)).toBeTruthy();
+  expect(screen.queryByText(/999/)).toBeNull();
+});
+
+test("ordinary defaultAccountId opens expense in that wallet; goal shortcut invents neither wallet nor amount", async () => {
+  const view = render(<AddTransactionModal isOpen onClose={() => {}} defaultAccountId="bank" />);
+  await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe("bank"));
+  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
+  view.rerender(<AddTransactionModal isOpen={false} onClose={() => {}} />);
+  view.rerender(<AddTransactionModal isOpen onClose={() => {}} defaultGoalId="laptop" />);
+  await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe(""));
+  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
+  expect(screen.queryByRole("option", { name: "userPayLater" })).toBeNull();
+});
+
+test.each(["unmount", "auth switch"])("zero-release quote cannot save after %s", async action => {
+  let resolve!: (value: TransactionQuote) => void;
+  vi.mocked(quoteTransaction).mockReturnValue(new Promise(r => { resolve = r; }));
+  const hook = renderHook(() => useTransactionSubmit());
+  let pending!: Promise<void>;
+  act(() => { pending = hook.result.current.quote(draft); });
+  if (action === "unmount") hook.unmount();
+  else { fixture.userId = "different-user"; hook.rerender(); }
+  await act(async () => { resolve({ ...proposal, releases: [] }); await pending; });
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+});
+
+test("closing while a quote loads prevents a late release review or write on reopening", async () => {
+  let resolve!: (value: TransactionQuote) => void;
+  vi.mocked(quoteTransaction).mockReturnValue(new Promise(r => { resolve = r; }));
+  const view = render(<AddTransactionModal isOpen onClose={() => {}} />);
+  await screen.findByRole("option", { name: "GoTyme" });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  view.rerender(<AddTransactionModal isOpen={false} onClose={() => {}} />);
+  await act(async () => { resolve({ ...proposal, releases: [] }); });
+  view.rerender(<AddTransactionModal isOpen onClose={() => {}} />);
+  expect(screen.queryByRole("button", { name: "Release funds and save" })).toBeNull();
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+});
+
+test("custom release inputs quote the chosen goals before allowing confirmation", async () => {
+  render(<AddTransactionModal isOpen onClose={() => {}} />);
+  await screen.findByRole("option", { name: "GoTyme" });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  await screen.findByRole("button", { name: "Release funds and save" });
+  fireEvent.click(screen.getByRole("button", { name: "Choose release amounts" }));
+  fireEvent.change(screen.getByLabelText("Release from Laptop"), { target: { value: "1000" } });
+  fireEvent.change(screen.getByLabelText("Release from Phone"), { target: { value: "2000" } });
+  expect((screen.getByRole("button", { name: "Release funds and save" }) as HTMLButtonElement).disabled).toBe(true);
+  const releases = [{ goalId: "laptop", accountId: "cash", amount: "1000.00" }, { goalId: "phone", accountId: "cash", amount: "2000.00" }];
+  vi.mocked(quoteTransaction).mockResolvedValue({ ...proposal, fingerprint: "custom", releases });
+  fireEvent.click(screen.getByRole("button", { name: "Review these releases" }));
+  await waitFor(() => expect(quoteTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ amount: "28000.00" }), releases));
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+  fireEvent.click(screen.getByRole("button", { name: "Release funds and save" }));
+  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(1));
+  expect(vi.mocked(applyFinancialCommand).mock.calls[0][2]?.releases).toEqual(releases);
+});
+
+test("an unknown dialog save survives closure and reopening before another transaction can be entered", async () => {
+  const view = render(<AddTransactionModal isOpen onClose={() => {}} />);
+  await screen.findByRole("option", { name: "GoTyme" });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "28000" } });
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  await screen.findByRole("button", { name: "Release funds and save" });
+  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
+  fireEvent.click(screen.getByRole("button", { name: "Release funds and save" }));
+  await screen.findByRole("button", { name: "Retry same transaction" });
+  const original = vi.mocked(applyFinancialCommand).mock.calls[0];
+  view.unmount();
+  render(<AddTransactionModal isOpen onClose={() => {}} defaultAccountId="bank" />);
+  expect((screen.getByLabelText("Amount") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
+  fireEvent.click(screen.getByRole("button", { name: "Retry same transaction" }));
+  await waitFor(() => expect(applyFinancialCommand).toHaveBeenCalledTimes(2));
+  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(original);
+});
+
+test("a saved dialog reports refresh failure without enabling another save", async () => {
+  fixture.refresh.mockRejectedValue(new Error("offline"));
+  vi.mocked(quoteTransaction).mockResolvedValue({ ...proposal, releases: [] });
+  render(<AddTransactionModal isOpen onClose={() => {}} />);
+  await screen.findByRole("option", { name: "GoTyme" });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  await screen.findByRole("status");
+  expect(screen.getByRole("status").textContent).toMatch(/saved.*could not refresh/i);
+  fireEvent.click(screen.getByRole("button", { name: "Saved" }));
+  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
+});
+
+test("actual insufficiency is an inline human error and never writes", async () => {
+  vi.mocked(quoteTransaction).mockRejectedValue(new FinancialCommandError({ message: "INSUFFICIENT_ACTUAL", code: "INSUFFICIENT_ACTUAL", outcome: "rejected" }));
+  render(<AddTransactionModal isOpen onClose={() => {}} />);
+  await screen.findByRole("option", { name: "GoTyme" });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30001" } });
+  fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  expect((await screen.findByRole("alert")).textContent).toMatch(/does not have enough money/);
+  expect(screen.queryByText("INSUFFICIENT_ACTUAL")).toBeNull();
+  expect(applyFinancialCommand).not.toHaveBeenCalled();
+});
+
+test("a live session change blocks retry without discarding the unresolved request", async () => {
+  const hook = await quoteHook();
+  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
+  await act(() => hook.result.current.confirm());
+  const original = vi.mocked(applyFinancialCommand).mock.calls[0];
+  fixture.authUserId = "another-account";
+  await act(() => hook.result.current.confirm());
+  expect(applyFinancialCommand).toHaveBeenCalledTimes(1);
+  expect(hook.result.current.unresolved).toBe(true);
+  fixture.authUserId = undefined;
+  await act(() => hook.result.current.confirm());
+  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(original);
+});
+
+test("deletion session mismatch preserves its unknown request for the original owner", async () => {
+  const hook = renderHook(() => useTransactionDelete(async () => {}));
+  vi.mocked(applyFinancialCommand).mockRejectedValueOnce(new FinancialCommandError({ message: "network", outcome: "unknown" }));
+  await act(() => hook.result.current.remove("tx"));
+  const original = vi.mocked(applyFinancialCommand).mock.calls[0];
+  fixture.authUserId = null;
+  await act(() => hook.result.current.remove("tx"));
+  expect(hook.result.current.pendingTransactionId).toBe("tx");
+  fixture.authUserId = undefined;
+  await act(() => hook.result.current.remove("tx"));
+  expect(vi.mocked(applyFinancialCommand).mock.calls[1]).toEqual(original);
+});
+
+test("only active PHP accounts appear in the transaction wallet choices", async () => {
+  const count = fixture.accounts.length;
+  fixture.accounts.push({ id: "inactive", name: "Closed", type: "bank", currency: "PHP", is_active: false, balance: 1000 }, { id: "usd", name: "USD wallet", type: "bank", currency: "USD", is_active: true, balance: 1000 }, { id: "unknown", name: "Unknown status", type: "bank", currency: "PHP", is_active: null, balance: 1000 } as any);
+  try {
+    render(<AddTransactionModal isOpen onClose={() => {}} />);
+    await screen.findByRole("option", { name: "GoTyme" });
+    expect(screen.queryByRole("option", { name: "Closed" })).toBeNull();
+    expect(screen.queryByRole("option", { name: "USD wallet" })).toBeNull();
+    expect(screen.queryByRole("option", { name: "Unknown status" })).toBeNull();
+  } finally { fixture.accounts.splice(count); }
+});
