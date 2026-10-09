# Unit 7.2 review

Reviewer: Sol 6.1 low, reused agent `unit71_review`. One substantive pass; no test reruns or edits by reviewer.

Baseline: e6888d3. Reviewed debt consumers, Accounts/Transactions page wiring, detail deletion routing and focused tests. Resulting implementation commit: 2bdd3e0.

## Findings and resolutions

- P2: Missing account type could open ordinary expense deletion. Unknown or invalid expense account identities now block deletion pending review, in both page and grouped paths.
- P2: Saved-refresh recovery was page-local and disappeared when moving from Transactions to Accounts after completion. Both pages now use the shared correction recovery identity exported from DebtHistoryGroup.
- P2: Escape on the focused expanded list did not exit selection. Both group consumers now clear selection/anchor on list-scoped Escape while leaving native controls and IME untouched.

Regressions cover unknown wallet identities, cross-page recovery and Escape/IME/control behavior. Implementer's final focused batch passed 96/96 across six files; tsc exited 0. No second review pass was requested under the user's minimal-review policy. No other substantive findings were returned.
