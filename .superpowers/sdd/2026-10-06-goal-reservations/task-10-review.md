# Task 10 initial independent review

Baseffc3c09; head945b909; reviewer review_task_10_legacy_guards, Sol medium. Verdict Needs fixes.

Important: migration006:54/schema994 opening guard NULL/<0 accepts numeric15,2 NaN via ordinaryauthenticated balance INSERT. ReadonlynativeSELECT showedstoredNaN andbothpredicatesfalse. Snapshotcanonicalmoneyinvalid andavailabilitycomparisonfailopen. Requirefinite/domainguard andauthHTTPregression.

No Critical/Minor findings. Legacyadoption/idempotency/ownerlocks/importspentonly/deletion/writegrants otherwise compliant. Reviewedreal-rolepermissions/concurrency/rollback/reapplytests andunknownrequestUI. ActualdeployedRPC/renderedUI remainpending; fixtureRPCexplicitlydisposable.

Outsidechecks: baselinebalance/ledgerconstraints; snapshot/availability; profilecascadepolicies; user-scopedgoalmetadata; cut-off lifecycledeletioncontinuation. No suite reruns/mutations.

## Final disposition after scoped fixes

Fix round 1 (`945b909..e5683bf`) closed the PostgreSQL numeric NaN bypass for authenticated account opening balances and goal money, but its independent review found that a zero goal target remained accepted. Fix round 2 (`e5683bf..9148353`) closed that finding; positive target and zero allocation behavior were independently approved by a fresh Luna high reviewer. The focused regression suite passed 14/14 and the native database suite passed 71/71.

The separately authorized local development CSP changes (`05dbd19`, `8cb894c`) passed scoped independent review. Focused CSP tests passed 5/5. The regular browser now signs in and loads the disposable Dashboard/account list and Wallet tiles. Wallets' snapshot RPC returns HTTP 200, but its summary still renders `Unavailable`; this remains unresolved. This browser observation is limited troubleshooting evidence, not the full rendered acceptance planned for Task 11.

Task 10 is complete. The user explicitly directed stopping after Task 10, so Task 11 was not started. No push, merge, deployment, or live migration occurred. Deployed deletion-RPC inventory remains a deployment preflight requirement.

## Fix round1 scoped review
945b909..e5683bf; NaN opening/goal target/allocation defenses addressed, schemamirrored, ordinaryauthregressions. Importantresidual006:69/schema1009 target0 allowedv_amount<0 whilePositiveMoneySchema contracts10/62 rejects0; allocation0valid. Requiretarget-specific<=0 andauthINSERT/UPDATE tests. ReadonlyoutsidecheckMoneySchemas/writercallers, no reruns/mutations. VerdictNeedsfixes.

## Fix round2 scoped review
e5683bf..9148353, fresh Luna high reviewer (prior Sol medium review thread rejected resumption byhost). APPROVED; target<=0 denied on authenticated insert/update, zeroallocation valid, finitebounds retained, schema SQL definitionsmatch, test covers unchanged snapshots and recomputed progress/reservations. No open/new findings; no reruns. Evidence14focused/71DB.
