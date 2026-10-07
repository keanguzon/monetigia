85747d4 fix(wallets): invalidate manual loads on every unmount
 .../2026-10-06-goal-reservations/task-9-report.md  |  8 +++++
 src/app/(dashboard)/accounts/page.tsx              |  5 ++-
 tests/wallet-reservations.test.tsx                 | 40 +++++++++++++++++++++-
 3 files changed, 49 insertions(+), 4 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md
index 988c176..95b3989 100644
--- a/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-9-report.md
@@ -27,10 +27,18 @@ No migration, schema, deployment, push, or merge was performed. The debt audit i
 
 ## Review fix round 1
 
 - Added a monotonically increasing AccountsPage load revision. Every asynchronous boundary checks that its load remains current before writing state; stale catch/finally handlers cannot replace errors or clear loading. Account query changes/errors and effect cleanup invalidate outstanding loads, including on unmount.
 - Shared the effective account collection between the wallet summary and its account-count caption, including locally saved inclusion flags.
 - Added six focused behavior regressions: old debt success, old debt failure, old completion while the new load remains pending, delayed authentication with older account metadata, account-query failure while debt is pending, and the locally saved inclusion toggle's caption/amount scope.
 - TDD evidence: before the fix, the two stale debt cases removed the newer PHP 300 debt and the caption remained at one account after the amount rose to PHP 150,000 (3 failed, 5 passed). After the fix, all focused regressions pass.
 - Final verification: `npm test` exit 0, Node 2/2 and Vitest 8 files / 122 tests; Wallets test file 11/11. `npx tsc --noEmit` exit 0. Existing no-fabricated-zero, no-fetch-balance-write, preview and month-filter tests remain passing.
 - antislop scope gate PASS: the existing layout, visual styles, copy, wallet actions, APY controls, order, debt filters and previews were preserved. The only caption change is using the same account inclusion collection as the amounts; the toggle behavior test exercises that scope.
 - No dependencies, SQL, live database access, push or merge. Root ledger/plan/review files were not edited by this fix.
