 .../migrations/202610060006_goal_write_guards.sql  |  3 ++-
 supabase/schema.sql                                |  3 ++-
 tests/database/migration-security.test.mjs         | 31 ++++++++++++++++++++++
 3 files changed, 35 insertions(+), 2 deletions(-)
diff --git a/supabase/migrations/202610060006_goal_write_guards.sql b/supabase/migrations/202610060006_goal_write_guards.sql
index 46a904b..4ac583d 100644
--- a/supabase/migrations/202610060006_goal_write_guards.sql
+++ b/supabase/migrations/202610060006_goal_write_guards.sql
@@ -59,21 +59,22 @@ BEGIN
     END IF;
   END IF;
   RETURN NEW;
 END $$;
 CREATE OR REPLACE FUNCTION public.guard_goal_money() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
 DECLARE v_amount numeric;
 BEGIN
   IF current_user='authenticated' THEN
     v_amount := CASE WHEN TG_ARGV[0]='target_amount' THEN NEW.target_amount ELSE NEW.allocation_per_cycle END;
-    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000 THEN
+    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000
+      OR (TG_ARGV[0]='target_amount' AND v_amount<=0) THEN
       RAISE EXCEPTION 'INVALID_STATE';
     END IF;
   END IF;
   RETURN NEW;
 END $$;
 REVOKE ALL ON FUNCTION public.guard_goal_money() FROM PUBLIC,anon,authenticated,service_role;
 DROP TRIGGER IF EXISTS financial_identity_guard ON public.accounts;
 CREATE TRIGGER financial_identity_guard BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_identity();
 DROP TRIGGER IF EXISTS financial_opening_guard ON public.accounts;
 CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 47d39e3..c22fec8 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -999,21 +999,22 @@ BEGIN
     END IF;
   END IF;
   RETURN NEW;
 END $$;
 CREATE OR REPLACE FUNCTION public.guard_goal_money() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
 DECLARE v_amount numeric;
 BEGIN
   IF current_user='authenticated' THEN
     v_amount := CASE WHEN TG_ARGV[0]='target_amount' THEN NEW.target_amount ELSE NEW.allocation_per_cycle END;
-    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000 THEN
+    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000
+      OR (TG_ARGV[0]='target_amount' AND v_amount<=0) THEN
       RAISE EXCEPTION 'INVALID_STATE';
     END IF;
   END IF;
   RETURN NEW;
 END $$;
 REVOKE ALL ON FUNCTION public.guard_goal_money() FROM PUBLIC,anon,authenticated,service_role;
 DROP TRIGGER IF EXISTS financial_identity_guard ON public.accounts;
 CREATE TRIGGER financial_identity_guard BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_identity();
 DROP TRIGGER IF EXISTS financial_opening_guard ON public.accounts;
 CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
diff --git a/tests/database/migration-security.test.mjs b/tests/database/migration-security.test.mjs
index f26d33f..d18651f 100644
--- a/tests/database/migration-security.test.mjs
+++ b/tests/database/migration-security.test.mjs
@@ -229,10 +229,41 @@ test('authenticated goal money edits reject nonfinite values, preserve valid der
   assert.equal(totals(f, after).progressPercent, 50);
   assert.equal(totals(f, after).reserved, '1000.00');
   assert.equal(wallet(f, after).actual, '30000.00');
   requireSuccess(await f.admin.from('goals').update({ allocation_per_cycle: 'NaN' }).eq('id', f.owner.goal.id));
   await applyMigration('202610060006_goal_write_guards.sql');
   requireSuccess(await f.owner.client.from('goals').update({ target_amount: '3000.00', name: 'Legacy reviewed separately' }).eq('id', f.owner.goal.id));
   const { queryAdmin } = await databaseRuntime();
   const old = await queryAdmin(`SELECT allocation_per_cycle::text AS allocation,target_amount::text AS target FROM public.goals WHERE id='${f.owner.goal.id}'::uuid`);
   assert.deepEqual(old, [{ allocation: 'NaN', target: '3000.00' }]);
 });
+
+test('authenticated zero-target goal creation is denied while positive targets with zero allocation remain valid', async t => {
+  const f = await setup(t), initial = await snap(f);
+  for (const target_amount of ['0.00',0]) {
+    const result = await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Zero target', target_amount, allocation_per_cycle: '0.00' });
+    assert.equal(result.error?.message, 'INVALID_STATE');
+    assert.deepEqual(await snap(f), initial);
+  }
+  const row = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Small positive target', target_amount: '0.01', allocation_per_cycle: '0.00' }).select().single());
+  const after = (await snap(f)).goals.find(g => g.goalId === row.id);
+  assert.equal(after.target_amount, '0.01');
+  assert.equal(after.allocation_per_cycle, '0.00');
+});
+
+test('authenticated zero-target updates leave the snapshot intact and zero-allocation target edits still recompute progress', async t => {
+  const f = await setup(t);
+  requireSuccess(await apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '1000.00' }));
+  const initial = await snap(f);
+  for (const target_amount of ['0.00',0]) {
+    const result = await f.owner.client.from('goals').update({ target_amount }).eq('id', f.owner.goal.id);
+    assert.equal(result.error?.message, 'INVALID_STATE');
+    assert.deepEqual(await snap(f), initial);
+  }
+  requireSuccess(await f.owner.client.from('goals').update({ target_amount: '2000.00', allocation_per_cycle: '0.00' }).eq('id', f.owner.goal.id));
+  const after = await snap(f);
+  assert.equal(totals(f, after).target_amount, '2000.00');
+  assert.equal(totals(f, after).allocation_per_cycle, '0.00');
+  assert.equal(totals(f, after).progressPercent, 50);
+  assert.equal(totals(f, after).reserved, '1000.00');
+  assert.equal(wallet(f, after).actual, '30000.00');
+});
