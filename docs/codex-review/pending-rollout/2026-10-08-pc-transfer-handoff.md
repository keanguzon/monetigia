# PC transfer checkpoint — Task 7.1 unfinished

Latest instruction: stop current-PC implementation, push the reviewed checkpoint and carry Luna findings to an Astra executor on the next PC. Continue 7.1 completion and independent review, then 7.2, 8.1, 8.2 and Task 9 using the tightly scoped execution plan. The later executor override replaces Luna for the next execution; keep independent review separate from implementation.

Task 6 is reviewed and committed: 50bf060 creation/recovery; 26a1e80 complete snapshot/legacy adoption. Final Astra fix review approved. Integrated verification before the draft tests: 7 Node tests and 379 Vitest tests passed. Final browser checks covered 320px creation with 600-row preview, no horizontal overflow, visible footer and Escape focus return; light/dark CTA contrast 4.52:1/6.54:1. Complete release browser/device acceptance remains Task 9. No production SQL/deployment performed; migration005 must precede frontend release.

Scoped plan: docs/superpowers/plans/2026-10-08-remaining-rollout-execution.md. Master/spec/brief links are inside it. Preserve small descriptive reviewed commits; no bulk implementation commit. Antislop during session override. Sol xhigh planning. Latest user wants Astra executor; Astra low independent review was the prior reviewer policy. No nested agents or unrelated edits.

## Luna findings and implementation rationale

No production 7.1 code exists. Luna wrote only two unexecuted draft test files, now stored as .tsx.txt under docs/codex-review/pending-rollout/task-7-1-drafts to keep this checkpoint's test discovery intact. Restore into tests only when resuming implementation. Neither meaningful RED nor GREEN was recorded; no implementation report exists.

Read-only preflight confirmed useDebt supplies snapshot/refresh; useDebtCommand supplies owner-keyed pendingCommand, retry/reset and saved/unknown state; useGoals supplies owner identity. Existing APIs suffice within the exact 7.1 allowlist; do not edit hooks/controllers. Prioritize stable IDs/canonical ordering and Shift ranges, checked exact remaining centavos, stale fingerprint explicit renewed review, durable same-attempt recovery after remount/zero remaining, and saved-refresh-only behavior. Adoption and correction share the controller, so resolve conflicts and prior completed receipts explicitly.

## Astra handoff triage (source only)

Draft active InstallmentSelection rerender omits required onActivate/onExit props: fix before typecheck. Missing coverage includes cancel/Escape, double confirm, empty/600/601/duplicate selection, owner change, mixed account/group/source, known rejection, prior completed adoption reset and actual close/remount request identity. Static hook mocks cannot prove UUID replay identity; use the actual reviewed hook boundary where that behavior is claimed. No triage tests or implementation review were performed.

## Resume order

1. Pull beta-1.1, inspect status and this checkpoint. Preserve user-owned implementation_plan.md/mema.md; they were not committed. Ignore generated .playwright-cli artifacts.
2. Read skills/AGENTS and scoped Unit7.1; restore/revise drafts, record assertion RED, implement ONLY allowlisted selection.ts/InstallmentSelection/DebtCorrectionDialog/tests/report. No consumers, SQL or sharedhook changes.
3. Run specified focused suites and tsc. Obtain independent review, fix findings, commit. 7.1 is not integrated into pages until7.2; do not claim end-user selection available at7.1.
4. Execute7.2 then8.1 then8.2 with separate scoped prompts/review/commits. Important8.1SQL risk: metadata result.transactionIds must not count as transaction source-operation provenance in debt_account_state. Plan permits narrow additive correction in new006; never edit released005.
5. Task9 integrated tests/native disposable DB/lint/build/browser/branchreview and release prerequisites. Preserve financial records, no production reset/inventedtransactions. PhysicalSafari/PWA acceptance separate. Re-establish local disposable harness onnewPC; transferred Downloads paths are machine-specific and no secrets are committed.

Final Astra triage also found a paid-row fixture changes remainingAmount without updating paidAmount/correctedAmount, breaking row reconciliation. Repair this fixture before claiming a meaningful selection/recovery RED. The alleged remount test only mounts preloaded mocked state once; add a real unmount/remount and identical request-ID check.

## Final stop — user budget instruction

The user stopped Astra execution before completion. No further implementation/review/tests were authorized after this stop. Root inspected the written files: selection.ts contains canonical deduplication/reconciliation and Shift/toggle logic; InstallmentSelection.tsx contains the basic toolbar and600-row notice; DebtCorrectionDialog.tsx is still only a null-returning scaffold with any props. Tests were revised but no completed GREEN/typecheck/final review exists. Astra reported assertion-level RED for selection/toolbar; root has not independently verified those runs.

All interrupted Astra files are preserved as .txt in task-7-1-drafts/astra/ rather than active source/tests, so unfinished imports/scaffolds do not replace the reviewed Task6 runtime. Restore them to the exact Unit7.1 paths when resuming. Original Luna drafts remain separately archived. Task7.1 remains UNFINISHED and UNREVIEWED; do not claim the selection UI works or is wired into pages. No production7.1 modules are installed at this checkpoint.

Next PC prompt: Pull beta-1.1 and read this handoff plus the scoped remaining-rollout-execution plan. Task6 is reviewed; Task7.1 was interrupted and its latest Astra work is archived in task-7-1-drafts/astra. Inspect/restore only the7.1 allowlist; finish confirmation/recovery and missing tests, verify focused suites and tsc, obtain independent Astra low review, fix and commit. Then continue7.2,8.1,8.2 and9 with tightly scoped plans and review perunit. Use antislop during, Sol xhigh planning; latest executor was Astra low after Luna was stopped. Preserve all financial data and user-owned untracked files. Confirm installed migrations before release; no production reset or fabricated history.
