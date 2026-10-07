f32f679 fix: guard goal closure against unavailable funds
 .../2026-10-06-goal-reservations/task-7-report.md  | 24 +++++++--
 src/app/(dashboard)/goals/page.tsx                 |  2 +-
 src/components/goals/GoalCompletionDialog.tsx      | 17 +++---
 src/components/goals/GoalFundsDialog.tsx           |  4 +-
 tests/goal-actions.test.tsx                        | 62 +++++++++++++++++++++-
 5 files changed, 96 insertions(+), 13 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-7-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-7-report.md
index 2d9e491..fd26ca2 100644
--- a/.superpowers/sdd/2026-10-06-goal-reservations/task-7-report.md
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-7-report.md
@@ -1,12 +1,30 @@
 # Task 7 implementation report
 
 Implemented goal reservation actions, lifecycle presentation, and owner-scoped history. Set aside, release, and same-wallet goal moves use the finance snapshot and active PHP non-credit wallet metadata; error/loading states remain distinct from empty funds. Completion/cancellation requires an explicit leftover release or move when reservations remain, preserves spending history, and supports reopening. Closed goals with reservations cannot be archived. The Goals page and cards now show canonical reserved/spent/progress values and use the approved guidance. History normalizes database decimal text without floating-point conversion, displays wallet/operation labels and retained transaction references, and records deleted-transaction reversals from owner-scoped operation metadata without inventing allocation events.
 
 Verification:
-- `npx vitest run tests/goal-actions.test.tsx --reporter=dot` — 17 passed.
-- `npx tsc --noEmit` — passed.
-- `npm test -- --run` — 80 passed across 6 Vitest files, plus 2 Node tests.
+- `npx vitest run tests/goal-actions.test.tsx --reporter=dot`: 17 passed.
+- `npx tsc --noEmit`: passed.
+- `npm test -- --run`: 80 passed across 6 Vitest files, plus 2 Node tests.
 - The first full run was 79/80 because an existing contribution-page test still searched for the old “Add contribution” label. Updated only that query to “Spend from goal”; the shortcut behavior assertions remain. The final full run passed.
 - Browser visual verification is assigned to Task 11 and is not claimed here.
 
 No database migration or runtime dependency was added.
