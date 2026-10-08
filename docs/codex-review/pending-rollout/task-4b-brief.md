# Task 4b brief: Atomic opening-debt creation

**Executor:** Sol 6.1 high. **Review:** Sol medium. **Planning:** Sol medium. Implement only detailed-plan Task 2's secured opening-debt storage and atomic account creation. No UI, payment/correction/adoption implementation, new purchase capability, commits or pushes.

Read [detailed plan](../../superpowers/plans/2026-10-07-existing-debt-selection.md), [approved design](../../superpowers/specs/2026-10-07-existing-debt-selection-design.md), [Task 4a brief](task-4a-brief.md), [rollout](../../superpowers/plans/2026-10-08-pending-rollout.md) and AGENTS.md. Task 4a is a dependency: its planned library files were absent at this drafting inspection. Re-read their actual reviewed implementation before coding this task; preserve their names and APIs. No independent copy of the frontend schedule algorithm.

## Source map and dependency boundary

Create `supabase/migrations/202610080002_existing_debt_creation.sql`. This filename is unused at inspection and chronologically follows archived restore `202610080001_archived_goal_restore.sql`; check again before writing, and choose the next unused chronological suffix if another worker has occupied it. Never rename or edit already released SQL.

Extend `src/lib/debt/contracts.ts` with complete creation input/result schemas and types, retaining Task 4a exports. Modify `src/types/database.ts` with the two new table types and the creation RPC signature. Create `tests/debt-creation-contracts.test.ts` and `tests/database/existing-debt.test.mjs`. Modify `tests/database/helpers.mjs` only to add a newest-state migration installation helper if needed; update the existing final-state test's restoration list so old guard SQL cannot silently revoke the new RPC after tests. No frontend hook/client wrapper yet.

Read existing baseline account column types, `financial_operations`, `accounts_owner_id_key`, `guard_financial_identity`, `guard_financial_opening`, all RLS/grants, archived restore's owner-first replay lane, and test harness. Do not replace the financial dispatcher or unknown outcome/recovery controller.

**Explicit narrowing:** The detailed plan also lists `debt_snapshot()`, settlement and correction storage. A complete snapshot requires purchase schedule mapping and payment allocation from later tasks. Do not return all legacy/purchase balances as fabricated undated debt or expose a partial RPC under that complete contract. Retain the planned snapshot interface for Task 6; Task 4b's deliverable is creation plus owner-scoped direct reads for tests. Task 5 adds the audited settlement/correction event model. Report this boundary in handoff.

## Exact creation contract

PostgreSQL RPC:

```sql
public.debt_account_create(p_request_id uuid, p_account jsonb, p_opening_debts jsonb)
RETURNS jsonb
```

Returns `{ accountId: uuid, debtItemIds: uuid[], replayed: boolean }`; returned item IDs match request array order. No invented transaction IDs or purchase dates. Use the existing `(user_id,request_id)` operation registry, not a second idempotency table.

Extend the debt contract exports:

```ts
export const OpeningDebtDraftSchema: z.ZodType<OpeningDebtDraft>;
export const DebtAccountCreateInputSchema: z.ZodType<DebtAccountCreateInput>;
export const DebtAccountCreateResultSchema: z.ZodType<DebtAccountCreateResult>;
export type DebtAccountCreateInput = {
  requestId: string;
  account: {
    name: string; type: 'credit_card'; currency: 'PHP';
    color: string|null; icon: string|null;
    is_savings: false; interest_rate: 0;
    include_in_networth: boolean; display_order: number;
  };
  openingDebts: OpeningDebtDraft[];
};
export type DebtAccountCreateResult = {
  accountId: string; debtItemIds: string[]; replayed: boolean;
};
```

All input objects are strict; reject unknown keys. RPC account payload has the same `account` shape, excludes `requestId`; debt array has the exact Task 4a `OpeningDebtDraft` keys. Do not accept client owner/account ID, initial balance, active status or table names. Derive owner from `auth.uid()`, generate IDs server-side, create active PHP credit account, and set its balance from opening-debt total exactly once. Empty array creates zero-debt credit wallet. Ordinary wallet creation remains untouched.

Validation in TS and SQL:

