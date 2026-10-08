# Task 5.1c review

**Final scoped review: Spec PASS. Quality PASS.** Reviewed the actual final settlement migration addition and three changed DB test files against task-5-brief.md and the reviewed private adapter. No SQL, tests, dependencies or product files were changed by this reviewer; no tests were repeated.

## Resolved finding

The FIFO regression previously assumed the 500-amount November item would sort before the 300-amount item despite randomly generated group UUIDs. The final test derives the first allocation from the sorted row's remaining amount and the second from the payment remainder. It now accepts either valid UUID order while still asserting the correct targets and partial allocation. The current handoff reports fresh focused GREEN evidence after this fix.

## Implementation checks

- The migration patches the newest quote/private apply definitions in place with explicit match failures. Existing function identities, private apply permissions, fixed search paths, public dispatcher, purchase-date metadata and reservation branches are retained.
- Only the payment month ceiling changes to authoritative total outstanding. Actual cash, debt-goal reservation, release planning and quote freshness checks remain. The fingerprint includes the complete private debt state.
- Existing owner serialization and completed-request replay precede sorted goals/accounts, followed by deterministic adapter-target locks. Allocation snapshots precede the real transfer, and only the existing transfer branch updates balances. Settlement bookkeeping does not subtract money again.
- Dated allocation follows the adapter's due-date/group/ordinal/UUID order, caps each allocation by exact positive remaining principal, then emits one residual event for the remainder. Entered payment date is retained.
- Payment deletion retains existing money and goal-reservation validation/reversal. Its BEFORE DELETE trigger locates the active owned deletion operation and appends source-equal reversals to the original targets, preserving payment provenance. Owner serialization, completed replay and unique reversal references prevent repeated effects.
- Credit advances remain undated; unsupported income/refund reductions remain reviewed and emit no cash-payment settlements.
- Final apply emits settlement events only for a balanced prepayment state. Existing actual-money behavior remains available for unsupported/incomplete history, with unmatched payments keeping the account reviewed rather than inventing row allocations. Final patch guards allow repeated installation without replacing already integrated definitions, and carriage-return normalization preserves matching across Windows line endings.
- Referenced purchase deletion currently fails its retained owner-composite target FK, preserving history. Scope 5.2 must still add the approved explicit `INVALID_STATE` guard for settlement/correction references; this review does not expand into that correction scope.

## Verification gate

Read the current `task-5c-report.md` after the final changes. It records sequential disposable-harness GREEN results: settlement 13/13, financial transactions 15/15, lifecycle 19/19, and final chronological state 3/3, followed by typecheck with no diagnostics and a clean diff check. The final-state suite ran after the suites that reinstall older definitions. Reviewer inspected the final diff and accepted this executor evidence without repeating tests.

Scope 5.1c is accepted. No remaining concrete blocker was found within this scope. Correction integration, its explicit purchase-delete guard and the public snapshot remain separately scoped; no production readiness claim is made.