+
+## Narrow review fixes, round 1
+
+Financial snapshot failure/loading now has explicit goal-funds feedback, hides the cached empty-reservation message, and blocks a new closure in both the button and submit handler. Optional wallet metadata failure remains separate. An unknown saved closure retains its original request ID and command, even after the goal appears closed and the snapshot fails.
+
+The reservation retry and amount controls now have explicit 44px heights; the closed-goals toggle has a 44px minimum. The Set aside test retains reservation/actual-balance assertions, adds the mandated visible dialog assertion, verifies no command is submitted on opening, and explicitly rejects transaction-kind submissions while allowing the reservation command.
+
+The existing test environment has no jest-dom matcher package. A test-only visibility matcher checks connection and ancestor display, visibility, hidden attributes, and zero opacity. This provides meaningful DOM visibility coverage without adding a dependency. It does not establish browser visual verification.
+
+Evidence:
+- Snapshot RED: focused run exit 1, 2 failures and 18 passes. Cached-zero error/loading cases incorrectly displayed “No reservations remain.”
+- Snapshot GREEN: focused run exit 0, 20 passes, including original-request retry after closed status and snapshot failure.
+- Mobile-control RED: focused run exit 1, 1 failure and 20 passes, missing the amount control's 44px minimum.
+- Final focused GREEN: exit 0, 21 passes. Mobile class assertions verify the declared minimums; the closed-goals toggle was checked in the scoped source diff.
+- Full suite: `npm test -- --run`, exit 0, 84 passes across 6 Vitest files and 2 passing Node tests.
+- TypeScript initially caught the new matcher's missing assertion type declaration; after adding the test-only declaration, `npx tsc --noEmit` exited 0.
+- `git diff --check`: exit 0.
+- R-02 PASS: report prose uses no em-dash separators. R-27 PASS: regression coverage distinguishes financial error/loading from known empty funds. C-4 PASS within scoped DOM coverage: failed snapshots block new closures and unknown requests retain retry behavior. Mobile target correction uses the existing 44px control convention. Browser visual/build checks remain assigned to Task 11.
diff --git a/src/app/(dashboard)/goals/page.tsx b/src/app/(dashboard)/goals/page.tsx
index a48dbc2..718a5b9 100644
--- a/src/app/(dashboard)/goals/page.tsx
+++ b/src/app/(dashboard)/goals/page.tsx
@@ -143,21 +143,21 @@ export default function GoalsPage() {
           <div className="space-y-2"><h2 className="text-xl font-bold tracking-tight text-foreground">No active goals yet</h2><p className="text-sm leading-relaxed text-muted-foreground">Set a target for a milestone such as a laptop, a trip, or emergency savings.</p></div>
           <Button onClick={handleOpenCreateModal} size="lg" className="gap-2 font-medium"><Plus className="h-4 w-4" />Create Your First Goal</Button>
         </div>
       ) : (
         <div className="space-y-8">
           <section className="space-y-4">
             <div className="flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Goals ({totals.active.length})</h2></div>
             {totals.active.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No active goals.</p> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{totals.active.map(renderGoal)}</div>}
           </section>
           {totals.closed.length > 0 && <section className="space-y-3 border-t border-border/30 pt-6">
-            <button type="button" aria-expanded={showClosed} onClick={() => setShowClosed(value => !value)} className="flex min-h-10 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
+            <button type="button" aria-expanded={showClosed} onClick={() => setShowClosed(value => !value)} className="flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
               <CheckCircle2 className="h-4 w-4 text-emerald-500" /><span>Closed Goals ({totals.closed.length})</span>{showClosed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
             </button>
             {showClosed && <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2 lg:grid-cols-3">{totals.closed.map(renderGoal)}</div>}
           </section>}
         </div>
       )}
 
       <AddTransactionModal isOpen={contributingGoalId !== null} defaultGoalId={contributingGoalId ?? undefined} onClose={() => setContributingGoalId(null)} />
       <AddGoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} editingGoal={editingGoal} />
       <GoalFundsDialog goalId={fundsAction?.goalId ?? ""} mode={fundsAction?.mode ?? "reserve"} open={fundsAction !== null} onOpenChange={open => { if (!open) setFundsAction(null); }} />
