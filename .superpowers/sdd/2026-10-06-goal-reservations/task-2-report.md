# Task 2 implementation report

Status: DONE. Local implementation only, stopping after Task 2. Starting commit: `8c23f8040ac06e9b75f26a3d7c2176e22da1652c`, branch `codex/goal-reservations`.

Commit: `80be291faae94acd907f85502d5db1c360842edb`, `feat: calculate reservation and spending progress exactly`. Commit contains the seven scoped implementation/test files. The local `.superpowers` report is ignored by Git. Post-commit `git status --short` was empty.

## Files

- `src/lib/goals/contracts.ts`: shared domain types and Zod schemas, canonical decimal money boundaries, snapshot monetary overrides, signed allocation events, named financial error codes.
- `src/lib/goals/summary.ts`: exact safe-centavo parsing/serialization/aggregation, installment splitting, pure cadence projection.
- `src/hooks/use-goals.ts`: projection delegation and compatible ProjectionResult re-export only. Fetching, automatic completion, mutations, and legacy contribution behavior remain as before.
- `src/lib/goal-funding.ts`: one comment documenting legacy tagged-contribution compatibility; existing exports and calculations unchanged.
- `tests/goal-summary.test.ts`: 34 tests covering all Task 2 example outcomes and exact-money/schema/projection boundaries.
- `tests/navigation-goals.test.cjs`: navigation assertions retained; obsolete tagged-funding regression replaced with allocation summary regression. Its TypeScript loader resolves the summary module's relative import.
- `vitest.config.ts`: controller-approved include discovery adjustment from `tests/**/*.test.tsx` to `tests/**/*.test.{ts,tsx}`. Node `.cjs`/`.mjs` tests remain outside Vitest.

No new dependency, migration, database reader, RPC adapter, UI, live mutation, remote write, merge, or Task 3+ work.

## Exact exported interfaces

From `summary.ts`:

```ts
parseMoney(input: string): Money
toMinorUnits(amount: Money): number
fromMinorUnits(cents: number): Money
splitInstallments(amount: Money, count: number): Money[]
summarizeGoal(goalId: string, target: Money, events: AllocationEvent[]): GoalTotals
projectGoal(input: GoalProjectionInput, now: Date): ProjectionResult

interface GoalProjectionInput {
  target: Money;
  progressAmount: Money;
  allocationPerCycle: Money;
  allocationFrequency: string | null;
}
interface ProjectionResult {
  count: number;
  unit: "month" | "months" | "payday" | "paydays";
  projectedDate: string | null;
  monthlyAmount: number;
  kinsenasAmount: number;
}
```

Existing hook signature remains `getProjection(goal: GoalWithProgress): ProjectionResult`, and its exported `ProjectionResult` now refers to the pure helper type.

From `contracts.ts` (schema-inferred types expanded below for clarity):

```ts
type Money = string;
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
  date: string;
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
type TransactionQuote = { fingerprint: string; actual: Money; reserved: Money; available: Money; releases: ReleaseLine[] };
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
type AllocationEvent = Omit<GoalAllocationEvent, "reserved_delta" | "spent_delta"> &
  { reserved_delta: Money; spent_delta: Money };
type FinancialErrorCode = "INSUFFICIENT_ACTUAL" | "INSUFFICIENT_AVAILABLE" |
  "INSUFFICIENT_RESERVATION" | "STALE_QUOTE" | "NEEDS_REVIEW" | "INVALID_STATE" |
  "REQUEST_CONFLICT" | "NOT_ALLOWED";
```

Exported Zod schemas: `MoneySchema`, `SignedMoneySchema`, `PositiveMoneySchema`, `GoalStatusSchema`, `ReviewStateSchema`, `ReleaseLineSchema`, `ReservationMoveSchema`, `LeftoverChoiceSchema`, `TransactionDraftSchema`, `FinancialCommandSchema`, `TransactionQuoteSchema`, `FinancialResultSchema`, `WalletFundsSchema`, `GoalTotalsSchema`, `GoalFinanceGoalSchema`, `GoalFinanceSnapshotSchema`, `AllocationEventSchema`, `FinancialErrorCodeSchema`. SQL failure-to-error transport mapping remains for the planned client adapter task.

