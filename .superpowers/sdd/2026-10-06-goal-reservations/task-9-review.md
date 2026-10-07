# Task 9 independent review, initial

Base2c6e47c; headcb92691. Reviewer review_task_9_wallet_summaries, Sol low. Verdict Needs fixes.

Important: AccountsPage loadAccounts overlapping requests lack a revision/cancellation guard. Old auth/debt responses may overwrite newer refreshed wallet metadata, debt buckets, error/loading state. Guard all post-await state writes and invalidate on query error/unmount; test out-of-order completion.

Minor: account-count caption uses raw SWR inclusion flags while totals overlay local flags. Derive both from the same effective collection.

No Critical findings. Exact cents/inclusion, stored debt preservation, reader errors and stable contributions fixtures otherwise match scope. Reviewer inspected refresh hooks and metadata toggle for named risks; no broad tests/mutations.

Reported evidence reviewed:116Vitest+2Node,TSC,5wallet and8contribution tests. Live debt statement audit and Task11 loaded browser/build acceptance deferred. Root separately observed Dashboard failure message replacing falsezero; this does not establish loaded browser acceptance.

## Fix round 1 review
cb92691..95d941d; Sol low. Normal stale-load handling and caption scope addressed; no new breakage. Residual Important: error/undefined account-effect branches omit unmount cleanup, so modal-close manual reload after queryfailure can surviveunmount and replaceSWRcache withstale accounts. Require unconditional unmount invalidation and controlled regression. Report reviewed122Vitest+2Node/TSC/11wallettests. No reruns/mutations.

## Fix round 2 final review
95d941d..85747d4. Sol low Approved: unconditionalcleanup allbranches closesremainingImportant; controlledoldmanualresponse cannotoverwritefreshsharedcache/newmountedmetadata. No Critical/Important/Minorremaining ornewbreakage. ReviewedWallet12/Vitest123/Node2/TSCpass; no reruns/mutations. Live statement-backeddebtaudit and Task11acceptancepending.