diff --git a/src/components/goals/GoalCompletionDialog.tsx b/src/components/goals/GoalCompletionDialog.tsx
index 3da3996..02e302c 100644
--- a/src/components/goals/GoalCompletionDialog.tsx
+++ b/src/components/goals/GoalCompletionDialog.tsx
@@ -43,20 +43,24 @@ export function GoalCompletionDialog({ goalId, status, open, onOpenChange }: Goa
     setDestinationGoalId("");
     setError(unknownOutcome.current ? "The previous save has an unknown result. Retry it to confirm the same request." : null);
     setRefreshError(false);
   }, [goalId, open, status]);
 
   async function submit(event: React.FormEvent) {
     event.preventDefault();
     setError(null);
     let command = retryCommand.current;
     if (!command) {
+      if (isLoading || isError) {
+        setError("Goal funds must load before closing this goal.");
+        return;
+      }
       if (!goal || goal.status !== "active" || goal.review_state !== "confirmed") {
         setError("Confirm this goal before closing it.");
         return;
       }
       let leftoversChoice: LeftoverChoice | null = null;
       if (leftoverCents > 0) {
         if (choice === "release") leftoversChoice = { mode: "release" };
         else if (choice === "move" && destinations.some(item => item.id === destinationGoalId)) {
           leftoversChoice = { mode: "move", goalId: destinationGoalId };
         } else {
@@ -103,36 +107,36 @@ export function GoalCompletionDialog({ goalId, status, open, onOpenChange }: Goa
     } catch {
       setRefreshError(true);
     }
   }
 
   async function retryLoad() {
     try {
       await Promise.all([refresh(), walletMetadata.refresh()]);
       setError(null);
     } catch {
-      setError("Wallet details still could not load. Try again.");
+      setError("Goal funds or wallet details still could not load. Try again.");
     }
   }
 
   const label = status === "completed" ? "Complete goal" : "Cancel goal";
-  const walletDataError = Boolean(isError || walletMetadata.error);
+  const walletDataError = Boolean(walletMetadata.error);
   const busy = pending || walletMetadata.isLoading || isLoading;
   const disabled = busy || goal?.status !== "active" || goal.review_state !== "confirmed" || unknownOutcome.current;
   return (
     <Dialog.Root open={open} onOpenChange={nextOpen => { if (!pending) onOpenChange(nextOpen); }}>
       <Dialog.Portal>
         <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
         <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
           <Dialog.Title className="text-lg font-semibold">{label}</Dialog.Title>
           <Dialog.Description className="mt-1 text-sm text-muted-foreground">{goal?.name ?? "Goal"} will keep its recorded spending in history.</Dialog.Description>
-          {leftoverCents > 0 && (
+          {!isError && !isLoading && leftoverCents > 0 && (
             <div className="mt-4 space-y-3 rounded-lg border border-border/70 p-3">
               <p className="text-sm font-medium">PHP {leftovers} remains reserved</p>
               <ul className="space-y-1 text-xs text-muted-foreground">
                 {(goal?.walletReservations ?? []).map(item => <li key={item.accountId}>{walletNames.get(item.accountId) ?? "Wallet"}: PHP {item.amount}</li>)}
               </ul>
               <p className="text-sm">Choose what happens to the remainder.</p>
               <label className="flex min-h-11 items-center gap-2 text-sm">
                 <input type="radio" name="goal-leftovers" value="release" checked={choice === "release"} onChange={() => setChoice("release")} disabled={disabled || walletDataError} />
                 Release leftovers to available funds
               </label>
@@ -144,30 +148,31 @@ export function GoalCompletionDialog({ goalId, status, open, onOpenChange }: Goa
                 <div className="space-y-1.5">
                   <label htmlFor="goal-close-destination" className="text-sm font-medium">Move to goal</label>
                   <select id="goal-close-destination" value={destinationGoalId} onChange={event => setDestinationGoalId(event.target.value)} disabled={disabled || walletDataError} className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                     <option value="">Choose a goal</option>
                     {destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                   </select>
                 </div>
               )}
             </div>
           )}
-          {leftoverCents === 0 && <p className="mt-4 text-sm text-muted-foreground">No reservations remain. Your recorded spending stays in history.</p>}
+          {!isError && !isLoading && leftoverCents === 0 && <p className="mt-4 text-sm text-muted-foreground">No reservations remain. Your recorded spending stays in history.</p>}
+          {isError && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive">Goal funds could not load. Load them before closing this goal.</p><Button type="button" variant="outline" className="h-11 min-h-11" onClick={() => void retryLoad()}>Retry loading</Button></div>}
           {walletDataError && leftoverCents > 0 && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive">Wallet details could not load, so the remaining funds cannot be reviewed.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => void retryLoad()}>Retry loading</Button></div>}
-          {busy && !pending && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading wallet details…</p>}
+          {busy && !pending && <p role="status" className="mt-4 text-sm text-muted-foreground">{isLoading ? "Loading goal funds…" : "Loading wallet details…"}</p>}
           {error && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
           {refreshError ? (
             <div className="mt-4 space-y-3" role="status">
               <p className="text-sm text-amber-700 dark:text-amber-300">Saved, but the goal summary could not refresh.</p>
               <Button type="button" className="h-11 min-h-11" onClick={() => void retryRefresh()}>Retry refresh</Button>
             </div>
           ) : (
             <form onSubmit={submit} className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
               <Button type="button" variant="outline" className="h-11 min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
-              <Button type="submit" className="h-11 min-h-11" disabled={pending || (!recoveringUnknown && (busy || (walletDataError && leftoverCents > 0) || goal?.status !== "active" || goal.review_state !== "confirmed"))}>{pending ? "Saving…" : recoveringUnknown ? "Retry same request" : label}</Button>
+              <Button type="submit" className="h-11 min-h-11" disabled={pending || (!recoveringUnknown && (busy || isError || (walletDataError && leftoverCents > 0) || goal?.status !== "active" || goal.review_state !== "confirmed"))}>{pending ? "Saving…" : recoveringUnknown ? "Retry same request" : label}</Button>
             </form>
           )}
         </Dialog.Content>
       </Dialog.Portal>
     </Dialog.Root>
   );
 }
diff --git a/src/components/goals/GoalFundsDialog.tsx b/src/components/goals/GoalFundsDialog.tsx
index e020180..ef83e00 100644
--- a/src/components/goals/GoalFundsDialog.tsx
+++ b/src/components/goals/GoalFundsDialog.tsx
@@ -152,21 +152,21 @@ export function GoalFundsDialog({ goalId, mode, open, onOpenChange }: GoalFundsD
 
   return (
     <Dialog.Root open={open} onOpenChange={nextOpen => { if (!pending) onOpenChange(nextOpen); }}>
       <Dialog.Portal>
         <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
         <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
           <Dialog.Title className="text-lg font-semibold">{titles[mode]}</Dialog.Title>
           <Dialog.Description className="mt-1 text-sm text-muted-foreground">{goal?.name ?? "Goal"} · PHP amounts</Dialog.Description>
 
           {error && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
-          {walletDataError && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive">Wallet balances or details could not load. Reservation options are unavailable.</p><Button type="button" variant="outline" onClick={() => void retryLoad()}>Retry loading</Button></div>}
+          {walletDataError && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-destructive">Wallet balances or details could not load. Reservation options are unavailable.</p><Button type="button" variant="outline" className="h-11 min-h-11" onClick={() => void retryLoad()}>Retry loading</Button></div>}
           {busy && !pending && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading wallet balances…</p>}
           {refreshError ? (
             <div className="mt-4 space-y-3" role="status">
               <p className="text-sm text-amber-700 dark:text-amber-300">Saved, but the goal summary could not refresh.</p>
               <Button type="button" className="h-11 min-h-11" onClick={() => void retryRefresh()}>Retry refresh</Button>
             </div>
           ) : (
             <form onSubmit={submit} className="mt-5 space-y-4">
               <fieldset disabled={busy || walletDataError || disabledForGoal || unknownOutcome.current} className="space-y-4">
                 <div className="space-y-1.5">
@@ -184,21 +184,21 @@ export function GoalFundsDialog({ goalId, mode, open, onOpenChange }: GoalFundsD
                     <label htmlFor="goal-funds-destination" className="text-sm font-medium">Move to goal</label>
                     <select id="goal-funds-destination" value={destinationGoalId} onChange={event => setDestinationGoalId(event.target.value)} className="h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                       <option value="">Choose a goal</option>
                       {activeDestinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                     </select>
                   </div>
                 )}
 
                 <div className="space-y-1.5">
                   <label htmlFor="goal-funds-amount" className="text-sm font-medium">Amount (PHP)</label>
-                  <Input id="goal-funds-amount" type="text" inputMode="decimal" autoComplete="off" value={amountText} onChange={event => setAmountText(event.target.value)} placeholder="0.00" />
+                  <Input id="goal-funds-amount" className="h-11 min-h-11" type="text" inputMode="decimal" autoComplete="off" value={amountText} onChange={event => setAmountText(event.target.value)} placeholder="0.00" />
                   <p className="text-xs text-muted-foreground">Enter an amount up to PHP {selectedWallet?.eligibleAmount ?? "0.00"}.</p>
                 </div>
                 {disabledForGoal && <p className="text-sm text-amber-700 dark:text-amber-300">This goal must be active and confirmed before you can change its reservations.</p>}
               </fieldset>
 
               <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                 <Button type="button" variant="outline" className="h-11 min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
                 <Button type="submit" className="h-11 min-h-11" disabled={pending || (!recoveringUnknown && (busy || walletDataError || disabledForGoal || wallets.length === 0))}>
                   {pending ? "Saving…" : recoveringUnknown ? "Retry same request" : titles[mode]}
                 </Button>
diff --git a/tests/goal-actions.test.tsx b/tests/goal-actions.test.tsx
index ef7c632..6489ab0 100644
--- a/tests/goal-actions.test.tsx
+++ b/tests/goal-actions.test.tsx
@@ -1,36 +1,54 @@
 import React from "react";
 import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
 import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
 import userEvent from "@testing-library/user-event";
 
+declare module "vitest" {
+  interface Assertion<T = any> {
+    toBeVisible(): T;
+  }
+}
+
+expect.extend({
+  toBeVisible(element: HTMLElement) {
+    let visible = element.isConnected;
+    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
+      const style = window.getComputedStyle(ancestor);
+      if (ancestor.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") visible = false;
+    }
+    return { pass: visible, message: () => `Expected element ${visible ? "not " : ""}to be visible` };
+  },
+});
+
 const state = vi.hoisted(() => ({
   finance: null as any,
   refresh: vi.fn(),
   apply: vi.fn(),
   accounts: [] as any[],
   events: [] as any[],
   operations: [] as any[],
   walletError: null as any,
   financeError: null as any,
+  financeLoading: false,
   historyError: null as any,
   readCalls: [] as any[],
 }));
 
 vi.mock("@/hooks/use-goal-finance", () => ({
   useGoalFinance: () => ({ data: state.finance, snapshot: state.finance, userId: "10000000-0000-4000-8000-000000000001", refresh: state.refresh, isLoading: false, error: null }),
   useGoalHistory: () => ({ data: state.events, isLoading: false, error: state.historyError, refresh: state.refresh }),
   useGoalWalletMetadata: () => ({ data: state.accounts, isLoading: false, error: state.walletError, refresh: state.refresh }),
 }));
 
 vi.mock("@/hooks/use-goals", () => ({
-  useGoals: () => ({ goals: state.finance?.goals ?? [], financeSnapshot: state.finance, userId, refresh: state.refresh, isLoading: false, isError: state.financeError }),
+  useGoals: () => ({ goals: state.finance?.goals ?? [], financeSnapshot: state.finance, userId, refresh: state.refresh, isLoading: state.financeLoading, isError: state.financeError }),
   getProjection: () => ({ count: 0, unit: "months", projectedDate: null, monthlyAmount: 0, kinsenasAmount: 0 }),
 }));
 
 vi.mock("@/lib/goals/client", async importOriginal => {
   const actual = await importOriginal<typeof import("@/lib/goals/client")>();
   return { ...actual, applyFinancialCommand: state.apply };
 });
 
 vi.mock("@/lib/supabase/client", () => ({
   createClient: () => ({ from: (table: string) => {
@@ -98,44 +116,49 @@ beforeEach(() => {
   state.finance = makeSnapshot();
   state.accounts = [
     { id: gcashId, user_id: userId, name: "GCash", type: "e_wallet", currency: "PHP", is_active: true },
     { id: bankId, user_id: userId, name: "GoTyme", type: "bank", currency: "PHP", is_active: true },
     { id: payLaterId, user_id: userId, name: "SPayLater", type: "credit_card", currency: "PHP", is_active: true },
   ];
   state.events = [];
   state.operations = [];
   state.walletError = null;
   state.financeError = null;
+  state.financeLoading = false;
   state.historyError = null;
   state.readCalls = [];
   state.refresh.mockReset().mockResolvedValue(undefined);
   state.apply.mockReset().mockResolvedValue({ operationId, transactionIds: [], replayed: false });
 });
 
 afterEach(() => cleanup());
 
 describe("goal reservation actions", () => {
   test("set aside uses reservation dialog and does not quote or create an expense", async () => {
     const user = userEvent.setup();
     render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
 
     const dialog = screen.getByRole("dialog", { name: /set aside/i });
+    expect(screen.getByRole("dialog", { name: /set aside/i })).toBeVisible();
+    expect(state.apply).not.toHaveBeenCalled();
+    expect(state.apply.mock.calls.some(([, command]) => command.kind === "transaction")).toBe(false);
     expect(dialog.getAttribute("data-state")).toBe("open");
     expect(within(dialog).getAllByRole("option").map(option => option.textContent)).toEqual(["Choose a wallet", "GCash", "GoTyme"]);
     await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
     await user.type(within(dialog).getByLabelText(/amount/i), "500");
     await user.click(within(dialog).getByRole("button", { name: /set aside/i }));
 
     await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
       kind: "reserve", goalId: laptopId, accountId: gcashId, amount: "500.00",
     }, undefined));
     expect(state.refresh).toHaveBeenCalledOnce();
+    expect(state.apply.mock.calls.some(([, command]) => command.kind === "transaction")).toBe(false);
     expect(state.finance.wallets[0].actual).toBe("30000.00");
   });
 
   test("release changes reservations without changing actual wallet balance", async () => {
     const user = userEvent.setup();
     render(<GoalFundsDialog goalId={laptopId} mode="release" open onOpenChange={() => {}} />);
     const dialog = screen.getByRole("dialog", { name: /release funds/i });
     await user.selectOptions(within(dialog).getByLabelText(/wallet/i), gcashId);
     await user.type(within(dialog).getByLabelText(/amount/i), "1000");
     await user.click(within(dialog).getByRole("button", { name: /release funds/i }));
@@ -224,20 +247,28 @@ describe("goal reservation actions", () => {
     expect(state.apply.mock.calls[1]).toEqual(firstAttempt);
   });
 
   test("wallet read errors stay distinct from an empty eligible-wallet list", () => {
     state.walletError = new Error("metadata unavailable");
     render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
     const dialog = screen.getByRole("dialog", { name: /set aside/i });
     expect(within(dialog).getByRole("alert").textContent).toMatch(/could not load/i);
     expect(dialog.textContent).not.toMatch(/no wallet has money available/i);
   });
+
+  test("reservation amount and retry loading controls have mobile minimum heights", () => {
+    state.walletError = new Error("metadata unavailable");
+    render(<GoalFundsDialog goalId={laptopId} mode="reserve" open onOpenChange={() => {}} />);
+    const dialog = screen.getByRole("dialog", { name: /set aside/i });
+    expect(within(dialog).getByLabelText(/amount/i).classList.contains("min-h-11")).toBe(true);
+    expect(within(dialog).getByRole("button", { name: /retry loading/i }).classList.contains("min-h-11")).toBe(true);
+  });
 });
 
 describe("goal lifecycle presentation", () => {
   test("active progress adds reserved and spent while showing each amount separately", () => {
     render(<GoalCard goal={makeGoal() as any} onEdit={() => {}} onDelete={() => {}} onToggleComplete={() => {}} onContribute={() => {}} onReserve={() => {}} onRelease={() => {}} onMove={() => {}} onHistory={() => {}} />);
     const card = screen.getByRole("article", { name: /laptop/i });
     expect(within(card).getByText(/reserved/i).textContent).toContain("₱3,000.00");
     expect(within(card).getByText(/spent/i).textContent).toContain("₱2,000.00");
     expect(within(card).getByText("17%")).toBeTruthy();
     expect(within(card).getByText("Saving")).toBeTruthy();
@@ -262,20 +293,49 @@ describe("goal lifecycle presentation", () => {
     const user = userEvent.setup();
     render(<GoalCard goal={makeGoal({ status: "completed", is_completed: true, reserved: "0.00", spent: "2000.00", progressAmount: "2000.00", progressPercent: 6.6667 }) as any} onEdit={() => {}} onDelete={() => {}} onToggleComplete={() => {}} onContribute={() => {}} onReserve={() => {}} onRelease={() => {}} onMove={() => {}} onHistory={() => {}} />);
     const card = screen.getByRole("article", { name: /laptop/i });
     await user.click(within(card).getByRole("button", { name: /reopen/i }));
     expect(within(card).getAllByText(/spent/i).some(element => element.textContent?.includes("₱2,000.00"))).toBe(true);
     expect(within(card).getByText("7%")).toBeTruthy();
   });
 });
 
 describe("goal closure and history", () => {
+  test.each(["error", "loading"])("cached zero reservations do not permit closure while snapshot is %s", async condition => {
+    state.finance = makeSnapshot([makeGoal({ reserved: "0.00", walletReservations: [] })]);
+    state.financeError = condition === "error" ? new Error("snapshot unavailable") : null;
+    state.financeLoading = condition === "loading";
+    render(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
+    const dialog = screen.getByRole("dialog", { name: /complete goal/i });
+    expect(dialog.textContent).not.toMatch(/no reservations remain/i);
+    expect(within(dialog).getByRole(condition === "error" ? "alert" : "status").textContent).toMatch(/goal funds/i);
+    expect((within(dialog).getByRole("button", { name: "Complete goal" }) as HTMLButtonElement).disabled).toBe(true);
+    fireEvent.submit(within(dialog).getByRole("button", { name: "Complete goal" }).closest("form")!);
+    expect(state.apply).not.toHaveBeenCalled();
+  });
+
+  test("unknown closure retries its original request despite a closed goal and snapshot error", async () => {
+    const user = userEvent.setup();
+    state.apply.mockRejectedValueOnce(new FinancialCommandError({ message: "Disconnected", outcome: "unknown" }));
+    const view = render(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
+    await user.click(screen.getByLabelText(/release leftovers/i));
+    await user.click(screen.getByRole("button", { name: "Complete goal" }));
+    await screen.findByText(/could not confirm whether this was saved/i);
+    const firstAttempt = state.apply.mock.calls[0];
+    state.finance = makeSnapshot([makeGoal({ status: "completed", reserved: "0.00", walletReservations: [] })]);
+    state.financeError = new Error("snapshot unavailable");
+    view.rerender(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
+    await user.click(screen.getByRole("button", { name: /retry same request/i }));
+    await waitFor(() => expect(state.apply).toHaveBeenCalledTimes(2));
+    expect(state.apply.mock.calls[1]).toEqual(firstAttempt);
+  });
+
   test("closure asks whether to release or move leftover reservations", async () => {
     const user = userEvent.setup();
     render(<GoalCompletionDialog goalId={laptopId} status="completed" open onOpenChange={() => {}} />);
     const dialog = screen.getByRole("dialog", { name: /complete goal/i });
     expect(within(dialog).getByText(/remains reserved/i).textContent).toContain("3000.00");
     expect(within(dialog).getByLabelText(/release leftovers/i)).toBeTruthy();
     expect(within(dialog).getByLabelText(/move leftovers/i)).toBeTruthy();
     await user.click(within(dialog).getByLabelText(/release leftovers/i));
     await user.click(within(dialog).getByRole("button", { name: /complete goal/i }));
     await waitFor(() => expect(state.apply).toHaveBeenCalledWith(expect.any(String), {