## Red evidence

Tests were written before implementation. The first invocation encountered a test parenthesis typo, which was corrected before accepting any red evidence. Full corrected missing-feature red output, command `npx vitest run tests/goal-summary.test.ts`, exit 1:

```text
 RUN  v3.2.7 C:/Users/PC/.codex/worktrees/goal-reservations/monetigia

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/goal-summary.test.ts [ tests/goal-summary.test.ts ]
Error: Failed to resolve import "@/lib/goals/contracts" from "tests/goal-summary.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: C:/Users/PC/.codex/worktrees/goal-reservations/monetigia/tests/goal-summary.test.ts:6:7
  6  |    MoneySchema,
  7  |    TransactionDraftSchema
  8  |  } from "@/lib/goals/contracts";
     |          ^
  9  |  import { fromMinorUnits, parseMoney, projectGoal, splitInstallments, summarizeGoal, toMinorUnits } from "@/lib/goals/...
  10 |  const goalId = "10000000-0000-4000-8000-000000000001";
 ❯ TransformPluginContext._formatLog ../../../../Documents/monetigia/node_modules/vite/dist/node/chunks/config.js:29079:43
 ❯ TransformPluginContext.error ../../../../Documents/monetigia/node_modules/vite/dist/node/chunks/config.js:29076:14
 ❯ normalizeUrl ../../../../Documents/monetigia/node_modules/vite/dist/node/chunks/config.js:27199:18
 ❯ ../../../../Documents/monetigia/node_modules/vite/dist/node/chunks/config.js:27257:32
 ❯ TransformPluginContext.transform ../../../../Documents/monetigia/node_modules/vite/dist/node/chunks/config.js:27225:4
 ❯ EnvironmentPluginContainer.transform ../../../../Documents/monetigia/node_modules/vite/dist/node/chunks/config.js:28877:14
 ❯ loadAndTransform ../../../../Documents/monetigia/node_modules/vite/dist/node/chunks/config.js:22746:26

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
   Start at  13:53:48
   Duration  1.18s (transform 10ms, setup 0ms, collect 0ms, tests 0ms, environment 610ms, prepare 186ms)
```

Throwing helper stubs and rejecting schema stubs then permitted collecting actual assertions: the same focused command exited 1 with `19 failed | 13 passed (32)`. Normalization, serialization, splitting, reserve/spend/release/move/reversal/legacy/clamping, projections, and schemas failed because their implementations were absent; rejection-only assertions passed with throwing stubs. `node --test tests/navigation-goals.test.cjs` exited 1, navigation passed and allocation failed with `Error: Not implemented`.

After implementing those behaviors, both suites passed (32 focused tests, 2 Node tests). Controller-requested zero-row installment safety and legacy date-overflow assertions then produced this additional full red output, command `npx vitest run tests/goal-summary.test.ts`, exit 1:

