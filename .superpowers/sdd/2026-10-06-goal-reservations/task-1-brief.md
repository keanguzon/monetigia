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
type GoalFinanceSnapshot = { goals: (Goal & GoalTotals)[]; wallets: WalletFunds[] };
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
- [ ] Write `ledger.test.mjs`: owner can read their event, another user cannot; referenced goal and account belong to the same user; invalid money scales fail; `(user_id, request_id)` is unique; existing goals become `needs_review` while newly created goals are `confirmed`; a no-op upgrade preserves old balances and tags.

  Pin named tests `owner-scoped allocation reads` and `upgrade preserves legacy finances`: `assert.equal(otherUserEvents.length, 0)` and `assert.deepEqual(after.balances, before.balances)`.
- [ ] Add `test:db` as `node --test tests/database/*.test.mjs`. Require `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, and `TEST_SUPABASE_SERVICE_ROLE_KEY` for disposable fixtures, fail clearly if missing, and never print secrets. Run `node --test tests/database/ledger.test.mjs`; expect failure against the baseline without the ledger.
- [ ] Create the additive ledger migration: UUID keys; exact NUMERIC deltas with scale <= 2 and abs(value) < 1e13 checks (numeric(15,2)-equivalent range without silent rounding); ownership-enforcing foreign keys; kind checks; timestamps; transaction references that survive deletion; operation/request hash/result storage; unique reversal references; indexes on owner/goal/account/history. Reject zero-value events. Keep allocation changes append-only. Add safe lifecycle defaults and timestamps without interpreting old tags.
- [ ] Narrow ignore exceptions to the required migrations, schema, plan, and spec directories. Run the database test and `npx tsc --noEmit`; expect exit 0. Commit only the listed files: `feat: add goal allocation ledger and reproducible schema`.



