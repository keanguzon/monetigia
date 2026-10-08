# Task 6a brief: Complete debt snapshot, legacy adoption and client contract

**Executor:** Luna max. **Review:** Sol low for each unit. **Scope:** Rollout Task 6 backend/read-model portion, detailed-plan Task 4 plus the command client required by Task 6 UI. Start only after reviewed Task 4b and both Task 5 units. No Add Wallet presentation, selection UI, production SQL execution, installs, subagents, commits or pushes.

Read [master rollout](../../superpowers/plans/2026-10-08-pending-rollout.md), [approved design](../../superpowers/specs/2026-10-07-existing-debt-selection-design.md), [detailed plan](../../superpowers/plans/2026-10-07-existing-debt-selection.md), [4b](task-4b-brief.md), [5](task-5-brief.md), and their actual reviewed implementation. The older claim that All months still omits the initial balance is stale: `accounts/page.tsx` now uses current account balances for All months. Preserve that fix and replace the separately truncated transaction/month arithmetic with the complete snapshot. Creation did not deliver a partial `debt_snapshot`; this task owns the first complete public contract.

## Files and bounded units

Unit 6a.1 creates `supabase/migrations/202610080005_debt_snapshot_adoption.sql`, `tests/database/debt-snapshot.test.mjs`, `tests/database/debt-adoption.test.mjs`, `tests/debt-snapshot-contracts.test.ts`; extends `src/lib/debt/contracts.ts`, `src/lib/goals/contracts.ts`, `src/types/database.ts`, newest-state restoration helper/list. Check migration filename/chronology again at execution.

Unit 6a.2 creates `src/lib/debt/client.ts`, `src/hooks/use-debt.ts`, `tests/debt-client.test.ts`, `tests/debt-hooks.test.tsx`; narrowly extends `src/lib/goals/client.ts` to share existing error classification, and `src/lib/refresh-financial-data.ts` for owner-scoped debt cache invalidation. Keep existing finance/session recovery behavior.

Unit 6a.3 modifies `src/app/(dashboard)/accounts/page.tsx`, `src/components/accounts/DebtScheduleSection.tsx`; creates `src/lib/debt/summary.ts`, `src/components/accounts/LegacyDebtReviewDialog.tsx`, `tests/debt-summary.test.ts`, `tests/debt-snapshot-view.test.tsx`, `tests/debt-adoption-ui.test.tsx`. This is a separate bounded consumer unit after backend/client review. It supplies the real Needs due-date review action; 6b supplies shared debt fields first if needed, so execute 6a.1 -> 6a.2 -> 6b shared fields -> 6a.3. Do not improvise a duplicate field component. Root may dispatch 6a.3 separately with the same Luna max assignment; completing backend alone does not complete master Task 6.

## Exact public contract

Preserve the detailed plan's required row/account fields and explicitly add the information the correction/adoption UI requires:

```ts
export type DebtDueRow = {
  id: string; accountId: string; groupId: string;
  source: 'opening'|'purchase'; transactionId: string|null;
  dueDate: string|null; originalAmount: Money; paidAmount: Money; remainingAmount: Money;
  correctedAmount: Money; ordinal: number; name: string;
};
export type DebtAccountSnapshot = {
  accountId: string; totalOutstanding: Money; undatedOutstanding: Money;
  fingerprint: string; reconciliation: 'balanced'|'needs_review';
  reconciliationDelta: Money; // signed canonical decimal text; schema uses SignedMoneySchema
};
export type DebtSnapshot = { accounts: DebtAccountSnapshot[]; rows: DebtDueRow[] };
export const DebtDueRowSchema: z.ZodType<DebtDueRow>;
export const DebtSnapshotSchema: z.ZodType<DebtSnapshot>;
export type AdoptOpeningDebtCommand = {
  kind: 'adopt_opening_debt'; accountId: string;
  items: OpeningDebtDraft[]; fingerprint: string;
};
export const AdoptOpeningDebtCommandSchema: z.ZodType<AdoptOpeningDebtCommand>;
```