```text
 RUN  v3.2.7 C:/Users/PC/.codex/worktrees/goal-reservations/monetigia

 ❯ tests/goal-summary.test.ts (34 tests | 2 failed) 30ms
   ✓ exact PHP money > normalizes entry amounts and adds centavos exactly 2ms
   ✓ exact PHP money > rejects invalid entry -1 1ms
   ✓ exact PHP money > rejects invalid entry -0.00 0ms
   ✓ exact PHP money > rejects invalid entry NaN 0ms
   ✓ exact PHP money > rejects invalid entry Infinity 0ms
   ✓ exact PHP money > rejects invalid entry 1e3 0ms
   ✓ exact PHP money > rejects invalid entry 1.001 0ms
   ✓ exact PHP money > rejects invalid entry 90071992547409.92 0ms
   ✓ exact PHP money > rejects invalid entry  0ms
   ✓ exact PHP money > rejects invalid entry  1.00 0ms
   ✓ exact PHP money > rejects invalid entry +1 0ms
   ✓ exact PHP money > rejects invalid entry .5 0ms
   ✓ exact PHP money > rejects invalid entry 1. 0ms
   ✓ exact PHP money > serializes safe integer boundaries without rounding 1ms
   ✓ exact PHP money > splits installments with the remainder in the earliest rows 1ms
   × exact PHP money > rejects splits that would create zero-value transaction rows 6ms
     → expected [Function] to throw an error
   ✓ allocation event progress > reserving the target funds a goal without spending 1ms
   ✓ allocation event progress > goal spending preserves combined progress 0ms
   ✓ allocation event progress > releasing reservations lowers progress without recording spending 0ms
   ✓ allocation event progress > paired wallet moves preserve goal totals 8ms
   ✓ allocation event progress > paired goal moves preserve total reservations across goals 0ms
   ✓ allocation event progress > reversals restore reservation and spending amounts 0ms
   ✓ allocation event progress > never infers reservations or spending from legacy tags 0ms
   ✓ allocation event progress > keeps true amounts while clamping the display percentage 0ms
   ✓ allocation event progress > requires positive targets and rejects invalid deltas and totals 1ms
   ✓ pure cadence projection > monthly cadence uses remaining combined progress 1ms
   ✓ pure cadence projection > kinsenas cadence uses nine half-month cycles 0ms
   ✓ pure cadence projection > zero cadence or a funded goal gives no estimate 0ms
   ✓ pure cadence projection > keeps singular labels and existing half-cycle display conversion 0ms
   ✓ pure cadence projection > keeps cycle counts when projected dates exceed the calendar range 0ms
   × pure cadence projection > legacy projection callers delegate while tolerating their floating contribution totals 2ms
     → Invalid time value
   ✓ domain JSON parsing > money JSON must already be canonical decimal text 0ms
   ✓ domain JSON parsing > parses the command union and rejects invalid entry amounts 1ms
   ✓ domain JSON parsing > snapshot goal row monetary fields override raw numeric rows 1ms

⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/goal-summary.test.ts > exact PHP money > rejects splits that would create zero-value transaction rows
AssertionError: expected [Function] to throw an error

- Expected:
null

+ Received:
undefined

 ❯ tests/goal-summary.test.ts:48:48
     46|   });
     47|   test("rejects splits that would create zero-value transaction rows",…
     48|     expect(() => splitInstallments("0.01", 3)).toThrow(/centavo|instal…
       |                                                ^
     49|     expect(() => splitInstallments("0.00", 1)).toThrow();
     50|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  tests/goal-summary.test.ts > pure cadence projection > legacy projection callers delegate while tolerating their floating contribution totals
RangeError: Invalid time value
 ❯ Module.getProjection src/hooks/use-goals.ts:60:32
     58|       count: months,
     59|       unit: months === 1 ? "month" : "months",
     60|       projectedDate: projected.toISOString().slice(0, 10),
       |                                ^
     61|       monthlyAmount,
     62|       kinsenasAmount,
 ❯ tests/goal-summary.test.ts:130:14

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  1 failed (1)
      Tests  2 failed | 32 passed (34)
   Start at  13:56:21
   Duration  1.58s (transform 94ms, setup 0ms, collect 121ms, tests 30ms, environment 609ms, prepare 460ms)
```

## Green verification

`npx vitest run tests/goal-summary.test.ts`, exit 0:

```text
 RUN  v3.2.7 C:/Users/PC/.codex/worktrees/goal-reservations/monetigia

 ✓ tests/goal-summary.test.ts (34 tests) 29ms

 Test Files  1 passed (1)
      Tests  34 passed (34)
   Start at  13:56:46
   Duration  1.32s (transform 91ms, setup 0ms, collect 147ms, tests 29ms, environment 731ms, prepare 127ms)
```

`node --test tests/navigation-goals.test.cjs`, exit 0:

```text
✔ navigation ignores same route, fragments, external links and modified clicks (42.6099ms)
✔ allocation events preserve combined progress and never infer legacy funding (77.6235ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 405.2097
```

`npx tsc --noEmit`, exit 0, no output.

