# Task 1 fix: 44d4bd03cd9e36a42c3b9e7a6253b67e19819085..db1e3eaea39d4349f9b1a1664b116e2c7d86c22c
db1e3ea fix: prevent service-role allocation history truncation
 .../202610060002_goal_allocation_ledger.sql         |  3 ++-
 supabase/schema.sql                                 |  3 ++-
 tests/database/ledger.test.mjs                      | 21 +++++++++++++++++++++
 3 files changed, 25 insertions(+), 2 deletions(-)
diff --git a/supabase/migrations/202610060002_goal_allocation_ledger.sql b/supabase/migrations/202610060002_goal_allocation_ledger.sql
index 595e1c1..f306a58 100644
--- a/supabase/migrations/202610060002_goal_allocation_ledger.sql
+++ b/supabase/migrations/202610060002_goal_allocation_ledger.sql
@@ -103,13 +103,14 @@ ALTER TABLE public.financial_operations ENABLE ROW LEVEL SECURITY;
 DO $$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='goal_allocation_events' AND policyname='allocation_owner_read') THEN
     CREATE POLICY allocation_owner_read ON public.goal_allocation_events FOR SELECT TO authenticated USING(auth.uid()=user_id);
   END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='financial_operations' AND policyname='operation_owner_read') THEN
     CREATE POLICY operation_owner_read ON public.financial_operations FOR SELECT TO authenticated USING(auth.uid()=user_id);
   END IF;
 END $$;
 REVOKE ALL ON public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.goal_allocation_events,public.financial_operations TO authenticated;
-GRANT ALL ON public.goal_allocation_events,public.financial_operations TO service_role;
+GRANT SELECT,INSERT,UPDATE,DELETE ON public.goal_allocation_events,public.financial_operations TO service_role;
+REVOKE TRUNCATE ON public.goal_allocation_events,public.financial_operations FROM service_role;
 NOTIFY pgrst, 'reload schema';
 COMMIT;
diff --git a/supabase/schema.sql b/supabase/schema.sql
index fdb04d4..75dee3d 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -250,13 +250,14 @@ ALTER TABLE public.financial_operations ENABLE ROW LEVEL SECURITY;
 DO $$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='goal_allocation_events' AND policyname='allocation_owner_read') THEN
     CREATE POLICY allocation_owner_read ON public.goal_allocation_events FOR SELECT TO authenticated USING(auth.uid()=user_id);
   END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='financial_operations' AND policyname='operation_owner_read') THEN
     CREATE POLICY operation_owner_read ON public.financial_operations FOR SELECT TO authenticated USING(auth.uid()=user_id);
   END IF;
 END $$;
 REVOKE ALL ON public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.goal_allocation_events,public.financial_operations TO authenticated;
-GRANT ALL ON public.goal_allocation_events,public.financial_operations TO service_role;
+GRANT SELECT,INSERT,UPDATE,DELETE ON public.goal_allocation_events,public.financial_operations TO service_role;
+REVOKE TRUNCATE ON public.goal_allocation_events,public.financial_operations FROM service_role;
 NOTIFY pgrst, 'reload schema';
 COMMIT;
diff --git a/tests/database/ledger.test.mjs b/tests/database/ledger.test.mjs
index 7ff54e0..2d2a1b4 100644
--- a/tests/database/ledger.test.mjs
+++ b/tests/database/ledger.test.mjs
@@ -73,20 +73,41 @@ test('transaction deletion retains the original event reference', async () => {
     kind: 'reversal', reserved_delta: '10.00', spent_delta: '-10.00', transaction_id: transaction.id, reversal_of: event.id,
   })).select().single());
   assert.equal(reversal.transaction_id, transaction.id);
   const invented = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { transaction_id: randomUUID() }));
   assert.equal(invented.error?.code, '23503');
   const otherTransaction = requireSuccess(await fixture.admin.from('transactions').insert({ user_id: fixture.other.id, account_id: fixture.other.account.id, type: 'expense', amount: '10.00', date: '2026-10-06' }).select().single());
   const wrongOwner = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { transaction_id: otherTransaction.id }));
   assert.equal(wrongOwner.error?.code, '23503');
 });
 
+test('service role cannot truncate allocation history', async () => {
+  const operation = await insertOperation(fixture);
+  requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)));
+  const before = requireSuccess(await fixture.admin.from('goal_allocation_events').select('*').order('id'));
+  const { queryAdmin } = await databaseRuntime();
+  let failure;
+  try {
+    // Either permission failure or the sentinel rolls back this single implicit transaction.
+    await queryAdmin(`DO $$ BEGIN
+      SET LOCAL ROLE service_role;
+      TRUNCATE public.goal_allocation_events;
+      RAISE EXCEPTION 'Allocation TRUNCATE unexpectedly succeeded' USING ERRCODE='P0001';
+    END $$;`);
+  } catch (error) { failure = error; }
+  const after = requireSuccess(await fixture.admin.from('goal_allocation_events').select('*').order('id'));
+  assert.deepEqual(after, before);
+  const denied = failure?.code === '42501'
+    || String(failure?.stderr).includes('permission denied for table goal_allocation_events');
+  assert.equal(denied, true, failure?.message ?? 'TRUNCATE did not fail');
+});
+
 test('one event can be reversed once by the same owner', async () => {
   const operation = await insertOperation(fixture);
   const event = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)).select().single());
   const reversal = eventInput(fixture, operation, { kind: 'reversal', reserved_delta: '-10.00', reversal_of: event.id });
   requireSuccess(await fixture.admin.from('goal_allocation_events').insert(reversal));
   assert.equal((await fixture.admin.from('goal_allocation_events').insert(reversal)).error?.code, '23505');
   const otherOp = await insertOperation(fixture, fixture.other.id);
   const otherEvent = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, otherOp, { user_id: fixture.other.id, goal_id: fixture.other.goal.id, account_id: fixture.other.account.id })).select().single());
   assert.equal((await fixture.admin.from('goal_allocation_events').insert({ ...reversal, reversal_of: otherEvent.id })).error?.code, '23503');
 });