All snapshot money is canonical decimal **text**, including zeros, with safe-centavo validation. `original - paid - corrected = remaining >=0` for each row. A reversed payment can restore positive remaining on a previously corrected row; correction event remains. Row/group UUIDs are stable; `transactionId` is null only for opening rows. Purchase name derives actual description/category fallback, never ownership/group inference. Single purchase ordinal is 1; installment ordinal comes from proven operation result order/retained metadata, not editable description. Opening ordinal comes from due rows. Keep paid/fully corrected rows in the read model for audit; projection sums only remaining. No 5000-row client query, silent RPC cap or paginated subset disguised as the whole snapshot.

```sql
public.debt_snapshot() RETURNS jsonb
-- Exact output: DebtSnapshot
```

SECURITY DEFINER, fixed `search_path=pg_catalog,public`, require `auth.uid()`, owner-filtered account/row/event reads, authenticated-only execute with other role grants revoked. Reuse Task 5's private `debt_account_state(p_owner,p_account_id)` for every owner credit account. A single stable database statement/snapshot or owner-serialized consistent read must not mix pre-payment balances with post-payment events. The private helper must include complete purchases + opening dues + undated residual, including inactive account debt for truthful owner totals; writes still require an active PHP credit account. Unsupported currencies must produce review/unavailable behavior, never add currencies together as PHP.

`totalOutstanding=max(account.balance,0)` is authoritative. On balanced accounts, `totalOutstanding=sum(remaining dated/known rows)+undatedOutstanding`; existing unknown dates stay null, and unknown principal is the undated residual. Proven actual payment/refund history affects recognized remaining once via Task 5 provenance rules. If recognized obligations cannot reconcile, return authoritative total, `reconciliation:'needs_review'`, the signed difference `totalOutstanding - sum(known remaining)`, and a nonnegative truthful undated amount where available. Do not clamp an over-recognized schedule to look balanced or rewrite account balances. In review state disable scheduled deduction/adoption/correction rather than presenting the disputed schedule as payable truth. User-visible total remains available with explicit review feedback.

Add adoption to the current `FinancialCommandSchema`/dispatcher. Strict keys, UUID account, lowercase SHA256 fingerprint, nonempty items, exact creation limits: <=100 items, <=6000 rows, each 1..600, single count1, canonical positive amounts <=`9999999999999.99`, exact valid date endpoints, aggregate range, unique clientIds, name limits. Import 4b schemas/SQL validator and 4a schedule semantics; no weaker second validator. Adopt command uses unchanged FinancialResult with `transactionIds: []` and no transaction quote.

Adoption locks owner before replay registry, then existing financial lock order, recomputes account fingerprint/reconciliation under lock, requires a balanced owned active PHP credit wallet and positive undated residual, and requires sum(items.amount) equal the **entire current undated residual**. Insert opening items/due rows under this adoption operation without increasing balance. Never convert existing scheduled rows again, infer original purchases or past paid installments, touch cash/reservations/history, or backfill fake transactions. Identical completed replay wins before stale check; changed request content conflicts. New command with stale fingerprint rejects `STALE_QUOTE`; mismatched sum/review state rejects without partial writes.

## Unit 6a.1: Complete SQL and adoption