`npm test`, exit 0, full output:

```text
> monetigia@1.0.0 test
> node --test tests/navigation-goals.test.cjs && vitest run

✔ navigation ignores same route, fragments, external links and modified clicks (48.8188ms)
✔ allocation events preserve combined progress and never infer legacy funding (113.5781ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 468.6592

 RUN  v3.2.7 C:/Users/PC/.codex/worktrees/goal-reservations/monetigia

 ✓ tests/goal-summary.test.ts (34 tests) 27ms
 ✓ tests/navigation.test.tsx (2 tests) 73ms
 ✓ tests/contributions.test.tsx (8 tests) 2271ms
   ✓ Expense saves correct goal association and refreshes actual progress  350ms
   ✓ Transfer saves correct goal association and refreshes actual progress  369ms
   ✓ tagged installments count once, and untagged saves remain unassociated  542ms

 Test Files  3 passed (3)
      Tests  44 passed (44)
   Start at  13:57:05
   Duration  4.78s (transform 431ms, setup 0ms, collect 2.21s, tests 2.37s, environment 1.52s, prepare 306ms)
```

`git diff --check`, exit 0, no output.

## Self-review and limits

- New entry parsing accepts only decimal text, normalizes to two places, and rejects negative entries, nonfinite values, exponent notation, excess precision, and overflow. Signed canonical event deltas retain reversals.
- Amount sums use safe integer centavos; no floating money rounding occurs in the new ledger calculations. BigInt quotient/remainder avoids division rounding in installment rows and cycle counts; all returned money/count values are within the safe integer range.
- Final reserved/spent totals and each wallet's reservation must be nonnegative. Overflow rejects rather than returning rounded totals. Reservation moves preserve combined progress; only explicit allocation events count, including intentionally adopted `legacy_spent` events. Pure summaries cannot derive a legacy-tag amount and return null.
- Display percentage clamps at 100 while all true amounts stay intact. Projections mutate only a copied supplied Date and add no allocation events. Existing local-calendar month increments, 15-day payday increments, labels, and monthly/kinsenas numeric display conversions remain.
- Out-of-range dates return null with the exact cycle count retained. Zero cadence has no estimate. Installments reject totals smaller than the count in centavos, preventing zero-value transaction rows; no UI/count policy changed. The helper rejects counts beyond JavaScript array length capacity rather than inventing a product limit.
- The legacy projection wrapper must still normalize existing float contribution totals with toFixed(2). This is explicitly isolated to the legacy reader adapter; new AllocationEvent and snapshot schemas reject raw numeric money. Reader, transaction, and completion cutovers remain for their later approved tasks.
- Existing contribution Vitest coverage remains untouched and passed. No database tests were required or run for this pure domain task, and no database correctness/deployment claim is made.
- No unresolved Task 2 defect found in self-review. Independent review is controller-owned and still pending.

## Antislop delivery gate

- Hard Gate PASS for this domain-only change: no new UI or assets; no invented content or unsupported success claims. The 44 Vitest tests and 2 Node tests passed; TypeScript and diff whitespace checks exited 0. UI layout/contrast/theme/click-through items are not applicable to these files and are not claimed verified.
- Purpose Gate PASS: no visual technique added; numeric and legacy-boundary decisions have the concrete constraints documented above.
- Liveliness Gate PASS for scope: no screens generated; the brief's existing ENERGY 1 / RHYTHM 2 / MOTION 1 direction remains outside this pure calculation edit.
- Craftsmanship/Quality Locks PASS for scope: comments explain only the NUMERIC-text and temporary legacy compatibility constraints; no decorative/narrative comments or product copy added. Report claims follow observed command outputs.

## Task 2 review fix: installment count bound

Full review finding: `TransactionDraftSchema` accepted any positive safe integer installment count, while `splitInstallments` allowed values through `0xffffffff`. Calling the helper with a huge count could attempt an enormous `Array.from` allocation. The existing `AddTransactionModal` selector offers exactly 1 through 12 installments, so the approved fix exports `MAX_INSTALLMENTS = 12` from `contracts.ts` and applies it to both the schema and helper. The modal options were not changed.