- Account name and debt name are trimmed, nonempty, maximum 60 characters. Accept duplicate debt names but reject duplicate `clientId` within one request. `clientId` is an opaque nonempty string up to 100 characters, not an owner/row ID. No silent truncation. Account color is null or strict six-digit hex; icon is null or a basename of existing image format, no slash/backslash or URL. `display_order` is a nonnegative int32. Booleans/numbers/strings must have their real JSON types, never cast permissively from text.
- Array limit 100 items and aggregate at most 6000 due rows per request. These bounded creation limits protect the owner lock from unbounded allocation; report them to later UI. Each item's count remains numeric safe integer 1..600; single mode requires 1, installments accepts 1..600, including 2/24. Raw typed digits-only parsing belongs to Task 4a; RPC rejects count string, exponent-as-string, decimals, zero, negatives and 601.
- Each amount is canonical positive decimal text with exactly two decimals. Existing `accounts.balance` is numeric(15,2) and opening guard requires balance < 10000000000000 PHP. Enforce each item AND aggregate total <= `9999999999999.99` before any typmod assignment; reject excess scale rather than rounding. Existing shared Money allows a larger safe-centavo range, so tighten ONLY `OpeningDebtDraftSchema`/creation boundary. No weakening shared Money or widening account columns.
- Date is exact valid YYYY-MM-DD in PostgreSQL/JS common range years 0001..9999; reject impossible dates and schedule overflow before inserting any persistent result. Allow overdue opening debt; no purchase-date comparison/input.

## Storage and invariants

Create `public.debt_items`: `id uuid`, `user_id uuid`, `account_id uuid`, `operation_id uuid`, `client_id text`, `name text`, `source text`, `mode text`, `original_amount numeric`, `first_due_date date`, `remaining_months integer`, `created_at timestamptz`. Source in this task is `opening`; later purchase mapping must extend it deliberately. Unique `(user_id,id)` and `(user_id,operation_id,client_id)`; owner-composite FK to accounts and financial_operations. Persist original amount as unconstrained numeric with positive/scale<=2/range checks to prevent automatic centavo rounding.

Create `public.debt_due_rows`: `id uuid`, `user_id uuid`, `debt_item_id uuid`, `ordinal integer`, `due_date date`, `original_amount numeric`, `created_at timestamptz`. Owner-composite FK to debt_items; unique `(user_id,id)` and `(user_id,debt_item_id,ordinal)`. Each amount positive, scale<=2, within creation range, ordinal 1..600. Paid/corrected amounts are not editable mutable counters here; later Task 5 derives them from audited events.

Enable RLS with authenticated owner-select policy, REVOKE ALL for PUBLIC/anon/authenticated then GRANT SELECT only to authenticated. No authenticated direct insert/update/delete grants or permissive write policies. SECURITY DEFINER creation uses fixed `search_path=pg_catalog,public`, qualified objects, explicit owner checks. REVOKE function execute from PUBLIC/anon/authenticated/service_role, then grant only authenticated. Helper functions get no client execute grants. Do not broaden existing account/operation grants.

History must not disappear through the existing account DELETE grant: extend the existing account identity/delete guard in this additive migration to also reject deletion of an account with debt_items, retaining its current transaction/allocation checks and auth-user cascade exception. Preserve operation/debt rows on ordinary user writes. Owner-composite FKs prevent cross-user attachment even through privileged fixture inserts. No trigger that blocks legitimate auth-user cleanup in disposable tests.

Atomic creation changes only: one new account with derived debt balance, its obligation items/due rows, and one completed operation. Existing cash balances, goals/reservations, transactions and payment history remain unchanged. Do not backfill existing accounts or create purchase/expense/cash movement rows.

## Locks, replay and exact schedule