- [ ] Add named failing snapshot/adoption/contract tests and run `npx vitest run tests/debt-snapshot-contracts.test.ts` plus `node --test --test-concurrency=1 tests/database/debt-snapshot.test.mjs tests/database/debt-adoption.test.mjs` only on an explicitly disposable database.
- [ ] Implement snapshot, adoption contract/SQL branch and exact database types; preserve the Task 5 adapter and final dispatcher definitions. Do not change purchase cap12 or front-remainder defaults, money range or opening count600.
- [ ] Prove fixture initial5000 + purchases2000 - proven payment400 => total6600, dated1600, undated5000; All months6600. Opening-only, purchase-only, mixed, zero-debt and inactive owner accounts return truth; cross-owner rows are absent. >5000 purchase/payment records still reconcile without truncation. Existing purchase IDs/groups/due dates remain actual; undated legacy has no invented date. Missing provenance/discrepancy returns review state and unchanged balances. Include refunds, credit advances, corrections and payment reversals using their actual provenance.
- [ ] Prove residual5000 adoption into 3000+2000 yields the same account balance/cash/goals/payment records, exact dated rows and undated0. Partial sum, over sum, zero residual, stale payment/correction, mixed owner, invalid item/name/date/count/range, duplicate client ID and aggregate allocation excess roll back item/row/operation creation. Concurrent identical UUID creates once; different commands conflict; same UUID replay after later payment returns original result. A formerly undated payment reversal after adoption returns its originally undated portion to review residual, without changing adopted principal or fabricating payment rows.
- [ ] Run focused SQL/contracts, existing settlement/correction/lifecycle tests and typecheck. Sol low reviews reconciliation, stable mapping, signed discrepancy, security, date/centavo parity and no double balance effect before 6a.2.

## Unit 6a.2: Authenticated client and durable write recovery

New APIs, **not existing APIs at drafting**:

```ts
export async function fetchDebtSnapshot(
  expectedUserId: string, isCurrentRequest?: () => boolean
): Promise<DebtSnapshot>;
export async function createDebtAccount(input: DebtAccountCreateInput): Promise<DebtAccountCreateResult>;
export function useDebt(userId: string|null): {
  snapshot: DebtSnapshot|undefined; isLoading: boolean; error: unknown;
  refresh: () => Promise<unknown>;
};
export function useDebtAccountCreate(userId: string|null): {
  isSaving: boolean; unresolved: boolean; saved: DebtAccountCreateResult|null;
  error: string|null; refreshError: unknown|null;
  create: (input: Omit<DebtAccountCreateInput,'requestId'>) => Promise<void>;
  retry: () => Promise<void>; reset: () => void;
};
export function useDebtCommand(userId: string|null): {
  isSaving: boolean; unresolved: boolean; saved: FinancialResult|null;
  error: string|null; refreshError: unknown|null;
  submit: (command: CorrectDebtRowsCommand|AdoptOpeningDebtCommand) => Promise<void>;
  retry: () => Promise<void>; reset: () => void;
};
```

Transport creation maps exactly to 4b `debt_account_create({ p_request_id: input.requestId, p_account: input.account, p_opening_debts: input.openingDebts })`, validates request/result with 4b schemas and calls no direct table insert. Correction/adoption transport uses existing `applyFinancialCommand`. Export the existing private error classifiers from goals client as `readFinancialRpcError(error: unknown, ambiguousOutcome?: boolean): FinancialCommandError` and `unknownFinancialOutcome(error: unknown): FinancialCommandError`, updating existing internal callers without changing semantics. Debt transport must share them: known server rejection is rejected; thrown network/5xx ambiguous response or malformed success result is unknown. Update their focused tests. No new transport error vocabulary silently incompatible with current controllers.

Owner-keyed controllers preserve an immutable request ID and exact payload across timeout, component unmount, closing/reopening, route change and retry. `retry` explicitly resends the same attempt; `create`/`submit` cannot replace an unresolved attempt or issue a second simultaneous write. `reset` cannot discard saving/unresolved state. Auth-check the original owner before every attempt; another signed-in user cannot see/resend it. Successful save clears the attempt before refresh; refresh failure records `saved` plus `refreshError`, enabling **refresh-only** recovery through `useDebt.refresh`, never another creation/adoption. Same-user token renewal must retain recovery; signing out hides data. No localStorage financial payloads, offline writes, background retry or service-worker private cache.

The snapshot key is exactly `['debtSnapshot', userId]`. Match current `useGoalFinance` session-token binding and identity/revision protections, including same-user refresh recovery; share/factor only if scoped tests cover the existing hook. Clear scoped debt snapshot data on signout; do not publish another owner's stale response. Add this key to `refreshFinancialData` matching/filtering, preserving scoped cache error reporting and existing goal/account/history invalidation.

