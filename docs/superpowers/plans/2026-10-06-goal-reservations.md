# Goal Reservations and Spending Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method is selected after the user reviews the plan.

**Goal:** Let users reserve money inside real wallets, spend or release it accurately, and complete goals without changing balances incorrectly or counting purchases twice.

**Architecture:** Keep transactions as the record of actual money movements and add an append-only goal allocation ledger for reserved and spent amounts. Authenticated PostgreSQL operations commit wallet, transaction, reservation, lifecycle, and idempotency changes together. Goals and wallet summaries read the same authoritative snapshot.

**Tech Stack:** Existing Next.js 14.1.0 / React 18 / TypeScript / Supabase PostgreSQL / SWR / Tailwind / Radix Dialog; Vitest and Testing Library; real Supabase integration tests using the existing SDK.

**Spec:** [Goal reservations design](../specs/2026-10-06-goal-reservations-design.md). Read both documents before execution. Repository baseline inspected: local `beta` at `6f17870` on 2026-10-06.

## Global Constraints

- Target the existing Next.js 14.1.0, React 18, TypeScript, Supabase PostgreSQL, SWR, Tailwind, and Radix Dialog stack.
- Use PostgreSQL exact decimal arithmetic and decimal strings at new money API boundaries; PHP amounts have two decimal places.
- No new runtime dependency is needed for the reservation model.
- Preserve actual wallet balances and net worth when reserving, releasing, or moving reservations within a wallet.
- Record actual expenses and transfers once; goal allocation events must never become duplicate financial transactions.
- Persist financial mutations atomically and authorize them with `auth.uid()` in the database.
- Require confirmation before an ordinary expense or outgoing transfer releases any goal reservation.
- Preserve existing wallet tiles, ordering, ledger toggle, debt filters, and preview calculations.
- Keep Manrope/Bricolage, restrained emerald emphasis, and Goals summary presentation; ENERGY 1 / RHYTHM 2 / MOTION 1.
- Support light/dark themes, keyboard use, reduced motion, and 375px, 768px, and 1280px layouts.
- Preserve existing history; never automatically reinterpret legacy goal tags as reservations or spending.
- Merging and deployment are separate from implementing and verifying this plan.

## Review Focus

These failure cases must receive explicit tests in the owning tasks:

1. A second tab changes funds while a warning is open: reject a stale quote without releasing or spending money (Task 4).
2. A timeout occurs after the save committed: retry the same request ID and recover its result without duplication; a cache failure must not encourage another save (Tasks 3, 6, 8).
3. Several goals share one wallet: release exactly the confirmed shortfall from that wallet, with predictable priority ordering and editable allocations (Tasks 4, 8).
4. A purchase is deleted after its goal closed: reverse accounting without silently reopening the goal or restoring a closed reservation (Task 5).
5. An old client uses direct writes or the old deletion RPC: database permissions prevent bypassing reservation invariants (Task 10).

## Decisions and execution boundaries

- **Confirmed:** soft warning with confirmed automatic release. PHP 30,000 actual / 5,000 reserved / 28,000 expense becomes PHP 2,000 actual / 2,000 reserved / 0 available; unrelated goal spending remains zero.
- **Confirmed progress default:** `reserved + spent toward this goal`. Date target PHP 3,000, spent PHP 2,000, reserved PHP 1,000 remains 100%, with both components visible. The user approved this model and subagent-driven execution on 2026-10-06.
- **Proposed release ordering:** non-priority first; furthest target date first, null first; newest creation first; UUID as final tie-breaker. Users can adjust the preview. This is an implementation default, not a claim that the user chose this policy.
- **Installment count:** cap at 12, matching the current transaction modal's 1..12 choices. Schema and split helper must share the same constant; authoritative transaction RPCs must retain this bound.
- **User model policy:** no Astra. Use GPT-6-luna with medium, high, or extra-high reasoning for suitable work/testing/review; never below medium. Use GPT-6.1-sol with low or medium reasoning for tasks that need it, with medium as the ceiling. Choose model and effort by complexity rather than using one combination for every role.
- **User stopping boundary:** stop after Task 2 and its independent review/local verification; Tasks 3..11 remain pending until the user resumes.
- Implement on an isolated branch/worktree based on current beta using the workspace worktree skill at execution time. Do not merge or deploy as part of this plan.
- No product code, dependency installation, live database migration, commit, or push is authorized by this planning document alone.
- The repository has no installed Supabase CLI, PostgreSQL CLI, or Docker discovered during planning. Database tests require a disposable Supabase project or local instance provisioned at execution time. Mock tests cannot replace that acceptance requirement.