1. Require authenticated UID, nonnull UUID request and valid typed payload. Normalize only documented trimming/defaults; store a complete command JSON containing kind `create_debt_account`, normalized account and ordered debt items. Compute SHA256 using existing operation conventions; compare both hash and JSON on replay.
2. Acquire the owner `public.users` row FOR UPDATE before operation lookup and before account/debt mutation. This serializes with current financial commands. Existing owner lookup must succeed. Do not lock another owner or use item order to determine lock order. No existing goals/accounts need mutation; if any existing financial row is locked, follow current owner -> goals sorted ID -> accounts sorted ID ordering.
3. Lookup existing `(user_id,request_id)`: identical completed command returns original account/item IDs with replayed true; different command produces REQUEST_CONFLICT; incomplete/missing result fails closed. Same UUID used by another command kind conflicts. Another owner may use the same UUID independently.
4. Validate every item, totals and date endpoints; insert operation, account/items/rows and completed result in one SQL transaction. Any exception rolls everything back, including operation. Successful rerun must not add another account or debt row. Do not swallow SQL errors into success.
5. Opening schedule parity: integer numeric centavos, base=floor(total/count), rows 1..count-1=base, final=total-base*(count-1). Require base>=1. Anchor each due date to original first_due_date plus ordinal-1 months with month-end clamping; never iteratively advance a clamped February day. Compare SQL output against approved Task 4a examples.

Current purchase behavior remains 12 maximum and earliest-row remainder. Do not widen `MAX_INSTALLMENTS`, modify `goal_normalize_transaction`, quote/apply dispatcher or purchase splitter defaults in this task. Opening-debt creation now gets its own reviewed 600/final-remainder SQL parity. Purchase cap/date-validation coordination is still a later explicit deliverable, rather than an accidental effect of this migration.

## RED/GREEN verification steps

- [ ] Add failing creation-contract tests for strict objects/types, 2/24/600, single count 1, positive exact money, total database range, valid/invalid dates, duplicate client ID, zero-debt wallet, limits and overlength names. Run `npx vitest run tests/debt-creation-contracts.test.ts`; record actual RED result.
- [ ] Add `tests/database/existing-debt.test.mjs` using existing fixture/harness, isolated users and final migration installation. Run `node --test --test-concurrency=1 tests/database/existing-debt.test.mjs` only with existing disposable DB configuration; record missing-RPC/table RED failures, not a live-project write. Do not print credentials or reset any project.
- [ ] Assert two debts 16000 + 3000 yield one account balance 19000, two items, correct rows, zero new transactions and unchanged fixture cash/goals/events. Empty debts yields zero. Same UUID/payload replay returns same IDs; concurrent identical calls create once; changed amount/name/order/command conflicts; same UUID other owner is independent; owner/profile absence and anonymous/service-role execution reject.
- [ ] Assert one invalid item among valid items rolls back account/items/rows/operation; 24 and 600 rows sum exact; 1000/3 is 333.33/333.33/333.34; 0.05/3 is 0.01/0.01/0.03; Jan31 clamps Feb28/29 then returns Mar31; first due is entered date, overdue accepted. Reject invalid JSON counts/scale/type/date/range, total under one centavo per row, duplicate client IDs and aggregate overflow. Repeated migration applies preserve successful records.
- [ ] Assert cross-owner reads empty, direct authenticated insert/update/delete denied on both new tables, composite FK owner mismatch fails, account deletion with debt history rejects, and existing normal account fixture cleanup remains possible via auth-user deletion. Verify request replay registry uses original owner boundary.
- [ ] Implement additive migration/types/contracts, then rerun focused TS/DB tests and `npx tsc --noEmit`. Run existing migration-security, ledger, financial-transactions, archived-goal and installment-final-state DB tests against the FULL final chronological migration sequence. Older suites reapply old guard SQL: install latest archived/debt migrations last and rerun final authenticated RPC/grant assertions; update restoration helper/list to prevent stale installed grants after tests.
- [ ] Sol medium reviews locks/idempotency/range/owner composite FKs/delete guard/grants and unchanged purchase behavior. Record exact exits/assertions and limitations, return reviewed diff to root. No production migration execution or dependent frontend push from this executor. Root applies reviewed SQL before later frontend release under user authorization.

## Genuine contract risks to carry forward

Task 4a's pure Money maximum exceeds account storage; creation-boundary rejection must be explained in later UI. Full debt_snapshot is deferred until purchase mapping and settlement exist; this task cannot claim complete debt reconciliation. New 100-item/6000-row limits must be honored by later UI. Existing database test guard reinstallation can revoke new definer RPC grants unless newest migrations are applied last. Current purchase cap/remainder remains distinct by design, and no opening-debt UI may ship before this SQL is verified installed.
