# Task 6a.3 implementation

Scope: wallet debt snapshot consumer, exact single-currency summary, real legacy due-date adoption dialog, and focused consumer tests. The reviewed 6a.1/6a.2/shared6b1 contracts are used directly. No SQL, dependencies, assets, commits, pushes, or financial records changed.

## Final behavior

- `summarizeDebt` sums canonical money with BigInt, validates strict YYYY-MM selections, rejects aggregate safe-centavo overflow, and uses authoritative account totals independently of scheduled rows. The fixture produces total6600.00, scheduled1600.00, undated5000.00. Payments are already reflected in remaining amounts and are not deducted again. Zero rows remain untouched in the snapshot and are excluded from payable projection.
- AccountsPage removes the 5000-transaction query and month arithmetic. All months uses snapshot outstanding debt; selected months use Scheduled Debt. The deduction preview subtracts the exact amount corresponding to the visible label. Reconciliation-review accounts preserve authoritative totals while disabling scheduled deduction.
- Snapshot account IDs correlate with all owner account metadata, including inactive accounts. Only PHP accounts enter the PHP summary and schedule. Unsupported currencies have explicit separate exclusion/review feedback. Missing currency metadata disables the fresh PHP debt total; no conversion or currency inference exists.
- DebtScheduleSection uses actual due dates and owned rows, labels opening debt Existing debt, keeps purchase names, shows unknown dates without inventing a date, and calls payment/review with the actual wallet ID. The optional `canReviewLegacy` metadata adapter disables inactive actions with a visible eligibility explanation; root approved this narrow adapter because snapshot accounts have no activity metadata.
- LegacyDebtReviewDialog uses reviewed ExistingDebtFields and useDebtCommand. The entire undated residual must match the exact draft sum before a separate confirmation. A fresh snapshot and active PHP credit metadata are required. Cancel does not submit. Stale fingerprint rejection refreshes without changing the draft and requires renewed review/confirmation. Unconfirmed attempts use the hook's frozen pendingCommand to reconstruct immutable fields after remount and offer same-attempt retry. Saved refresh failures offer refresh-only recovery. No wallet creation or duplicated fields/controller exists.
- New legacy primary actions use locally readable emerald colors in both themes, preserving the global theme. Fixed dialog header/footer and scrolling middle support narrow layouts. Existing Manrope/Bricolage and green ledger direction remain; ENERGY1/RHYTHM2/MOTION1, no new assets or landing redesign.

## Root-approved scope extension

The actual boundary regression in wallet-reservations exposed a previously reviewed useDebt flaw: an older failed request could publish an error after a newer successful same-owner snapshot. Root authorized a narrow useDebt read-generation repair and the consumer regression fixture update. The hook now guards each read generation; a superseded read settles with the newer request promise, preventing SWR's older-error path from hiding newer data. Owner/token protections and durable write controllers remain unchanged. Existing debt-hook owner-switch, token-renewal, unknown-write, same-request retry and refresh-only tests still pass.

wallet-reservations fixtures now exercise the real `debt_snapshot` transport and useDebt hook. They retain reservation, exact preview, malformed read, late-generation and metadata assertions. The old coupled assertion that net-worth stays hidden while the independent debt read waits now asserts the fresh net-worth while retaining the pending debt-loading assertion; root approved this behavior update. Malformed balance cases now return malformed snapshot amounts so the new authoritative read is exercised.

## RED/GREEN evidence

- Initial missing summary module and old schedule props produced import/contract errors; these are setup evidence, not the meaningful assertion RED.
- Summary placeholder then produced 5 expected assertion failures (zero totals vs6600/1600/5000, missing review state,6001centavo rows, missing month/overflow validation).
- Missing adoption component produced an import error; the null interface placeholder then produced 5 expected missing-interaction assertion failures. Subsequent real-hook tests verify full command amount/fingerprint, no premature confirmation, cancel/mismatch no-write, frozen retry across remount, stale renewed confirmation, and refresh-only recovery. Test transport naming was corrected to the actual reviewed `goal_finance_apply` RPC before GREEN.
- Page currency tests produced 2 expected missing summary/feedback failures before snapshot wiring; inactive action produced an explicit false-vs-true disabled assertion RED before its metadata adapter.
- Real snapshot boundary wallet regression produced17pass/1fail: `newer debt refresh survives an older response (old failure: true)`. The shared read-generation fix made this18/18GREEN, while existing debt-hooks remained18/18GREEN.
- Latest command: `npx vitest run tests/debt-summary.test.ts tests/debt-snapshot-view.test.tsx tests/debt-adoption-ui.test.tsx tests/wallet-reservations.test.tsx tests/debt-hooks.test.tsx` =>5files,53tests passed, exit0 (summary5, view7, adoption5, wallet18, hooks18).
- Latest `npx tsc --noEmit` =>exit0. Two transient JSX typing errors found during implementation were corrected; final output is clean.

## Handoff and limits

Consumer sources frozen for root's integrated verification. Root owns the one full npm suite after both6a3/6b2 freeze and authenticated disposable-preview checks at320/375/768/1280, both themes, keyboard,200%zoom, and long rows. Those browser/full-suite checks have not been claimed here. Source-level delivery checks preserve readable copy, exact money/data attributes, focus-capable controls and44px new action targets; visual acceptance remains with root. No production write or physical iOS/PWA acceptance was performed.

## Astra P1 review repair: reachable uncertain adoption after route remount

Astra correctly identified that server-committed adoption can leave undated residual0 while the client retains an unknown attempt. The former residual-dependent Review due dates entry disappears on route remount, hiding recovery. AccountsPage now subscribes to the existing owner-scoped useDebtCommand and renders Recover due-date save from its pending adoption, independently of snapshot residual, reconciliation, activity or currency eligibility. It opens the existing dialog; only its frozen same-request retry is enabled. No new controller or command is created.

New actual-page remount test first observed RED:5passed/1failed, missing Recover due-date save after simulated server commit plus lost response. (An initial unstable test metadata array caused a fixture render loop; it was made stable before recording assertion RED.) GREEN verifies committed residual0 removes ordinary Review due dates, recovery remains reachable, original field amount/name reappear, replay submits byte-for-byte identical RPC args/request ID/fingerprint/items, and successful recovery clears the entry. This uses real useDebt/useDebtCommand and mocks only RPC/auth/metadata boundaries.

Latest after repair: required focused consumer+wallet+hook command5files54tests passed (summary5/view7/adoption6/wallet18/hooks18); npx tsc --noEmit exit0. Sources refrozen for root's re-review and integrated checks.
