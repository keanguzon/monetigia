# Spending summary and limit QA

Status: local implementation and QA complete, including concise copy revision `82b3e93`. Branch `beta-1.1`; implementation starts from `d95ec5a`. No production writes, deployment, merge or push performed for this feature.

## Verification recorded so far

| Unit | Commit | Evidence | Independent review |
| --- | --- | --- | --- |
| Local periods and Dashboard date boundaries | `d8a8cdc` | Manila 19, Tokyo 15, Los Angeles 16 focused assertions; timezone-specific skips recorded; typecheck | Sol low approved |
| Summary RPC | `1c8f8af` | 12 native database tests, including 1,200 transactions, owner isolation and LF/CRLF install parity | Sol medium approved |
| Owner spending limit table | `3f98be5` | 4 native database tests and typecheck | Sol low approved |
| Owner-safe hooks and refresh | `141bed3` | 60 focused tests and typecheck; StrictMode auth race reproduced and fixed | Sol medium approved |
| Dashboard RPC integration | `ab800ff` | 11 focused tests and typecheck | Sol low approved |
| Period filtering and summary panel | `e391aef` | 54 focused tests; 31 existing spending/date tests with 4 timezone skips; typecheck | Sol medium approved |
| Limit dialog | `2f02c23`, `5f9ca9d`, `c38d422` | 39 focused spending tests, 13 history tests, deferred-refresh success/rejection regressions; typecheck | Sol low approved after one race fix |

Final source corrections: `87626b5` updates the Dashboard fixture without weakening the reservation assertions; `15c1f2f` fixes JSX lint and the dialog effect dependency; `9538eb9` makes menu-kind selections open the current period with a future-half guard. Final Sol medium review approved these changes with no open findings.

User-requested concise copy in `82b3e93`: 14 focused tests, typecheck, targeted lint and final production build pass; Sol medium scoped review approved. Real browser Enter opens and closes the native disclosure, which starts collapsed and retains all accounting/list-scope explanations. [Final concise mobile screenshot](pending-rollout/screenshots/spending-2026-10-15/concise-mobile.png).

Full frontend verification on `9538eb9`: **8 Node checks and 535 Vitest tests passed**, 4 timezone-specific skips across 47 files, exit 0. A run concurrent with the build hit one existing 10-second UI test timeout; rerunning without the build passed with no timeout or source changes. The earlier integration run exposed two stale mocks (14 failures); both were corrected and their original behavioral assertions retained.

Production build on `9538eb9`: exit 0, including type validation. Existing hook-dependency warnings remain in older components/pages; font override, Browserslist and Supabase Edge compatibility warnings were observed in the initial uncached build. The two new spending components pass targeted lint without warnings. These results do not claim the entire repository has no lint or dependency issues.

Final build was repeated successfully on `82b3e93` after the copy-only revision. Durable [review reports, ledger and verification logs](spending-summary-2026-10-15/) replace the plan's temporary workspace. Its isolated services were stopped, generated TypeScript settings restored, and disposable workspace removed. Existing unrelated audit/chat-export files remain untouched.

Full database regression: **153 passed, 0 failed, 0 skipped**, exit 0, run sequentially after reinstalling all ordered migrations. Disposable database `spending_fixture` on loopback only; existing debt, goal, restore, metadata and concurrency suites included. Production data and older local clusters were not used.

## Browser observations

The preview uses a synthetic owner and a separate local API/database. Its seeded wallet balance is independent of the transaction fixtures; it is not a production accounting example.

- All time is initial; summary is absent.
- Selecting Month shows October 2026, `Spent so far` **₱425.50**, Income **₱2,000.00**, Net **₱1,574.50**. Dashboard → This month Expenses also **₱425.50**.
- Previous selects September 2026, `Spent` **₱250.00** and one September history row. Next returns to October and is disabled there.
- Income filter plus a nonmatching search shows zero list rows while the whole-period summary remains **₱425.50**.
- A synthetic 503 for summary requests displays the specified failure message while history remains usable. Clicking Retry during that outage enters the loading state. Removing the fault allows recovery. One earlier recovery occurred automatically before a click; it is not counted as a successful manual Retry click.

Additional manual checks passed:

- Set limit rejects zero; saving ₱300 displays ₱125.50 over against spending ₱425.50. Editing to ₱600 displays ₱174.50 left.
- Previous month displays the current-only limit note without a historical progress bar.
- Remove displays confirmation; confirming returns to Set spending limit. Cancel after typing ₱999 does not recreate it.
- Escape and Cancel restore focus to the opening trigger. Keyboard Enter opens the period menu and selects 1st–15th.
- Oct 1–15 comparison correctly displays ₱175.50 more than Sep 16–30 for the seeded fixtures.
- Light and dark layouts were checked at 320, 375, 768 and 1280 CSS pixels with no document overflow. [Screenshots](pending-rollout/screenshots/spending-2026-10-15/) capture those views. Some show the over-limit state; others show the later cleared-limit cutoff state.

Measured warning contrast using the installed antislop checker: light text `#b81e1e` on white **6.48:1**; dark text `#ef4343` on `#020617` **5.34:1**. Bar against track: light **5.91:1**, dark **3.87:1**, both above the nontext 3:1 minimum. The dark track pairing fails normal text contrast, but it is a progress bar rather than text. No global theme changes were made.

## Known scope boundaries

- Existing nonspending cache findings are not claimed fixed.
- PHP totals intentionally exclude qualifying foreign-currency transactions and disclose their count.
- Complete installment groups can include siblings outside the selected period. Group totals are not period spending.
- Limits never restrict transaction recording.
- Existing global destructive colors fail normal text contrast for this new use. The new limit UI receives a scoped semantic warning treatment; global theme tokens remain unchanged. Rendered warning text and bar pairs pass their applicable checks above. This does not claim every preexisting color pairing passes.
- Production catalog parity and migration installation remain manual release gates. See [rollout instructions](pending-rollout/spending-rollout.md).
- Physical iPhone Safari/PWA acceptance is not established by desktop viewport emulation.