- [ ] RED/GREEN tests cover correct RPC args/result decimals, malformed success unknown, known rejection, no auto replay, duplicate click, immutable unknown attempt after close/remount, owner switch/out-of-order snapshot response, token renewal, request conflict, same-ID retry, saved-refresh-failed versus failed-save and owner-scoped cache invalidation. Run `npx vitest run tests/debt-client.test.ts tests/debt-hooks.test.tsx tests/goal-finance-client.test.ts tests/goal-finance-hooks.test.tsx tests/transaction-release.test.tsx tests/wallet-reservations.test.tsx`, then typecheck and Sol low review.

## Unit 6a.3: Wallet summary and real legacy review action

`summarizeDebt(snapshot: DebtSnapshot, selectedMonths: string[]|null)` in new summary module returns `{ totalOutstanding: Money, scheduledDebt: Money|null, undatedOutstanding: Money, needsReviewAccountIds: string[] }`. `null` selection means All months; month strings are strict YYYY-MM. Sum with safe exact centavos/BigInt, fail on overflow instead of floats. Scheduled debt is null when relevant reconciliation is reviewed. No total inferred from fetched transaction subsets.

Change DebtScheduleSection to consume `{ snapshot: DebtSnapshot|undefined; isLoading: boolean; error: unknown; onPayDebt?: (accountId?: string)=>void; onReviewLegacy: (accountId:string)=>void }` and group its owned known remaining rows by real due month. Keep zero-remaining audit rows available to later history consumers without counting them as payable. Use actual account IDs for pay action, not always first credit wallet. Opening groups are labeled Existing debt; purchase groups retain real description; undated residual is separately Needs due-date review. Loading/error/review states remain visible and no stale success total is masqueraded as fresh.

`LegacyDebtReviewDialog({ isOpen, onClose, account: DebtAccountSnapshot|null })` uses 6b ExistingDebtFields and `useDebtCommand`, displays current residual and complete exact sum before explicit confirm. Cancel/Escape writes nothing; server stale rejects, refreshes, preserves draft, and requires renewed confirmation with the new fingerprint. Unknown outcome permits same-attempt retry; successful-refresh failure gives refresh-only action. It never creates a new wallet. In `accounts/page.tsx`, keep current authoritative All months behavior while wiring snapshot totals; selected-month label remains Scheduled Debt, undated labels remain visible, and deduction preview uses exactly the amount its label promises. Month selection does not constrain payment allocation (Task 5 ruling). Preserve existing wallet creation/order/name/interest/navigation behavior.

- [ ] RED/GREEN summary/view/adoption tests prove 6600 total vs1600 schedule and5000 review residual, no double deduction, no 5000-row cap, mixed month selection, exact cents, no invented due/purchase date, source labels, unresolved state, stale fingerprint, amount mismatch and cancel no-write. Run `npx vitest run tests/debt-summary.test.ts tests/debt-snapshot-view.test.tsx tests/debt-adoption-ui.test.tsx tests/wallet-reservations.test.tsx` and typecheck; root verifies 320/375/768/1280, both themes, keyboard/200% zoom and readable long rows. Sol low review before completion.

## Final state and release prerequisite

Extend the newest-state restoration sequence through archived restore, actual 4b, both 5 migrations and this migration, after older guards/dispatcher suites. Verify authenticated snapshot/adoption/correction/create and archived restore, anonymous/service-role restrictions for new private/authenticated-only RPCs, helper execute denial and account history guards on the final installed functions. Run actual focused DB commands and record current results, never historical counts. Root applies reviewed chronological SQL and confirms runtime RPC behavior before dependent frontend release. Return reviewed contracts and exact test evidence to 6b/Task 7. Public snapshot is complete only when every owned source is represented or honestly flagged for review.
