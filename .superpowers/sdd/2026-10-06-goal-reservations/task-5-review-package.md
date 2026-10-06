00fc91d feat: preserve goal achievements and reverse spending safely
 .gitignore                                         |   1 +
 .../2026-10-06-goal-reservations/task-5-report.md  |  33 +++
 .../202610060005_goal_lifecycle_operations.sql     | 170 ++++++++++++++
 supabase/schema.sql                                | 171 +++++++++++++++
 tests/database/goal-lifecycle.test.mjs             | 243 +++++++++++++++++++++
 5 files changed, 618 insertions(+)
diff --git a/.gitignore b/.gitignore
index ba1be11..85774fc 100644
--- a/.gitignore
+++ b/.gitignore
@@ -75,10 +75,11 @@ supabase/migrations/*
 !supabase/migrations/202610060002_goal_allocation_ledger.sql
 !supabase/migrations/202610060003_goal_reservation_operations.sql
 
 # Verification & Test Scripts
 scripts/
 
 
 
 
 !supabase/migrations/202610060004_goal_transaction_operations.sql
+!supabase/migrations/202610060005_goal_lifecycle_operations.sql
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-5-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-5-report.md
new file mode 100644
index 0000000..79f6043
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-5-report.md
@@ -0,0 +1,33 @@
+# Task 5 implementation report
+
+Implemented lifecycle commands and transaction deletion in the public finance dispatcher. The repeatable migration keeps the existing transaction/reservation lanes as private helpers, with direct execution revoked for every client role. New mutations require `auth.uid()` ownership, lock the profile first and goals/accounts in UUID order, and complete operation results atomically with status, allocations, balances, and deletion.
+
+Closing below target succeeds. Nonzero leftovers require a release or destination choice; moves preserve each backing wallet. Completion/cancellation preserve spending and mirror the legacy completion boolean. Reopen produces no reservations; archive requires a closed goal with zero reservations. Reads never update the legacy boolean.
+
+Deletion reverses the selected transaction amount, including only the selected scheduled installment row. This preserves the current single-UUID caller behavior, confirmed by the controller; other installment rows and their remaining booked debt stay intact. Original allocation values/IDs and transaction UUID references remain unchanged. Active spending/release/carrying events receive nonzero audited reversals linked through `reversal_of`; spent-only imported events reduce spending without inventing reservations. Closed/archived goals receive no reservation restoration and remain closed. Closed release/carry reversals with no allocation effect emit no zero-value event: the deletion operation command/result audits the transaction UUID, as directed by the controller, preserving the ledger's existing zero-event constraint.
+
+Transfer reversal validates actual balances, carried reservations, and resulting wallet backing. Income reversal cannot reduce actual below reservations. Failures include corrective guidance in SQL `HINT`; Task 6's client should expose that guidance or an equivalent mapped instruction. Auto-release originals from migration 004 are located through their owning transaction operation result because those release events have no transaction UUID.
+
+## TDD and verification
+
+- RED: `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/goal-lifecycle.test.mjs` before production edits: **0 passing, 14 failing**. Lifecycle/deletion requests returned the existing `INVALID_STATE`, including expected `INSUFFICIENT_ACTUAL`, `INSUFFICIENT_AVAILABLE`, and ownership assertions receiving that unsupported-command failure. This verified the missing operation lane. Tests exercised real Supabase SDK/PostgREST against disposable PostgreSQL 16 on loopback ports 55439/55440/55441.
+- GREEN: same focused command after migration: **14 passing, 0 failing**. Added focused coverage for downstream reservation loss with actual money intact, closed carrying reversal, debt payment reversal, injected late deletion failure, private helper denial, read-only legacy boolean, and concurrent duplicate lifecycle requests. Re-ran the focused command: **19 passing, 0 failing**, output clean.
+- Full suite: loaded `.superpowers/local-db/environment.json` into process environment only, then `npm run test:db`: **55 passing, 0 failing**, output clean. No live `.env` values used or printed.
+- TypeScript: `npx tsc --noEmit`: exit **0**, no output.
+- Restored the complete ordered schema after the suite (earlier test files intentionally reinstall earlier dispatchers): read `supabase/schema.sql` and applied it via the disposable adapter's `queryAdmin`: `Ordered schema restored`.
+- Post-restore SQL inventory: PostgreSQL **16.15**; authenticated public apply execution **true**, private transaction and reservation execution **false**. An initial inline SQL inventory command had a shell quoting syntax error before any query ran; corrected with a literal here-string and obtained the above result.
+- `git diff --check`: no whitespace errors. Git emits only its configured LF-to-CRLF working-copy notices.
+
+Rollback tests compare all owner goals, accounts, operations, events, and transactions. The injected `BEFORE DELETE` failure occurs after reversal inserts and balance updates, proving those writes and the operation result roll back together. The closed expense test pins status `completed`, reserved `0.00`, spent `0.00`, unchanged completion/archive timestamps, and available refund. Other coverage verifies wallet breakdown during leftover moves, repeated deletion replay without appended reversals, non-restoration of closed releases, and 1000.01 debt installments leaving exactly 666.67 debt and two rows after deleting the first 333.34 row.
+
+## Files and self-review
+
+- `supabase/migrations/202610060005_goal_lifecycle_operations.sql`
+- `tests/database/goal-lifecycle.test.mjs`
+- `supabase/schema.sql`: ordered migration bundle only
+- `.gitignore`: one narrow migration exception
+- This report
+
+Reviewed validation/ownership, private grants, profile-first lock ordering, decimal arithmetic, idempotency, event provenance, transaction retention, closed-state handling, full rollback, migration reapplication, and bundle consistency. No changes to Task 6+ UI/adapter or permission cutover. Controller-owned `progress.md` remains unstaged.
+
+No correctness concern remains from self-review. Integration considerations: the new caller transport/UI belongs to later tasks; legacy live deletion-RPC inventory remains deployment preflight because its definition is absent locally. No build, live migration, push, merge, or deployment was performed.
diff --git a/supabase/migrations/202610060005_goal_lifecycle_operations.sql b/supabase/migrations/202610060005_goal_lifecycle_operations.sql
new file mode 100644
index 0000000..a8e5e1d
--- /dev/null
+++ b/supabase/migrations/202610060005_goal_lifecycle_operations.sql
@@ -0,0 +1,170 @@
+BEGIN;
+DO $$ BEGIN
+  IF to_regprocedure('public.goal_transaction_apply(uuid,jsonb,jsonb)') IS NULL THEN
+    ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_transaction_apply;
+  END IF;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_transaction_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
+
+CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid(); v_kind text; v_goal_id uuid; v_target_id uuid; v_transaction_id uuid;
+  v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
+  v_goal public.goals%ROWTYPE; v_target public.goals%ROWTYPE;
+  v_tx public.transactions%ROWTYPE; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
+  v_operation uuid; v_result jsonb; v_row record; v_events jsonb := '[]'::jsonb;
+  v_reserved numeric; v_delta numeric; v_src_balance numeric; v_dst_balance numeric;
+BEGIN
+  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  v_kind := p_command->>'kind';
+  IF v_kind IN ('reserve','release','reallocate','transaction') THEN
+    RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
+  END IF;
+  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL
+    OR v_kind IS NULL OR v_kind NOT IN ('close','reopen','archive','delete_transaction') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  BEGIN
+    IF v_kind='delete_transaction' THEN
+      IF jsonb_typeof(p_command->'transactionId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      v_transaction_id := (p_command->>'transactionId')::uuid;
+      v_command := jsonb_build_object('kind',v_kind,'transactionId',v_transaction_id);
+    ELSE
+      IF jsonb_typeof(p_command->'goalId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      v_goal_id := (p_command->>'goalId')::uuid;
+      v_command := jsonb_build_object('kind',v_kind,'goalId',v_goal_id);
+      IF v_kind='close' THEN
+        IF jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string'
+          OR p_command->>'status' NOT IN ('completed','cancelled') OR NOT p_command ? 'leftovers' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        IF p_command->'leftovers'<>'null'::jsonb THEN
+          IF p_command->'leftovers'=jsonb_build_object('mode','release') THEN NULL;
+          ELSIF jsonb_typeof(p_command->'leftovers'->'goalId')='string' AND p_command->'leftovers'->>'mode'='move' THEN
+            v_target_id := (p_command->'leftovers'->>'goalId')::uuid;
+            IF p_command->'leftovers'<>jsonb_build_object('mode','move','goalId',p_command->'leftovers'->>'goalId') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+          ELSE RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        END IF;
+        v_command := v_command || jsonb_build_object('status',p_command->>'status','leftovers',
+          CASE WHEN v_target_id IS NOT NULL THEN jsonb_build_object('mode','move','goalId',v_target_id) ELSE p_command->'leftovers' END);
+      END IF;
+    END IF;
+    IF p_command<>v_command THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
+  v_hash := encode(sha256(convert_to(v_command::text,'UTF8')),'hex');
+  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
+  IF FOUND THEN
+    IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
+    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    RETURN v_previous.result || jsonb_build_object('replayed',true);
+  END IF;
+  PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
+  PERFORM id FROM public.accounts WHERE user_id=v_owner ORDER BY id FOR UPDATE;
+  IF v_kind<>'delete_transaction' THEN
+    SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=v_goal_id;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+    IF v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal_id;
+    IF v_kind='close' THEN
+      IF v_goal.status<>'active' OR (v_reserved>0 AND p_command->'leftovers'='null'::jsonb) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      IF v_target_id IS NOT NULL THEN
+        SELECT * INTO v_target FROM public.goals WHERE user_id=v_owner AND id=v_target_id;
+        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+        IF v_target.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+        IF v_target.id=v_goal.id OR v_target.status<>'active' OR v_target.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      END IF;
+    ELSIF v_kind='reopen' THEN
+      IF v_goal.status='active' OR v_reserved<>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    ELSE
+      IF v_goal.status='active' OR v_reserved<>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END IF;
+    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
+    IF v_kind='close' THEN
+      FOR v_row IN SELECT account_id,sum(reserved_delta) AS funds FROM public.goal_allocation_events
+        WHERE user_id=v_owner AND goal_id=v_goal_id GROUP BY account_id ORDER BY account_id
+      LOOP
+        IF v_row.funds<0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        IF v_row.funds=0 THEN CONTINUE; END IF;
+        INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+          VALUES(v_owner,v_goal_id,v_row.account_id,v_operation,CASE WHEN v_target_id IS NULL THEN 'release' ELSE 'move_out' END,-v_row.funds);
+        IF v_target_id IS NOT NULL THEN
+          INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+            VALUES(v_owner,v_target_id,v_row.account_id,v_operation,'move_in',v_row.funds);
+        END IF;
+      END LOOP;
+      UPDATE public.goals SET status=p_command->>'status',is_completed=(p_command->>'status'='completed'),
+        completed_at=CASE WHEN p_command->>'status'='completed' THEN now() ELSE NULL END WHERE id=v_goal_id AND user_id=v_owner;
+    ELSIF v_kind='reopen' THEN
+      UPDATE public.goals SET status='active',is_completed=false,completed_at=NULL WHERE id=v_goal_id AND user_id=v_owner;
+    ELSE
+      UPDATE public.goals SET archived_at=now() WHERE id=v_goal_id AND user_id=v_owner;
+    END IF;
+  ELSE
+    SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id FOR UPDATE;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    v_src_balance := coalesce(v_src.balance,0)+CASE WHEN v_tx.type='income' THEN
+      CASE WHEN v_src.type='credit_card' THEN v_tx.amount ELSE -v_tx.amount END
+      ELSE CASE WHEN v_src.type='credit_card' THEN -v_tx.amount ELSE v_tx.amount END END;
+    IF v_tx.type='transfer' THEN
+      SELECT * INTO v_dst FROM public.accounts WHERE user_id=v_owner AND id=v_tx.transfer_to_account_id;
+      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+      v_dst_balance := coalesce(v_dst.balance,0)+CASE WHEN v_dst.type='credit_card' THEN v_tx.amount ELSE -v_tx.amount END;
+    END IF;
+    IF v_src_balance<0 OR v_dst_balance<0 THEN
+      RAISE EXCEPTION 'INSUFFICIENT_ACTUAL' USING HINT='Release funds or make a corrective transaction before deleting this transaction.';
+    END IF;
+    -- Older transaction operations link auto-releases through their result, rather than an event transaction UUID.
+    FOR v_row IN SELECT e.*,g.status,g.archived_at FROM public.goal_allocation_events e
+      JOIN public.goals g ON g.id=e.goal_id AND g.user_id=e.user_id
+      WHERE e.user_id=v_owner AND e.kind<>'reversal' AND
+        (e.transaction_id=v_transaction_id OR (e.kind='release' AND e.transaction_id IS NULL AND EXISTS(
+          SELECT 1 FROM public.financial_operations o WHERE o.id=e.operation_id AND o.user_id=v_owner
+            AND o.command->>'kind'='transaction' AND o.result->'transactionIds' @> jsonb_build_array(v_transaction_id))))
+        AND NOT EXISTS(SELECT 1 FROM public.goal_allocation_events r WHERE r.reversal_of=e.id)
+      ORDER BY e.id
+    LOOP
+      v_delta := CASE WHEN v_row.status='active' AND v_row.archived_at IS NULL THEN -v_row.reserved_delta ELSE 0 END;
+      IF v_delta<>0 OR v_row.spent_delta<>0 THEN
+        v_events := v_events || jsonb_build_array(jsonb_build_object('id',v_row.id,'goal',v_row.goal_id,'account',v_row.account_id,
+          'reserved',v_delta,'spent',-v_row.spent_delta,'transaction',v_row.transaction_id));
+      END IF;
+    END LOOP;
+    FOR v_row IN SELECT (value->>'goal')::uuid AS goal_id,(value->>'account')::uuid AS account_id,
+      sum((value->>'reserved')::numeric) AS delta FROM jsonb_array_elements(v_events) GROUP BY 1,2
+    LOOP
+      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events
+        WHERE user_id=v_owner AND goal_id=v_row.goal_id AND account_id=v_row.account_id;
+      IF v_reserved+v_row.delta<0 THEN
+        RAISE EXCEPTION 'INSUFFICIENT_RESERVATION' USING HINT='Restore the carried allocation or make a corrective transaction before deleting this transfer.';
+      END IF;
+    END LOOP;
+    FOR v_row IN SELECT a.id,a.type,CASE WHEN a.id=v_src.id THEN v_src_balance WHEN a.id=v_dst.id THEN v_dst_balance ELSE coalesce(a.balance,0) END AS balance
+      FROM public.accounts a WHERE a.user_id=v_owner ORDER BY a.id
+    LOOP
+      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_row.id;
+      SELECT coalesce(sum((value->>'reserved')::numeric),0) INTO v_delta FROM jsonb_array_elements(v_events) WHERE (value->>'account')::uuid=v_row.id;
+      IF v_row.type<>'credit_card' AND v_row.balance<v_reserved+v_delta THEN
+        RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE' USING HINT='Release funds or make a corrective transaction before deleting this transaction.';
+      END IF;
+    END LOOP;
+    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
+    FOR v_row IN SELECT value FROM jsonb_array_elements(v_events) LOOP
+      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id,reversal_of)
+        VALUES(v_owner,(v_row.value->>'goal')::uuid,(v_row.value->>'account')::uuid,v_operation,'reversal',
+          (v_row.value->>'reserved')::numeric,(v_row.value->>'spent')::numeric,(v_row.value->>'transaction')::uuid,(v_row.value->>'id')::uuid);
+    END LOOP;
+    UPDATE public.accounts SET balance=v_src_balance WHERE user_id=v_owner AND id=v_src.id;
+    IF v_tx.type='transfer' THEN UPDATE public.accounts SET balance=v_dst_balance WHERE user_id=v_owner AND id=v_dst.id; END IF;
+    DELETE FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id;
+  END IF;
+  v_result := jsonb_build_object('operationId',v_operation,'transactionIds',
+    CASE WHEN v_kind='delete_transaction' THEN jsonb_build_array(v_transaction_id) ELSE '[]'::jsonb END,'replayed',false);
+  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE user_id=v_owner AND id=v_operation;
+  RETURN v_result;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
+GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/supabase/schema.sql b/supabase/schema.sql
index eb9c71c..42b3907 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -675,10 +675,181 @@ BEGIN
   v_result := jsonb_build_object('operationId',v_operation,'transactionIds',v_ids,'replayed',false);
   UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=v_operation AND user_id=v_owner;
   RETURN v_result;
 END $$;
 REVOKE ALL ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) FROM PUBLIC,anon;
 REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) TO authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
 NOTIFY pgrst, 'reload schema';
 COMMIT;
+
+BEGIN;
+DO $$ BEGIN
+  IF to_regprocedure('public.goal_transaction_apply(uuid,jsonb,jsonb)') IS NULL THEN
+    ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_transaction_apply;
+  END IF;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_transaction_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
+
+CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid(); v_kind text; v_goal_id uuid; v_target_id uuid; v_transaction_id uuid;
+  v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
+  v_goal public.goals%ROWTYPE; v_target public.goals%ROWTYPE;
+  v_tx public.transactions%ROWTYPE; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
+  v_operation uuid; v_result jsonb; v_row record; v_events jsonb := '[]'::jsonb;
+  v_reserved numeric; v_delta numeric; v_src_balance numeric; v_dst_balance numeric;
+BEGIN
+  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  v_kind := p_command->>'kind';
+  IF v_kind IN ('reserve','release','reallocate','transaction') THEN
+    RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
+  END IF;
+  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL
+    OR v_kind IS NULL OR v_kind NOT IN ('close','reopen','archive','delete_transaction') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  BEGIN
+    IF v_kind='delete_transaction' THEN
+      IF jsonb_typeof(p_command->'transactionId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      v_transaction_id := (p_command->>'transactionId')::uuid;
+      v_command := jsonb_build_object('kind',v_kind,'transactionId',v_transaction_id);
+    ELSE
+      IF jsonb_typeof(p_command->'goalId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      v_goal_id := (p_command->>'goalId')::uuid;
+      v_command := jsonb_build_object('kind',v_kind,'goalId',v_goal_id);
+      IF v_kind='close' THEN
+        IF jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string'
+          OR p_command->>'status' NOT IN ('completed','cancelled') OR NOT p_command ? 'leftovers' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        IF p_command->'leftovers'<>'null'::jsonb THEN
+          IF p_command->'leftovers'=jsonb_build_object('mode','release') THEN NULL;
+          ELSIF jsonb_typeof(p_command->'leftovers'->'goalId')='string' AND p_command->'leftovers'->>'mode'='move' THEN
+            v_target_id := (p_command->'leftovers'->>'goalId')::uuid;
+            IF p_command->'leftovers'<>jsonb_build_object('mode','move','goalId',p_command->'leftovers'->>'goalId') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+          ELSE RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        END IF;
+        v_command := v_command || jsonb_build_object('status',p_command->>'status','leftovers',
+          CASE WHEN v_target_id IS NOT NULL THEN jsonb_build_object('mode','move','goalId',v_target_id) ELSE p_command->'leftovers' END);
+      END IF;
+    END IF;
+    IF p_command<>v_command THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
+  v_hash := encode(sha256(convert_to(v_command::text,'UTF8')),'hex');
+  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
+  IF FOUND THEN
+    IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
+    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    RETURN v_previous.result || jsonb_build_object('replayed',true);
+  END IF;
+  PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
+  PERFORM id FROM public.accounts WHERE user_id=v_owner ORDER BY id FOR UPDATE;
+  IF v_kind<>'delete_transaction' THEN
+    SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=v_goal_id;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+    IF v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal_id;
+    IF v_kind='close' THEN
+      IF v_goal.status<>'active' OR (v_reserved>0 AND p_command->'leftovers'='null'::jsonb) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      IF v_target_id IS NOT NULL THEN
+        SELECT * INTO v_target FROM public.goals WHERE user_id=v_owner AND id=v_target_id;
+        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+        IF v_target.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+        IF v_target.id=v_goal.id OR v_target.status<>'active' OR v_target.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      END IF;
+    ELSIF v_kind='reopen' THEN
+      IF v_goal.status='active' OR v_reserved<>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    ELSE
+      IF v_goal.status='active' OR v_reserved<>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END IF;
+    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
+    IF v_kind='close' THEN
+      FOR v_row IN SELECT account_id,sum(reserved_delta) AS funds FROM public.goal_allocation_events
+        WHERE user_id=v_owner AND goal_id=v_goal_id GROUP BY account_id ORDER BY account_id
+      LOOP
+        IF v_row.funds<0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        IF v_row.funds=0 THEN CONTINUE; END IF;
+        INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+          VALUES(v_owner,v_goal_id,v_row.account_id,v_operation,CASE WHEN v_target_id IS NULL THEN 'release' ELSE 'move_out' END,-v_row.funds);
+        IF v_target_id IS NOT NULL THEN
+          INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+            VALUES(v_owner,v_target_id,v_row.account_id,v_operation,'move_in',v_row.funds);
+        END IF;
+      END LOOP;
+      UPDATE public.goals SET status=p_command->>'status',is_completed=(p_command->>'status'='completed'),
+        completed_at=CASE WHEN p_command->>'status'='completed' THEN now() ELSE NULL END WHERE id=v_goal_id AND user_id=v_owner;
+    ELSIF v_kind='reopen' THEN
+      UPDATE public.goals SET status='active',is_completed=false,completed_at=NULL WHERE id=v_goal_id AND user_id=v_owner;
+    ELSE
+      UPDATE public.goals SET archived_at=now() WHERE id=v_goal_id AND user_id=v_owner;
+    END IF;
+  ELSE
+    SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id FOR UPDATE;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    v_src_balance := coalesce(v_src.balance,0)+CASE WHEN v_tx.type='income' THEN
+      CASE WHEN v_src.type='credit_card' THEN v_tx.amount ELSE -v_tx.amount END
+      ELSE CASE WHEN v_src.type='credit_card' THEN -v_tx.amount ELSE v_tx.amount END END;
+    IF v_tx.type='transfer' THEN
+      SELECT * INTO v_dst FROM public.accounts WHERE user_id=v_owner AND id=v_tx.transfer_to_account_id;
+      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+      v_dst_balance := coalesce(v_dst.balance,0)+CASE WHEN v_dst.type='credit_card' THEN v_tx.amount ELSE -v_tx.amount END;
+    END IF;
+    IF v_src_balance<0 OR v_dst_balance<0 THEN
+      RAISE EXCEPTION 'INSUFFICIENT_ACTUAL' USING HINT='Release funds or make a corrective transaction before deleting this transaction.';
+    END IF;
+    -- Older transaction operations link auto-releases through their result, rather than an event transaction UUID.
+    FOR v_row IN SELECT e.*,g.status,g.archived_at FROM public.goal_allocation_events e
+      JOIN public.goals g ON g.id=e.goal_id AND g.user_id=e.user_id
+      WHERE e.user_id=v_owner AND e.kind<>'reversal' AND
+        (e.transaction_id=v_transaction_id OR (e.kind='release' AND e.transaction_id IS NULL AND EXISTS(
+          SELECT 1 FROM public.financial_operations o WHERE o.id=e.operation_id AND o.user_id=v_owner
+            AND o.command->>'kind'='transaction' AND o.result->'transactionIds' @> jsonb_build_array(v_transaction_id))))
+        AND NOT EXISTS(SELECT 1 FROM public.goal_allocation_events r WHERE r.reversal_of=e.id)
+      ORDER BY e.id
+    LOOP
+      v_delta := CASE WHEN v_row.status='active' AND v_row.archived_at IS NULL THEN -v_row.reserved_delta ELSE 0 END;
+      IF v_delta<>0 OR v_row.spent_delta<>0 THEN
+        v_events := v_events || jsonb_build_array(jsonb_build_object('id',v_row.id,'goal',v_row.goal_id,'account',v_row.account_id,
+          'reserved',v_delta,'spent',-v_row.spent_delta,'transaction',v_row.transaction_id));
+      END IF;
+    END LOOP;
+    FOR v_row IN SELECT (value->>'goal')::uuid AS goal_id,(value->>'account')::uuid AS account_id,
+      sum((value->>'reserved')::numeric) AS delta FROM jsonb_array_elements(v_events) GROUP BY 1,2
+    LOOP
+      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events
+        WHERE user_id=v_owner AND goal_id=v_row.goal_id AND account_id=v_row.account_id;
+      IF v_reserved+v_row.delta<0 THEN
+        RAISE EXCEPTION 'INSUFFICIENT_RESERVATION' USING HINT='Restore the carried allocation or make a corrective transaction before deleting this transfer.';
+      END IF;
+    END LOOP;
+    FOR v_row IN SELECT a.id,a.type,CASE WHEN a.id=v_src.id THEN v_src_balance WHEN a.id=v_dst.id THEN v_dst_balance ELSE coalesce(a.balance,0) END AS balance
+      FROM public.accounts a WHERE a.user_id=v_owner ORDER BY a.id
+    LOOP
+      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_row.id;
+      SELECT coalesce(sum((value->>'reserved')::numeric),0) INTO v_delta FROM jsonb_array_elements(v_events) WHERE (value->>'account')::uuid=v_row.id;
+      IF v_row.type<>'credit_card' AND v_row.balance<v_reserved+v_delta THEN
+        RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE' USING HINT='Release funds or make a corrective transaction before deleting this transaction.';
+      END IF;
+    END LOOP;
+    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
+    FOR v_row IN SELECT value FROM jsonb_array_elements(v_events) LOOP
+      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id,reversal_of)
+        VALUES(v_owner,(v_row.value->>'goal')::uuid,(v_row.value->>'account')::uuid,v_operation,'reversal',
+          (v_row.value->>'reserved')::numeric,(v_row.value->>'spent')::numeric,(v_row.value->>'transaction')::uuid,(v_row.value->>'id')::uuid);
+    END LOOP;
+    UPDATE public.accounts SET balance=v_src_balance WHERE user_id=v_owner AND id=v_src.id;
+    IF v_tx.type='transfer' THEN UPDATE public.accounts SET balance=v_dst_balance WHERE user_id=v_owner AND id=v_dst.id; END IF;
+    DELETE FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id;
+  END IF;
+  v_result := jsonb_build_object('operationId',v_operation,'transactionIds',
+    CASE WHEN v_kind='delete_transaction' THEN jsonb_build_array(v_transaction_id) ELSE '[]'::jsonb END,'replayed',false);
+  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE user_id=v_owner AND id=v_operation;
+  RETURN v_result;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
+GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/tests/database/goal-lifecycle.test.mjs b/tests/database/goal-lifecycle.test.mjs
new file mode 100644
index 0000000..e997c54
--- /dev/null
+++ b/tests/database/goal-lifecycle.test.mjs
@@ -0,0 +1,243 @@
+import assert from 'node:assert/strict';
+import { before, test } from 'node:test';
+import { randomUUID } from 'node:crypto';
+import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, eventInput, insertOperation, requireSuccess } from './helpers.mjs';
+
+before(async () => {
+  await applyMigration('202610060004_goal_transaction_operations.sql');
+  try { await applyMigration('202610060005_goal_lifecycle_operations.sql'); }
+  catch (e) { if (e.code !== 'ENOENT') throw e; }
+});
+async function setup(t) {
+  const f = await createFinanceFixture();
+  t.after(() => cleanupFinanceFixture(f));
+  return f;
+}
+const apply = (f, command, id = randomUUID(), quote = null) => f.owner.client.rpc('goal_finance_apply', { p_request_id: id, p_command: command, p_quote: quote });
+const snap = async f => requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
+const goal = (s, id) => s.goals.find(g => g.goalId === id);
+const wallet = (s, id) => s.wallets.find(w => w.accountId === id);
+const reserve = async (f, amount, goalId = f.owner.goal.id, accountId = f.owner.account.id) => requireSuccess(await apply(f, { kind: 'reserve', goalId, accountId, amount }));
+const close = (f, status = 'completed', leftovers = { mode: 'release' }, id = f.owner.goal.id) => apply(f, { kind: 'close', goalId: id, status, leftovers });
+const remove = (f, id, request = randomUUID()) => apply(f, { kind: 'delete_transaction', transactionId: id }, request);
+async function save(f, overrides = {}) {
+  const draft = { type: 'expense', accountId: f.owner.account.id, transferToAccountId: null, categoryId: null, goalId: null, amount: '2000.00', description: null, date: '2026-10-01', installments: null, reservationMoves: [], ...overrides };
+  const quote = requireSuccess(await f.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
+  return requireSuccess(await apply(f, { kind: 'transaction', draft }, randomUUID(), quote));
+}
+async function rows(f) {
+  return Promise.all(['goals', 'accounts', 'financial_operations', 'goal_allocation_events', 'transactions'].map(async table => requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id).order('id'))));
+}
+const account = async (f, name = 'Bank', type = 'bank', balance = '0.00') => requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name, type, balance }).select().single());
+
+test('Date closes below target with explicit release, preserving actual spending and replay', async t => {
+  const f = await setup(t);
+  await reserve(f, '3000.00');
+  await save(f, { goalId: f.owner.goal.id });
+  const initial = await rows(f);
+  assert.equal((await close(f, 'completed', null)).error?.message, 'INVALID_STATE');
+  assert.deepEqual(await rows(f), initial);
+  const command = { kind: 'close', goalId: f.owner.goal.id, status: 'completed', leftovers: { mode: 'release' } };
+  const request = randomUUID();
+  const result = requireSuccess(await apply(f, command, request));
+  const s = await snap(f), g = goal(s, f.owner.goal.id);
+  assert.equal(g.status, 'completed'); assert.equal(g.is_completed, true);
+  assert.equal(g.reserved, '0.00'); assert.equal(g.spent, '2000.00');
+  assert.equal(wallet(s, f.owner.account.id).actual, '28000.00');
+  assert.ok(g.completed_at);
+  const completed = await rows(f);
+  assert.deepEqual(requireSuccess(await apply(f, command, request)), { ...result, replayed: true });
+  assert.deepEqual(await rows(f), completed);
+  assert.equal((await apply(f, { ...command, status: 'cancelled' }, request)).error?.message, 'REQUEST_CONFLICT');
+});
+test('Laptop reserve and spend 30000 completes with 30000 progress, never double counted', async t => {
+  const f = await setup(t);
+  await reserve(f, '30000.00');
+  await save(f, { amount: '30000.00', goalId: f.owner.goal.id });
+  requireSuccess(await close(f, 'completed', null));
+  const g = goal(await snap(f), f.owner.goal.id);
+  assert.equal(g.progressAmount, '30000.00'); assert.equal(g.spent, '30000.00'); assert.equal(g.reserved, '0.00');
+});
+test('leftovers move across each backing wallet without changing actual or total reserved', async t => {
+  const f = await setup(t), dst = await account(f, 'Bank', 'bank', '2000.00');
+  const target = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: 10000 }).select().single());
+  await reserve(f, '3000.00'); await reserve(f, '2000.00', f.owner.goal.id, dst.id);
+  const before = await snap(f);
+  requireSuccess(await close(f, 'cancelled', { mode: 'move', goalId: target.id }));
+  const s = await snap(f);
+  assert.deepEqual(s.wallets, before.wallets);
+  assert.deepEqual(goal(s, target.id).walletReservations, goal(before, f.owner.goal.id).walletReservations);
+  assert.equal(goal(s, target.id).reserved, '5000.00');
+  assert.equal(goal(s, f.owner.goal.id).status, 'cancelled');
+});
+test('cancel, reopen, and archive retain spending; archive requires closed zero reservations', async t => {
+  const f = await setup(t);
+  await reserve(f, '3000.00'); await save(f, { goalId: f.owner.goal.id });
+  assert.equal((await apply(f, { kind: 'archive', goalId: f.owner.goal.id })).error?.message, 'INVALID_STATE');
+  requireSuccess(await close(f, 'cancelled'));
+  assert.equal(goal(await snap(f), f.owner.goal.id).is_completed, false);
+  requireSuccess(await apply(f, { kind: 'reopen', goalId: f.owner.goal.id }));
+  let g = goal(await snap(f), f.owner.goal.id);
+  assert.equal(g.status, 'active'); assert.equal(g.reserved, '0.00'); assert.equal(g.spent, '2000.00');
+  requireSuccess(await close(f));
+  requireSuccess(await apply(f, { kind: 'archive', goalId: f.owner.goal.id }));
+  g = goal(await snap(f), f.owner.goal.id);
+  assert.ok(g.archived_at); assert.equal(g.status, 'completed'); assert.equal(g.spent, '2000.00');
+  assert.equal((await apply(f, { kind: 'reopen', goalId: f.owner.goal.id })).error?.message, 'INVALID_STATE');
+});
+test('deletion restores active reservations and retains source event and transaction UUID', async t => {
+  const f = await setup(t); await reserve(f, '3000.00');
+  const tx = (await save(f, { goalId: f.owner.goal.id })).transactionIds[0];
+  const originals = (await rows(f))[3];
+  const request = randomUUID(); const result = requireSuccess(await remove(f, tx, request));
+  const s = await snap(f), g = goal(s, f.owner.goal.id);
+  assert.equal(g.reserved, '3000.00'); assert.equal(g.spent, '0.00'); assert.equal(wallet(s, f.owner.account.id).actual, '30000.00');
+  const after = await rows(f);
+  for (const original of originals) assert.deepEqual(after[3].find(e => e.id === original.id), original);
+  const reversal = after[3].find(e => e.kind === 'reversal');
+  assert.equal(reversal.transaction_id, tx); assert.equal(reversal.reversal_of, originals.find(e => e.kind === 'spend').id);
+  assert.equal(after[4].length, 0);
+  assert.deepEqual(requireSuccess(await remove(f, tx, request)), { ...result, replayed: true });
+  assert.deepEqual(await rows(f), after);
+  assert.equal((await remove(f, tx)).error?.message, 'NOT_ALLOWED');
+});
+test('deletion preserves closed goal state', async t => {
+  const f = await setup(t); await reserve(f, '3000.00');
+  const tx = (await save(f, { goalId: f.owner.goal.id })).transactionIds[0];
+  requireSuccess(await close(f));
+  requireSuccess(await apply(f, { kind: 'archive', goalId: f.owner.goal.id }));
+  const closed = goal(await snap(f), f.owner.goal.id);
+  requireSuccess(await remove(f, tx));
+  const s = await snap(f), g = goal(s, f.owner.goal.id);
+  assert.equal(g.status, 'completed'); assert.equal(g.reserved, '0.00'); assert.equal(g.spent, '0.00');
+  assert.equal(g.completed_at, closed.completed_at); assert.equal(g.archived_at, closed.archived_at); assert.equal(g.is_completed, true);
+  assert.equal(wallet(s, f.owner.account.id).available, '30000.00');
+});
+for (const closed of [false, true]) test(`ordinary expense release reversal respects ${closed ? 'closed' : 'active'} goal`, async t => {
+  const f = await setup(t); await reserve(f, '5000.00');
+  const tx = (await save(f, { amount: '28000.00' })).transactionIds[0];
+  if (closed) requireSuccess(await close(f));
+  requireSuccess(await remove(f, tx));
+  const s = await snap(f), g = goal(s, f.owner.goal.id);
+  assert.equal(g.reserved, closed ? '0.00' : '5000.00'); assert.equal(g.spent, '0.00');
+  assert.equal(wallet(s, f.owner.account.id).actual, '30000.00');
+  const reversal = (await rows(f))[3].find(e => e.kind === 'reversal');
+  if (closed) {
+    assert.equal(reversal, undefined);
+    assert.ok((await rows(f))[2].find(o => o.command.kind === 'delete_transaction' && o.command.transactionId === tx));
+  } else { assert.ok(reversal); assert.equal(reversal.reserved_delta, 3000); }
+});
+test('cash transfer reversal restores carried allocations to source', async t => {
+  const f = await setup(t), dst = await account(f); await reserve(f, '5000.00');
+  const tx = (await save(f, { type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }] })).transactionIds[0];
+  requireSuccess(await remove(f, tx));
+  const s = await snap(f);
+  assert.deepEqual(goal(s, f.owner.goal.id).walletReservations, [{ accountId: f.owner.account.id, amount: '5000.00' }]);
+  assert.equal(wallet(s, dst.id).actual, '0.00'); assert.equal(wallet(s, f.owner.account.id).actual, '30000.00');
+});
+test('transfer reversal fails atomically after downstream spending or reallocation', async t => {
+  const f = await setup(t), dst = await account(f); await reserve(f, '5000.00');
+  const tx = (await save(f, { type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }] })).transactionIds[0];
+  await save(f, { accountId: dst.id, goalId: f.owner.goal.id, amount: '1000.00' });
+  const initial = await rows(f);
+  assert.equal((await remove(f, tx)).error?.message, 'INSUFFICIENT_ACTUAL');
+  assert.deepEqual(await rows(f), initial);
+});
+test('transfer reversal requires the carried reservation even when actual money remains', async t => {
+  const f = await setup(t), dst = await account(f); await reserve(f, '5000.00');
+  const tx = (await save(f, { type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }] })).transactionIds[0];
+  requireSuccess(await apply(f, { kind: 'release', goalId: f.owner.goal.id, accountId: dst.id, amount: '1000.00' }));
+  const initial = await rows(f);
+  assert.equal((await remove(f, tx)).error?.message, 'INSUFFICIENT_RESERVATION');
+  assert.deepEqual(await rows(f), initial);
+});
+test('closed carried transfer reverses wallet money without restoring reservations', async t => {
+  const f = await setup(t), dst = await account(f); await reserve(f, '5000.00');
+  const tx = (await save(f, { type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }] })).transactionIds[0];
+  requireSuccess(await close(f));
+  requireSuccess(await remove(f, tx));
+  const s = await snap(f), g = goal(s, f.owner.goal.id);
+  assert.equal(g.status, 'completed'); assert.equal(g.reserved, '0.00');
+  assert.equal(wallet(s, f.owner.account.id).available, '30000.00'); assert.equal(wallet(s, dst.id).actual, '0.00');
+  const history = (await rows(f))[3];
+  assert.equal(history.filter(e => e.transaction_id === tx).length, 2);
+  assert.equal(history.filter(e => e.kind === 'reversal').length, 0);
+});
+test('debt goal payment reversal restores cash reservation and card debt once', async t => {
+  const f = await setup(t), card = await account(f, 'Card', 'credit_card', '2000.00');
+  requireSuccess(await f.admin.from('goals').update({ category: 'debt' }).eq('id', f.owner.goal.id));
+  requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: card.id, type: 'expense', amount: 2000, date: '2026-10-01' }));
+  await reserve(f, '2000.00');
+  const tx = (await save(f, { type: 'transfer', goalId: f.owner.goal.id, transferToAccountId: card.id })).transactionIds[0];
+  requireSuccess(await remove(f, tx));
+  const s = await snap(f), g = goal(s, f.owner.goal.id);
+  assert.equal(g.reserved, '2000.00'); assert.equal(g.spent, '0.00');
+  assert.equal(wallet(s, card.id).actual, '2000.00'); assert.equal(wallet(s, f.owner.account.id).actual, '30000.00');
+});
+test('a late deletion failure rolls back operation, allocation reversals, balances and transaction', async t => {
+  const f = await setup(t); await reserve(f, '3000.00');
+  const tx = (await save(f, { goalId: f.owner.goal.id })).transactionIds[0];
+  const { queryAdmin } = await databaseRuntime();
+  await queryAdmin(`CREATE OR REPLACE FUNCTION public.task5_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='${tx}'::uuid THEN RAISE EXCEPTION 'task5_late_failure'; END IF; RETURN OLD; END $$;
+    CREATE TRIGGER task5_reject_delete BEFORE DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.task5_reject_delete()`);
+  try {
+    const initial = await rows(f);
+    assert.equal((await remove(f, tx)).error?.message, 'task5_late_failure');
+    assert.deepEqual(await rows(f), initial);
+  } finally { await queryAdmin('DROP TRIGGER task5_reject_delete ON public.transactions; DROP FUNCTION public.task5_reject_delete()'); }
+});
+test('income reversal cannot overdraw reservations and gives corrective instructions', async t => {
+  const f = await setup(t);
+  const tx = (await save(f, { type: 'income', amount: '5000.00' })).transactionIds[0];
+  await reserve(f, '35000.00'); const initial = await rows(f);
+  const result = await remove(f, tx);
+  assert.equal(result.error?.message, 'INSUFFICIENT_AVAILABLE');
+  assert.match(result.error?.hint ?? '', /release|corrective/i);
+  assert.deepEqual(await rows(f), initial);
+});
+test('deleting one scheduled installment reverses only its row amount', async t => {
+  const f = await setup(t), card = await account(f, 'Card', 'credit_card');
+  const result = await save(f, { accountId: card.id, amount: '1000.01', installments: { count: 3 } });
+  requireSuccess(await remove(f, result.transactionIds[0]));
+  const remaining = (await rows(f))[4];
+  assert.equal(remaining.length, 2); assert.deepEqual(remaining.map(r => r.id).sort(), result.transactionIds.slice(1).sort());
+  assert.equal(wallet(await snap(f), card.id).actual, '666.67');
+});
+test('spent-only legacy original deletion never creates a reservation', async t => {
+  const f = await setup(t), tx = (await save(f)).transactionIds[0], op = await insertOperation(f);
+  requireSuccess(await f.admin.from('goal_allocation_events').insert(eventInput(f, op, { kind: 'legacy_spent', reserved_delta: '0.00', spent_delta: '2000.00', transaction_id: tx })));
+  requireSuccess(await remove(f, tx));
+  const g = goal(await snap(f), f.owner.goal.id);
+  assert.equal(g.spent, '0.00'); assert.equal(g.reserved, '0.00');
+});
+test('lifecycle rejects foreign ownership, review state, extra fields, quotes, and unsafe archive', async t => {
+  const f = await setup(t), initial = await rows(f);
+  assert.equal((await close(f, 'completed', { mode: 'release' }, f.other.goal.id)).error?.message, 'NOT_ALLOWED');
+  assert.equal((await remove(f, randomUUID())).error?.message, 'NOT_ALLOWED');
+  assert.equal((await apply(f, { kind: 'reopen', goalId: f.owner.goal.id, extra: true })).error?.message, 'INVALID_STATE');
+  assert.equal((await apply(f, { kind: 'close', goalId: f.owner.goal.id, status: 'completed', leftovers: null }, randomUUID(), {})).error?.message, 'INVALID_STATE');
+  assert.deepEqual(await rows(f), initial);
+  requireSuccess(await f.admin.from('goals').update({ review_state: 'needs_review' }).eq('id', f.owner.goal.id));
+  assert.equal((await close(f)).error?.message, 'NEEDS_REVIEW');
+  requireSuccess(await f.admin.from('goals').update({ review_state: 'confirmed', status: 'completed' }).eq('id', f.owner.goal.id));
+  const op = await insertOperation(f);
+  requireSuccess(await f.admin.from('goal_allocation_events').insert(eventInput(f, op)));
+  assert.equal((await apply(f, { kind: 'archive', goalId: f.owner.goal.id })).error?.message, 'INVALID_STATE');
+});
+test('snapshot never mirrors the legacy completion boolean and helper lanes deny direct execution', async t => {
+  const f = await setup(t);
+  requireSuccess(await f.admin.from('goals').update({ is_completed: true }).eq('id', f.owner.goal.id));
+  const initial = await rows(f);
+  assert.equal(goal(await snap(f), f.owner.goal.id).status, 'active');
+  assert.deepEqual(await rows(f), initial);
+  for (const name of ['goal_reservation_apply', 'goal_transaction_apply']) {
+    const result = await f.owner.client.rpc(name, { p_request_id: randomUUID(), p_command: { kind: 'reserve' }, p_quote: null });
+    assert.ok(result.error); assert.match(result.error.message, /permission denied/i);
+  }
+  const command = { kind: 'close', goalId: f.owner.goal.id, status: 'cancelled', leftovers: null };
+  const request = randomUUID();
+  const results = await Promise.all([apply(f, command, request), apply(f, command, request)]);
+  const values = results.map(r => requireSuccess(r));
+  assert.equal(values[0].operationId, values[1].operationId);
+  assert.equal(values.filter(r => r.replayed).length, 1);
+});
