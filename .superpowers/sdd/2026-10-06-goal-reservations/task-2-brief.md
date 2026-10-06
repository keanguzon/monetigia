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


## Task 2: Exact money, progress, and projection calculations

**Files:** create `src/lib/goals/contracts.ts`, `src/lib/goals/summary.ts`, `tests/goal-summary.test.ts`; modify `src/lib/goal-funding.ts`, `tests/navigation-goals.test.cjs`.

**Interfaces:** produce the shared domain contracts, money helpers, and `summarizeGoal`. Preserve the navigation assertions; replace the obsolete tagged-expense funding assertions rather than deleting useful coverage.

- [ ] Write failing tests with these exact outcomes: reserve 5,000 of target 5,000 gives reserved `5000.00`, spent `0.00`, 100%; spending 2,000 from a reserved 3,000 gives reserved `1000.00`, spent `2000.00`, progress `3000.00`, 100%; release 15,000 from 27,000 of target 30,000 gives 40%; paired reservation moves preserve totals; reversals restore amounts; no amount is inferred from legacy tags.

  Pin `goal spending preserves combined progress`: `expect(totals).toMatchObject({ reserved: "1000.00", spent: "2000.00", progressAmount: "3000.00", progressPercent: 100 })`.
- [ ] Add parsing tests: `0.10 + 0.20 = 0.30`; reject negative entry amounts, NaN, Infinity, exponent notation, excessive precision and overflow; target must be positive. Preserve unclamped true amounts when the displayed bar clamps to 100. Installment split 100.00 over three rows must equal `33.34`, `33.33`, `33.33`.
- [ ] Run `npx vitest run tests/goal-summary.test.ts`; expect red. Implement integer-centavo calculations within the safe integer range and canonical decimal serialization; use SQL numeric for authoritative aggregation. Do not use floating-point rounding for ledger sums.
- [ ] Pin cadence examples: target 5,000 / progress 500 / monthly 1,000 means five monthly cycles remaining; kinsenas 500 means nine half-month cycles; zero cadence means no estimate. Estimates add no events. Move existing `getProjection` calculation into this focused helper while retaining its existing display conversion rules.
- [ ] Run the focused Vitest suite and `node --test tests/navigation-goals.test.cjs`; expect exit 0. Commit: `feat: calculate reservation and spending progress exactly`.



## Controller integration clarification

Task 6 performs the live reader cutover. Keep the existing contributionGoalId/goalFunding exports compatible for the current modal/hooks until then; clearly identify their legacy purpose and do not count legacy tags in the new summarizeGoal. Preserve the existing Vitest contribution tests until the transaction cutover. The new Node funding regression should exercise allocation events. Add a minimal getProjection wrapper in src/hooks/use-goals.ts if needed to delegate to the new pure projection helper while preserving existing callers. This adds that hook file to Task 2 scope only for projection delegation; do not alter fetching, completion, or transaction behavior yet.

Task 1 raw NUMERIC Row is string|number but new AllocationEvent money boundary must be canonical decimal strings; do not derive ledger money from imprecise raw JSON numbers. SQL decimal-text snapshots/history come in later tasks.

