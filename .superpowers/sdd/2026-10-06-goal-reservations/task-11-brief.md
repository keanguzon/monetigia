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


## Task 11: Whole-flow verification and delivery evidence

**Files:** create `docs/codex-review/GOAL_RESERVATIONS_VERIFICATION.md`; modify the rollout guide and this plan's completed checkboxes only after the corresponding work passes.

**Interfaces:** consumes all prior task deliverables. Produces verified acceptance evidence and a reviewable branch; this task does not merge or deploy.

- [ ] Run `npx tsc --noEmit`, `npm test`, `npm run test:db`, `npm run lint`, and `npm run build` sequentially; record exit codes and actual counts. Fix new failures. Separate pre-existing lint findings with exact evidence rather than claiming lint passes when it does not. Database tests must exercise real permissions, locking, rollback, and replay.
- [ ] Against disposable seeded accounts, click through: set aside 500 toward 5,000 gives 10%; Laptop full reserve/spend/complete; Date under-budget completion with release and move choices; emergency release; user-confirmed 28,000 overspend; multiple goals and stale quote; cancel/failed save; installment/debt payment; transaction reversals; legacy adoption; archive/reopen.
- [ ] Verify at 375px, 768px, and 1280px in both themes: headings and summary alignment, loaded/skeleton layout, long goal/wallet names, large amounts, no overflow, contrast, pending/error/empty states, Tab/Enter/Escape focus, and reduced motion. Check cached route and cold navigation regressions remain covered by existing navigation tests.
- [ ] Record workspace antislop delivery checks with concrete screenshots/interaction evidence: Hard Gate, Purpose Gate, Liveliness, and Craftsmanship. Include one-line reasons for amount hierarchy, typography, spacing, goal card actions, emerald feedback, and dialog layout. Do not mark rendered UI checks passed from tests or source inspection alone.
- [ ] Review the complete branch against the spec and all five Review Focus cases. Record remaining limitations and any blocked database/environment checks honestly. Commit the verification document only after evidence exists: `docs: record goal reservation verification and rollout`. Handoff to the user for separate merge/deployment decisions.



