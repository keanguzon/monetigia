945b909 feat: reconcile legacy goals and enforce financial write guards
 .gitignore                                         |   1 +
 .../2026-10-06-goal-reservations/task-10-report.md |  50 ++++++
 docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md     |  27 +++
 src/app/(dashboard)/goals/page.tsx                 |   5 +-
 src/components/goals/GoalCard.tsx                  |  17 +-
 src/components/goals/LegacyGoalReviewDialog.tsx    | 129 ++++++++++++++
 .../transactions/AddTransactionModal.tsx           |   4 +
 .../202610060005_goal_lifecycle_operations.sql     |  70 +++++++-
 .../migrations/202610060006_goal_write_guards.sql  |  79 +++++++++
 supabase/schema.sql                                | 150 +++++++++++++++-
 tests/database/migration-security.test.mjs         | 192 +++++++++++++++++++++
 tests/database/reservations.test.mjs               |  11 +-
 tests/legacy-goals.test.tsx                        | 107 ++++++++++++
 13 files changed, 822 insertions(+), 20 deletions(-)
diff --git a/.gitignore b/.gitignore
index 85774fc..d8551ef 100644
--- a/.gitignore
+++ b/.gitignore
@@ -76,10 +76,11 @@ supabase/migrations/*
 !supabase/migrations/202610060003_goal_reservation_operations.sql
 
 # Verification & Test Scripts
 scripts/
 
 
 
 
 !supabase/migrations/202610060004_goal_transaction_operations.sql
 !supabase/migrations/202610060005_goal_lifecycle_operations.sql
+!supabase/migrations/202610060006_goal_write_guards.sql
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md
new file mode 100644
index 0000000..7521035
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md
@@ -0,0 +1,50 @@
+# Task 10 implementation report
+
+Date: 2026-10-07
+Branch: `codex/goal-reservations`
+Base: `ffc3c09`
+
+## Implementation
+
+- Added the explicit legacy funding review dialog and Goals card/page entry point. Unreviewed tags are not displayed as reserved money and cannot invoke spend, reserve, close, reopen, or archive shortcuts. Transaction submission also rejects an unreviewed default goal before quoting.
+- Review selects current active PHP noncredit wallet reservations, status, and optional eligible historical cash expenses or cash-to-credit-card debt payments. Closed reviews create no reservations. Fake-savings copy explains normal transaction correction without an automatic reversal. Available-money validation uses decimal strings and integer cents.
+- Added `adopt_legacy` to the lifecycle dispatcher. It normalizes UUIDs and array ordering, rejects malformed/duplicate entries, locks the profile before ordered goals/accounts, and checks request replay before mutable state. Reservations and spent-only imports commit atomically. Historical spending never charges the wallet again; its transaction UUID has a unique legacy import index and already-counted spending is rejected. Existing legacy tags/current amounts remain untouched. An already-confirmed goal cannot run another adoption request. Normal deletion reverses imported spending with zero restored reservation.
+- Added migration 006 with reviewed column creation/metadata allowlists, denied direct transaction/event/operation DML, denied balance/ownership/account identity/lifecycle/review/archive writes, and a restrictive owner boundary. Safe account name/color/icon/order/APY/net-worth inclusion, goal target/metadata edits, and safe PHP opening wallets remain available. Wallet deletion is blocked by transaction or allocation history; allocation-backed identity changes are also blocked for privileged direct writes.
+- Other public security definers and private goal/guard helpers fail closed with execution revoked from PUBLIC, anon, authenticated and service_role. Only the three public finance endpoint signatures remain callable. Trigger execution remains valid. All new helpers have pinned search paths. No missing deployed function body was guessed or created.
+- Synchronized `supabase/schema.sql` with migrations 001–006 and added the 006 `.gitignore` exception approved by root. Repeated ordered migration, standalone guard/lifecycle, and reproducible-schema reapplication preserve imported history and finish with the reviewed grants.
+- Audited product writers and expanded the rollout checklist with backups, statement-based debt discrepancy audit, actual function/grant inventory review, coordinated writer cutover, and forward fixes. The actual deployed deletion RPC remains explicitly unknown.
+- Changed only three old database fixture inserts to privileged setup for USD/inactive wallets and closed/archived goals now denied to authenticated writers. All original financial assertions remain unchanged. The older reservation suite restores 004/005/006 afterward, keeping the disposable preview on the current dispatcher and grants.
+
+## TDD evidence
+
+RED database: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 1, 0 passed / 5 failed. Adoption returned `INVALID_STATE` where a successful import or `INSUFFICIENT_AVAILABLE` was expected; direct authenticated transaction insertion unexpectedly succeeded; migration 006 was absent. An initially invalid installment fixture referenced a nonexistent column; that setup error was corrected and the same five feature failures were reproduced before implementation. Credit installments are represented by credit-source transaction rows in this schema.
+
+RED UI: `npx vitest run tests/legacy-goals.test.tsx` initially could not import the missing component. With a null component export, all four behavior tests failed because review controls were absent and the unreviewed card still exposed spending/reservation actions. After implementation, 4/4 passed. The transaction default-goal regression then failed because a quote was sent with the unreviewed goal; after the modal guard, 5/5 passed. The pending-review identity regression failed when another goal's name replaced the original pending goal; retaining and displaying the original review name fixed it, yielding 7/7.
+
+GREEN covering run: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 0, 9/9 passed, including the final foreign-owner, ineligible-wallet, duplicate-ID and exact DML-permission assertions. This is real PostgreSQL/PostgREST with signed ordinary authenticated users, grants, RLS, race concurrency, rollback and replay. The disposable old RPC is proven callable before cutover, still exists afterward, has no execution grants for authenticated/anon/service_role, and cannot delete its selected transaction. PostgREST may deny a revoked endpoint with `42501` or remove it from the exposed cache with `PGRST202`; catalog privilege assertions independently prove revocation.
+
+## Final verification
+
+- `npm run test:db`, spawned with process variables from ignored `.superpowers/local-db/environment.json`: exit 0, 66 tests / 66 passed / 0 failed / 0 skipped. The final fixture-only branch assertions were then covered by the 9/9 focused run above. No application live environment was loaded or printed.
+- `npm test`: exit 0, Node 2/2 and Vitest 9 files / 130 tests passed. This includes legacy review 7/7 and all prior transaction, lifecycle, Wallets, contribution and money tests.
+- `npx tsc --noEmit`: exit 0.
+- `git diff --check` for owned modified files: exit 0. Git emits Windows LF-to-CRLF notices; test runs emitted no runtime warnings.
+- Contrast checker, using the bundled Python runtime: emerald-700/white 5.48:1, emerald-400/slate-950 10.49:1, red-700/white 6.47:1, red-300/slate-950 10.63:1, all normal-text AA passes. The first system `python` invocation was unavailable; no runtime installation was performed.
+- Test users are generated and cleanup deletes only those fixture identities. The separate preview user's data was not reset. No live database, cloud credentials, push, merge, deployment, dependency installation, child agent, root progress record or root review record was changed.
+
+## Self-review and antislop scope gate
+
+- PASS, functional controls/states: component interaction tests cover explicit selection, insufficient funds, history errors, optional empty selection, completed review, unknown outcome retry, original pending-goal identity, and keyboard Escape with focus return. Every product entry point supplies the review handler. Confirmation is disabled during loading/errors/pending saves and changes are frozen for unknown outcomes.
+- PASS, copy/data: the review uses real owner-scoped history and balances, explains old tags and fake savings, makes no fabricated security/customer/statistic claims, and adds no decorative assets, dead links, testimonials or generic marketing copy. Added copy has no em dashes.
+- PASS, purpose/direction: existing Manrope/Bricolage and ENERGY 1 / RHYTHM 2 / MOTION 1 are preserved. The dialog's single confirmation accent identifies the financial commitment; bounded width and vertical scrolling follow the existing dialogs. No new layout system, gradients, icons or motion were introduced.
+- PASS, source accessibility/mobile: labels associate with selects, amounts and checkboxes; clickable controls/labels have 44px minimum height, focus rings, foreground/background theme tokens, long-history wrapping, and bounded viewport dimensions. Static text color pairs pass contrast checks.
+- PASS, comment scope: new SQL comments explain column-grant cleanup and fail-closed unknown-function revocation. No generic narration comments were added.
+- PENDING, rendered gate: actual 375/768/1280 light/dark browser rendering and complete click-through remain with root's Task 11 gate, as instructed. Source and jsdom checks are not represented as rendered-browser evidence. Root also owns final branch lint/build.
+
+## Files changed
+
+`.gitignore`; `docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md`; `src/app/(dashboard)/goals/page.tsx`; `src/components/goals/GoalCard.tsx`; `src/components/goals/LegacyGoalReviewDialog.tsx`; `src/components/transactions/AddTransactionModal.tsx`; `supabase/migrations/202610060005_goal_lifecycle_operations.sql`; `supabase/migrations/202610060006_goal_write_guards.sql`; `supabase/schema.sql`; `tests/database/migration-security.test.mjs`; `tests/database/reservations.test.mjs`; `tests/legacy-goals.test.tsx`; this report.
+
+## Remaining gates
+
+Task 10 implementation and automated checks are complete. Independent review and root's Task 11 rendered/lint/build gate remain. Deployment additionally requires authorized backup/debt/schema/function/grant preflight. In particular, the real old deletion RPC is still unverified; the local fixture test does not establish its deployed name, signature or body.
diff --git a/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md b/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
index 5498150..b18d518 100644
--- a/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
+++ b/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
@@ -70,10 +70,37 @@ Keep this reconciliation separate from Wallets' normalized monthly debt buckets.
 
 ## Coordinated cutover
 
 1. Capture the deployed-schema evidence above and audit existing debt discrepancies without correcting balances automatically.
 2. Apply reviewed additive migrations after deployment authorization. Verify legacy goals require review and newly created goals are confirmed.
 3. Update every financial writer to the atomic RPC lane, including expense, transfer, installments, deletion, legacy adoption, and lifecycle actions. Remove fetch-time balance writes.
 4. Audit old RPC grants and restrict direct transaction, balance, lifecycle, and allocation mutations as a coordinated cutover. Retain opening-balance account creation and safe metadata changes.
 5. Run integration and owner-isolation checks, then verify the user examples and cache refresh behavior.
 
 Once reservations exist, a rollback to legacy writers can corrupt available money. Preserve ledger history and use a forward fix or temporarily disable writes if the cutover fails.
+
+## Writer audit and review lane
+
+The local source audit covers every `from(...).insert/update/delete` and `rpc(...)` call under `src`. Transaction creation, installments, deletion, reservations, legacy review, and goal lifecycle actions use `goal_finance_apply`; quotes use `goal_transaction_quote`. Goals create and edit metadata through `use-goals.ts`. `AddGoalModal` supplies an initial zero current amount and false completion flag; the database validates those opening values. Wallet creation remains in `AddAccountModal` and `AddAccountForm`. Wallets writes only account names, ordering, APY, and net-worth inclusion, plus deletion of wallets without financial history. Account, Dashboard, transaction, and SWR reads do not repair balances. Categories and user profile/settings writes do not mutate goal funds.
+
+Migration 006 denies authenticated transaction/event/operation DML, balance changes, account identity/type/currency/active-state changes, and goal ownership/current-amount/lifecycle/review/archive changes. It replaces column privileges with explicit creation and metadata allowlists and adds a restrictive owner boundary, so an older permissive RLS policy cannot broaden owner access. Safe PHP wallet opening balances, account name/color/icon/order/APY/net-worth inclusion, and goal metadata/targets remain available. A wallet with transaction or allocation history cannot be deleted; allocation-backed wallet identity cannot change even through a privileged direct update. Deleting a goal directly is disabled; closing and archiving use the finance command.
+
+Legacy review explicitly selects active PHP cash-wallet reservations, a lifecycle status, and optional existing cash expenses or cash-to-card payments for debt goals. Old tags, amounts, and wallet balances stay intact. Historical imports append spent-only events with unique transaction IDs; they never charge the wallet again. Replaying the same request returns its original result before validating the now-confirmed goal or deleted historical transaction. A second review with another request is rejected, as is importing a transaction already counted by another goal. Deleting an imported transaction follows the normal financial reversal and reverses its spent-only event with no invented reservation. Completed and cancelled reviews add no reservations. An expense previously used as fake savings needs normal transaction correction; review neither reverses it automatically nor reserves unavailable money.
+
+## Verified local function inventory and unknown deployed RPCs
+
+The disposable native database inventory contained the three public finance endpoints, private `goal_reservation_apply` and `goal_transaction_apply`, the allocation owner/immutability triggers, the identity guard, and the existing registration trigger. All security definers reported `search_path=pg_catalog, public`. This inventory is local evidence only. The actual deployed deletion RPC's name, overloads, body, and grants remain unknown.
+
+Migration 006 fails closed for other public security-definer functions and private goal/guard helpers: it revokes execution from PUBLIC, anon, authenticated, and service_role, retaining only the three reviewed public finance endpoint signatures. Trigger invocation continues to work without direct execution grants. No guessed deletion RPC body is created or replaced. The security test creates and revokes a clearly named disposable old deletion fixture RPC solely to prove the bypass is denied; it is not evidence of a deployed function's name or implementation.
+
+Before deployment, review the captured complete function inventory, including every exposed API schema, overload, function owner, security mode, search path, table grants, column grants, role membership, inherited grants, and default privileges. Identify all existing financial RPC callers. Confirm unknown or old mutation endpoints are revoked for every calling role, including grants inherited through PUBLIC or another role. If a reviewed nonfinancial endpoint must remain callable, add its exact signature to the reviewed deployment allowlist and rerun owner/security tests before cutover. Do not regrant unknown functions merely to restore an old client.
+
+## Operator cutover checklist
+
+1. Obtain separate production/deployment authorization. Capture a restorable database backup and the schema/function/grant inventory; test restoring the backup into an isolated environment before changing production.
+2. Complete the statement-based card opening-debt discrepancy audit above. Record unresolved comparisons and review corrections separately; do not replace balances with monthly debt previews.
+3. Rehearse migrations 001 through 006 on a disposable copy with representative legacy rows, followed by standalone 005/006 reapplication and the reproducible `schema.sql`. Confirm balances, old tags, review decisions, and imported history survive reapplication.
+4. Coordinate the application writer release with migration 006. Pause writes or use a maintenance window during the cutover so an old client cannot submit through the legacy direct-write lane. Apply the additive baseline/ledger/RPC migrations, switch every writer, then enforce the reviewed grants and endpoint revocations. Verify the final state, not an intermediate migration state.
+5. Confirm owner-scoped reads, safe metadata/target edits, safe wallet creation, quote/confirmation, transaction/deletion, legacy review, close/reopen/archive, retry replay, and denied direct writes as ordinary authenticated users. Verify no unknown public definer endpoint or overload remains callable.
+6. Monitor failed mutations and financial-operation completion. If the cutover fails, disable affected writes and apply a forward fix. Preserve operations, append-only allocation history, and idempotency IDs. Never roll back to an application that writes balances or transactions directly while reservations exist.
+
+Local automated tests create uniquely named users and remove only those users. They do not reset the separate preview user. The final reservations test restores the current transaction/lifecycle/guard migrations after exercising the older reservation dispatcher. Rendered browser verification and deployment preflight remain separate gates; local test results are not a live database audit or permission to deploy.
diff --git a/src/app/(dashboard)/goals/page.tsx b/src/app/(dashboard)/goals/page.tsx
index 718a5b9..e722795 100644
--- a/src/app/(dashboard)/goals/page.tsx
+++ b/src/app/(dashboard)/goals/page.tsx
@@ -7,37 +7,39 @@ import { useToast } from "@/components/ui/use-toast";
 import { formatCurrency } from "@/lib/utils";
 import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";
 import { GoalWithProgress, useGoals } from "@/hooks/use-goals";
 import { GoalCard } from "@/components/goals/GoalCard";
 import { AddGoalModal } from "@/components/goals/AddGoalModal";
 import type { Goal } from "@/types/database";
 import AddTransactionModal from "@/components/transactions/AddTransactionModal";
 import { GoalFundsDialog } from "@/components/goals/GoalFundsDialog";
 import { GoalCompletionDialog } from "@/components/goals/GoalCompletionDialog";
 import { GoalHistoryDialog } from "@/components/goals/GoalHistoryDialog";
+import { LegacyGoalReviewDialog } from "@/components/goals/LegacyGoalReviewDialog";
 import { GoalCardSkeleton } from "@/components/goals/GoalCardSkeleton";
 import { Skeleton } from "@/components/ui/skeleton";
 import { SummarySkeleton, summaryPanelClass } from "@/components/ui/financial-summary";
 
 type FundsAction = { goalId: string; mode: "reserve" | "release" | "move" };
 type ClosingAction = { goalId: string; status: "completed" | "cancelled" };
 
 export default function GoalsPage() {
   const { toast } = useToast();
   const { goals, isLoading, isError, deleteGoal, toggleComplete } = useGoals();
   const [isModalOpen, setIsModalOpen] = useState(false);
   const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
   const [showClosed, setShowClosed] = useState(false);
   const [contributingGoalId, setContributingGoalId] = useState<string | null>(null);
   const [fundsAction, setFundsAction] = useState<FundsAction | null>(null);
   const [closingAction, setClosingAction] = useState<ClosingAction | null>(null);
   const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
+  const [reviewGoalId, setReviewGoalId] = useState<string | null>(null);
 
   const totals = useMemo(() => {
     let targetCents = 0;
     let reservedCents = 0;
     let spentCents = 0;
     let monthlyCents = 0;
     const active: GoalWithProgress[] = [];
     const closed: GoalWithProgress[] = [];
     goals.forEach(goal => {
       targetCents += toMinorUnits(goal.financeAmounts.target);
@@ -83,21 +85,21 @@ export default function GoalsPage() {
     }
   };
 
   const renderGoal = (goal: GoalWithProgress) => (
     <GoalCard key={goal.id} goal={goal} onEdit={handleOpenEditModal} onDelete={handleArchiveGoal}
       onToggleComplete={handleToggleComplete} onContribute={setContributingGoalId}
       onReserve={goalId => setFundsAction({ goalId, mode: "reserve" })}
       onRelease={goalId => setFundsAction({ goalId, mode: "release" })}
       onMove={goalId => setFundsAction({ goalId, mode: "move" })}
       onClose={(goalId, status) => setClosingAction({ goalId, status })}
-      onHistory={setHistoryGoalId} />
+      onHistory={setHistoryGoalId} onReview={setReviewGoalId} />
   );
 
   return (
     <div className="space-y-8 pb-12">
       <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
         <div>
           <div className="flex items-center gap-2.5">
             <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Goals &amp; Sinking Funds</h1>
             <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{isLoading ? <Skeleton className="h-4 w-14" /> : `${totals.active.length} Active`}</span>
           </div>
@@ -156,13 +158,14 @@ export default function GoalsPage() {
             {showClosed && <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2 lg:grid-cols-3">{totals.closed.map(renderGoal)}</div>}
           </section>}
         </div>
       )}
 
       <AddTransactionModal isOpen={contributingGoalId !== null} defaultGoalId={contributingGoalId ?? undefined} onClose={() => setContributingGoalId(null)} />
       <AddGoalModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} editingGoal={editingGoal} />
       <GoalFundsDialog goalId={fundsAction?.goalId ?? ""} mode={fundsAction?.mode ?? "reserve"} open={fundsAction !== null} onOpenChange={open => { if (!open) setFundsAction(null); }} />
       <GoalCompletionDialog goalId={closingAction?.goalId ?? ""} status={closingAction?.status ?? "completed"} open={closingAction !== null} onOpenChange={open => { if (!open) setClosingAction(null); }} />
       <GoalHistoryDialog goalId={historyGoalId ?? ""} open={historyGoalId !== null} onOpenChange={open => { if (!open) setHistoryGoalId(null); }} />
+      <LegacyGoalReviewDialog goalId={reviewGoalId ?? ""} open={reviewGoalId !== null} onOpenChange={open => { if (!open) setReviewGoalId(null); }} />
     </div>
   );
 }
diff --git a/src/components/goals/GoalCard.tsx b/src/components/goals/GoalCard.tsx
index a0966fe..7e42a45 100644
--- a/src/components/goals/GoalCard.tsx
+++ b/src/components/goals/GoalCard.tsx
@@ -29,29 +29,31 @@ interface GoalCardProps {
   goal: GoalWithProgress;
   onEdit: (goal: GoalWithProgress) => void;
   onDelete: (goalId: string) => void;
   onToggleComplete: (goalId: string, completed: boolean) => void;
   onContribute: (goalId: string) => void;
   onReserve: (goalId: string) => void;
   onRelease: (goalId: string) => void;
   onMove: (goalId: string) => void;
   onHistory: (goalId: string) => void;
   onClose?: (goalId: string, status: "completed" | "cancelled") => void;
+  onReview?: (goalId: string) => void;
 }
 
-export function GoalCard({ goal, onEdit, onDelete, onToggleComplete, onContribute, onReserve, onRelease, onMove, onHistory, onClose }: GoalCardProps) {
+export function GoalCard({ goal, onEdit, onDelete, onToggleComplete, onContribute, onReserve, onRelease, onMove, onHistory, onClose, onReview }: GoalCardProps) {
   const projection = getProjection(goal);
   const progressCents = toMinorUnits(goal.financeAmounts.progress);
   const targetCents = toMinorUnits(goal.financeAmounts.target);
   const isCompleted = goal.status === "completed";
   const isCancelled = goal.status === "cancelled";
   const isActive = goal.status === "active";
+  const needsReview = goal.review_state === "needs_review";
   const activeFunded = isActive && progressCents >= targetCents;
   const displayedProgress = isCompleted ? goal.spent : goal.financeAmounts.progress;
   const percent = isCompleted ? (targetCents ? Math.min(100, toMinorUnits(goal.spent) / targetCents * 100) : 0) : goal.progressPercent;
   const clampedPercent = Math.min(100, Math.max(0, percent));
   const categoryStyle = categoryStyles[goal.category?.toLowerCase()] || categoryStyles.lifestyle;
   const formattedTargetDate = formatDate(goal.target_date);
   const formattedProjectedDate = formatDate(projection.projectedDate);
   const hasReservations = goal.walletReservations.some(wallet => toMinorUnits(wallet.amount) > 0);
 
   return (
@@ -71,58 +73,59 @@ export function GoalCard({ goal, onEdit, onDelete, onToggleComplete, onContribut
             </div>
           </div>
           <DropdownMenu.Root>
             <DropdownMenu.Trigger asChild>
               <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`${goal.name} actions`}><MoreHorizontal className="h-4 w-4" /></Button>
             </DropdownMenu.Trigger>
             <DropdownMenu.Portal>
               <DropdownMenu.Content align="end" sideOffset={6} className="z-[60] min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
                 <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onHistory(goal.id)}><History className="h-4 w-4" />View history</DropdownMenu.Item>
                 <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onEdit(goal)}><Edit2 className="h-4 w-4" />Edit goal</DropdownMenu.Item>
-                {isActive && <>
+                {isActive && !needsReview && <>
                   <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onRelease(goal.id)} disabled={!hasReservations}>Release funds</DropdownMenu.Item>
                   <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onMove(goal.id)} disabled={!hasReservations}>Move reservation</DropdownMenu.Item>
                   <DropdownMenu.Separator className="my-1 h-px bg-border" />
                   <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onClose ? onClose(goal.id, "completed") : onToggleComplete(goal.id, true)}>Complete goal</DropdownMenu.Item>
                   <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onClose?.(goal.id, "cancelled")}>Cancel goal</DropdownMenu.Item>
                 </>}
-                {isCompleted && <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onToggleComplete(goal.id, false)}><Circle className="h-4 w-4" />Reopen</DropdownMenu.Item>}
-                {!isActive && !hasReservations && <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-destructive outline-none focus:bg-accent" onSelect={() => onDelete(goal.id)}><Trash2 className="h-4 w-4" />Archive goal</DropdownMenu.Item>}
+                {isCompleted && !needsReview && <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent" onSelect={() => onToggleComplete(goal.id, false)}><Circle className="h-4 w-4" />Reopen</DropdownMenu.Item>}
+                {!isActive && !needsReview && !hasReservations && <DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-destructive outline-none focus:bg-accent" onSelect={() => onDelete(goal.id)}><Trash2 className="h-4 w-4" />Archive goal</DropdownMenu.Item>}
               </DropdownMenu.Content>
             </DropdownMenu.Portal>
           </DropdownMenu.Root>
         </div>
 
         <div className="my-3.5 space-y-2">
           <div className="flex items-baseline justify-between gap-2">
             <div className="min-w-0"><span className="text-base font-bold tracking-tight text-foreground sm:text-lg">{formatCurrency(Number(displayedProgress))}</span><span className="ml-1.5 text-xs font-medium text-muted-foreground">/ {formatCurrency(goal.target_amount)}</span></div>
             <span className="text-xs font-bold tabular-nums text-foreground">{clampedPercent.toFixed(0)}%</span>
           </div>
           <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50" role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clampedPercent)}>
             <div className={`h-full rounded-full ${isCompleted || activeFunded ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${clampedPercent}%` }} />
           </div>
           <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
             <p className="text-muted-foreground">Reserved <span className="font-medium text-foreground">{formatCurrency(Number(goal.reserved))}</span></p>
             <p className="text-muted-foreground">Spent <span className="font-medium text-foreground">{formatCurrency(Number(goal.spent))}</span></p>
           </div>
         </div>
       </div>
 
-      {isActive && <div className="mt-2 grid grid-cols-2 gap-2">
+      {needsReview && <div className="mt-2 space-y-2"><p className="text-xs text-muted-foreground">Existing tags need review before they count as funding.</p><Button variant="outline" className="h-11 min-h-11 w-full" onClick={() => onReview?.(goal.id)}>Review existing funding</Button></div>}
+      {isActive && !needsReview && <div className="mt-2 grid grid-cols-2 gap-2">
         <Button variant="outline" size="sm" className="h-11 min-h-11" onClick={() => onReserve(goal.id)}>Set aside</Button>
         <Button size="sm" className="h-11 min-h-11" onClick={() => onContribute(goal.id)}>Spend from goal</Button>
       </div>}
 
       <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/30 pt-3 text-xs text-muted-foreground">
         <div className="min-w-0 flex-1">
           {isCompleted ? <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />PHP {goal.spent} spent</span>
             : isCancelled ? <span>Spending history retained</span>
             : activeFunded ? <span className="font-medium text-emerald-600 dark:text-emerald-400">Funded</span>
             : Number(goal.allocation_per_cycle) > 0 ? <div className="space-y-0.5"><span className="flex items-center gap-1 text-[11px] font-medium text-foreground"><Clock className="h-3 w-3 text-muted-foreground" />Saving · ~{projection.count} {projection.unit}</span>{formattedProjectedDate && <span className="block text-[10px] text-muted-foreground">Estimate: {formattedProjectedDate}</span>}</div>
             : <span className="text-[11px] text-muted-foreground">Saving</span>}
         </div>
-        {isActive && !activeFunded && <Button variant="ghost" size="sm" className="h-11 min-h-11 shrink-0 px-2 text-xs" onClick={() => onClose ? onClose(goal.id, "completed") : onToggleComplete(goal.id, true)}>Complete</Button>}
-        {isCompleted && <Button variant="ghost" size="sm" className="h-11 min-h-11 shrink-0 px-2 text-xs" onClick={() => onToggleComplete(goal.id, false)}>Reopen</Button>}
+        {isActive && !needsReview && !activeFunded && <Button variant="ghost" size="sm" className="h-11 min-h-11 shrink-0 px-2 text-xs" onClick={() => onClose ? onClose(goal.id, "completed") : onToggleComplete(goal.id, true)}>Complete</Button>}
+        {isCompleted && !needsReview && <Button variant="ghost" size="sm" className="h-11 min-h-11 shrink-0 px-2 text-xs" onClick={() => onToggleComplete(goal.id, false)}>Reopen</Button>}
       </div>
     </article>
   );
 }
diff --git a/src/components/goals/LegacyGoalReviewDialog.tsx b/src/components/goals/LegacyGoalReviewDialog.tsx
new file mode 100644
index 0000000..10d29a6
--- /dev/null
+++ b/src/components/goals/LegacyGoalReviewDialog.tsx
@@ -0,0 +1,129 @@
+"use client";
+
+import React, { useEffect, useMemo, useRef, useState } from "react";
+import * as Dialog from "@radix-ui/react-dialog";
+import { Button } from "@/components/ui/button";
+import { Input } from "@/components/ui/input";
+import { useGoals } from "@/hooks/use-goals";
+import { useGoalWalletMetadata } from "@/hooks/use-goal-finance";
+import { createClient } from "@/lib/supabase/client";
+import { FinancialCommandError, financialCommandMessage } from "@/lib/goals/client";
+import { parseMoney, toMinorUnits } from "@/lib/goals/summary";
+import { applyAndRefreshFinancialCommand } from "@/lib/refresh-financial-data";
+import type { FinancialCommand, GoalStatus } from "@/lib/goals/contracts";
+
+type HistoricalTransaction = { id: string; account_id: string; transfer_to_account_id: string | null; type: string; amount: number | string; description: string | null; date: string };
+type ReviewCommand = Extract<FinancialCommand, { kind: "adopt_legacy" }>;
+
+export function LegacyGoalReviewDialog({ goalId, open, onOpenChange }: { goalId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
+  const { goals, userId, financeSnapshot, refresh, isLoading, isError } = useGoals();
+  const metadata = useGoalWalletMetadata(userId);
+  const goal = goals.find(item => item.id === goalId);
+  const [status, setStatus] = useState<GoalStatus>("active");
+  const [amounts, setAmounts] = useState<Record<string, string>>({});
+  const [selectedIds, setSelectedIds] = useState<string[]>([]);
+  const [history, setHistory] = useState<HistoricalTransaction[]>([]);
+  const [historyLoading, setHistoryLoading] = useState(true);
+  const [historyError, setHistoryError] = useState(false);
+  const [loadRevision, setLoadRevision] = useState(0);
+  const [error, setError] = useState<string | null>(null);
+  const [pending, setPending] = useState(false);
+  const [saved, setSaved] = useState(false);
+  const [unknown, setUnknown] = useState(false);
+  const retry = useRef<{ requestId: string; command: ReviewCommand; userId: string; goalName: string } | null>(null);
+  const opener = useRef<HTMLElement | null>(null);
+
+  useEffect(() => {
+    if (!open) return;
+    if (retry.current && retry.current.userId !== userId) { retry.current = null; setUnknown(false); }
+    if (!retry.current) { setStatus(goal?.status ?? "active"); setAmounts({}); setSelectedIds([]); setError(null); setSaved(false); }
+  }, [open, goalId, userId, goal?.status]);
+
+  useEffect(() => {
+    if (!open || !userId) return;
+    let current = true;
+    setHistoryLoading(true); setHistoryError(false); setHistory([]);
+    const db = createClient() as any;
+    void Promise.all([
+      db.from("transactions").select("id,account_id,transfer_to_account_id,type,amount,description,date").eq("user_id", userId).order("date", { ascending: false }),
+      db.from("goal_allocation_events").select("kind,transaction_id").eq("user_id", userId),
+    ]).then(([transactions, events]) => {
+      if (!current) return;
+      if (transactions.error || events.error || !Array.isArray(transactions.data) || !Array.isArray(events.data)) throw new Error("History unavailable");
+      const used = new Set(events.data.filter((event: any) => event.kind === "spend" || event.kind === "legacy_spent").map((event: any) => event.transaction_id));
+      setHistory(transactions.data.filter((transaction: HistoricalTransaction) => !used.has(transaction.id)));
+    }).catch(() => { if (current) setHistoryError(true); }).finally(() => { if (current) setHistoryLoading(false); });
+    return () => { current = false; };
+  }, [open, userId, loadRevision]);
+
+  const wallets = useMemo(() => (financeSnapshot?.wallets ?? []).flatMap(wallet => {
+    const account = metadata.data?.find(item => item.id === wallet.accountId);
+    return account?.is_active && account.currency === "PHP" && account.type !== "credit_card" ? [{ ...wallet, name: account.name }] : [];
+  }), [financeSnapshot, metadata.data]);
+  const eligibleHistory = useMemo(() => history.filter(transaction => {
+    const source = metadata.data?.find(account => account.id === transaction.account_id);
+    if (!source?.is_active || source.currency !== "PHP" || source.type === "credit_card" || !Number.isFinite(Number(transaction.amount)) || Number(transaction.amount) <= 0) return false;
+    if (transaction.type === "expense") return !transaction.transfer_to_account_id;
+    const destination = metadata.data?.find(account => account.id === transaction.transfer_to_account_id);
+    return goal?.category === "debt" && transaction.type === "transfer" && destination?.is_active && destination.type === "credit_card" && destination.currency === "PHP";
+  }), [history, metadata.data, goal?.category]);
+  const loadError = Boolean(isError || metadata.error || historyError);
+  const loading = isLoading || metadata.isLoading || historyLoading;
+  const eligibleGoal = goal?.review_state === "needs_review" && goal.archived_at === null;
+
+  async function submit(event: React.FormEvent) {
+    event.preventDefault(); if (pending) return;
+    setError(null);
+    let attempt = retry.current;
+    if (!attempt) {
+      if (!eligibleGoal || !userId || loading || loadError) return;
+      try {
+        const reservations: ReviewCommand["reservations"] = [];
+        if (status === "active") for (const wallet of wallets) {
+          const text = amounts[wallet.accountId]?.trim(); if (!text) continue;
+          const amount = parseMoney(text);
+          if (toMinorUnits(amount) === 0) continue;
+          if (toMinorUnits(amount) > toMinorUnits(wallet.available)) throw new Error(`${wallet.name} has only PHP ${wallet.available} available.`);
+          reservations.push({ accountId: wallet.accountId, amount });
+        }
+        if (selectedIds.some(id => !eligibleHistory.some(transaction => transaction.id === id))) throw new Error("Review the selected spending again.");
+        attempt = { requestId: crypto.randomUUID(), userId, goalName: goal?.name ?? "Goal", command: { kind: "adopt_legacy", goalId, status, reservations, spentTransactionIds: selectedIds } };
+        retry.current = attempt;
+      } catch (cause) { setError(cause instanceof Error ? cause.message : "Enter valid PHP amounts."); return; }
+    }
+    if (attempt.userId !== userId) { setError("Sign in as the original user before retrying this review."); return; }
+    setPending(true);
+    try {
+      const outcome = await applyAndRefreshFinancialCommand(attempt.requestId, attempt.command, undefined, refresh);
+      retry.current = null; setUnknown(false); setSaved(true);
+      if (!outcome.refreshError) onOpenChange(false);
+    } catch (cause) {
+      if (cause instanceof FinancialCommandError && cause.outcome === "unknown") { setUnknown(true); setError("We could not confirm whether the review was saved. Retry the same request before starting another review."); }
+      else { retry.current = null; setUnknown(false); setError(financialCommandMessage(cause, "The funding review could not be saved.")); }
+    } finally { setPending(false); }
+  }
+
+  return <Dialog.Root open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
+    <Dialog.Portal>
+      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
+      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
+        <Dialog.Title className="text-lg font-semibold">Review existing funding</Dialog.Title>
+        <Dialog.Description className="mt-1 text-sm text-muted-foreground">{unknown && retry.current ? `${retry.current.goalName}: pending review. Retry its original selections before reviewing another goal.` : `${goal?.name ?? "Goal"}: confirm money currently set aside and past spending that belongs to this goal.`}</Dialog.Description>
+        <p className="mt-4 text-sm text-muted-foreground">Old goal tags are kept as history. They do not reserve money in a wallet. Selecting past spending records progress without charging your wallet again.</p>
+        <p className="mt-3 text-sm text-muted-foreground">If an old expense was used as fake savings, use a normal transaction correction from Transactions first. This review does not reverse it or create money that is no longer available.</p>
+        {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
+        {loading && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading balances and spending history…</p>}
+        {loadError && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-red-700 dark:text-red-300">Balances or spending history could not load. Confirmation is unavailable.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => { setLoadRevision(value => value + 1); void Promise.all([refresh(), metadata.refresh()]).catch(() => setError("Could not reload wallet details.")); }}>Retry loading</Button></div>}
+        {saved ? <div role="status" className="mt-4 space-y-3"><p>Review saved. The summary could not refresh; do not submit it again.</p><Button className="min-h-11 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300" onClick={() => { void refresh().then(() => onOpenChange(false)).catch(() => setError("The summary still could not refresh.")); }}>Retry refresh</Button></div> : <form className="mt-5 space-y-4" onSubmit={submit}>
+          <fieldset disabled={pending || loading || loadError || !eligibleGoal || unknown} className="space-y-4">
+            <div className="space-y-1.5"><label htmlFor="legacy-status" className="text-sm font-medium">Goal status</label><select id="legacy-status" value={status} onChange={event => setStatus(event.target.value as GoalStatus)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>
+            {status === "active" ? <div className="space-y-3"><p className="text-sm font-medium">Current wallet reservations</p>{wallets.map(wallet => <div key={wallet.accountId} className="space-y-1.5"><label htmlFor={`legacy-${wallet.accountId}`} className="text-sm">Set aside in {wallet.name} (PHP)</label><Input id={`legacy-${wallet.accountId}`} className="min-h-11" inputMode="decimal" value={amounts[wallet.accountId] ?? ""} onChange={event => setAmounts(current => ({ ...current, [wallet.accountId]: event.target.value }))} placeholder="0.00" /><p className="text-xs text-muted-foreground">Available: PHP {wallet.available}</p></div>)}{!wallets.length && !loading && <p className="text-sm text-muted-foreground">No eligible PHP wallet is available. You can confirm with no reservation.</p>}</div> : <p className="text-sm text-muted-foreground">Closed goals add no new reservations.</p>}
+            <div className="space-y-2"><p className="text-sm font-medium">Past spending (optional)</p><p className="text-xs text-muted-foreground">Select actual cash expenses{goal?.category === "debt" ? " or cash payments to a credit card" : ""}. Leave fake savings expenses unchecked.</p>{eligibleHistory.map(transaction => <label key={transaction.id} className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" checked={selectedIds.includes(transaction.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, transaction.id] : ids.filter(id => id !== transaction.id))} /><span className="min-w-0 break-words">{transaction.description || "Cash spending"} · {transaction.date} · PHP {Number(transaction.amount).toFixed(2)}</span></label>)}{!loading && !eligibleHistory.length && <p className="text-sm text-muted-foreground">No eligible past spending. An empty selection is valid.</p>}</div>
+          </fieldset>
+          {!eligibleGoal && !unknown && <p className="text-sm text-muted-foreground">This goal has already been reviewed or is unavailable.</p>}
+          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" className="min-h-11 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300" disabled={pending || (!unknown && (loading || loadError || !eligibleGoal))}>{pending ? "Saving…" : unknown ? "Retry same request" : "Confirm funding review"}</Button></div>
+        </form>}
+      </Dialog.Content>
+    </Dialog.Portal>
+  </Dialog.Root>;
+}
diff --git a/src/components/transactions/AddTransactionModal.tsx b/src/components/transactions/AddTransactionModal.tsx
index c7e02e2..1e268f2 100644
--- a/src/components/transactions/AddTransactionModal.tsx
+++ b/src/components/transactions/AddTransactionModal.tsx
@@ -244,20 +244,24 @@ export default function AddTransactionModal({ isOpen, onClose, defaultAccountId,
   const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
     if (isDataLoading || isLoading || dataError || submit.phase === "saved" || submit.phase === "review") return;
     setFormError("");
     try {
       const exactAmount = parseMoney(amount);
       if (!effectiveAccountId || exactAmount === "0.00") { setFormError("Select a wallet and enter an amount greater than zero."); return; }
       if (type === "transfer" && (!transferToAccountId || transferToAccountId === effectiveAccountId)) { setFormError("Choose a different destination wallet."); return; }
       const cashTransfer = type === "transfer" && !isDebtPayment;
       const selectedGoalId = type === "income" ? null : goalId || null;
+      if (selectedGoalId && financeSnapshot?.goals.find(goal => goal.id === selectedGoalId)?.review_state === "needs_review") {
+        setFormError("Review existing funding on the Goals page before using this goal.");
+        return;
+      }
       await submit.quote({
         type, accountId: effectiveAccountId, transferToAccountId: type === "transfer" ? transferToAccountId : null,
         categoryId: type === "transfer" ? null : categoryId || null, goalId: cashTransfer ? null : selectedGoalId,
         amount: exactAmount, description: description.trim() || (isDebtPayment ? `Debt - ${selectedDebtMonthLabel || debtPaymentMonth}` : null),
         date: isDebtPayment ? `${debtPaymentMonth}-01` : type === "expense" && isPayLater ? `${startMonth}-01` : date,
         installments: type === "expense" && isPayLater ? { count: installments } : null,
         reservationMoves: cashTransfer && selectedGoalId ? [{ goalId: selectedGoalId, amount: parseMoney(carryAmount) }] : [],
       });
     } catch { setFormError("Enter valid amounts with no more than two decimal places."); }
   };
diff --git a/supabase/migrations/202610060005_goal_lifecycle_operations.sql b/supabase/migrations/202610060005_goal_lifecycle_operations.sql
index b25cf74..1ba736f 100644
--- a/supabase/migrations/202610060005_goal_lifecycle_operations.sql
+++ b/supabase/migrations/202610060005_goal_lifecycle_operations.sql
@@ -28,30 +28,54 @@ REVOKE ALL ON FUNCTION public.goal_transaction_apply(uuid,jsonb,jsonb) FROM PUBL
 
 CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE
   v_owner uuid := auth.uid(); v_kind text; v_goal_id uuid; v_target_id uuid; v_transaction_id uuid;
   v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
   v_goal public.goals%ROWTYPE; v_target public.goals%ROWTYPE;
   v_tx public.transactions%ROWTYPE; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
   v_operation uuid; v_result jsonb; v_row record; v_events jsonb := '[]'::jsonb;
   v_reserved numeric; v_delta numeric; v_src_balance numeric; v_dst_balance numeric;
+  v_reservations jsonb := '[]'::jsonb; v_spent_ids jsonb := '[]'::jsonb; v_value jsonb;
 BEGIN
   IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
   v_kind := p_command->>'kind';
   IF v_kind IN ('reserve','release','reallocate','transaction') THEN
     RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
   END IF;
   IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL
-    OR v_kind IS NULL OR v_kind NOT IN ('close','reopen','archive','delete_transaction') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    OR v_kind IS NULL OR v_kind NOT IN ('close','reopen','archive','delete_transaction','adopt_legacy') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   BEGIN
-    IF v_kind='delete_transaction' THEN
+    IF v_kind='adopt_legacy' THEN
+      IF jsonb_typeof(p_command->'goalId') IS DISTINCT FROM 'string'
+        OR jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string' OR p_command->>'status' NOT IN ('active','completed','cancelled')
+        OR jsonb_typeof(p_command->'reservations') IS DISTINCT FROM 'array'
+        OR jsonb_typeof(p_command->'spentTransactionIds') IS DISTINCT FROM 'array'
+        OR p_command - ARRAY['kind','goalId','status','reservations','spentTransactionIds'] <> '{}'::jsonb THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      v_goal_id := (p_command->>'goalId')::uuid;
+      FOR v_value IN SELECT value FROM jsonb_array_elements(p_command->'reservations') LOOP
+        IF jsonb_typeof(v_value->'accountId') IS DISTINCT FROM 'string' OR jsonb_typeof(v_value->'amount') IS DISTINCT FROM 'string'
+          OR v_value - ARRAY['accountId','amount'] <> '{}'::jsonb
+          OR (v_value->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
+          OR (v_value->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        v_reservations := v_reservations || jsonb_build_array(jsonb_build_object('accountId',(v_value->>'accountId')::uuid,'amount',v_value->>'amount'));
+      END LOOP;
+      FOR v_value IN SELECT value FROM jsonb_array_elements(p_command->'spentTransactionIds') LOOP
+        IF jsonb_typeof(v_value)<>'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        v_spent_ids := v_spent_ids || jsonb_build_array((v_value#>>'{}')::uuid);
+      END LOOP;
+      IF (SELECT count(*)<>count(DISTINCT value->>'accountId') FROM jsonb_array_elements(v_reservations))
+        OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v_spent_ids)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      SELECT coalesce(jsonb_agg(value ORDER BY value->>'accountId'),'[]') INTO v_reservations FROM jsonb_array_elements(v_reservations);
+      SELECT coalesce(jsonb_agg(value ORDER BY value#>>'{}'),'[]') INTO v_spent_ids FROM jsonb_array_elements(v_spent_ids);
+      v_command := jsonb_build_object('kind',v_kind,'goalId',v_goal_id,'status',p_command->>'status','reservations',v_reservations,'spentTransactionIds',v_spent_ids);
+    ELSIF v_kind='delete_transaction' THEN
       IF jsonb_typeof(p_command->'transactionId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
       v_transaction_id := (p_command->>'transactionId')::uuid;
       v_command := jsonb_build_object('kind',v_kind,'transactionId',v_transaction_id);
     ELSE
       IF jsonb_typeof(p_command->'goalId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
       v_goal_id := (p_command->>'goalId')::uuid;
       v_command := jsonb_build_object('kind',v_kind,'goalId',v_goal_id);
       IF v_kind='close' THEN
         IF jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string'
           OR p_command->>'status' NOT IN ('completed','cancelled') OR NOT p_command ? 'leftovers' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
@@ -59,34 +83,72 @@ BEGIN
           IF p_command->'leftovers'=jsonb_build_object('mode','release') THEN NULL;
           ELSIF jsonb_typeof(p_command->'leftovers'->'goalId')='string' AND p_command->'leftovers'->>'mode'='move' THEN
             v_target_id := (p_command->'leftovers'->>'goalId')::uuid;
             IF p_command->'leftovers'<>jsonb_build_object('mode','move','goalId',p_command->'leftovers'->>'goalId') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
           ELSE RAISE EXCEPTION 'INVALID_STATE'; END IF;
         END IF;
         v_command := v_command || jsonb_build_object('status',p_command->>'status','leftovers',
           CASE WHEN v_target_id IS NOT NULL THEN jsonb_build_object('mode','move','goalId',v_target_id) ELSE p_command->'leftovers' END);
       END IF;
     END IF;
-    IF p_command<>v_command THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    IF v_kind<>'adopt_legacy' AND p_command<>v_command THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
   v_hash := encode(sha256(convert_to(v_command::text,'UTF8')),'hex');
   PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
   SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
   IF FOUND THEN
     IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
     IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     RETURN v_previous.result || jsonb_build_object('replayed',true);
   END IF;
   PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
   PERFORM id FROM public.accounts WHERE user_id=v_owner ORDER BY id FOR UPDATE;
-  IF v_kind<>'delete_transaction' THEN
+  IF v_kind='adopt_legacy' THEN
+    SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=v_goal_id;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_goal.review_state<>'needs_review' OR v_goal.archived_at IS NOT NULL
+      OR EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal_id)
+      OR (p_command->>'status'<>'active' AND jsonb_array_length(v_reservations)>0) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    FOR v_value IN SELECT value FROM jsonb_array_elements(v_reservations) LOOP
+      SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=(v_value->>'accountId')::uuid;
+      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+      IF v_src.is_active IS DISTINCT FROM true OR v_src.currency IS DISTINCT FROM 'PHP' OR v_src.type='credit_card' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_src.id;
+      IF coalesce(v_src.balance,0)-v_reserved<(v_value->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
+    END LOOP;
+    FOR v_value IN SELECT value FROM jsonb_array_elements(v_spent_ids) LOOP
+      SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=(v_value#>>'{}')::uuid FOR UPDATE;
+      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+      SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
+      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+      IF v_src.type='credit_card' OR v_src.currency IS DISTINCT FROM 'PHP' OR v_src.is_active IS DISTINCT FROM true
+        OR v_tx.amount<=0 OR EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE transaction_id=v_tx.id AND kind IN ('spend','legacy_spent')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      IF v_tx.type='transfer' THEN
+        SELECT * INTO v_dst FROM public.accounts WHERE user_id=v_owner AND id=v_tx.transfer_to_account_id;
+        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+        IF v_goal.category IS DISTINCT FROM 'debt' OR v_dst.type<>'credit_card' OR v_dst.currency IS DISTINCT FROM 'PHP' OR v_dst.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      ELSIF v_tx.type<>'expense' OR v_tx.transfer_to_account_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END LOOP;
+    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
+    FOR v_value IN SELECT value FROM jsonb_array_elements(v_reservations) LOOP
+      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+        VALUES(v_owner,v_goal_id,(v_value->>'accountId')::uuid,v_operation,'reserve',(v_value->>'amount')::numeric);
+    END LOOP;
+    FOR v_value IN SELECT value FROM jsonb_array_elements(v_spent_ids) LOOP
+      SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=(v_value#>>'{}')::uuid;
+      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id)
+        VALUES(v_owner,v_goal_id,v_tx.account_id,v_operation,'legacy_spent',0,v_tx.amount,v_tx.id);
+    END LOOP;
+    UPDATE public.goals SET review_state='confirmed',status=p_command->>'status',is_completed=(p_command->>'status'='completed'),
+      completed_at=CASE WHEN p_command->>'status'='completed' THEN coalesce(completed_at,now()) ELSE NULL END WHERE user_id=v_owner AND id=v_goal_id;
+  ELSIF v_kind<>'delete_transaction' THEN
     SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=v_goal_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
     IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
     IF v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal_id;
     IF v_kind='close' THEN
       IF v_goal.status<>'active' OR (v_reserved>0 AND p_command->'leftovers'='null'::jsonb) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
       IF v_target_id IS NOT NULL THEN
         SELECT * INTO v_target FROM public.goals WHERE user_id=v_owner AND id=v_target_id;
         IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
diff --git a/supabase/migrations/202610060006_goal_write_guards.sql b/supabase/migrations/202610060006_goal_write_guards.sql
new file mode 100644
index 0000000..0ec43bb
--- /dev/null
+++ b/supabase/migrations/202610060006_goal_write_guards.sql
@@ -0,0 +1,79 @@
+BEGIN;
+CREATE UNIQUE INDEX IF NOT EXISTS allocation_legacy_spent_once ON public.goal_allocation_events(transaction_id) WHERE kind='legacy_spent';
+
+REVOKE ALL ON public.transactions,public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
+GRANT SELECT ON public.transactions,public.goal_allocation_events,public.financial_operations TO authenticated;
+REVOKE ALL ON public.accounts,public.goals FROM PUBLIC,anon,authenticated;
+-- Remove column grants left by previous deployments before applying the reviewed allowlist.
+DO $$ DECLARE v_table text; v_columns text; BEGIN
+  FOREACH v_table IN ARRAY ARRAY['accounts','goals','transactions','goal_allocation_events','financial_operations'] LOOP
+    SELECT string_agg(quote_ident(attname),',') INTO v_columns FROM pg_attribute WHERE attrelid=('public.'||v_table)::regclass AND attnum>0 AND NOT attisdropped;
+    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC,anon,authenticated',v_columns,v_table);
+  END LOOP;
+END $$;
+GRANT SELECT ON public.accounts,public.goals TO authenticated;
+GRANT INSERT(user_id,name,type,balance,currency,color,icon,is_active,is_savings,interest_rate,include_in_networth,display_order) ON public.accounts TO authenticated;
+GRANT UPDATE(name,color,icon,display_order,interest_rate,include_in_networth) ON public.accounts TO authenticated;
+GRANT DELETE ON public.accounts TO authenticated;
+GRANT INSERT(user_id,name,target_amount,current_amount,target_date,color,icon,is_completed,is_priority,category,allocation_per_cycle,allocation_frequency) ON public.goals TO authenticated;
+GRANT UPDATE(name,target_amount,target_date,color,icon,is_priority,category,allocation_per_cycle,allocation_frequency) ON public.goals TO authenticated;
+DO $$ DECLARE v_table text; BEGIN
+  FOREACH v_table IN ARRAY ARRAY['accounts','goals','transactions','goal_allocation_events','financial_operations'] LOOP
+    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
+    EXECUTE format('DROP POLICY IF EXISTS finance_owner_boundary ON public.%I',v_table);
+    EXECUTE format('CREATE POLICY finance_owner_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)',v_table);
+  END LOOP;
+END $$;
+
+CREATE OR REPLACE FUNCTION public.guard_financial_identity() RETURNS trigger
+LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+BEGIN
+  IF TG_OP='DELETE' THEN
+    IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
+    IF EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id)
+      OR EXISTS(SELECT 1 FROM public.transactions WHERE account_id=OLD.id OR transfer_to_account_id=OLD.id) THEN
+      RAISE EXCEPTION 'Wallet with financial history cannot be deleted' USING ERRCODE='23503';
+    END IF;
+    RETURN OLD;
+  END IF;
+  IF TG_TABLE_NAME='accounts' AND TG_OP='UPDATE' THEN
+    IF (NEW.id,NEW.user_id,NEW.type,NEW.currency,NEW.is_active) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.type,OLD.currency,OLD.is_active)
+      AND EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id) THEN
+      RAISE EXCEPTION 'Wallet identity with allocation history cannot change' USING ERRCODE='55000';
+    END IF;
+  END IF;
+  RETURN NEW;
+END $$;
+
+CREATE OR REPLACE FUNCTION public.guard_financial_opening() RETURNS trigger
+LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
+BEGIN
+  IF current_user='authenticated' THEN
+    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF TG_TABLE_NAME='accounts' THEN
+      IF NEW.balance IS NULL OR NEW.balance<0 OR NEW.currency IS DISTINCT FROM 'PHP' OR NEW.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    ELSE
+      IF NEW.current_amount IS DISTINCT FROM 0 OR NEW.is_completed IS DISTINCT FROM false OR NEW.status<>'active'
+        OR NEW.review_state<>'confirmed' OR NEW.completed_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END IF;
+  END IF;
+  RETURN NEW;
+END $$;
+DROP TRIGGER IF EXISTS financial_identity_guard ON public.accounts;
+CREATE TRIGGER financial_identity_guard BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_identity();
+DROP TRIGGER IF EXISTS financial_opening_guard ON public.accounts;
+CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
+DROP TRIGGER IF EXISTS financial_opening_guard ON public.goals;
+CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
+
+-- Unknown deployed definer RPCs fail closed until their complete signatures and bodies are reviewed.
+DO $$ DECLARE v_function record; BEGIN
+  FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
+    WHERE n.nspname='public' AND p.prokind='f' AND (p.prosecdef OR p.proname LIKE 'goal_%' OR p.proname LIKE 'guard_financial_%')
+      AND p.oid NOT IN ('public.goal_finance_snapshot()'::regprocedure,'public.goal_transaction_quote(jsonb,jsonb)'::regprocedure,'public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure)
+  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_function.signature); END LOOP;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
+GRANT EXECUTE ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 2818d9a..839296d 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -715,30 +715,54 @@ REVOKE ALL ON FUNCTION public.goal_transaction_apply(uuid,jsonb,jsonb) FROM PUBL
 
 CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE
   v_owner uuid := auth.uid(); v_kind text; v_goal_id uuid; v_target_id uuid; v_transaction_id uuid;
   v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
   v_goal public.goals%ROWTYPE; v_target public.goals%ROWTYPE;
   v_tx public.transactions%ROWTYPE; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
   v_operation uuid; v_result jsonb; v_row record; v_events jsonb := '[]'::jsonb;
   v_reserved numeric; v_delta numeric; v_src_balance numeric; v_dst_balance numeric;
+  v_reservations jsonb := '[]'::jsonb; v_spent_ids jsonb := '[]'::jsonb; v_value jsonb;
 BEGIN
   IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
   v_kind := p_command->>'kind';
   IF v_kind IN ('reserve','release','reallocate','transaction') THEN
     RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
   END IF;
   IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL
-    OR v_kind IS NULL OR v_kind NOT IN ('close','reopen','archive','delete_transaction') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    OR v_kind IS NULL OR v_kind NOT IN ('close','reopen','archive','delete_transaction','adopt_legacy') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   BEGIN
-    IF v_kind='delete_transaction' THEN
+    IF v_kind='adopt_legacy' THEN
+      IF jsonb_typeof(p_command->'goalId') IS DISTINCT FROM 'string'
+        OR jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string' OR p_command->>'status' NOT IN ('active','completed','cancelled')
+        OR jsonb_typeof(p_command->'reservations') IS DISTINCT FROM 'array'
+        OR jsonb_typeof(p_command->'spentTransactionIds') IS DISTINCT FROM 'array'
+        OR p_command - ARRAY['kind','goalId','status','reservations','spentTransactionIds'] <> '{}'::jsonb THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      v_goal_id := (p_command->>'goalId')::uuid;
+      FOR v_value IN SELECT value FROM jsonb_array_elements(p_command->'reservations') LOOP
+        IF jsonb_typeof(v_value->'accountId') IS DISTINCT FROM 'string' OR jsonb_typeof(v_value->'amount') IS DISTINCT FROM 'string'
+          OR v_value - ARRAY['accountId','amount'] <> '{}'::jsonb
+          OR (v_value->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
+          OR (v_value->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        v_reservations := v_reservations || jsonb_build_array(jsonb_build_object('accountId',(v_value->>'accountId')::uuid,'amount',v_value->>'amount'));
+      END LOOP;
+      FOR v_value IN SELECT value FROM jsonb_array_elements(p_command->'spentTransactionIds') LOOP
+        IF jsonb_typeof(v_value)<>'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        v_spent_ids := v_spent_ids || jsonb_build_array((v_value#>>'{}')::uuid);
+      END LOOP;
+      IF (SELECT count(*)<>count(DISTINCT value->>'accountId') FROM jsonb_array_elements(v_reservations))
+        OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v_spent_ids)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      SELECT coalesce(jsonb_agg(value ORDER BY value->>'accountId'),'[]') INTO v_reservations FROM jsonb_array_elements(v_reservations);
+      SELECT coalesce(jsonb_agg(value ORDER BY value#>>'{}'),'[]') INTO v_spent_ids FROM jsonb_array_elements(v_spent_ids);
+      v_command := jsonb_build_object('kind',v_kind,'goalId',v_goal_id,'status',p_command->>'status','reservations',v_reservations,'spentTransactionIds',v_spent_ids);
+    ELSIF v_kind='delete_transaction' THEN
       IF jsonb_typeof(p_command->'transactionId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
       v_transaction_id := (p_command->>'transactionId')::uuid;
       v_command := jsonb_build_object('kind',v_kind,'transactionId',v_transaction_id);
     ELSE
       IF jsonb_typeof(p_command->'goalId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
       v_goal_id := (p_command->>'goalId')::uuid;
       v_command := jsonb_build_object('kind',v_kind,'goalId',v_goal_id);
       IF v_kind='close' THEN
         IF jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string'
           OR p_command->>'status' NOT IN ('completed','cancelled') OR NOT p_command ? 'leftovers' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
@@ -746,34 +770,72 @@ BEGIN
           IF p_command->'leftovers'=jsonb_build_object('mode','release') THEN NULL;
           ELSIF jsonb_typeof(p_command->'leftovers'->'goalId')='string' AND p_command->'leftovers'->>'mode'='move' THEN
             v_target_id := (p_command->'leftovers'->>'goalId')::uuid;
             IF p_command->'leftovers'<>jsonb_build_object('mode','move','goalId',p_command->'leftovers'->>'goalId') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
           ELSE RAISE EXCEPTION 'INVALID_STATE'; END IF;
         END IF;
         v_command := v_command || jsonb_build_object('status',p_command->>'status','leftovers',
           CASE WHEN v_target_id IS NOT NULL THEN jsonb_build_object('mode','move','goalId',v_target_id) ELSE p_command->'leftovers' END);
       END IF;
     END IF;
-    IF p_command<>v_command THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    IF v_kind<>'adopt_legacy' AND p_command<>v_command THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
   v_hash := encode(sha256(convert_to(v_command::text,'UTF8')),'hex');
   PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
   SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
   IF FOUND THEN
     IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
     IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     RETURN v_previous.result || jsonb_build_object('replayed',true);
   END IF;
   PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
   PERFORM id FROM public.accounts WHERE user_id=v_owner ORDER BY id FOR UPDATE;
-  IF v_kind<>'delete_transaction' THEN
+  IF v_kind='adopt_legacy' THEN
+    SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=v_goal_id;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_goal.review_state<>'needs_review' OR v_goal.archived_at IS NOT NULL
+      OR EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal_id)
+      OR (p_command->>'status'<>'active' AND jsonb_array_length(v_reservations)>0) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    FOR v_value IN SELECT value FROM jsonb_array_elements(v_reservations) LOOP
+      SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=(v_value->>'accountId')::uuid;
+      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+      IF v_src.is_active IS DISTINCT FROM true OR v_src.currency IS DISTINCT FROM 'PHP' OR v_src.type='credit_card' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_src.id;
+      IF coalesce(v_src.balance,0)-v_reserved<(v_value->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
+    END LOOP;
+    FOR v_value IN SELECT value FROM jsonb_array_elements(v_spent_ids) LOOP
+      SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=(v_value#>>'{}')::uuid FOR UPDATE;
+      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+      SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
+      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+      IF v_src.type='credit_card' OR v_src.currency IS DISTINCT FROM 'PHP' OR v_src.is_active IS DISTINCT FROM true
+        OR v_tx.amount<=0 OR EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE transaction_id=v_tx.id AND kind IN ('spend','legacy_spent')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      IF v_tx.type='transfer' THEN
+        SELECT * INTO v_dst FROM public.accounts WHERE user_id=v_owner AND id=v_tx.transfer_to_account_id;
+        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+        IF v_goal.category IS DISTINCT FROM 'debt' OR v_dst.type<>'credit_card' OR v_dst.currency IS DISTINCT FROM 'PHP' OR v_dst.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      ELSIF v_tx.type<>'expense' OR v_tx.transfer_to_account_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END LOOP;
+    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
+    FOR v_value IN SELECT value FROM jsonb_array_elements(v_reservations) LOOP
+      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+        VALUES(v_owner,v_goal_id,(v_value->>'accountId')::uuid,v_operation,'reserve',(v_value->>'amount')::numeric);
+    END LOOP;
+    FOR v_value IN SELECT value FROM jsonb_array_elements(v_spent_ids) LOOP
+      SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=(v_value#>>'{}')::uuid;
+      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id)
+        VALUES(v_owner,v_goal_id,v_tx.account_id,v_operation,'legacy_spent',0,v_tx.amount,v_tx.id);
+    END LOOP;
+    UPDATE public.goals SET review_state='confirmed',status=p_command->>'status',is_completed=(p_command->>'status'='completed'),
+      completed_at=CASE WHEN p_command->>'status'='completed' THEN coalesce(completed_at,now()) ELSE NULL END WHERE user_id=v_owner AND id=v_goal_id;
+  ELSIF v_kind<>'delete_transaction' THEN
     SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=v_goal_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
     IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
     IF v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal_id;
     IF v_kind='close' THEN
       IF v_goal.status<>'active' OR (v_reserved>0 AND p_command->'leftovers'='null'::jsonb) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
       IF v_target_id IS NOT NULL THEN
         SELECT * INTO v_target FROM public.goals WHERE user_id=v_owner AND id=v_target_id;
         IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
@@ -868,10 +930,90 @@ BEGIN
   END IF;
   v_result := jsonb_build_object('operationId',v_operation,'transactionIds',
     CASE WHEN v_kind='delete_transaction' THEN jsonb_build_array(v_transaction_id) ELSE '[]'::jsonb END,'replayed',false);
   UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE user_id=v_owner AND id=v_operation;
   RETURN v_result;
 END $$;
 REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
 NOTIFY pgrst, 'reload schema';
 COMMIT;
+
+BEGIN;
+CREATE UNIQUE INDEX IF NOT EXISTS allocation_legacy_spent_once ON public.goal_allocation_events(transaction_id) WHERE kind='legacy_spent';
+
+REVOKE ALL ON public.transactions,public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
+GRANT SELECT ON public.transactions,public.goal_allocation_events,public.financial_operations TO authenticated;
+REVOKE ALL ON public.accounts,public.goals FROM PUBLIC,anon,authenticated;
+-- Remove column grants left by previous deployments before applying the reviewed allowlist.
+DO $$ DECLARE v_table text; v_columns text; BEGIN
+  FOREACH v_table IN ARRAY ARRAY['accounts','goals','transactions','goal_allocation_events','financial_operations'] LOOP
+    SELECT string_agg(quote_ident(attname),',') INTO v_columns FROM pg_attribute WHERE attrelid=('public.'||v_table)::regclass AND attnum>0 AND NOT attisdropped;
+    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC,anon,authenticated',v_columns,v_table);
+  END LOOP;
+END $$;
+GRANT SELECT ON public.accounts,public.goals TO authenticated;
+GRANT INSERT(user_id,name,type,balance,currency,color,icon,is_active,is_savings,interest_rate,include_in_networth,display_order) ON public.accounts TO authenticated;
+GRANT UPDATE(name,color,icon,display_order,interest_rate,include_in_networth) ON public.accounts TO authenticated;
+GRANT DELETE ON public.accounts TO authenticated;
+GRANT INSERT(user_id,name,target_amount,current_amount,target_date,color,icon,is_completed,is_priority,category,allocation_per_cycle,allocation_frequency) ON public.goals TO authenticated;
+GRANT UPDATE(name,target_amount,target_date,color,icon,is_priority,category,allocation_per_cycle,allocation_frequency) ON public.goals TO authenticated;
+DO $$ DECLARE v_table text; BEGIN
+  FOREACH v_table IN ARRAY ARRAY['accounts','goals','transactions','goal_allocation_events','financial_operations'] LOOP
+    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
+    EXECUTE format('DROP POLICY IF EXISTS finance_owner_boundary ON public.%I',v_table);
+    EXECUTE format('CREATE POLICY finance_owner_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)',v_table);
+  END LOOP;
+END $$;
+
+CREATE OR REPLACE FUNCTION public.guard_financial_identity() RETURNS trigger
+LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+BEGIN
+  IF TG_OP='DELETE' THEN
+    IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
+    IF EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id)
+      OR EXISTS(SELECT 1 FROM public.transactions WHERE account_id=OLD.id OR transfer_to_account_id=OLD.id) THEN
+      RAISE EXCEPTION 'Wallet with financial history cannot be deleted' USING ERRCODE='23503';
+    END IF;
+    RETURN OLD;
+  END IF;
+  IF TG_TABLE_NAME='accounts' AND TG_OP='UPDATE' THEN
+    IF (NEW.id,NEW.user_id,NEW.type,NEW.currency,NEW.is_active) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.type,OLD.currency,OLD.is_active)
+      AND EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id) THEN
+      RAISE EXCEPTION 'Wallet identity with allocation history cannot change' USING ERRCODE='55000';
+    END IF;
+  END IF;
+  RETURN NEW;
+END $$;
+
+CREATE OR REPLACE FUNCTION public.guard_financial_opening() RETURNS trigger
+LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
+BEGIN
+  IF current_user='authenticated' THEN
+    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF TG_TABLE_NAME='accounts' THEN
+      IF NEW.balance IS NULL OR NEW.balance<0 OR NEW.currency IS DISTINCT FROM 'PHP' OR NEW.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    ELSE
+      IF NEW.current_amount IS DISTINCT FROM 0 OR NEW.is_completed IS DISTINCT FROM false OR NEW.status<>'active'
+        OR NEW.review_state<>'confirmed' OR NEW.completed_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END IF;
+  END IF;
+  RETURN NEW;
+END $$;
+DROP TRIGGER IF EXISTS financial_identity_guard ON public.accounts;
+CREATE TRIGGER financial_identity_guard BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_identity();
+DROP TRIGGER IF EXISTS financial_opening_guard ON public.accounts;
+CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
+DROP TRIGGER IF EXISTS financial_opening_guard ON public.goals;
+CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
+
+-- Unknown deployed definer RPCs fail closed until their complete signatures and bodies are reviewed.
+DO $$ DECLARE v_function record; BEGIN
+  FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
+    WHERE n.nspname='public' AND p.prokind='f' AND (p.prosecdef OR p.proname LIKE 'goal_%' OR p.proname LIKE 'guard_financial_%')
+      AND p.oid NOT IN ('public.goal_finance_snapshot()'::regprocedure,'public.goal_transaction_quote(jsonb,jsonb)'::regprocedure,'public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure)
+  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_function.signature); END LOOP;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
+GRANT EXECUTE ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/tests/database/migration-security.test.mjs b/tests/database/migration-security.test.mjs
new file mode 100644
index 0000000..afcc12b
--- /dev/null
+++ b/tests/database/migration-security.test.mjs
@@ -0,0 +1,192 @@
+import assert from 'node:assert/strict';
+import { before, test } from 'node:test';
+import { randomUUID } from 'node:crypto';
+import { readFile } from 'node:fs/promises';
+import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';
+
+before(async () => {
+  for (const name of ['004_goal_transaction_operations', '005_goal_lifecycle_operations', '006_goal_write_guards']) {
+    try { await applyMigration(`202610060${name}.sql`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
+  }
+});
+async function setup(t) { const f = await createFinanceFixture(); t.after(() => cleanupFinanceFixture(f)); return f; }
+const apply = (f, command, request = randomUUID()) => f.owner.client.rpc('goal_finance_apply', { p_request_id: request, p_command: command });
+const snap = async f => requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
+const totals = (f, s) => s.goals.find(g => g.goalId === f.owner.goal.id);
+const wallet = (f, s) => s.wallets.find(w => w.accountId === f.owner.account.id);
+async function legacy(f, category = 'tech') {
+  requireSuccess(await f.admin.from('goals').update({ review_state: 'needs_review', current_amount: 2000, category }).eq('id', f.owner.goal.id));
+}
+async function tx(f, overrides = {}) {
+  return requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: f.owner.account.id, goal_id: f.owner.goal.id, type: 'expense', amount: 2000, date: '2026-10-01', ...overrides }).select().single());
+}
+const command = (f, overrides = {}) => ({ kind: 'adopt_legacy', goalId: f.owner.goal.id, status: 'active', reservations: [], spentTransactionIds: [], ...overrides });
+
+test('legacy review keeps old tags and balances; importing cash spending never charges twice and deletion restores no reservation', async t => {
+  const f = await setup(t); await legacy(f); const old = await tx(f);
+  const before = await snap(f);
+  assert.equal(totals(f, before).reserved, '0.00');
+  const request = randomUUID(), c = command(f, { spentTransactionIds: [old.id] });
+  const result = requireSuccess(await apply(f, c, request));
+  const after = await snap(f);
+  assert.equal(wallet(f, after).actual, wallet(f, before).actual);
+  assert.equal(totals(f, after).spent, '2000.00');
+  assert.equal(requireSuccess(await f.owner.client.from('transactions').select('*').eq('id', old.id).single()).goal_id, old.goal_id);
+  assert.equal(requireSuccess(await f.owner.client.from('goals').select('*').eq('id', f.owner.goal.id).single()).current_amount, 2000);
+  assert.deepEqual(requireSuccess(await apply(f, c, request)), { ...result, replayed: true });
+  assert.equal((await apply(f, c)).error?.message, 'INVALID_STATE');
+  requireSuccess(await apply(f, { kind: 'delete_transaction', transactionId: old.id }));
+  const afterDeletion = await snap(f);
+  assert.equal(totals(f, afterDeletion).spent, '0.00');
+  assert.equal(totals(f, afterDeletion).reserved, '0.00');
+  assert.deepEqual(requireSuccess(await apply(f, c, request)), { ...result, replayed: true });
+});
+
+test('review uses current available cash, allows empty history and blocks completed reservations, foreign IDs and repeated imports', async t => {
+  const f = await setup(t); await legacy(f);
+  const old = await tx(f);
+  const foreign = await tx(f, { user_id: f.other.id, account_id: f.other.account.id, goal_id: f.other.goal.id });
+  assert.equal((await apply(f, command(f, { goalId: f.other.goal.id }))).error?.message, 'NOT_ALLOWED');
+  assert.equal((await apply(f, command(f, { spentTransactionIds: [foreign.id] }))).error?.message, 'NOT_ALLOWED');
+  assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '30000.01' }] }))).error?.message, 'INSUFFICIENT_AVAILABLE');
+  assert.equal((await apply(f, command(f, { status: 'completed', reservations: [{ accountId: f.owner.account.id, amount: '1.00' }] }))).error?.message, 'INVALID_STATE');
+  assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.other.account.id, amount: '1.00' }] }))).error?.message, 'NOT_ALLOWED');
+  assert.equal((await apply(f, command(f, { spentTransactionIds: [randomUUID()] }))).error?.message, 'NOT_ALLOWED');
+  requireSuccess(await apply(f, command(f, { status: 'completed', spentTransactionIds: [old.id] })));
+  assert.equal(totals(f, await snap(f)).reserved, '0.00');
+  const otherGoal = requireSuccess(await f.admin.from('goals').insert({ user_id: f.owner.id, name: 'Other', target_amount: 5000, review_state: 'needs_review' }).select().single());
+  assert.equal((await apply(f, command(f, { goalId: otherGoal.id, spentTransactionIds: [old.id] }))).error?.message, 'INVALID_STATE');
+  requireSuccess(await apply(f, command(f, { goalId: otherGoal.id })));
+});
+
+test('only cash expenses and cash-to-card debt payments qualify, with exact cents and transactional rollback', async t => {
+  const f = await setup(t); await legacy(f, 'debt');
+  const card = requireSuccess(await f.admin.from('accounts').insert({ user_id: f.owner.id, name: 'Card', type: 'credit_card', balance: 2000 }).select().single());
+  for (const overrides of [{ type: 'credit_card' }, { currency: 'USD' }, { is_active: false }]) {
+    const ineligible = requireSuccess(await f.admin.from('accounts').insert({ user_id: f.owner.id, name: 'Ineligible', type: 'cash', balance: 2000, ...overrides }).select().single());
+    assert.equal((await apply(f, command(f, { reservations: [{ accountId: ineligible.id, amount: '0.01' }] }))).error?.message, 'INVALID_STATE');
+  }
+  const alreadyCounted = await tx(f);
+  assert.equal((await apply(f, command(f, { spentTransactionIds: [alreadyCounted.id, alreadyCounted.id] }))).error?.message, 'INVALID_STATE');
+  for (const overrides of [{ type: 'income' }, { type: 'transfer', transfer_to_account_id: f.owner.account.id }, { account_id: card.id }]) {
+    const invalid = await tx(f, overrides);
+    assert.equal((await apply(f, command(f, { spentTransactionIds: [invalid.id] }))).error?.message, 'INVALID_STATE');
+  }
+  assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '1.001' }] }))).error?.message, 'INVALID_STATE');
+  const payment = await tx(f, { type: 'transfer', transfer_to_account_id: card.id });
+  requireSuccess(await apply(f, command(f, { spentTransactionIds: [payment.id], reservations: [{ accountId: f.owner.account.id, amount: '0.01' }] })));
+  assert.equal(totals(f, await snap(f)).reserved, '0.01');
+  assert.equal(totals(f, await snap(f)).spent, '2000.00');
+});
+
+test('authenticated direct finance writes fail while safe metadata, targets, owner reads and opening wallets work', async t => {
+  const f = await setup(t);
+  const inserted = await tx(f);
+  for (const action of [
+    f.owner.client.from('transactions').insert({ user_id: f.owner.id, account_id: f.owner.account.id, type: 'expense', amount: 1, date: '2026-10-01' }),
+    f.owner.client.from('transactions').update({ amount: 1 }).eq('id', inserted.id),
+    f.owner.client.from('transactions').delete().eq('id', inserted.id),
+    f.owner.client.from('financial_operations').insert({ user_id: f.owner.id, request_id: randomUUID(), command_hash: 'a'.repeat(64), command: {} }),
+    f.owner.client.from('goal_allocation_events').insert({}),
+  ]) assert.equal((await action).error?.code, '42501');
+  for (const values of [{ balance: 1 }, { type: 'credit_card' }, { currency: 'USD' }, { user_id: f.other.id }, { id: randomUUID() }, { is_active: false }]) {
+    assert.ok((await f.owner.client.from('accounts').update(values).eq('id', f.owner.account.id)).error);
+  }
+  for (const values of [{ status: 'completed' }, { is_completed: true }, { current_amount: 1 }, { archived_at: new Date().toISOString() }, { review_state: 'needs_review' }, { user_id: f.other.id }, { id: randomUUID() }]) {
+    assert.ok((await f.owner.client.from('goals').update(values).eq('id', f.owner.goal.id)).error);
+  }
+  requireSuccess(await f.owner.client.from('accounts').update({ name: 'Renamed', color: '#123456', icon: 'wallet', display_order: 3, interest_rate: 1, include_in_networth: false }).eq('id', f.owner.account.id));
+  requireSuccess(await apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '1000.00' }));
+  const operation = requireSuccess(await f.owner.client.from('financial_operations').select('id').eq('user_id', f.owner.id).single());
+  const event = requireSuccess(await f.owner.client.from('goal_allocation_events').select('id').eq('user_id', f.owner.id).single());
+  for (const [table, id, patch] of [['financial_operations', operation.id, { result: {} }], ['goal_allocation_events', event.id, { reserved_delta: 0 }]]) {
+    assert.equal((await f.owner.client.from(table).update(patch).eq('id', id)).error?.code, '42501');
+    assert.equal((await f.owner.client.from(table).delete().eq('id', id)).error?.code, '42501');
+  }
+  requireSuccess(await f.owner.client.from('goals').update({ target_amount: 2000 }).eq('id', f.owner.goal.id));
+  assert.equal(totals(f, await snap(f)).progressPercent, 50);
+  assert.equal(wallet(f, await snap(f)).actual, '30000.00');
+  assert.ok((await f.owner.client.from('accounts').delete().eq('id', f.owner.account.id)).error);
+  assert.ok((await f.owner.client.from('goals').delete().eq('id', f.owner.goal.id)).error);
+  const empty = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'New', type: 'cash', balance: 10, currency: 'PHP' }).select().single());
+  requireSuccess(await f.owner.client.from('accounts').delete().eq('id', empty.id));
+  assert.deepEqual(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', f.other.account.id)), []);
+  assert.ok((await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Forged', target_amount: 1, status: 'completed' })).error);
+});
+
+test('standalone guards reapply safely and revoke a known disposable old definer deletion RPC', async t => {
+  const f = await setup(t), old = await tx(f), { queryAdmin } = await databaseRuntime();
+  await queryAdmin(`CREATE FUNCTION public.task10_fixture_old_delete(p_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DELETE FROM public.transactions WHERE id=p_id $$; GRANT EXECUTE ON FUNCTION public.task10_fixture_old_delete(uuid) TO authenticated`);
+  try {
+    await queryAdmin("NOTIFY pgrst, 'reload schema'");
+    for (let attempt = 0; attempt < 20; attempt++) {
+      const visible = await f.owner.client.rpc('task10_fixture_old_delete', { p_id: randomUUID() });
+      if (!visible.error) break;
+      if (attempt === 19 || visible.error.code !== 'PGRST202') requireSuccess(visible);
+      await new Promise(resolve => setTimeout(resolve, 100));
+    }
+    await applyMigration('202610060006_goal_write_guards.sql');
+    await applyMigration('202610060006_goal_write_guards.sql');
+    const grants = await queryAdmin("SELECT to_regprocedure('public.task10_fixture_old_delete(uuid)') IS NOT NULL AS present,has_function_privilege('authenticated','public.task10_fixture_old_delete(uuid)','EXECUTE') AS authenticated,has_function_privilege('anon','public.task10_fixture_old_delete(uuid)','EXECUTE') AS anon,has_function_privilege('service_role','public.task10_fixture_old_delete(uuid)','EXECUTE') AS service");
+    assert.deepEqual(grants, [{ present: true, authenticated: false, anon: false, service: false }]);
+    const blocked = await f.owner.client.rpc('task10_fixture_old_delete', { p_id: old.id });
+    assert.ok(['42501','PGRST202'].includes(blocked.error?.code));
+    assert.equal(requireSuccess(await f.owner.client.from('transactions').select('id').eq('id', old.id)).length, 1);
+    requireSuccess(await apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '0.01' }));
+  } finally { await queryAdmin('DROP FUNCTION public.task10_fixture_old_delete(uuid)'); }
+});
+
+test('review serializes competing reservations and duplicate request replay without overbooking', async t => {
+  const f = await setup(t); await legacy(f);
+  const next = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: 30000 }).select().single());
+  const outcomes = await Promise.all([
+    apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '20000.00' }] })),
+    apply(f, { kind: 'reserve', goalId: next.id, accountId: f.owner.account.id, amount: '20000.00' }),
+  ]);
+  assert.equal(outcomes.filter(result => !result.error).length, 1);
+  assert.equal(outcomes.find(result => result.error)?.error.message, 'INSUFFICIENT_AVAILABLE');
+  assert.equal(wallet(f, await snap(f)).reserved, '20000.00');
+  const duplicate = await setup(t); await legacy(duplicate);
+  const request = randomUUID(), c = command(duplicate, { reservations: [{ accountId: duplicate.owner.account.id, amount: '0.01' }] });
+  const results = (await Promise.all([apply(duplicate, c, request), apply(duplicate, c, request)])).map(result => requireSuccess(result));
+  assert.equal(results[0].operationId, results[1].operationId);
+  assert.equal(results.filter(result => result.replayed).length, 1);
+  assert.equal(totals(duplicate, await snap(duplicate)).reserved, '0.01');
+});
+
+test('a late import failure rolls back review state, operations, reservations, spending and actual balances', async t => {
+  const f = await setup(t); await legacy(f); const old = await tx(f), { queryAdmin } = await databaseRuntime();
+  const before = await snap(f);
+  const rows = async () => Promise.all(['goals','accounts','transactions','financial_operations','goal_allocation_events'].map(async table => requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id).order('id'))));
+  const initial = await rows();
+  await queryAdmin(`CREATE FUNCTION public.task10_reject_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.goal_id='${f.owner.goal.id}'::uuid AND NEW.kind='legacy_spent' THEN RAISE EXCEPTION 'late_import_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER task10_reject_import BEFORE INSERT ON public.goal_allocation_events FOR EACH ROW EXECUTE FUNCTION public.task10_reject_import()`);
+  try {
+    assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '1000.00' }], spentTransactionIds: [old.id] }))).error?.message, 'late_import_failure');
+    assert.deepEqual(await rows(), initial); assert.deepEqual(await snap(f), before);
+  } finally { await queryAdmin('DROP TRIGGER task10_reject_import ON public.goal_allocation_events; DROP FUNCTION public.task10_reject_import()'); }
+});
+
+test('fake savings are not auto-reversed and cannot reserve money absent from the current wallet', async t => {
+  const f = await setup(t); await legacy(f); const fake = await tx(f);
+  requireSuccess(await f.admin.from('accounts').update({ balance: 0 }).eq('id', f.owner.account.id));
+  assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '0.01' }] }))).error?.message, 'INSUFFICIENT_AVAILABLE');
+  requireSuccess(await apply(f, command(f)));
+  assert.equal(wallet(f, await snap(f)).actual, '0.00');
+  assert.equal(totals(f, await snap(f)).spent, '0.00');
+  assert.equal(requireSuccess(await f.owner.client.from('transactions').select('id').eq('id', fake.id)).length, 1);
+});
+
+test('ordered migrations and reproducible schema preserve imported history and finish with secure grants', async t => {
+  const f = await setup(t); await legacy(f); const old = await tx(f);
+  const c = command(f, { spentTransactionIds: [old.id] }), request = randomUUID();
+  const result = requireSuccess(await apply(f, c, request));
+  for (let pass = 0; pass < 2; pass++) for (const name of ['001_runtime_baseline','002_goal_allocation_ledger','003_goal_reservation_operations','004_goal_transaction_operations','005_goal_lifecycle_operations','006_goal_write_guards']) await applyMigration(`202610060${name}.sql`);
+  const { queryAdmin } = await databaseRuntime();
+  await queryAdmin(await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
+  await queryAdmin("NOTIFY pgrst, 'reload schema'");
+  assert.deepEqual(requireSuccess(await apply(f, c, request)), { ...result, replayed: true });
+  assert.equal(totals(f, await snap(f)).spent, '2000.00');
+  assert.ok((await f.owner.client.from('accounts').update({ balance: 1 }).eq('id', f.owner.account.id)).error);
+  const denied = await queryAdmin("SELECT has_table_privilege('authenticated','public.transactions','INSERT') AS tx,has_column_privilege('authenticated','public.accounts','balance','UPDATE') AS balance,has_column_privilege('authenticated','public.goals','status','UPDATE') AS lifecycle,has_function_privilege('authenticated','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS helper");
+  assert.deepEqual(denied, [{ tx: false, balance: false, lifecycle: false, helper: false }]);
+});
diff --git a/tests/database/reservations.test.mjs b/tests/database/reservations.test.mjs
index 3cb3d55..57431a8 100644
--- a/tests/database/reservations.test.mjs
+++ b/tests/database/reservations.test.mjs
@@ -1,29 +1,32 @@
 import assert from 'node:assert/strict';
-import { before, test } from 'node:test';
+import { after, before, test } from 'node:test';
 import { randomUUID } from 'node:crypto';
 import { createClient } from '@supabase/supabase-js';
 import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';
 
 before(async () => {
   await applyMigration('202610060003_goal_reservation_operations.sql');
   const { admin } = await databaseRuntime();
   for (let attempt = 0; attempt < 50; attempt++) {
     const result = await admin.rpc('goal_finance_snapshot');
     if (result.error?.code !== 'PGRST202') {
       assert.equal(result.error?.message, 'NOT_ALLOWED');
       return;
     }
     await new Promise(resolve => setTimeout(resolve, 100));
   }
   throw new Error('PostgREST did not reload goal_finance_snapshot');
 });
+after(async () => {
+  for (const filename of ['202610060004_goal_transaction_operations.sql','202610060005_goal_lifecycle_operations.sql','202610060006_goal_write_guards.sql']) await applyMigration(filename);
+});
 
 async function setup(t) {
   const fixture = await createFinanceFixture();
   t.after(() => cleanupFinanceFixture(fixture));
   return fixture;
 }
 const command = (f, kind = 'reserve', amount = '5000.00', overrides = {}) => ({
   kind, goalId: f.owner.goal.id, accountId: f.owner.account.id, amount, ...overrides,
 });
 const apply = (f, cmd, requestId = randomUUID(), quote = null) => f.owner.client.rpc('goal_finance_apply', {
@@ -79,37 +82,37 @@ test('foreign and missing account/goal references fail without writes', async t
   const f = await setup(t);
   for (const overrides of [{ accountId: f.other.account.id }, { goalId: f.other.goal.id }, { accountId: randomUUID() }, { goalId: randomUUID() }]) {
     await expectFailure(f, command(f, 'reserve', '1.00', overrides), 'NOT_ALLOWED');
   }
   await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: f.other.goal.id }), 'NOT_ALLOWED');
 });
 
 test('credit, non-PHP and inactive wallets cannot be reserved', async t => {
   const f = await setup(t);
   for (const overrides of [{ type: 'credit_card' }, { currency: 'USD' }, { is_active: false }]) {
-    const wallet = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Ineligible', type: 'cash', balance: '30000.00', ...overrides }).select().single());
+    const wallet = requireSuccess(await f.admin.from('accounts').insert({ user_id: f.owner.id, name: 'Ineligible', type: 'cash', balance: '30000.00', ...overrides }).select().single());
     await expectFailure(f, command(f, 'reserve', '1.00', { accountId: wallet.id }), 'NOT_ALLOWED');
   }
 });
 
 test('closed, archived and unreviewed goals reject allocation changes', async t => {
   const f = await setup(t);
   for (const [patch, error] of [[{ status: 'completed' }, 'INVALID_STATE'], [{ status: 'cancelled' }, 'INVALID_STATE'], [{ archived_at: '2026-10-06T00:00:00Z' }, 'INVALID_STATE'], [{ review_state: 'needs_review' }, 'NEEDS_REVIEW']]) {
     requireSuccess(await f.admin.from('goals').update({ status: 'active', archived_at: null, review_state: 'confirmed', ...patch }).eq('id', f.owner.goal.id));
     for (const kind of ['reserve', 'release', 'reallocate']) await expectFailure(f, command(f, kind, '1.00', kind === 'reallocate' ? { destinationGoalId: f.owner.goal.id } : {}), error);
   }
 });
 
 test('reallocation validates destination and rejects moving to the same goal', async t => {
   const f = await setup(t);
   requireSuccess(await apply(f, command(f)));
-  const destination = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Closed', target_amount: '1000.00', status: 'completed' }).select().single());
+  const destination = requireSuccess(await f.admin.from('goals').insert({ user_id: f.owner.id, name: 'Closed', target_amount: '1000.00', status: 'completed' }).select().single());
   await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: destination.id }), 'INVALID_STATE');
   requireSuccess(await f.admin.from('goals').update({ status: 'active', review_state: 'needs_review' }).eq('id', destination.id));
   await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: destination.id }), 'NEEDS_REVIEW');
   await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: f.owner.goal.id }), 'INVALID_STATE');
 });
 
 test('insufficient availability and excessive release or move roll back', async t => {
   const f = await setup(t);
   requireSuccess(await apply(f, command(f)));
   await expectFailure(f, command(f, 'reserve', '25000.01'), 'INSUFFICIENT_AVAILABLE');
@@ -153,21 +156,21 @@ test('concurrent duplicate requests append a single event', async t => {
   assert.equal(values[0].operationId, values[1].operationId);
   assert.deepEqual(values.map(v => v.replayed).sort(), [false, true]);
   const [operations, events] = await counts(f);
   assert.equal(operations.length, 1);
   assert.equal(events.length, 1);
 });
 
 test('snapshot is owned, read-only, retains archived metadata and separates legacy tags', async t => {
   const f = await setup(t);
   requireSuccess(await f.admin.from('goals').update({ review_state: 'needs_review', current_amount: '999.99' }).eq('id', f.owner.goal.id));
-  const archived = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Historical name', target_amount: '5000.00', status: 'cancelled', archived_at: '2026-10-06T00:00:00Z' }).select().single());
+  const archived = requireSuccess(await f.admin.from('goals').insert({ user_id: f.owner.id, name: 'Historical name', target_amount: '5000.00', status: 'cancelled', archived_at: '2026-10-06T00:00:00Z' }).select().single());
   for (const [type, amount] of [['expense', '123.45'], ['transfer', '76.55'], ['income', '500.00']]) {
     requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: f.owner.account.id, goal_id: f.owner.goal.id, type, amount, date: '2026-10-06' }));
   }
   const before = await counts(f);
   const row = requireSuccess(await f.admin.from('goals').select('*').eq('id', f.owner.goal.id).single());
   const state = await snapshot(f);
   assert.equal(state.goals.length, 2);
   assert.equal(state.wallets.length, 1);
   assert.equal(state.goals.find(g => g.id === archived.id).name, 'Historical name');
   const legacy = state.goals.find(g => g.id === f.owner.goal.id);
diff --git a/tests/legacy-goals.test.tsx b/tests/legacy-goals.test.tsx
new file mode 100644
index 0000000..6bd950a
--- /dev/null
+++ b/tests/legacy-goals.test.tsx
@@ -0,0 +1,107 @@
+import React from "react";
+import { afterEach, beforeEach, expect, test, vi } from "vitest";
+import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
+import userEvent from "@testing-library/user-event";
+
+const state = vi.hoisted(() => ({ apply: vi.fn(), refresh: vi.fn(), quote: vi.fn(), reset: vi.fn(), readError: null as any, history: [] as any[], accounts: [] as any[], goal: null as any, wallets: [] as any[] }));
+vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ goals: [state.goal], userId: "10000000-0000-4000-8000-000000000001", financeSnapshot: { goals: [state.goal], wallets: state.wallets }, refresh: state.refresh, isLoading: false, isError: null }), getProjection: () => ({ count: 1, unit: "months", projectedDate: null }) }));
+vi.mock("@/hooks/use-goal-finance", () => ({ useGoalWalletMetadata: () => ({ data: state.accounts, isLoading: false, error: null, refresh: state.refresh }) }));
+vi.mock("@/lib/refresh-financial-data", () => ({ applyAndRefreshFinancialCommand: state.apply }));
+vi.mock("@/hooks/use-transaction-submit", () => ({ useTransactionSubmit: () => ({ phase: "editing", reset: state.reset, quote: state.quote }) }));
+vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "10000000-0000-4000-8000-000000000001" } } }) }, from: (table: string) => {
+  const q: any = { select: () => q, eq: () => q, order: () => q, then: (resolve: any) => Promise.resolve({ data: table === "transactions" ? state.history : table === "accounts" ? state.accounts : [], error: state.readError }).then(resolve) }; return q;
+} }) }));
+import { LegacyGoalReviewDialog } from "@/components/goals/LegacyGoalReviewDialog";
+import { GoalCard } from "@/components/goals/GoalCard";
+import { FinancialCommandError } from "@/lib/goals/client";
+import AddTransactionModal from "@/components/transactions/AddTransactionModal";
+
+const goalId = "20000000-0000-4000-8000-000000000002", accountId = "30000000-0000-4000-8000-000000000003";
+beforeEach(() => {
+  vi.clearAllMocks(); state.readError = null;
+  state.goal = { id: goalId, name: "Laptop", review_state: "needs_review", status: "active", archived_at: null, category: "tech", target_amount: 5000, reserved: "0.00", spent: "0.00", walletReservations: [], progressPercent: 0, legacyTaggedAmount: "2000.00", financeAmounts: { target: "5000.00", progress: "0.00", allocationPerCycle: "0.00" } };
+  state.accounts = [{ id: accountId, name: "GCash", type: "e_wallet", currency: "PHP", is_active: true }, { id: "card", name: "Card", type: "credit_card", currency: "PHP", is_active: true }];
+  state.wallets = [{ accountId, actual: "3000.00", reserved: "0.00", available: "3000.00" }];
+  state.history = [{ id: "40000000-0000-4000-8000-000000000004", account_id: accountId, type: "expense", amount: 2000, description: "Laptop purchase", date: "2026-10-01", transfer_to_account_id: null }, { id: "credit", account_id: "card", type: "expense", amount: 2000, description: "Installment purchase", date: "2026-10-01" }, { id: "transfer", account_id: accountId, type: "transfer", amount: 2000, description: "Cash transfer", transfer_to_account_id: accountId, date: "2026-10-01" }];
+  state.apply.mockResolvedValue({ refreshError: null }); state.refresh.mockResolvedValue(undefined);
+});
+afterEach(cleanup);
+const renderDialog = () => render(<LegacyGoalReviewDialog goalId={goalId} open onOpenChange={vi.fn()} />);
+
+test('unreviewed goal opens review and cannot spend or reserve legacy tagged money', async () => {
+  const review = vi.fn();
+  render(<GoalCard goal={state.goal} onReview={review} onEdit={vi.fn()} onDelete={vi.fn()} onToggleComplete={vi.fn()} onContribute={vi.fn()} onReserve={vi.fn()} onRelease={vi.fn()} onMove={vi.fn()} onHistory={vi.fn()} />);
+  await userEvent.click(screen.getByRole("button", { name: "Review existing funding" }));
+  expect(review).toHaveBeenCalledWith(goalId);
+  expect(screen.queryByRole("button", { name: "Set aside" })).toBeNull();
+  expect(screen.queryByRole("button", { name: "Spend from goal" })).toBeNull();
+});
+
+test('review explains fake savings correction and only imports explicitly selected cash spending', async () => {
+  renderDialog();
+  await screen.findByRole("checkbox", { name: /Laptop purchase/ });
+  expect(screen.getByText(/normal transaction correction/i)).toBeTruthy();
+  expect(screen.queryByRole("checkbox", { name: /Installment purchase/ })).toBeNull();
+  expect(screen.queryByRole("checkbox", { name: /Cash transfer/ })).toBeNull();
+  fireEvent.change(screen.getByLabelText("Set aside in GCash (PHP)"), { target: { value: "3000.01" } });
+  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
+  expect(state.apply).not.toHaveBeenCalled();
+  expect(screen.getByRole("alert").textContent).toMatch(/available/);
+  fireEvent.change(screen.getByLabelText("Set aside in GCash (PHP)"), { target: { value: "500.01" } });
+  await userEvent.click(screen.getByRole("checkbox", { name: /Laptop purchase/ }));
+  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
+  expect(state.apply.mock.calls[0][1]).toEqual({ kind: "adopt_legacy", goalId, status: "active", reservations: [{ accountId, amount: "500.01" }], spentTransactionIds: [state.history[0].id] });
+});
+
+test('completed review submits zero reservations and optional empty history', async () => {
+  renderDialog(); await screen.findByRole("checkbox", { name: /Laptop purchase/ });
+  fireEvent.change(screen.getByLabelText("Goal status"), { target: { value: "completed" } });
+  expect(screen.queryByLabelText("Set aside in GCash (PHP)")).toBeNull();
+  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
+  expect(state.apply.mock.calls[0][1]).toEqual({ kind: "adopt_legacy", goalId, status: "completed", reservations: [], spentTransactionIds: [] });
+});
+
+test('history errors block confirmation and unknown outcomes retry the same request with frozen selections', async () => {
+  state.readError = { message: "Failed" };
+  const view = renderDialog();
+  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm funding review" }).hasAttribute("disabled")).toBe(true));
+  expect(state.apply).not.toHaveBeenCalled(); view.unmount(); state.readError = null;
+  state.apply.mockRejectedValueOnce(new FinancialCommandError({ message: "Lost response", outcome: "unknown" }));
+  renderDialog(); await screen.findByRole("checkbox", { name: /Laptop purchase/ });
+  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
+  await userEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
+  expect(state.apply.mock.calls[1][0]).toBe(state.apply.mock.calls[0][0]);
+  expect(state.apply.mock.calls[1][1]).toEqual(state.apply.mock.calls[0][1]);
+});
+
+test('transaction dialog blocks an unreviewed default goal before requesting a quote', async () => {
+  render(<AddTransactionModal isOpen defaultGoalId={goalId} onClose={vi.fn()} />);
+  await screen.findByRole("option", { name: "GCash" });
+  fireEvent.change(screen.getByLabelText("Account"), { target: { value: accountId } });
+  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
+  await userEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
+  expect(state.quote).not.toHaveBeenCalled();
+  expect(screen.getByRole("alert").textContent).toMatch(/Review existing funding/);
+});
+
+test('an unknown review reopened for another goal identifies and retries the original review', async () => {
+  state.apply.mockRejectedValueOnce(new FinancialCommandError({ message: "Lost response", outcome: "unknown" }));
+  const view = renderDialog(); await screen.findByRole("checkbox", { name: /Laptop purchase/ });
+  await userEvent.click(screen.getByRole("button", { name: "Confirm funding review" }));
+  await screen.findByRole("button", { name: "Retry same request" });
+  state.goal = { ...state.goal, id: "trip", name: "Trip" };
+  view.rerender(<LegacyGoalReviewDialog goalId="trip" open onOpenChange={vi.fn()} />);
+  expect(screen.getByText(/Laptop.*pending review/)).toBeTruthy();
+  await userEvent.click(screen.getByRole("button", { name: "Retry same request" }));
+  expect(state.apply.mock.calls[1][0]).toBe(state.apply.mock.calls[0][0]);
+  expect(state.apply.mock.calls[1][1].goalId).toBe(goalId);
+});
+
+test('keyboard Escape closes the review and restores focus to its opening button', async () => {
+  function Wrapper() { const [open, setOpen] = React.useState(false); return <><button onClick={() => setOpen(true)}>Review Laptop</button><LegacyGoalReviewDialog goalId={goalId} open={open} onOpenChange={setOpen} /></>; }
+  render(<Wrapper />); const opener = screen.getByRole("button", { name: "Review Laptop" });
+  await userEvent.click(opener); await screen.findByRole("checkbox", { name: /Laptop purchase/ });
+  await userEvent.keyboard("{Escape}");
+  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
+  expect(document.activeElement).toBe(opener);
+});
