# Goal session recovery hotfix

2026-10-08

User reports Goals shows an error after 10-15 seconds in another tab and recovers when DevTools is opened. The exact production exception has not been captured.

Two deterministic regression paths were observed failing before the fix: token refresh during an in-flight snapshot, and the first SIGNED_IN before INITIAL_SESSION. Stale response rejection left the finance cache in an error state. The hook now makes one immediate fresh read after eligible same-user session supersession. Identity revisions forbid recovery across logout or user changes. Existing client checks still reject changed tokens, foreign goals and obsolete selection revisions. A second supersession cannot start another immediate retry; normal SWR error retries remain unchanged.

Changed only the goal finance hook and its regression tests. No database migration is required for this hotfix. Archived Goals commit b89b591 remains separate pending production migration.

Verification on main commit 4b13916:
- npm test: 7 Node tests and 206 Vitest tests passed.
- Focused hook tests: 15 passed; regression failures were observed before implementation.
- TypeScript noEmit passed before cherry-pick, production build also typechecked main.
- Production build passed and generated 20 pages. Five existing hook warnings and Browserslist warning remain; compiler edge-worker SIGTERM was nonfatal.
- Independent Astra low review: no blocking findings; exact production reproduction remains unverified.

Production tab-return behavior still requires validation after deployment. No claim of browser reproduction or deployed acceptance is made here.
