antislop active: during (session override).

### Spec Compliance
- ❌ Issues found: The mobile sort trigger still displays the entire selected sort label (`src/components/transactions/TransactionSortControl.tsx:38`), contrary to the brief's icon-first toolbar/action controls and permission to retain sort text inside the menu. Use the existing icon, tooltip, aria-label and 44px icon button for the mobile trigger.
- ⚠️ Parent integration must verify global Clear all produces the full cleared query/date-all state and preserves the intended sort; this task correctly exposes callbacks but does not implement their consumer.

### Strengths
- `TransactionFilterDialog.tsx:64-73,88-137` restores drafts on opening, separates Reset from global Clear all, preserves presets until explicit date edits, and validates exact decimal bounds and civil dates before Apply.
- `TransactionFilterDialog.tsx:161-199` supplies named Radix controls, scroll/safe-area treatment, 44px option targets and explicit option loading/error states.
- `TransactionFilterChips.tsx:30-68` removes individual criteria while retaining other query fields and resetting offset; empty rows disappear and chips wrap.
- `tests/transaction-filters-ui.test.tsx:48-220` covers cancel/Escape/focus return, validation, preset preservation, callback separation and all six sort choices.

### Issues
#### Important (Should Fix)
- `src/components/transactions/TransactionSortControl.tsx:38`: Remove the visible selected-label span from the mobile toolbar trigger and retain those words in its accessible name/tooltip/menu. The current control uses up to 56vw for a verbose label despite the explicit compact icon-first followup.
- `src/components/transactions/PeriodBar.tsx:9` and `src/components/transactions/TransactionFilterChips.tsx:17`: The complete date-range formatting algorithm is copied verbatim into both components. Extract one shared formatter so period summaries and date chips cannot diverge when formatting changes. This is an Important finding under the task reviewer template's explicit verbatim-logic-duplication rule.

### Assessment
**Task quality: Needs fixes.** Controlled state, validation and error presentation are sound; address the mobile trigger requirement and duplicate formatter before approval.

Checks: Reviewed the authoritative diff. Initial combined tool output truncated the diff, so re-read the first 370 lines of the diff package to inspect the complete control implementations. No changed source files read separately, git commands, test reruns or source edits.