## Shared contracts and file responsibilities

Create `src/lib/goals/contracts.ts` for domain types and Zod parsing. Money in these new interfaces is a canonical two-decimal string, not an unchecked JavaScript float. `src/lib/goals/summary.ts` contains pure amount/projection calculations. `src/lib/goals/client.ts` owns RPC transport, request IDs, and structured errors. Keep rendering in components and mutations in this adapter.

```ts
type Money = string; // canonical decimal, e.g. "5000.00"
type GoalStatus = "active" | "completed" | "cancelled";
type ReviewState = "needs_review" | "confirmed";
type ReleaseLine = { goalId: string; accountId: string; amount: Money };
type ReservationMove = { goalId: string; amount: Money };
type LeftoverChoice = { mode: "release" } | { mode: "move"; goalId: string };

type TransactionDraft = {
  type: "income" | "expense" | "transfer";
  accountId: string;
  transferToAccountId: string | null;
  categoryId: string | null;
  goalId: string | null;
  amount: Money;
  description: string | null;
  date: string; // YYYY-MM-DD
  installments: { count: number } | null;
  reservationMoves: ReservationMove[];
};

type FinancialCommand =
  | { kind: "reserve" | "release"; goalId: string; accountId: string; amount: Money }
  | { kind: "reallocate"; goalId: string; destinationGoalId: string; accountId: string; amount: Money }
  | { kind: "close"; goalId: string; status: "completed" | "cancelled"; leftovers: LeftoverChoice | null }
  | { kind: "reopen" | "archive"; goalId: string }
  | { kind: "transaction"; draft: TransactionDraft }
  | { kind: "delete_transaction"; transactionId: string }
  | { kind: "adopt_legacy"; goalId: string; status: GoalStatus;
      reservations: { accountId: string; amount: Money }[]; spentTransactionIds: string[] };

type TransactionQuote = {
  fingerprint: string;
  actual: Money;
  reserved: Money;
  available: Money;
  releases: ReleaseLine[];
};
type FinancialResult = { operationId: string; transactionIds: string[]; replayed: boolean };
type WalletFunds = { accountId: string; actual: Money; reserved: Money; available: Money };
type GoalTotals = {
  goalId: string; reserved: Money; spent: Money; progressAmount: Money;
  remaining: Money; progressPercent: number;
  walletReservations: { accountId: string; amount: Money }[];
  legacyTaggedAmount: Money | null;
};
type GoalFinanceGoal = Omit<Goal, "target_amount" | "current_amount" | "allocation_per_cycle"> &
  { target_amount: Money; current_amount: Money; allocation_per_cycle: Money } & GoalTotals;
type GoalFinanceSnapshot = { goals: GoalFinanceGoal[]; wallets: WalletFunds[] };
```

`Goal` gains `status`, `review_state`, `completed_at`, and `archived_at` in database types. Domain JSON uses the camelCase names above; existing Goal row fields retain their existing snake_case names. Do not rename unrelated database fields.

Public SQL RPCs, all scoped by `auth.uid()`:

- `goal_finance_snapshot() -> jsonb` returns `GoalFinanceSnapshot`, including explicit decimal strings.
- `goal_transaction_quote(p_draft jsonb, p_releases jsonb default null) -> jsonb` returns `TransactionQuote`; null releases requests the proposed default, supplied releases request an exact valid alternative.
- `goal_finance_apply(p_request_id uuid, p_command jsonb, p_quote jsonb default null) -> jsonb` returns `FinancialResult`. A transaction requires a fresh quote even when releases are empty. Other commands reject non-null quotes.

Client exports:

- `fetchGoalFinance(): Promise<GoalFinanceSnapshot>`
- `quoteTransaction(draft: TransactionDraft, releases?: ReleaseLine[]): Promise<TransactionQuote>`
- `applyFinancialCommand(requestId: string, command: FinancialCommand, quote?: TransactionQuote): Promise<FinancialResult>`
- `parseMoney(input: string): Money`, `toMinorUnits(amount: Money): number`, `fromMinorUnits(cents: number): Money`
- `summarizeGoal(goalId: string, target: Money, events: AllocationEvent[]): GoalTotals`

Define `AllocationEvent` from the new database row, including `reserved_delta`, `spent_delta`, goal/account IDs, kind, operation ID, transaction ID, and reversal ID. Fail invalid values rather than coercing them to zero. Map SQL failures into named errors: `INSUFFICIENT_ACTUAL`, `INSUFFICIENT_AVAILABLE`, `INSUFFICIENT_RESERVATION`, `STALE_QUOTE`, `NEEDS_REVIEW`, `INVALID_STATE`, `REQUEST_CONFLICT`, and `NOT_ALLOWED`.

