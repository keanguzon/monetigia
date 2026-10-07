e5683bf fix: reject nonfinite authenticated goal and wallet money
 .../2026-10-06-goal-reservations/task-10-report.md | 11 ++++++
 docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md     |  1 +
 .../migrations/202610060006_goal_write_guards.sql  | 20 +++++++++-
 supabase/schema.sql                                | 20 +++++++++-
 tests/database/migration-security.test.mjs         | 46 ++++++++++++++++++++++
 5 files changed, 96 insertions(+), 2 deletions(-)
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md
index 7521035..4a17197 100644
--- a/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-10-report.md
@@ -41,10 +41,21 @@ GREEN covering run: `node .superpowers/local-db/run-test.mjs tests/database/migr
 - PASS, comment scope: new SQL comments explain column-grant cleanup and fail-closed unknown-function revocation. No generic narration comments were added.
 - PENDING, rendered gate: actual 375/768/1280 light/dark browser rendering and complete click-through remain with root's Task 11 gate, as instructed. Source and jsdom checks are not represented as rendered-browser evidence. Root also owns final branch lint/build.
 
 ## Files changed
 
 `.gitignore`; `docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md`; `src/app/(dashboard)/goals/page.tsx`; `src/components/goals/GoalCard.tsx`; `src/components/goals/LegacyGoalReviewDialog.tsx`; `src/components/transactions/AddTransactionModal.tsx`; `supabase/migrations/202610060005_goal_lifecycle_operations.sql`; `supabase/migrations/202610060006_goal_write_guards.sql`; `supabase/schema.sql`; `tests/database/migration-security.test.mjs`; `tests/database/reservations.test.mjs`; `tests/legacy-goals.test.tsx`; this report.
 
 ## Remaining gates
 
 Task 10 implementation and automated checks are complete. Independent review and root's Task 11 rendered/lint/build gate remain. Deployment additionally requires authorized backup/debt/schema/function/grant preflight. In particular, the real old deletion RPC is still unverified; the local fixture test does not establish its deployed name, signature or body.
+
+## Review fix round 1: finite authenticated money writes
+
+Independent review found PostgreSQL numeric `NaN` bypassed the opening balance's NULL/negative check. The same typed numeric domain permits `NaN` in directly editable goal target/allocation amounts. These are authenticated direct-write guards; no legacy values are automatically rewritten and privileged fixture setup remains available.
+
+- Opening balances now explicitly reject nonfinite, null, negative and out-of-range values. Goal target/allocation guards apply on creation and when each money column is explicitly updated. Separate column triggers allow unrelated metadata/target edits to leave an untouched legacy invalid allocation intact for separate review. The trigger helper has pinned search path and no direct PUBLIC/anon/authenticated/service_role execution grants.
+- Mirrored migration 006 in the reproducible schema and added the existing-invalid-money audit to deployment preflight. The typed numeric columns still determine decimal rounding; this fix makes no new promise to reject excess input scale before PostgreSQL's column conversion.
+- RED: `node .superpowers/local-db/run-test.mjs tests/database/migration-security.test.mjs` exited 1 with 9 passed / 3 failed. Ordinary authenticated HTTP opening `NaN`, goal creation `NaN` target, and goal update `NaN` target unexpectedly succeeded. Each failure explicitly asserted that the write must be denied.
+- GREEN: the same focused command exited 0, 12/12 passed. Tests cover both goal money columns on insert/update, `NaN`, positive/negative infinity, malformed numeric text, null, negative and overflow values, zero/positive/max finite openings, valid goal creation/target recomputation, unchanged actual/reserved balances, and retained untouched legacy invalid allocation after reapplication.
+- Full final verification: `npm run test:db` with ignored disposable environment only exited 0, 69/69 passed; `npm test` exited 0, Node 2/2 and Vitest 9 files / 130 tests; `npx tsc --noEmit` exited 0. No runtime test warnings. The reservations after-hook restored current migrations and the preview user's data was not reset.
+- Files: migration 006, schema.sql, migration-security tests, rollout checklist and this report. No root plan/progress/review edits, live database changes, dependencies, push, merge or deployment.
diff --git a/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md b/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
index b18d518..03b59dc 100644
--- a/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
+++ b/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
@@ -91,16 +91,17 @@ Legacy review explicitly selects active PHP cash-wallet reservations, a lifecycl
 The disposable native database inventory contained the three public finance endpoints, private `goal_reservation_apply` and `goal_transaction_apply`, the allocation owner/immutability triggers, the identity guard, and the existing registration trigger. All security definers reported `search_path=pg_catalog, public`. This inventory is local evidence only. The actual deployed deletion RPC's name, overloads, body, and grants remain unknown.
 
 Migration 006 fails closed for other public security-definer functions and private goal/guard helpers: it revokes execution from PUBLIC, anon, authenticated, and service_role, retaining only the three reviewed public finance endpoint signatures. Trigger invocation continues to work without direct execution grants. No guessed deletion RPC body is created or replaced. The security test creates and revokes a clearly named disposable old deletion fixture RPC solely to prove the bypass is denied; it is not evidence of a deployed function's name or implementation.
 
 Before deployment, review the captured complete function inventory, including every exposed API schema, overload, function owner, security mode, search path, table grants, column grants, role membership, inherited grants, and default privileges. Identify all existing financial RPC callers. Confirm unknown or old mutation endpoints are revoked for every calling role, including grants inherited through PUBLIC or another role. If a reviewed nonfinancial endpoint must remain callable, add its exact signature to the reviewed deployment allowlist and rerun owner/security tests before cutover. Do not regrant unknown functions merely to restore an old client.
 
 ## Operator cutover checklist
 
 1. Obtain separate production/deployment authorization. Capture a restorable database backup and the schema/function/grant inventory; test restoring the backup into an isolated environment before changing production.
 2. Complete the statement-based card opening-debt discrepancy audit above. Record unresolved comparisons and review corrections separately; do not replace balances with monthly debt previews.
+   Audit existing account balances and goal target/allocation amounts for null, nonfinite (`NaN`/infinity), negative or out-of-domain values. Migration 006 rejects newly written authenticated opening balances and goal money, but does not rewrite existing legacy values. Record any invalid legacy rows for a separate source-backed correction before enabling affected financial actions. Unrelated metadata edits do not silently repair those amounts.
 3. Rehearse migrations 001 through 006 on a disposable copy with representative legacy rows, followed by standalone 005/006 reapplication and the reproducible `schema.sql`. Confirm balances, old tags, review decisions, and imported history survive reapplication.
 4. Coordinate the application writer release with migration 006. Pause writes or use a maintenance window during the cutover so an old client cannot submit through the legacy direct-write lane. Apply the additive baseline/ledger/RPC migrations, switch every writer, then enforce the reviewed grants and endpoint revocations. Verify the final state, not an intermediate migration state.
 5. Confirm owner-scoped reads, safe metadata/target edits, safe wallet creation, quote/confirmation, transaction/deletion, legacy review, close/reopen/archive, retry replay, and denied direct writes as ordinary authenticated users. Verify no unknown public definer endpoint or overload remains callable.
 6. Monitor failed mutations and financial-operation completion. If the cutover fails, disable affected writes and apply a forward fix. Preserve operations, append-only allocation history, and idempotency IDs. Never roll back to an application that writes balances or transactions directly while reservations exist.
 
 Local automated tests create uniquely named users and remove only those users. They do not reset the separate preview user. The final reservations test restores the current transaction/lifecycle/guard migrations after exercising the older reservation dispatcher. Rendered browser verification and deployment preflight remain separate gates; local test results are not a live database audit or permission to deploy.
diff --git a/supabase/migrations/202610060006_goal_write_guards.sql b/supabase/migrations/202610060006_goal_write_guards.sql
index 0ec43bb..46a904b 100644
--- a/supabase/migrations/202610060006_goal_write_guards.sql
+++ b/supabase/migrations/202610060006_goal_write_guards.sql
@@ -44,34 +44,52 @@ BEGIN
   END IF;
   RETURN NEW;
 END $$;
 
 CREATE OR REPLACE FUNCTION public.guard_financial_opening() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
 BEGIN
   IF current_user='authenticated' THEN
     IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
     IF TG_TABLE_NAME='accounts' THEN
-      IF NEW.balance IS NULL OR NEW.balance<0 OR NEW.currency IS DISTINCT FROM 'PHP' OR NEW.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      IF NEW.balance IS NULL OR NEW.balance::text IN ('NaN','Infinity','-Infinity') OR NEW.balance<0 OR NEW.balance>=10000000000000
+        OR NEW.currency IS DISTINCT FROM 'PHP' OR NEW.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     ELSE
       IF NEW.current_amount IS DISTINCT FROM 0 OR NEW.is_completed IS DISTINCT FROM false OR NEW.status<>'active'
         OR NEW.review_state<>'confirmed' OR NEW.completed_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     END IF;
   END IF;
   RETURN NEW;
 END $$;
+CREATE OR REPLACE FUNCTION public.guard_goal_money() RETURNS trigger
+LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
+DECLARE v_amount numeric;
+BEGIN
+  IF current_user='authenticated' THEN
+    v_amount := CASE WHEN TG_ARGV[0]='target_amount' THEN NEW.target_amount ELSE NEW.allocation_per_cycle END;
+    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000 THEN
+      RAISE EXCEPTION 'INVALID_STATE';
+    END IF;
+  END IF;
+  RETURN NEW;
+END $$;
+REVOKE ALL ON FUNCTION public.guard_goal_money() FROM PUBLIC,anon,authenticated,service_role;
 DROP TRIGGER IF EXISTS financial_identity_guard ON public.accounts;
 CREATE TRIGGER financial_identity_guard BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_identity();
 DROP TRIGGER IF EXISTS financial_opening_guard ON public.accounts;
 CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
 DROP TRIGGER IF EXISTS financial_opening_guard ON public.goals;
 CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
+DROP TRIGGER IF EXISTS goal_target_money_guard ON public.goals;
+CREATE TRIGGER goal_target_money_guard BEFORE INSERT OR UPDATE OF target_amount ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_goal_money('target_amount');
+DROP TRIGGER IF EXISTS goal_allocation_money_guard ON public.goals;
+CREATE TRIGGER goal_allocation_money_guard BEFORE INSERT OR UPDATE OF allocation_per_cycle ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_goal_money('allocation_per_cycle');
 
 -- Unknown deployed definer RPCs fail closed until their complete signatures and bodies are reviewed.
 DO $$ DECLARE v_function record; BEGIN
   FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f' AND (p.prosecdef OR p.proname LIKE 'goal_%' OR p.proname LIKE 'guard_financial_%')
       AND p.oid NOT IN ('public.goal_finance_snapshot()'::regprocedure,'public.goal_transaction_quote(jsonb,jsonb)'::regprocedure,'public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure)
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_function.signature); END LOOP;
 END $$;
 REVOKE ALL ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 839296d..47d39e3 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -984,34 +984,52 @@ BEGIN
   END IF;
   RETURN NEW;
 END $$;
 
 CREATE OR REPLACE FUNCTION public.guard_financial_opening() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
 BEGIN
   IF current_user='authenticated' THEN
     IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
     IF TG_TABLE_NAME='accounts' THEN
-      IF NEW.balance IS NULL OR NEW.balance<0 OR NEW.currency IS DISTINCT FROM 'PHP' OR NEW.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      IF NEW.balance IS NULL OR NEW.balance::text IN ('NaN','Infinity','-Infinity') OR NEW.balance<0 OR NEW.balance>=10000000000000
+        OR NEW.currency IS DISTINCT FROM 'PHP' OR NEW.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     ELSE
       IF NEW.current_amount IS DISTINCT FROM 0 OR NEW.is_completed IS DISTINCT FROM false OR NEW.status<>'active'
         OR NEW.review_state<>'confirmed' OR NEW.completed_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     END IF;
   END IF;
   RETURN NEW;
 END $$;
+CREATE OR REPLACE FUNCTION public.guard_goal_money() RETURNS trigger
+LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
+DECLARE v_amount numeric;
+BEGIN
+  IF current_user='authenticated' THEN
+    v_amount := CASE WHEN TG_ARGV[0]='target_amount' THEN NEW.target_amount ELSE NEW.allocation_per_cycle END;
+    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000 THEN
+      RAISE EXCEPTION 'INVALID_STATE';
+    END IF;
+  END IF;
+  RETURN NEW;
+END $$;
+REVOKE ALL ON FUNCTION public.guard_goal_money() FROM PUBLIC,anon,authenticated,service_role;
 DROP TRIGGER IF EXISTS financial_identity_guard ON public.accounts;
 CREATE TRIGGER financial_identity_guard BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_identity();
 DROP TRIGGER IF EXISTS financial_opening_guard ON public.accounts;
 CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
 DROP TRIGGER IF EXISTS financial_opening_guard ON public.goals;
 CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
+DROP TRIGGER IF EXISTS goal_target_money_guard ON public.goals;
+CREATE TRIGGER goal_target_money_guard BEFORE INSERT OR UPDATE OF target_amount ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_goal_money('target_amount');
+DROP TRIGGER IF EXISTS goal_allocation_money_guard ON public.goals;
+CREATE TRIGGER goal_allocation_money_guard BEFORE INSERT OR UPDATE OF allocation_per_cycle ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_goal_money('allocation_per_cycle');
 
 -- Unknown deployed definer RPCs fail closed until their complete signatures and bodies are reviewed.
 DO $$ DECLARE v_function record; BEGIN
   FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f' AND (p.prosecdef OR p.proname LIKE 'goal_%' OR p.proname LIKE 'guard_financial_%')
       AND p.oid NOT IN ('public.goal_finance_snapshot()'::regprocedure,'public.goal_transaction_quote(jsonb,jsonb)'::regprocedure,'public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure)
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_function.signature); END LOOP;
 END $$;
 REVOKE ALL ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
diff --git a/tests/database/migration-security.test.mjs b/tests/database/migration-security.test.mjs
index afcc12b..f26d33f 100644
--- a/tests/database/migration-security.test.mjs
+++ b/tests/database/migration-security.test.mjs
@@ -183,10 +183,56 @@ test('ordered migrations and reproducible schema preserve imported history and f
   for (let pass = 0; pass < 2; pass++) for (const name of ['001_runtime_baseline','002_goal_allocation_ledger','003_goal_reservation_operations','004_goal_transaction_operations','005_goal_lifecycle_operations','006_goal_write_guards']) await applyMigration(`202610060${name}.sql`);
   const { queryAdmin } = await databaseRuntime();
   await queryAdmin(await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
   await queryAdmin("NOTIFY pgrst, 'reload schema'");
   assert.deepEqual(requireSuccess(await apply(f, c, request)), { ...result, replayed: true });
   assert.equal(totals(f, await snap(f)).spent, '2000.00');
   assert.ok((await f.owner.client.from('accounts').update({ balance: 1 }).eq('id', f.owner.account.id)).error);
   const denied = await queryAdmin("SELECT has_table_privilege('authenticated','public.transactions','INSERT') AS tx,has_column_privilege('authenticated','public.accounts','balance','UPDATE') AS balance,has_column_privilege('authenticated','public.goals','status','UPDATE') AS lifecycle,has_function_privilege('authenticated','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS helper");
   assert.deepEqual(denied, [{ tx: false, balance: false, lifecycle: false, helper: false }]);
 });
+
+test('authenticated opening balances reject nonfinite and invalid domain values while finite zero and positive wallets work', async t => {
+  const f = await setup(t), initial = await snap(f);
+  for (const balance of ['NaN','Infinity','-Infinity','not-a-number','-0.01','10000000000000.00',null]) {
+    const result = await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Invalid opening', type: 'cash', balance });
+    assert.ok(result.error, `Opening balance ${balance} must be denied`);
+    assert.deepEqual(await snap(f), initial);
+  }
+  for (const balance of ['0.00','0.01','9999999999999.99']) {
+    const row = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Finite opening', type: 'cash', balance }).select().single());
+    assert.equal((await snap(f)).wallets.find(w => w.accountId === row.id).actual, balance);
+  }
+});
+
+test('authenticated goal creation rejects nonfinite target and allocation money without poisoning the finance snapshot', async t => {
+  const f = await setup(t), initial = await snap(f);
+  for (const field of ['target_amount','allocation_per_cycle']) for (const amount of ['NaN','Infinity','-Infinity','not-a-number','-0.01','10000000000000.00',null]) {
+    const result = await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Invalid goal money', target_amount: '5000.00', allocation_per_cycle: '0.00', [field]: amount });
+    assert.ok(result.error, `${field} ${amount} must be denied`);
+    assert.deepEqual(await snap(f), initial);
+  }
+  const row = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Finite goal', target_amount: '9999999999999.99', allocation_per_cycle: '0.00' }).select().single());
+  assert.equal((await snap(f)).goals.find(g => g.goalId === row.id).target_amount, '9999999999999.99');
+});
+
+test('authenticated goal money edits reject nonfinite values, preserve valid derived target edits and leave untouched legacy invalid amounts intact', async t => {
+  const f = await setup(t);
+  requireSuccess(await apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '1000.00' }));
+  const initial = await snap(f);
+  for (const field of ['target_amount','allocation_per_cycle']) for (const amount of ['NaN','Infinity','-Infinity','not-a-number','-0.01','10000000000000.00',null]) {
+    const result = await f.owner.client.from('goals').update({ [field]: amount }).eq('id', f.owner.goal.id);
+    assert.ok(result.error, `${field} ${amount} must be denied`);
+    assert.deepEqual(await snap(f), initial);
+  }
+  requireSuccess(await f.owner.client.from('goals').update({ target_amount: '2000.00', allocation_per_cycle: '0.01' }).eq('id', f.owner.goal.id));
+  const after = await snap(f);
+  assert.equal(totals(f, after).progressPercent, 50);
+  assert.equal(totals(f, after).reserved, '1000.00');
+  assert.equal(wallet(f, after).actual, '30000.00');
+  requireSuccess(await f.admin.from('goals').update({ allocation_per_cycle: 'NaN' }).eq('id', f.owner.goal.id));
+  await applyMigration('202610060006_goal_write_guards.sql');
+  requireSuccess(await f.owner.client.from('goals').update({ target_amount: '3000.00', name: 'Legacy reviewed separately' }).eq('id', f.owner.goal.id));
+  const { queryAdmin } = await databaseRuntime();
+  const old = await queryAdmin(`SELECT allocation_per_cycle::text AS allocation,target_amount::text AS target FROM public.goals WHERE id='${f.owner.goal.id}'::uuid`);
+  assert.deepEqual(old, [{ allocation: 'NaN', target: '3000.00' }]);
+});