### Red evidence

Added the safe count-13 helper case with an amount sufficient for 13 rows, plus schema rejection checks for 13 and `0xffffffff`. This demonstrates both old acceptance paths without asking the old helper to allocate a huge array.

Command: `npx vitest run tests/goal-summary.test.ts`, exit 1:

```text
 RUN  v3.2.7 C:/Users/PC/.codex/worktrees/goal-reservations/monetigia

 ❯ tests/goal-summary.test.ts (36 tests | 2 failed) 30ms
   ✓ exact PHP money > normalizes entry amounts and adds centavos exactly 2ms
   ✓ exact PHP money > rejects invalid entry -1 1ms
   ✓ exact PHP money > rejects invalid entry -0.00 0ms
   ✓ exact PHP money > rejects invalid entry NaN 0ms
   ✓ exact PHP money > rejects invalid entry Infinity 0ms
   ✓ exact PHP money > rejects invalid entry 1e3 0ms
   ✓ exact PHP money > rejects invalid entry 1.001 0ms
   ✓ exact PHP money > rejects invalid entry 90071992547409.92 0ms
   ✓ exact PHP money > rejects invalid entry  0ms
   ✓ exact PHP money > rejects invalid entry  1.00 0ms
   ✓ exact PHP money > rejects invalid entry +1 0ms
   ✓ exact PHP money > rejects invalid entry .5 0ms
   ✓ exact PHP money > rejects invalid entry 1. 0ms
   ✓ exact PHP money > serializes safe integer boundaries without rounding 1ms
   ✓ exact PHP money > splits installments with the remainder in the earliest rows 1ms
   × exact PHP money > caps installment splitting at the existing twelve choices 5ms
     → expected [Function] to throw an error
   ✓ exact PHP money > rejects splits that would create zero-value transaction rows 0ms
   ✓ allocation event progress > reserving the target funds a goal without spending 1ms
   ✓ allocation event progress > goal spending preserves combined progress 0ms
   ✓ allocation event progress > releasing reservations lowers progress without recording spending 0ms
   ✓ allocation event progress > paired wallet moves preserve goal totals 8ms
   ✓ allocation event progress > paired goal moves preserve total reservations across goals 0ms
   ✓ allocation event progress > reversals restore reservation and spending amounts 0ms
   ✓ allocation event progress > never infers reservations or spending from legacy tags 0ms
   ✓ allocation event progress > keeps true amounts while clamping the display percentage 0ms
   ✓ allocation event progress > requires positive targets and rejects invalid deltas and totals 1ms
   ✓ pure cadence projection > monthly cadence uses remaining combined progress 1ms
   ✓ pure cadence projection > kinsenas cadence uses nine half-month cycles 0ms
   ✓ pure cadence projection > zero cadence or a funded goal gives no estimate 0ms
   ✓ pure cadence projection > keeps singular labels and existing half-cycle display conversion 0ms
   ✓ pure cadence projection > keeps cycle counts when projected dates exceed the calendar range 0ms
   ✓ pure cadence projection > legacy projection callers delegate while tolerating their floating contribution totals 1ms
   ✓ domain JSON parsing > money JSON must already be canonical decimal text 0ms
   ✓ domain JSON parsing > parses the command union and rejects invalid entry amounts 1ms
   × domain JSON parsing > limits transaction draft installments to the existing twelve choices 2ms
     → expected true to be false // Object.is equality
   ✓ domain JSON parsing > snapshot goal row monetary fields override raw numeric rows 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/goal-summary.test.ts > exact PHP money > caps installment splitting at the existing twelve choices
AssertionError: expected [Function] to throw an error

- Expected: 
null

+ Received: 
undefined

 ❯ tests/goal-summary.test.ts:49:50
    47|   test("caps installment splitting at the existing twelve choices", ()…
    48|     expect(splitInstallments("12.00", 12)).toEqual(Array(12).fill("1.0…
    49|     expect(() => splitInstallments("13.00", 13)).toThrow(/12/);
       |                                                  ^
    50|   });
    51|   test("rejects splits that would create zero-value transaction rows", ()…

 FAIL  tests/goal-summary.test.ts > domain JSON parsing > limits transaction draft installments to the existing twelve choices
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/goal-summary.test.ts:164:95
    162|     expect(TransactionDraftSchema.safeParse({ ...draft, installments: …
    163|     for (const count of [13, 0xffffffff]) {
    164|       expect(TransactionDraftSchema.safeParse({ ...draft, installments…
       |                                                                                               ^
    165|     }
    166|   });

 Test Files  1 failed (1)
      Tests  2 failed | 34 passed (36)
```