## Task 1: Reproducible ledger schema and database test harness

**Files:** create `supabase/migrations/202610060001_runtime_baseline.sql`, `202610060002_goal_allocation_ledger.sql`, `tests/database/helpers.mjs`, `tests/database/ledger.test.mjs`; modify `.gitignore`, `supabase/schema.sql`, `src/types/database.ts`, `package.json`; create `docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md`.

**Interfaces:** produce `goal_allocation_events`, `financial_operations`, lifecycle fields on `goals`, and typed rows. Test helpers export `createFinanceFixture()` and `cleanupFinanceFixture(fixture)` using a disposable project and separate user clients.

- [ ] Inspect runtime fields against SQL and the prior Goals migration document. Record the actual deployed schema/deletion RPC as a read-only preflight before deployment SQL is finalized; do not invent its definition. Make the baseline reproduce existing runtime columns on an empty test database, without dropping or overwriting existing production data.
- [x] Write `ledger.test.mjs`: owner can read their event, another user cannot; referenced goal and account belong to the same user; invalid money scales fail; `(user_id, request_id)` is unique; existing goals become `needs_review` while newly created goals are `confirmed`; a no-op upgrade preserves old balances and tags.

  Pin named tests `owner-scoped allocation reads` and `upgrade preserves legacy finances`: `assert.equal(otherUserEvents.length, 0)` and `assert.deepEqual(after.balances, before.balances)`.
