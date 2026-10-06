2ee49eb test: assert persisted transaction race outcome
 .../2026-10-06-goal-reservations/task-4-report.md  |  8 +++
 tests/database/financial-transactions.test.mjs     | 61 ++++++++++++++++++++--
 2 files changed, 64 insertions(+), 5 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-4-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-4-report.md
index bdd9908..c2d630e 100644
--- a/.superpowers/sdd/2026-10-06-goal-reservations/task-4-report.md
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-4-report.md
@@ -52,10 +52,18 @@ An early GREEN iteration hit asynchronous PostgREST schema reload on its first t
 
 ## Self-review and concerns
 
 No known failing checks. The single migration retains all required functionality in the planned file; the controller approved the private-helper dispatcher pattern. Fingerprinting all owned goal metadata intentionally invalidates quotes conservatively when another owned goal changes, avoiding missed ordering/lifecycle changes at the cost of potentially requesting another quote.
 
 Existing Task 3 reservation tests reapply migration 003 in their setup and leave the disposable public dispatcher at that migration when the full suite ends. Reapply the ordered bundle or migration 004 before manual Task 4 RPC checks; deployed ordered migrations end at 004. This is a test setup artifact, not a production migration dependency.
 
 Antislop delivery gate: PASS for this backend-only change; no UI, generated marketing claims, visual assets, or code-comment boilerplate were introduced. New SQL comments explain the private lane, request identity, and stale release validation.
 
 The controller will conduct independent review and the final application/lint/build checkpoint. No build was requested from this implementer.
+
+## Acceptance coverage follow-up
+
+Strengthened the simultaneous reserve/expense integration test to assert both winner-dependent persisted outcomes. The expense winner must leave actual/reserved/available at 2,000.00/0.00/2,000.00 with one linked operation and one stored expense matching the returned transaction ID; the reserve winner must leave 30,000.00/5,000.00/25,000.00 with one linked reserve event at +5,000.00 and no transaction. Each losing request is checked for absent operation/event rows, and the losing transaction path must return `STALE_QUOTE` while the losing reserve path returns `INSUFFICIENT_AVAILABLE`.
+
+Focused verification command: `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/financial-transactions.test.mjs`
+
+Output: tests 12, pass 12, fail 0, cancelled 0, skipped 0, todo 0; duration 3213.1998 ms. The simultaneous reserve/expense test passed (168.1963 ms).
diff --git a/tests/database/financial-transactions.test.mjs b/tests/database/financial-transactions.test.mjs
index 78ee030..f785848 100644
--- a/tests/database/financial-transactions.test.mjs
+++ b/tests/database/financial-transactions.test.mjs
@@ -143,26 +143,77 @@ test('foreign references and insert failure preserve balances events and operati
         assert.deepEqual(await rows(f), baseline);
     }
     finally {
         await queryAdmin('DROP TRIGGER test_reject_transaction ON public.transactions; DROP FUNCTION public.test_reject_transaction()');
     }
 });
 test('simultaneous reserve and expense serialize without overbooking', async (t) => {
     const f = await setup(t);
     const d = draft(f);
     const q = requireSuccess(await quote(f, d));
-    const results = await Promise.all([apply(f, { kind: 'transaction', draft: d }, q), apply(f, {
-            kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '5000.00'
-        })]);
-    assert.equal(results.filter(r => !r.error).length, 1);
+    const transactionRequestId = randomUUID();
+    const reserveRequestId = randomUUID();
+    const [transactionResult, reserveResult] = await Promise.all([
+        apply(f, { kind: 'transaction', draft: d }, q, transactionRequestId),
+        apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '5000.00' }, null, reserveRequestId),
+    ]);
+    assert.equal(Number(!transactionResult.error) + Number(!reserveResult.error), 1);
+    const persisted = await rows(f);
     const s = await snap(f);
-    assert.ok(Number(s.wallets[0].available) >= 0);
+    const wallet = s.wallets.find(w => w.accountId === f.owner.account.id);
+    assert.ok(wallet);
+    assert.equal(persisted[0].length, 1);
+
+    if (!transactionResult.error) {
+        const result = requireSuccess(transactionResult);
+        assert.equal(reserveResult.error?.message, 'INSUFFICIENT_AVAILABLE');
+        assert.equal(wallet.actual, '2000.00');
+        assert.equal(wallet.reserved, '0.00');
+        assert.equal(wallet.available, '2000.00');
+        assert.equal(s.goals[0].reserved, '0.00');
+        assert.equal(s.goals[0].spent, '0.00');
+        assert.equal(persisted[1].length, 1);
+        assert.equal(persisted[1][0].id, result.operationId);
+        assert.equal(persisted[1][0].request_id, transactionRequestId);
+        assert.equal(persisted[1][0].command.kind, 'transaction');
+        assert.deepEqual(result.transactionIds, persisted[3].map(tx => tx.id));
+        assert.equal(result.transactionIds.length, 1);
+        assert.equal(persisted[3][0].amount, 28000);
+        assert.equal(persisted[3][0].account_id, f.owner.account.id);
+        assert.equal(persisted[3][0].type, 'expense');
+        assert.equal(persisted[2].length, 0);
+        assert.equal(persisted[1].some(op => op.request_id === reserveRequestId), false);
+    }
+    else {
+        assert.equal(transactionResult.error.message, 'STALE_QUOTE');
+        const result = requireSuccess(reserveResult);
+        assert.equal(wallet.actual, '30000.00');
+        assert.equal(wallet.reserved, '5000.00');
+        assert.equal(wallet.available, '25000.00');
+        assert.equal(s.goals[0].reserved, '5000.00');
+        assert.equal(s.goals[0].spent, '0.00');
+        assert.equal(persisted[1].length, 1);
+        assert.equal(persisted[1][0].id, result.operationId);
+        assert.equal(persisted[1][0].request_id, reserveRequestId);
+        assert.deepEqual(result.transactionIds, []);
+        assert.equal(persisted[2].length, 1);
+        assert.equal(persisted[2][0].operation_id, result.operationId);
+        assert.equal(persisted[2][0].goal_id, f.owner.goal.id);
+        assert.equal(persisted[2][0].account_id, f.owner.account.id);
+        assert.equal(persisted[2][0].kind, 'reserve');
+        assert.equal(persisted[2][0].reserved_delta, 5000);
+        assert.equal(persisted[2][0].spent_delta, 0);
+        assert.equal(persisted[2][0].transaction_id, null);
+        assert.equal(persisted[3].length, 0);
+        assert.equal(persisted[1].some(op => op.request_id === transactionRequestId), false);
+        assert.equal(persisted[2].some(event => event.operation_id === transactionResult.data?.operationId), false);
+    }
 });
 test('credit installments distribute centavos and book debt once; debt goal payment spends once', async (t) => {
     const f = await setup(t);
     const credit = requireSuccess(await f.owner.client.from('accounts').insert({
         user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0
     }).select().single());
     const d = draft(f, { accountId: credit.id, amount: '1000.01', installments: { count: 3 } });
     const result = await save(f, d);
     assert.equal(result.transactionIds.length, 3);
     const tx = (await rows(f))[3];
