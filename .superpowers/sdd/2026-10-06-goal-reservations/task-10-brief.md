# Binding global constraints
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


# Shared interfaces
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


## Task 10: Legacy funding review and write-permission cutover

**Files:** create `src/components/goals/LegacyGoalReviewDialog.tsx`, `supabase/migrations/202610060006_goal_write_guards.sql`, `tests/legacy-goals.test.tsx`, `tests/database/migration-security.test.mjs`; modify `src/app/(dashboard)/goals/page.tsx`, `src/components/goals/GoalCard.tsx`, `src/components/transactions/AddTransactionModal.tsx`, the lifecycle migration, and `docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md`.

**Interfaces:** implement `adopt_legacy`; a review submission explicitly selects current per-wallet reservations, status, and optional historical spent transaction IDs. Import historical spending with a uniqueness constraint that prevents reimport on retry or to another goal.

- [ ] Write tests: untouched legacy tags/balances remain unchanged; unreconciled funding is labeled `Review existing funding`, not counted as real reserved money; review checks current available funds; adopting existing cash expenses adds spent history only and never deducts balances again; cash transfers and credit installment purchases cannot be imported as spent; completed imports have zero new reservations.
- [ ] Test an old expense used as fake savings: review explains normal transaction correction, does not auto-reverse it, and cannot create a reservation from nonexistent available money. Optional empty history selection is valid. Once confirmed, review cannot run again as another funding import.

  Pin `historical spending import never charges twice`: `assert.equal(after.wallet.actual, before.wallet.actual)` and `assert.equal(after.goal.spent, "2000.00")` for a selected 2,000 cash expense. Deleting that imported expense reverses its spent-only event but must not invent a reservation: `assert.equal(afterDeletion.goal.reserved, "0.00")`.
- [ ] Add Review Focus 5 tests as ordinary authenticated users: direct event/transaction DML and balance/lifecycle writes fail; another user's IDs fail; safe account/goal metadata edits and opening a wallet still work; wallet deletion or account identity changes with allocation history fail; the old deletion RPC cannot bypass the new lane. Test goal target edits only recompute derived values.
- [ ] Run `node --test tests/database/migration-security.test.mjs` and `npx vitest run tests/legacy-goals.test.tsx`; expect red. Add the review UI and backend case, then restrict grants/RLS/columns after all writers have been audited. Explicitly revoke or safely redirect old financial RPCs from the verified deployed function inventory. Keep safe owner-scoped metadata access. Enforce invariants against direct goal/account ownership, currency, type, status, and archival manipulation.
- [ ] On the disposable project, apply all migrations in order and run `npm run test:db`; expect every test to pass. Confirm fixtures clean up without production credentials. Document additive rollout, backups, debt discrepancy audit, coordinated writer cutover, and forward-fix strategy. Commit: `feat: reconcile legacy goals and enforce financial write guards`.