- [x] Add `test:db` as `node --test tests/database/*.test.mjs`. Require `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, and `TEST_SUPABASE_SERVICE_ROLE_KEY` for disposable fixtures, fail clearly if missing, and never print secrets. Run `node --test tests/database/ledger.test.mjs`; expect failure against the baseline without the ledger.
- [x] Create the additive ledger migration: UUID keys; exact NUMERIC deltas with scale <= 2 and abs(value) < 1e13 checks (numeric(15,2)-equivalent range without silent rounding); ownership-enforcing foreign keys; kind checks; timestamps; transaction references that survive deletion; operation/request hash/result storage; unique reversal references; indexes on owner/goal/account/history. Reject zero-value events. Keep allocation changes append-only. Add safe lifecycle defaults and timestamps without interpreting old tags.
- [x] Narrow ignore exceptions to the required migrations, schema, plan, and spec directories. Run the database test and `npx tsc --noEmit`; expect exit 0. Commit only the listed files: `feat: add goal allocation ledger and reproducible schema`.

## Task 2: Exact money, progress, and projection calculations

**Files:** create `src/lib/goals/contracts.ts`, `src/lib/goals/summary.ts`, `tests/goal-summary.test.ts`; modify `src/lib/goal-funding.ts`, `tests/navigation-goals.test.cjs`, and `src/hooks/use-goals.ts` only for projection delegation.

**Interfaces:** produce the shared domain contracts, money helpers, and `summarizeGoal`. Preserve the navigation assertions; replace the obsolete tagged-expense funding assertions rather than deleting useful coverage.

- [x] Write failing tests with these exact outcomes: reserve 5,000 of target 5,000 gives reserved `5000.00`, spent `0.00`, 100%; spending 2,000 from a reserved 3,000 gives reserved `1000.00`, spent `2000.00`, progress `3000.00`, 100%; release 15,000 from 27,000 of target 30,000 gives 40%; paired reservation moves preserve totals; reversals restore amounts; no amount is inferred from legacy tags.

  Pin `goal spending preserves combined progress`: `expect(totals).toMatchObject({ reserved: "1000.00", spent: "2000.00", progressAmount: "3000.00", progressPercent: 100 })`.
- [x] Add parsing tests: `0.10 + 0.20 = 0.30`; reject negative entry amounts, NaN, Infinity, exponent notation, excessive precision and overflow; target must be positive. Preserve unclamped true amounts when the displayed bar clamps to 100. Installment split 100.00 over three rows must equal `33.34`, `33.33`, `33.33`.
- [x] Run `npx vitest run tests/goal-summary.test.ts`; expect red. Implement integer-centavo calculations within the safe integer range and canonical decimal serialization; use SQL numeric for authoritative aggregation. Do not use floating-point rounding for ledger sums.
- [x] Pin cadence examples: target 5,000 / progress 500 / monthly 1,000 means five monthly cycles remaining; kinsenas 500 means nine half-month cycles; zero cadence means no estimate. Estimates add no events. Move existing `getProjection` calculation into this focused helper while retaining its existing display conversion rules.
- [x] Run the focused Vitest suite and `node --test tests/navigation-goals.test.cjs`; expect exit 0. Commit: `feat: calculate reservation and spending progress exactly`.

## Task 3: Atomic set aside, release, and reallocation

**Files:** create `supabase/migrations/202610060003_goal_reservation_operations.sql`, `tests/database/reservations.test.mjs`; modify `src/types/database.ts`.

**Interfaces:** implement `goal_finance_snapshot` and the reserve/release/reallocate cases of `goal_finance_apply`. Later tasks extend the same apply RPC; unsupported command kinds must fail explicitly until implemented.

- [ ] Write real database assertions: PHP 30,000 reserve 5,000 leaves actual `30000.00`, reserved `5000.00`, available `25000.00`, and creates no transaction; releasing 2,000 leaves reserved `3000.00`; moving 1,000 to another goal preserves total reserved. Other owners, credit wallets, non-PHP wallets, closed goals, unreviewed goals, insufficient available funds, and excessive release amounts fail with no writes.
- [ ] Test two concurrent reserve requests each for 20,000 against the same 30,000 wallet: exactly one succeeds. Retry the same successful request UUID returns its original result with `replayed=true`; reuse that UUID with a different command returns `REQUEST_CONFLICT`.
- [ ] Run `node --test tests/database/reservations.test.mjs`; expect red. Implement owner-scoped RPCs with pinned search paths, a lock on the user's existing profile row, then deterministic wallet/goal locks. Validate after locking and commit operation result with the event changes. Reads must not mutate goals or balances.
- [ ] Implement the snapshot as one coherent query, returning decimal strings, per-goal `walletReservations`, current reservations by wallet, and explicit legacy-review state. For `needs_review`, `legacyTaggedAmount` is the old tagged-expense/transfer sum, displayed as legacy history only; for confirmed goals it is null. Include archived names for history, while excluding archived goals from the active list. Read only owned accounts and goals.

  Pin `reserve leaves actual cash unchanged`: `assert.deepEqual(wallet, { accountId: fixture.walletId, actual: "30000.00", reserved: "5000.00", available: "25000.00" })` and `assert.equal(transactions.length, 0)`.
- [ ] Run reservation and ledger database suites; expect exit 0. Commit: `feat: add atomic goal reservation operations`.

## Task 4: Transaction quotes, confirmed releases, and atomic booking

**Files:** create `supabase/migrations/202610060004_goal_transaction_operations.sql`, `tests/database/financial-transactions.test.mjs`; modify `src/types/database.ts`.

**Interfaces:** implement `goal_transaction_quote` and the transaction case of `goal_finance_apply` using `TransactionDraft`, `TransactionQuote`, and `FinancialResult` exactly as defined above.

- [ ] Write the user's exact example: quote 28,000 against actual 30,000 / Laptop reserved 5,000; expect release `3000.00`. Quote creates no rows. Confirm results in actual `2000.00`, reserved `2000.00`, available `0.00`, goal spent `0.00`, and exactly one 28,000 expense. No confirmation means no operation.
- [ ] Test a normal 1,000 goal expense against its reservation: actual and reservation both decrease by 1,000, goal spent increases by 1,000. Ordinary income has no goal allocation. Cash-to-cash transfer carrying 5,000 moves backing reservations without raising goal progress. Carrying more than the transfer or available reservation fails.
- [ ] Test multiple goals and deterministic ordering, custom exact release selection, releases from the wrong wallet, excess release, and a wallet with insufficient actual money. Reject custom plans whose sum differs from the shortfall. If the source goal reservation cannot cover a goal expense, return `INSUFFICIENT_RESERVATION` rather than classifying another goal's money as that goal's spending.
- [ ] Test Review Focus 1: change funds after quoting; applying the original fingerprint returns `STALE_QUOTE` and writes nothing. Test simultaneous expense/reserve, a transaction insert failure, invalid category ownership, and expired authentication. Assert rollback of every balance, event, and transaction, not just an error response.

  Pin `confirmed overspend releases only its shortfall`: `assert.equal(quote.releases[0].amount, "3000.00")`; after save, `assert.equal(wallet.available, "0.00")` and `assert.equal(laptop.spent, "0.00")`.
- [ ] Run `node --test tests/database/financial-transactions.test.mjs`; expect red. Implement quote normalization/fingerprints and authoritative revalidation under locks. Check a matching completed request before rejecting its now-stale quote, so retry after an unknown network outcome returns the committed result.
- [ ] Port current credit signs, debt/month payment validation, and installment scheduling into the atomic writer. Test exact remainder centavos and debt booked once; credit purchases/installation rows do not fund a goal; cash debt payment tagged to a debt goal consumes a reservation and records spending once. Reject income goal tags and goal spending on other credit transfers. Run all database tests; commit: `feat: save transactions with confirmed goal fund releases`.

## Task 5: Completion, cancellation, archival, and financial reversals

**Files:** create `supabase/migrations/202610060005_goal_lifecycle_operations.sql`, `tests/database/goal-lifecycle.test.mjs`.

**Interfaces:** extend `goal_finance_apply` with close/reopen/archive/delete_transaction. Produce audited reversals linked to original allocation events. Retain original event monetary values even after transaction deletion.

- [ ] Write Date scenario assertions: reserve 3,000, spend 2,000, complete with release choice; actual balance is unchanged by completion, reservation is zero, spending remains 2,000, and status is completed. Complete below target succeeds. Close with leftovers and no choice fails. Moving leftovers keeps per-wallet backing and total reserved.
- [ ] Test Laptop reserve/spend 30,000 completes without a 60,000 total. Cancel preserves actual spending and handles leftovers. Reopen retains history and creates no reservation. Archive requires closed status and zero reservations; it retains history. The legacy completion boolean is mirrored only by lifecycle operations, never by a read.
- [ ] Add Review Focus 4: deleting a goal expense on an active goal restores reservation and reduces spending; deleting it after closure increases available money and reduces spending without reopening or reserving. Reversing an ordinary expense's auto-release follows the same active/closed rule. Repeated deletion request does not duplicate reversals.

  Pin `deletion preserves closed goal state`: `assert.equal(goal.status, "completed")`, `assert.equal(goal.reserved, "0.00")`, and `assert.equal(goal.spent, "0.00")` after deleting its sole goal expense.
- [ ] Test transfer reversal restores carried allocations only if both sides can support it; reversal after downstream use fails atomically. Undoing income must not leave actual balance below reservations. Reject with instructions to release funds or make a corrective transaction, not an implicit reservation reduction.
- [ ] Run `node --test tests/database/goal-lifecycle.test.mjs`; expect red. Implement lifecycle and deletion in the existing operation lane, preserving the current transaction deletion experience but eliminating the old untyped RPC dependency. Run all database tests; commit: `feat: preserve goal achievements and reverse spending safely`.

## Task 6: Typed transport, shared snapshots, and reliable refresh

**Files:** create `src/lib/goals/client.ts`, `src/hooks/use-goal-finance.ts`, `tests/goal-finance-client.test.ts`, `tests/goal-finance-hooks.test.tsx`; modify `src/hooks/use-goals.ts`, `src/lib/refresh-financial-data.ts`.

**Interfaces:** produce the client exports above and `useGoalFinance(userId: string | null)` returning `{ data, isLoading, error, refresh }`. SWR key: `["goalFinance", userId]`; history key: `["goalHistory", userId, goalId]`. `useGoals` consumes this snapshot and preserves existing metadata CRUD with lifecycle writes routed through commands.

- [ ] Write failing adapter tests for canonical money serialization, schema rejection of malformed RPC results, named errors, and the same UUID on retry. Test `fetchGoalFinance` is read-only and never updates a fully funded goal.
- [ ] Write refresh tests: success and idempotent replay revalidate goal snapshot/history plus existing account, recent transaction, and dashboard keys; failed commands do not mutate cached amounts. Signing out clears user-specific snapshots. Never reuse another user's cached wallet data.
- [ ] Test Review Focus 2: committed mutation plus failed revalidation returns a saved outcome with a refresh error, not a failed financial save. Keep `applyFinancialCommand` and refresh separate so an error in the latter cannot cause a new request UUID.

  Pin `retry recovers committed operation`: `expect(second.operationId).toBe(first.operationId)` and `expect(second.replayed).toBe(true)`.
- [ ] Run `npx vitest run tests/goal-finance-client.test.ts tests/goal-finance-hooks.test.tsx`; expect red. Implement parsing with existing Zod, replace tagged-transaction sums in `use-goals`, and remove the fetch-time auto-completion write. Keep metadata edits and projection callers compatible through explicit updated types.
- [ ] Run focused tests and `npx tsc --noEmit`; expect exit 0. Commit: `feat: share authoritative goal and wallet financial snapshots`.

## Task 7: Goal actions, lifecycle presentation, and history

**Files:** create `src/components/goals/GoalFundsDialog.tsx`, `src/components/goals/GoalCompletionDialog.tsx`, `src/components/goals/GoalHistoryDialog.tsx`, `tests/goal-actions.test.tsx`; modify `src/components/goals/GoalCard.tsx`, `GoalCardSkeleton.tsx`, `AddGoalModal.tsx`, `src/app/(dashboard)/goals/page.tsx`.

**Interfaces:** `GoalFundsDialog` takes `goalId`, `mode: "reserve" | "release" | "move"`, `open`, `onOpenChange`; `GoalCompletionDialog` takes goalId and closing status; `GoalHistoryDialog` takes goalId. All resolve wallets/amounts from Task 6, never from stale caller-provided balances. Spend action opens `AddTransactionModal` with existing `defaultGoalId`.

- [ ] Write user-facing tests: Set aside changes reservation without an expense; Release changes no actual balance; move offers owned active goals in the same wallet; closure asks about leftovers; changing goal/opening resets amount and selections; cancelled/failed dialogs change no totals.
- [ ] Assert card labels distinguish reserved and spent, active Saving/Funded is derived, completed cards show `Completed` and true spending, and reopening preserves history. Test 3,000 Date/2,000 spent/1,000 reserved presentation against the selected progress default. Archive replaces irreversible goal deletion.

  Pin `set aside uses reservation dialog`: `expect(screen.getByRole("dialog", { name: /set aside/i })).toBeVisible()` and assert the transaction submission adapter was not called.
- [ ] Run `npx vitest run tests/goal-actions.test.tsx`; expect red. Build compact forms with existing Radix Dialog, inline errors, disabled pending submits, amount guidance, and accessible names/focus. History includes set aside, release, confirmed automatic release, spending, moves, and reversal entries with real wallet names.
- [ ] Match skeletons to new card amounts/actions/history and keep summary placeholders during loading. Replace old guidance with: `Set aside money in a wallet to fund a goal. Spending from that goal uses its reserved funds. Monthly and kinsenas targets estimate completion only.`
- [ ] Verify keyboard opening, Tab, Escape, and focus return with Testing Library. Run focused tests and TypeScript; commit: `feat: add goal reservation and completion actions`.

## Task 8: Transaction dialog release review and deletion integration

**Files:** create `src/components/transactions/GoalReleaseNotice.tsx`, `src/hooks/use-transaction-submit.ts`, `tests/transaction-release.test.tsx`; modify `src/components/transactions/AddTransactionModal.tsx`, `TransactionDetailModal.tsx`, `src/components/goals/GoalSelector.tsx`, `src/app/(dashboard)/transactions/page.tsx`, `tests/contributions.test.tsx`.

**Interfaces:** `useTransactionSubmit()` exposes `quote(draft, releases?)`, `confirm()`, `reset()`, plus phase/error/saved/quote state. Phases: `editing`, `quoting`, `review`, `saving`, `saved`. One request UUID belongs to one confirmed attempt and persists through unknown outcomes/retries. Editing the draft invalidates its quote and confirmation.

- [ ] Write tests: 28,000 ordinary expense shows exact Laptop 3,000 warning before saving; declining writes nothing; accepting calls one transaction command with that quote; editing amounts or wallet invalidates the warning; `STALE_QUOTE` returns to review with fresh amounts and requires another confirmation.
- [ ] Test custom release breakdown across several goals, disabled duplicate submits, unknown network outcome retry with the same request ID, and saved-but-refresh-failed feedback. A zero-release quote may proceed directly without an extra confirmation dialog. Ordinary actual insufficiency stays a clear inline error.

  Pin `release requires explicit confirmation`: before clicking confirmation, `expect(applyFinancialCommand).not.toHaveBeenCalled()`; after clicking `Release funds and save`, `expect(applyFinancialCommand).toHaveBeenCalledTimes(1)`. Retain an unresolved request across dialog closure in the submit controller; recover it with the same UUID before allowing a replacement save. Do not discard an unknown outcome as cancellation.
- [ ] Run `npx vitest run tests/transaction-release.test.tsx`; expect red. Replace all insert-then-update sequences, including installments, with Task 6 transport. Keep the normal Expense default and `defaultAccountId` callers. Set aside never opens this dialog. Spend from goal preselects the goal but never invents an amount or wallet.
- [ ] Give transfer goal association an explicit meaning: carry reservation to another cash wallet, or spend a debt-goal reservation on a credit payment. Income excludes goal tags. Credit purchase association is informational and says it does not fund the goal. Do not restore the removed standalone transaction page/form; its redirect already exists.
- [ ] Route deletion through `delete_transaction` and refresh both local transaction list and shared financial caches. Detail views show goal-spending/carried-reservation information distinctly from unrelated auto-releases. Replace obsolete contribution assertions with behavior tests; retain cancellation/reset/installment coverage. Run focused suites plus TypeScript; commit: `feat: confirm automatic goal releases in transaction flow`.

## Task 9: Wallet and dashboard balances remain truthful

**Files:** modify `src/app/(dashboard)/accounts/page.tsx`, `src/app/(dashboard)/dashboard/page.tsx`, `src/hooks/use-data.ts`, `src/components/ui/financial-summary.tsx`; create `tests/wallet-reservations.test.tsx`.

**Interfaces:** consume `WalletFunds` using the same wallet inclusion scope as the existing balance headline. Dashboard's existing metrics continue to consume real transactions and accounts. Local wallet state must refresh after finance operations, using the shared snapshot or explicit revalidation rather than only modal close.

- [ ] Write assertions: reserving 5,000 of 30,000 shows actual 30,000 / reserved 5,000 / available 25,000 and unchanged net worth; excluded wallets remain excluded from corresponding headline sums; credit debt is separate and cannot be reserved; release changes no income/expense metric.
- [ ] Test loading/error states never display fabricated zero balances. Test wallet fetches do not call balance updates, and successful finance operations refresh Wallets while its page remains mounted. Debt filters and previews yield the same values as baseline fixtures.

  Pin `reservations do not change net worth`: `expect(after.netWorth).toBe(before.netWorth)` and `expect(after.available).toBe("25000.00")` after reserving 5,000 in a 30,000 wallet.
- [ ] Run `npx vitest run tests/wallet-reservations.test.tsx`; expect red. Extend the existing Goals-style top summary with the reservation distinction and remove fetch-time credit balance synchronization. Do not redesign lower tiles or change drag order, ledger toggle, wallet actions, or APY/net-worth behavior.
- [ ] Audit credit opening-balance and transaction-derived differences before cutover and document them in the rollout checklist; preserve stored actual debt rather than overwriting it on page load. Preserve existing real cash-advance and payment reporting fixtures.
- [ ] Run focused tests and TypeScript; commit: `feat: show wallet reserved and available funds consistently`.

## Task 10: Legacy funding review and write-permission cutover

**Files:** create `src/components/goals/LegacyGoalReviewDialog.tsx`, `supabase/migrations/202610060006_goal_write_guards.sql`, `tests/legacy-goals.test.tsx`, `tests/database/migration-security.test.mjs`; modify `src/app/(dashboard)/goals/page.tsx`, `src/components/goals/GoalCard.tsx`, `src/components/transactions/AddTransactionModal.tsx`, the lifecycle migration, and `docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md`.

**Interfaces:** implement `adopt_legacy`; a review submission explicitly selects current per-wallet reservations, status, and optional historical spent transaction IDs. Import historical spending with a uniqueness constraint that prevents reimport on retry or to another goal.

- [ ] Write tests: untouched legacy tags/balances remain unchanged; unreconciled funding is labeled `Review existing funding`, not counted as real reserved money; review checks current available funds; adopting existing cash expenses adds spent history only and never deducts balances again; cash transfers and credit installment purchases cannot be imported as spent; completed imports have zero new reservations.
- [ ] Test an old expense used as fake savings: review explains normal transaction correction, does not auto-reverse it, and cannot create a reservation from nonexistent available money. Optional empty history selection is valid. Once confirmed, review cannot run again as another funding import.

  Pin `historical spending import never charges twice`: `assert.equal(after.wallet.actual, before.wallet.actual)` and `assert.equal(after.goal.spent, "2000.00")` for a selected 2,000 cash expense. Deleting that imported expense reverses its spent-only event but must not invent a reservation: `assert.equal(afterDeletion.goal.reserved, "0.00")`.
- [ ] Add Review Focus 5 tests as ordinary authenticated users: direct event/transaction DML and balance/lifecycle writes fail; another user's IDs fail; safe account/goal metadata edits and opening a wallet still work; wallet deletion or account identity changes with allocation history fail; the old deletion RPC cannot bypass the new lane. Test goal target edits only recompute derived values.
- [ ] Run `node --test tests/database/migration-security.test.mjs` and `npx vitest run tests/legacy-goals.test.tsx`; expect red. Add the review UI and backend case, then restrict grants/RLS/columns after all writers have been audited. Explicitly revoke or safely redirect old financial RPCs from the verified deployed function inventory. Keep safe owner-scoped metadata access. Enforce invariants against direct goal/account ownership, currency, type, status, and archival manipulation.
- [ ] On the disposable project, apply all migrations in order and run `npm run test:db`; expect every test to pass. Confirm fixtures clean up without production credentials. Document additive rollout, backups, debt discrepancy audit, coordinated writer cutover, and forward-fix strategy. Commit: `feat: reconcile legacy goals and enforce financial write guards`.

## Task 11: Whole-flow verification and delivery evidence

**Files:** create `docs/codex-review/GOAL_RESERVATIONS_VERIFICATION.md`; modify the rollout guide and this plan's completed checkboxes only after the corresponding work passes.

**Interfaces:** consumes all prior task deliverables. Produces verified acceptance evidence and a reviewable branch; this task does not merge or deploy.

- [ ] Run `npx tsc --noEmit`, `npm test`, `npm run test:db`, `npm run lint`, and `npm run build` sequentially; record exit codes and actual counts. Fix new failures. Separate pre-existing lint findings with exact evidence rather than claiming lint passes when it does not. Database tests must exercise real permissions, locking, rollback, and replay.
- [ ] Against disposable seeded accounts, click through: set aside 500 toward 5,000 gives 10%; Laptop full reserve/spend/complete; Date under-budget completion with release and move choices; emergency release; user-confirmed 28,000 overspend; multiple goals and stale quote; cancel/failed save; installment/debt payment; transaction reversals; legacy adoption; archive/reopen.
- [ ] Verify at 375px, 768px, and 1280px in both themes: headings and summary alignment, loaded/skeleton layout, long goal/wallet names, large amounts, no overflow, contrast, pending/error/empty states, Tab/Enter/Escape focus, and reduced motion. Check cached route and cold navigation regressions remain covered by existing navigation tests.
- [ ] Record workspace antislop delivery checks with concrete screenshots/interaction evidence: Hard Gate, Purpose Gate, Liveliness, and Craftsmanship. Include one-line reasons for amount hierarchy, typography, spacing, goal card actions, emerald feedback, and dialog layout. Do not mark rendered UI checks passed from tests or source inspection alone.
- [ ] Review the complete branch against the spec and all five Review Focus cases. Record remaining limitations and any blocked database/environment checks honestly. Commit the verification document only after evidence exists: `docs: record goal reservation verification and rollout`. Handoff to the user for separate merge/deployment decisions.

## Self-review of this plan

- Spec coverage: wallet reservation semantics (Tasks 1, 3, 9), exact progress/projections (2), spending and warning (4, 8), lifecycle/reversal (5, 7), transport/cache (6), legacy reconciliation and permissions (10), delivery evidence (11).
- Shared type/RPC names match across tasks. Money is a decimal string on new boundaries; lifecycle and review state are explicit. Existing `is_completed` and `current_amount` are compatibility fields, not authoritative funding inputs.
- All five Review Focus cases have named test assertions. Financial integrity requires real database tests; the plan makes the missing environment a provisioning dependency, not a silently skipped suite.
- Scope stays within goal finance and the existing wallet/transaction integrations it depends on. PWA, navigation redesign, recurring reset automation, multi-currency conversion, and bank integration are excluded.
- The combined reserved-plus-spent progress model is now user-confirmed. The confirmed soft-warning behavior is included throughout; no task uses the earlier hard-block recommendation.

## Planning delivery checks

- Hard gate PASS for the plan: exact example amounts and outcomes come from the supplied cases; no claims that unimplemented UI, database checks, or deployment already pass.
- Purpose gate PASS: the design spec records reasons for ledger separation, release preview, achievement history, and reuse of existing summary presentation.
- Liveliness PASS at plan level: the supplied ENERGY 1 / RHYTHM 2 / MOTION 1 direction is retained; Task 11 requires rendered evidence.
- Craftsmanship PASS at plan level: all lifecycle actions have concrete behavior and test ownership; loading, errors, keyboard, themes, and mobile verification are explicit. Product delivery remains subject to Task 11.

## Execution handoff

Review this plan and its companion spec before product implementation. For this change, prefer subagent-driven execution with a fresh review after each task because a mistake in atomic writes or migration can corrupt financial balances. Native execution with one final independent branch review is the lower-cost alternative. The user chose subagent-driven execution and accepted combined progress on 2026-10-06. Local implementation and commits are authorized; remote pushes remain prohibited pending final check.