+
+## Review fix round 2
+
+- Corrected round 1's incomplete unmount protection: the account effect now returns its invalidating cleanup unconditionally, including error and undefined-data branches. A manual reload started by closing an already open transaction modal after a query error cannot outlive its page and publish stale accounts into SWR.
+- Added a controlled UI/cache regression: open Pay Debt, fail account revalidation, close the transaction modal to start a deferred manual account read, unmount, mount a fresh page with fresh account names, and resolve the old read. Assert both the shared SWR account cache and the fresh page retain the fresh accounts.
+- TDD red: the focused new regression failed before the fix because the old read replaced all fresh names in the cache. Green: `npx vitest run tests/wallet-reservations.test.tsx` exit 0, 12/12 tests passed.
+- Final verification: `npm test` exit 0, Node 2/2 and Vitest 8 files / 123 tests. `npx tsc --noEmit` exit 0. Existing race, caption, no-fabricated-zero, no-fetch-balance-write, preview and filter regressions remain passing.
+- antislop scope gate PASS: this round only changes effect cleanup and test controls; existing product layout, copy and wallet behavior are preserved. No dependencies, SQL, live database access, push or merge. Root ledger/plan/review files were not edited by this fix.
diff --git a/src/app/(dashboard)/accounts/page.tsx b/src/app/(dashboard)/accounts/page.tsx
index de6ddb2..65288cd 100644
--- a/src/app/(dashboard)/accounts/page.tsx
+++ b/src/app/(dashboard)/accounts/page.tsx
@@ -69,24 +69,23 @@ export default function AccountsPage() {
   };
 
   useEffect(() => {
     loadRevision.current += 1;
     if (accountsQuery.error) {
       setAccountLoadError(accountsQuery.error);
       setDebtLoadError(accountsQuery.error);
       setAccounts([]);
       setIsLoading(false);
       setIsDebtLoading(false);
-      return;
+    } else if (accountsQuery.data !== undefined) {
+      void loadAccounts(accountsQuery.data);
     }
-    if (accountsQuery.data === undefined) return;
-    void loadAccounts(accountsQuery.data);
     return () => { loadRevision.current += 1; };
   }, [accountsQuery.data, accountsQuery.error]);
 
   useEffect(() => {
     setInterestRateDraft((prev) => {
       const next = { ...prev };
       for (const acc of accounts || []) {
         if (!acc?.id) continue;
         if (!acc?.is_savings) continue;
         if (next[acc.id] === undefined) {
diff --git a/tests/wallet-reservations.test.tsx b/tests/wallet-reservations.test.tsx
index 225b736..8fd8034 100644
--- a/tests/wallet-reservations.test.tsx
+++ b/tests/wallet-reservations.test.tsx
@@ -25,24 +25,31 @@ const fixture = vi.hoisted(() => {
     nextSnapshot: null as any,
     accountReadError: null as unknown,
     transactionReadError: null as unknown,
     financeReadError: null as unknown,
     accountWrites: [] as any[],
     applyCalls: [] as any[],
     accountReads: 0,
     transactionResponses: [] as Promise<any>[],
     transactionReads: 0,
     authResponses: [] as Promise<any>[],
+    accountResponses: [] as Promise<any>[],
   };
 });
 
-vi.mock("next/dynamic", () => ({ default: () => function DynamicStub() { return null; } }));
+vi.mock("next/dynamic", () => ({
+  default: () => function DynamicStub(props: any) {
+    return props.isOpen && "defaultAccountId" in props
+      ? <button type="button" onClick={props.onClose}>Close transaction modal</button>
+      : null;
+  },
+}));
 vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
 
 vi.mock("@/lib/supabase/client", () => ({
   createClient: () => ({
     auth: {
       getUser: async () => fixture.authResponses.shift() ?? ({ data: { user: { id: fixture.userId } }, error: null }),
       onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
     },
     from: (table: string) => {
       let action: "select" | "update" = "select";
@@ -56,20 +63,22 @@ vi.mock("@/lib/supabase/client", () => ({
         lte() { return query; },
         update(values: unknown) {
           action = "update";
           fixture.accountWrites.push(values);
           return query;
         },
         then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
           if (action === "update") return Promise.resolve({ data: null, error: null }).then(resolve, reject);
           if (table === "accounts") {
             fixture.accountReads += 1;
+            const pending = fixture.accountResponses.shift();
+            if (pending) return pending.then(resolve, reject);
             return Promise.resolve({ data: fixture.accounts, error: fixture.accountReadError }).then(resolve, reject);
           }
           if (table === "transactions") {
             fixture.transactionReads += 1;
             const pending = fixture.transactionResponses.shift();
             if (pending) return pending.then(resolve, reject);
             return Promise.resolve({ data: fixture.transactions, error: fixture.transactionReadError }).then(resolve, reject);
           }
           return Promise.resolve({ data: [], error: null }).then(resolve, reject);
         },
@@ -148,20 +157,21 @@ beforeEach(() => {
   fixture.nextSnapshot = null;
   fixture.accountReadError = null;
   fixture.transactionReadError = null;
   fixture.financeReadError = null;
   fixture.accountWrites = [];
   fixture.applyCalls = [];
   fixture.accountReads = 0;
   fixture.transactionReads = 0;
   fixture.transactionResponses = [];
   fixture.authResponses = [];
+  fixture.accountResponses = [];
 });
 
 afterEach(() => {
   cleanup();
   cache.clear();
   vi.clearAllMocks();
 });
 
 test.each([false, true])("newer debt refresh survives an older response (old failure: %s)", async oldFailure => {
   let resolveOld!: (value: any) => void;
@@ -230,20 +240,48 @@ test("an account query failure invalidates outstanding debt reads", async () =>
   render(<><AccountsPage /><FinanceOperation command={{ kind: "reserve" }} label="Refresh finance" /></>, { wrapper });
   await waitFor(() => expect(fixture.transactionReads).toBe(1));
   fixture.accountReadError = new Error("accounts unavailable");
   fireEvent.click(screen.getByRole("button", { name: "Refresh finance" }));
   await screen.findByText(/wallet balances could not be loaded/i);
   await act(async () => resolveOld({ data: makeTransactions(), error: null }));
   expect(screen.getByText("Outstanding Debt:").parentElement?.textContent).toContain("Unavailable");
   expect(screen.queryByLabelText("Net worth balance")).toBeNull();
 });
 
+test("unmount after a query error invalidates a manual modal-close reload before it overwrites the account cache", async () => {
+  const view = render(<><AccountsPage /><FinanceOperation command={{ kind: "reserve" }} label="Refresh finance" /></>, { wrapper });
+  await screen.findByLabelText("Net worth balance");
+  fireEvent.click(screen.getByRole("button", { name: "Pay Debt" }));
+  expect(screen.getByRole("button", { name: "Close transaction modal" })).not.toBeNull();
+  fixture.accountReadError = new Error("accounts unavailable");
+  fireEvent.click(screen.getByRole("button", { name: "Refresh finance" }));
+  await screen.findByText(/wallet balances could not be loaded/i);
+
+  let resolveOld!: (value: any) => void;
+  const oldAccounts = makeAccounts();
+  fixture.accountResponses = [new Promise(resolve => { resolveOld = resolve; })];
+  const readsBeforeClose = fixture.accountReads;
+  fireEvent.click(screen.getByRole("button", { name: "Close transaction modal" }));
+  await waitFor(() => expect(fixture.accountReads).toBe(readsBeforeClose + 1));
+  view.unmount();
+
+  fixture.accountReadError = null;
+  fixture.accounts = makeAccounts().map(account => ({ ...account, name: `${account.name} fresh mount` }));
+  render(<AccountsPage />, { wrapper });
+  await screen.findByText("GoTyme fresh mount");
+  expect(cache.get("accounts").data).toEqual(fixture.accounts);
+  await act(async () => resolveOld({ data: oldAccounts, error: null }));
+  expect(cache.get("accounts").data).toEqual(fixture.accounts);
+  expect(screen.getByText("GoTyme fresh mount")).not.toBeNull();
+  expect(screen.queryByText("GoTyme")).toBeNull();
+});
+
 test("reservations update the mounted Wallets summary without changing its net worth", async () => {
   const before = snapshot("0.00");
   const after = snapshot("5000.00", "10000.00");
   fixture.nextSnapshot = after;
 
   render(
     <>
       <AccountsPage />
       <FinanceOperation command={{ kind: "reserve", goalId: "20000000-0000-4000-8000-000000000001", accountId: fixture.cashId, amount: "5000.00" }} label="Reserve 5,000" />
     </>,
