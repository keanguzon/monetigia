# Landing page final review

Reviewed `src/components/landing/LandingPage.tsx` against `cebe57f` at `f22336469fe4c59615d9a48a0d1a55430e80d10d`. The worktree was clean. `src/app/page.tsx` has no diff; its existing OAuth session and remember-me redirect behavior remains intact.

## Finding

- **Resolved, P2, pending OAuth state names the wrong provider:** The bounded fix now tracks `pendingProvider`. Only the selected provider shows its spinner, provider-specific pending copy, and `aria-busy=true`; both buttons remain disabled until the request settles. The other button keeps its original label and `aria-busy=false` ([LandingPage.tsx:53], [LandingPage.tsx:79], [LandingPage.tsx:170], [LandingPage.tsx:182]).

## Review checks

- Google and Facebook still call `signInWithOAuth`, remember-me is still saved before the request, and the redirect continues through the existing sanitized `redirect` parameter to `/auth/callback`.
- Loading disables both providers; both thrown failures and returned OAuth errors show a destructive toast, and `finally` clears loading. This was a static code review; provider sign-in was not exercised against live OAuth configuration.
- Wallet sample: ₱52,000 + ₱5,500 = ₱57,500 actual; ₱57,500 - ₱12,000 reserved = ₱45,500 available. Goal sample: ₱8,000 reserved + ₱2,000 spent = ₱10,000 of ₱30,000, rounded to 33%. Credit examples: ₱1,250 + ₱800 = ₱2,050; the November example totals ₱640. The examples are labeled as illustrative/sample data.
- The reviewed copy describes existing wallet reservation, goal spending, and month-grouped credit schedule behavior. No deferred bulk-edit plan or claim that sample figures are live appears in the landing page.
- Internal section links resolve to `wallets`, `goals`, `credit-schedule`, `how-it-works`, and `sign-in`. The Android app link points to `/mobile-app` in the footer.
- Layout uses the shared Manrope and Bricolage heading classes, green primary tokens, restrained decoration, responsive single-column stacking below breakpoints, and no fixed-width table or unbroken long text that suggests horizontal overflow at 375px. A browser viewport check is covered separately by the main reviewer.
- Visible controls have focus outlines; the remember-me checkbox is associated with its text through a wrapping label. Foreground, muted foreground, and primary colors use the shared light/dark theme variables.

## Bounded fix re-review

Reviewed the pending-provider source diff and `tests/landing-oauth-loading.test.tsx`. The fix addresses the finding for both Google and Facebook, and the added parameterized test checks selected-provider loading copy, disabled states, `aria-busy`, and cleanup after the request resolves. No new issues found in this bounded diff. Test execution remains with the main reviewer.
