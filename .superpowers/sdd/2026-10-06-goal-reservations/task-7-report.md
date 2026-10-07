# Task 7 implementation report

Implemented goal reservation actions, lifecycle presentation, and owner-scoped history. Set aside, release, and same-wallet goal moves use the finance snapshot and active PHP non-credit wallet metadata; error/loading states remain distinct from empty funds. Completion/cancellation requires an explicit leftover release or move when reservations remain, preserves spending history, and supports reopening. Closed goals with reservations cannot be archived. The Goals page and cards now show canonical reserved/spent/progress values and use the approved guidance. History normalizes database decimal text without floating-point conversion, displays wallet/operation labels and retained transaction references, and records deleted-transaction reversals from owner-scoped operation metadata without inventing allocation events.

Verification:
- `npx vitest run tests/goal-actions.test.tsx --reporter=dot`: 17 passed.
- `npx tsc --noEmit`: passed.
- `npm test -- --run`: 80 passed across 6 Vitest files, plus 2 Node tests.
- The first full run was 79/80 because an existing contribution-page test still searched for the old “Add contribution” label. Updated only that query to “Spend from goal”; the shortcut behavior assertions remain. The final full run passed.
- Browser visual verification is assigned to Task 11 and is not claimed here.

No database migration or runtime dependency was added.

## Narrow review fixes, round 1

Financial snapshot failure/loading now has explicit goal-funds feedback, hides the cached empty-reservation message, and blocks a new closure in both the button and submit handler. Optional wallet metadata failure remains separate. An unknown saved closure retains its original request ID and command, even after the goal appears closed and the snapshot fails.

The reservation retry and amount controls now have explicit 44px heights; the closed-goals toggle has a 44px minimum. The Set aside test retains reservation/actual-balance assertions, adds the mandated visible dialog assertion, verifies no command is submitted on opening, and explicitly rejects transaction-kind submissions while allowing the reservation command.

The existing test environment has no jest-dom matcher package. A test-only visibility matcher checks connection and ancestor display, visibility, hidden attributes, and zero opacity. This provides meaningful DOM visibility coverage without adding a dependency. It does not establish browser visual verification.

Evidence:
- Snapshot RED: focused run exit 1, 2 failures and 18 passes. Cached-zero error/loading cases incorrectly displayed “No reservations remain.”
- Snapshot GREEN: focused run exit 0, 20 passes, including original-request retry after closed status and snapshot failure.
- Mobile-control RED: focused run exit 1, 1 failure and 20 passes, missing the amount control's 44px minimum.
- Final focused GREEN: exit 0, 21 passes. Mobile class assertions verify the declared minimums; the closed-goals toggle was checked in the scoped source diff.
- Full suite: `npm test -- --run`, exit 0, 84 passes across 6 Vitest files and 2 passing Node tests.
- TypeScript initially caught the new matcher's missing assertion type declaration; after adding the test-only declaration, `npx tsc --noEmit` exited 0.
- `git diff --check`: exit 0.
- R-02 PASS: report prose uses no em-dash separators. R-27 PASS: regression coverage distinguishes financial error/loading from known empty funds. C-4 PASS within scoped DOM coverage: failed snapshots block new closures and unknown requests retain retry behavior. Mobile target correction uses the existing 44px control convention. Browser visual/build checks remain assigned to Task 11.
