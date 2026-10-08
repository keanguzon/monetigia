# Task 4b review

Spec review: PASS. Code quality/security review: PASS. No actionable findings in the scoped creation change.

Reviewed the brief, implementation report, actual contracts/types/test-helper diff, creation tests, ignored `202610080002_existing_debt_creation.sql`, and the prior account guard. Used the requesting-code-review skill. Product files were read only; no database writes, commits, dependency changes or broad test reruns were performed.

The RPC derives its owner from `auth.uid()`, requires an existing owner profile, and locks that profile before operation lookup and persistent mutation. Ordered normalized command JSON and its hash protect replay; existing command kinds conflict, missing/incomplete results reject, and account/item ownership is checked before returning saved IDs. The shared owner lock serializes identical concurrent calls. Operation, account, items, due rows and completion share one transaction with no caught success path after an error.

Strict TS and SQL validation agree on the account shape, counts, canonical positive amounts, account storage limit, original calendar anchor and request allocation bounds. SQL uses integer numeric centavos and places remainder in the final row. Owner-composite foreign keys cover account, operation and obligation attachment. RLS exposes owner SELECT only; table/column client writes are revoked, creation execution is authenticated only, helpers are ungranted, and definer search paths are pinned. The additive account guard retains allocation/transaction deletion checks and the existing user-cascade exception while protecting debt history.

The final-state helper installs all migrations chronologically, restoring archived-goal and debt grants after older guard SQL. Purchase splitting and its 12-installment cap are untouched. The supplied evidence records 103 passing TypeScript tests, 53 passing database regressions, 10 passing creation database tests and a passing typecheck; this review inspected their assertions without repeating those runs.

Integration remains scoped: explicitly include the ignored SQL migration, apply and runtime-verify it before dependent frontend release, and retain deferred snapshot/payment/correction work. Separate shared-Money module extraction is outside this review.