### Green evidence

`src/lib/goals/contracts.ts` exports the shared cap and constrains the draft schema. `src/lib/goals/summary.ts` uses the same cap and rejects over-limit counts before `Array.from`. Tests accept and exactly split 12 rows, reject 13 in both paths, reject `0xffffffff` in both paths, and spy on `Array.from` to confirm the helper rejects the huge count before allocation.

Command: `npx vitest run tests/goal-summary.test.ts`, exit 0:

```text
 RUN  v3.2.7 C:/Users/PC/.codex/worktrees/goal-reservations/monetigia

 ✓ tests/goal-summary.test.ts (37 tests) 39ms

 Test Files  1 passed (1)
      Tests  37 passed (37)
   Start at  14:10:01
   Duration  1.41s (transform 89ms, setup 0ms, collect 118ms, tests 39ms, environment 568ms, prepare 347ms)
```

`node --test tests/navigation-goals.test.cjs`, exit 0: 2 tests passed, 0 failed. `npm test`, exit 0: 2 Node tests and all 47 Vitest tests passed across 3 files (37 goal summary, 2 navigation, 8 contributions). `npx tsc --noEmit`, exit 0 with no output. `git diff --check`, exit 0; Git emitted only its LF-to-CRLF working-copy notices.

### Review-fix file list and result

- `src/lib/goals/contracts.ts`: add exported `MAX_INSTALLMENTS = 12` and validate transaction draft counts against it.
- `src/lib/goals/summary.ts`: reject counts greater than the same constant before constructing rows.
- `tests/goal-summary.test.ts`: cover the cap, exact 12-row split, schema rejection, and no-allocation rejection of `0xffffffff`.
- `.superpowers/sdd/2026-10-06-goal-reservations/task-2-report.md`: append this review-fix evidence; the report is ignored by Git.

No other Task 2 behavior or UI options changed. The original “no UI/count policy changed” self-review line above describes the pre-review commit; this review fix now enforces the existing 12-choice policy at the domain boundaries. No Task 3+ work was done.

## Task 2 fix round 1 re-review

- **Huge installment count can trigger unbounded Array.from allocation** — ADDRESSED. `MAX_INSTALLMENTS` is shared as 12 in `src/lib/goals/contracts.ts:5`; draft schema caps counts at that value in `src/lib/goals/contracts.ts:33`, and `splitInstallments` rejects larger counts before `Array.from` in `src/lib/goals/summary.ts:26-33`. Acceptance evidence: 12 is accepted and split into twelve rows; 13 and `0xffffffff` are rejected in helper and schema tests (`tests/goal-summary.test.ts:47-66,178-181`). The huge-count test spies on `Array.from` and confirms it is not called. Existing zero-centavo row protection remains at `summary.ts:31` and is covered by `tests/goal-summary.test.ts:68-70`.
- **Red evidence:** fix report records the pre-fix failures for the 13-row helper and draft schema count tests (34 passing, 2 failing).
- **Green evidence:** fix report records `npx vitest run tests/goal-summary.test.ts` exit 0 (37 tests), `node --test tests/navigation-goals.test.cjs` exit 0 (2 tests), `npm test` exit 0 (47 Vitest plus 2 Node tests), and `npx tsc --noEmit` exit 0. Controller additionally reports 10 DB/TSC/lint/build checks exited 0. Suites were not rerun.

### New Breakage in the Fix Diff

None.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
