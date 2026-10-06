eff835d feat: save transactions with confirmed goal fund releases
 .gitignore                                         |   2 +
 .../2026-10-06-goal-reservations/task-4-report.md  |  61 +++++
 src/types/database.ts                              |   4 +
 .../202610060004_goal_transaction_operations.sql   | 266 ++++++++++++++++++++
 supabase/schema.sql                                | 269 ++++++++++++++++++++-
 tests/database/financial-transactions.test.mjs     | 259 ++++++++++++++++++++
 6 files changed, 860 insertions(+), 1 deletion(-)
diff --git a/.gitignore b/.gitignore
index 61a6e7c..ba1be11 100644
--- a/.gitignore
+++ b/.gitignore
@@ -73,10 +73,12 @@ supabase/*
 supabase/migrations/*
 !supabase/migrations/202610060001_runtime_baseline.sql
 !supabase/migrations/202610060002_goal_allocation_ledger.sql
 !supabase/migrations/202610060003_goal_reservation_operations.sql
 
 # Verification & Test Scripts
 scripts/
 
 
 
+
+!supabase/migrations/202610060004_goal_transaction_operations.sql
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-4-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-4-report.md
new file mode 100644
index 0000000..bdd9908
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-4-report.md
@@ -0,0 +1,61 @@
+# Task 4 implementation report
+
+Status: DONE. Scope stops at Task 4; no UI wiring, lifecycle/deletion commands, authorization cutover, push, or live migration.
+
+## Implementation
+
+- Added migration 004 with strict transaction normalization, authoritative read-only quotes, and an atomic transaction dispatcher. The existing Task 3 reservation implementation is renamed once to a private `goal_reservation_apply` helper, rather than copied. Reapplying ordered migrations retains the helper and restores the public dispatcher.
+- Decimal-string money, real dates, UUID normalization, unique reservation moves, and installments capped at the shared MAX_INSTALLMENTS value of 12 are validated before writes. The normalized command plus normalized confirmed releases forms request identity. Completed matching requests replay before freshness checks; changed commands/releases conflict.
+- Quotes include normalized draft, authoritative account rows, allocation history, owned goal ordering/lifecycle metadata, and relevant debt transactions in the fingerprint. Default release selection uses non-priority goals first, then creation time and UUID. Custom releases must total exactly the shortfall, come from the paying wallet, and respect amounts already carried by a transfer.
+- The ordinary 28,000 expense against 30,000 actual/5,000 reserved releases exactly 3,000 only after an explicit quote is supplied. It leaves actual/reserved at 2,000, available at zero, spent at zero, and one real expense. Quotes and unconfirmed saves create no rows.
+- Goal expenses consume their own reservation and increment spending once. Income never allocates goal funds. Cash transfers move reservation backing using paired events and one real transfer; they preserve progress.
+- Profile-first locks serialize operations with the Task 3 reservation lane. All owned goals, affected accounts, and the referenced category are locked before authoritative revalidation. Failed inserts and stale quotes roll back the operation, events, transactions, and balances.
+- Ported the actual modal's credit signs and month debt carry-forward rules: purchases/outgoing credit transfers raise debt, income/payments lower it; month and total debt both limit payments. Credit installments spread remainder centavos over the first installments, create first-of-month scheduled expenses, and update debt once by the total. Credit purchases cannot carry goal tags. Cash payments to credit tagged to a debt goal consume backing and record spending once.
+- Public RPCs retain auth.uid checks and pinned search paths; private helpers deny execution to PUBLIC, anon, authenticated, and service_role. SQL objects are schema-qualified.
+
+## TDD and verification evidence
+
+Initial RED, before any production implementation:
+
+`node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/financial-transactions.test.mjs`
+
+Output: tests 8, pass 0, fail 8. Required examples failed because PostgREST could not find `goal_transaction_quote` (PGRST202). No production quote function existed. This was the expected missing-feature failure.
+
+Second RED for canonical request identity, before its fix, same command:
+
+Output: tests 12, pass 11, fail 1. `equivalent normalized requests replay across release ordering and UUID casing` failed with `P0001: REQUEST_CONFLICT`. Normalizing confirmed release UUIDs/order fixed it.
+
+GREEN, same focused command:
+
+Output: tests 12, pass 12, fail 0, skipped 0. Covers exact confirmed shortfall, read-only quotes/no confirmation, ordinary income and goal expense, carrying reservation backing, multiple goals/default priority selection/custom exact release/wrong wallet/excess/insufficient actual, stale allocation and ordering changes, foreign category/account ownership, forced insert rollback of every stored row/balance, simultaneous expense/reserve, centavo remainder/debt once/debt goal spending once, equivalent replay and request conflict, expired authentication/private grants, boundary values/unsupported later commands, and credit signs/month carry-forward.
+
+Full database suite: ran `npm run test:db` through Node spawn with an `environmentProcess` created from the ignored disposable `.superpowers/local-db/environment.json`; no configuration or token values were printed.
+
+Output: tests 36, pass 36, fail 0, skipped 0, duration approximately 9.4 seconds. Includes all existing ledger and reservation tests.
+
+`npx tsc --noEmit`: exit 0, no diagnostics.
+
+Ordered schema bundle validation: created a disposable alternate schema, rewrote only explicit public schema references as the existing upgrade test does, applied the full ordered bundle twice, asserted the quote/dispatcher/private reservation functions existed, then dropped the schema. Output: `Ordered schema bundle: fresh rename and repeat application passed.` This exercises the previously absent-helper rename path and repeat application, not just a database that already had the helper.
+
+`git diff --check`: exit 0, no whitespace errors (Git emitted line-ending notices for Windows working copies).
+
+An early GREEN iteration hit asynchronous PostgREST schema reload on its first test; a bounded readiness poll resolved the harness race. A development edit caused a SQL syntax failure; it was fixed before the clean GREEN run. Neither failure remains.
+
+## Files
+
+- `supabase/migrations/202610060004_goal_transaction_operations.sql` (266 lines).
+- `tests/database/financial-transactions.test.mjs` (12 real integration tests).
+- `src/types/database.ts`: quote RPC signature.
+- `supabase/schema.sql`: ordered migration bundle through 004, required for reproducible provisioning.
+- `.gitignore`: narrow exception for migration 004 so the requested migration is tracked.
+- This report.
+
+## Self-review and concerns
+
+No known failing checks. The single migration retains all required functionality in the planned file; the controller approved the private-helper dispatcher pattern. Fingerprinting all owned goal metadata intentionally invalidates quotes conservatively when another owned goal changes, avoiding missed ordering/lifecycle changes at the cost of potentially requesting another quote.
+
+Existing Task 3 reservation tests reapply migration 003 in their setup and leave the disposable public dispatcher at that migration when the full suite ends. Reapply the ordered bundle or migration 004 before manual Task 4 RPC checks; deployed ordered migrations end at 004. This is a test setup artifact, not a production migration dependency.
+
+Antislop delivery gate: PASS for this backend-only change; no UI, generated marketing claims, visual assets, or code-comment boilerplate were introduced. New SQL comments explain the private lane, request identity, and stale release validation.
+
+The controller will conduct independent review and the final application/lint/build checkpoint. No build was requested from this implementer.
diff --git a/src/types/database.ts b/src/types/database.ts
index 8b4f57a..1bc6436 100644
--- a/src/types/database.ts
+++ b/src/types/database.ts
@@ -363,20 +363,24 @@ export interface Database {
         };
         Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
       };
     };
     Views: {};
     Functions: {
       goal_finance_snapshot: {
         Args: Record<string, never>;
         Returns: Json;
       };
+      goal_transaction_quote: {
+        Args: { p_draft: Json; p_releases?: Json | null };
+        Returns: Json;
+      };
       goal_finance_apply: {
         Args: { p_request_id: string; p_command: Json; p_quote?: Json | null };
         Returns: Json;
       };
     };
     Enums: {};
   };
 }
 
 // Convenience types
diff --git a/supabase/migrations/202610060004_goal_transaction_operations.sql b/supabase/migrations/202610060004_goal_transaction_operations.sql
new file mode 100644
index 0000000..310da8c
--- /dev/null
+++ b/supabase/migrations/202610060004_goal_transaction_operations.sql
@@ -0,0 +1,266 @@
+BEGIN;
+-- Keep the reservation lane private while adding transactions to the public dispatcher.
+DO $$ BEGIN
+  IF to_regprocedure('public.goal_reservation_apply(uuid,jsonb,jsonb)') IS NULL THEN
+    ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_reservation_apply;
+  END IF;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_reservation_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
+
+CREATE OR REPLACE FUNCTION public.goal_normalize_transaction(p_draft jsonb)
+RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
+DECLARE v jsonb; v_moves jsonb; v_date date; v_count integer;
+BEGIN
+  IF p_draft IS NULL OR jsonb_typeof(p_draft)<>'object'
+    OR NOT p_draft ?& ARRAY['type','accountId','transferToAccountId','categoryId','goalId','amount','description','date','installments','reservationMoves']
+    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('type','accountId','transferToAccountId','categoryId','goalId','amount','description','date','installments','reservationMoves'))
+    OR jsonb_typeof(p_draft->'type')<>'string' OR p_draft->>'type' NOT IN ('income','expense','transfer')
+    OR jsonb_typeof(p_draft->'amount')<>'string' OR (p_draft->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
+    OR (p_draft->>'amount')::numeric<=0 OR (p_draft->>'amount')::numeric>=10000000000000
+    OR jsonb_typeof(p_draft->'date')<>'string' OR p_draft->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
+    OR jsonb_typeof(p_draft->'description') NOT IN ('null','string')
+    OR jsonb_typeof(p_draft->'reservationMoves')<>'array'
+    OR jsonb_typeof(p_draft->'accountId')<>'string'
+    OR jsonb_typeof(p_draft->'transferToAccountId') NOT IN ('null','string')
+    OR jsonb_typeof(p_draft->'categoryId') NOT IN ('null','string')
+    OR jsonb_typeof(p_draft->'goalId') NOT IN ('null','string') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  BEGIN
+    v_date := (p_draft->>'date')::date;
+    IF to_char(v_date,'YYYY-MM-DD')<>p_draft->>'date' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    v := p_draft || jsonb_build_object('accountId',(p_draft->>'accountId')::uuid,
+      'transferToAccountId',(p_draft->>'transferToAccountId')::uuid,
+      'categoryId',(p_draft->>'categoryId')::uuid,'goalId',(p_draft->>'goalId')::uuid);
+    IF jsonb_typeof(v->'installments')<>'null' THEN
+      IF jsonb_typeof(v->'installments')<>'object' OR v->'installments' <> jsonb_build_object('count',v->'installments'->'count')
+        OR jsonb_typeof(v->'installments'->'count')<>'number' OR v->'installments'->>'count' !~ '^([1-9]|1[0-2])$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      v_count := (v->'installments'->>'count')::integer;
+      IF (v->>'amount')::numeric*100<v_count THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END IF;
+    FOR v_moves IN SELECT value FROM jsonb_array_elements(v->'reservationMoves') LOOP
+      IF jsonb_typeof(v_moves)<>'object' OR NOT v_moves ?& ARRAY['goalId','amount']
+        OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_moves) k WHERE k NOT IN ('goalId','amount'))
+        OR jsonb_typeof(v_moves->'goalId')<>'string' OR jsonb_typeof(v_moves->'amount')<>'string'
+        OR v_moves->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
+        OR (v_moves->>'amount')::numeric<=0 OR (v_moves->>'amount')::numeric>=10000000000000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      PERFORM (v_moves->>'goalId')::uuid;
+    END LOOP;
+    SELECT coalesce(jsonb_agg(jsonb_build_object('goalId',(value->>'goalId')::uuid,'amount',value->>'amount') ORDER BY (value->>'goalId')::uuid),'[]'::jsonb)
+      INTO v_moves FROM jsonb_array_elements(v->'reservationMoves');
+    IF (SELECT count(*)<>count(DISTINCT value->>'goalId') FROM jsonb_array_elements(v_moves)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    RETURN v || jsonb_build_object('reservationMoves',v_moves);
+  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVALID_STATE'; END;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_normalize_transaction(jsonb) FROM PUBLIC,anon,authenticated,service_role;
+
+CREATE OR REPLACE FUNCTION public.goal_transaction_quote(p_draft jsonb,p_releases jsonb DEFAULT NULL)
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid(); v_draft jsonb; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
+  v_goal public.goals%ROWTYPE; v_amount numeric; v_reserved numeric; v_shortfall numeric; v_remainder numeric;
+  v_carried numeric := 0; v_spending numeric := 0; v_line jsonb; v_releases jsonb := '[]'::jsonb;
+  v_funds numeric; v_metadata jsonb; v_fingerprint text; v_month record; v_carry numeric := 0; v_month_debt numeric := 0;
+BEGIN
+  IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_owner) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  v_draft := public.goal_normalize_transaction(p_draft);
+  v_amount := (v_draft->>'amount')::numeric;
+  SELECT * INTO v_src FROM public.accounts WHERE id=(v_draft->>'accountId')::uuid AND user_id=v_owner;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF v_src.is_active IS DISTINCT FROM true OR v_src.currency IS DISTINCT FROM 'PHP' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF v_draft->>'categoryId' IS NOT NULL THEN
+    IF NOT EXISTS(SELECT 1 FROM public.categories WHERE id=(v_draft->>'categoryId')::uuid
+      AND (user_id=v_owner OR is_default=true)) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  END IF;
+  IF v_draft->>'type'='transfer' THEN
+    IF v_draft->>'transferToAccountId' IS NULL OR v_draft->>'categoryId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT * INTO v_dst FROM public.accounts WHERE id=(v_draft->>'transferToAccountId')::uuid AND user_id=v_owner;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_src.id=v_dst.id THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    IF v_dst.is_active IS DISTINCT FROM true OR v_dst.currency IS DISTINCT FROM 'PHP' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  ELSIF v_draft->>'transferToAccountId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF jsonb_typeof(v_draft->'installments')<>'null' AND
+    (v_draft->>'type'<>'expense' OR v_src.type<>'credit_card' OR extract(day FROM (v_draft->>'date')::date)<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF v_draft->>'goalId' IS NOT NULL THEN
+    SELECT * INTO v_goal FROM public.goals WHERE id=(v_draft->>'goalId')::uuid AND user_id=v_owner;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+    IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    IF v_src.type='credit_card' OR v_draft->>'type'='income' OR
+      (v_draft->>'type'='transfer' AND (v_dst.type<>'credit_card' OR v_goal.category<>'debt')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
+      WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
+    IF v_funds<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+    v_spending := v_amount;
+  END IF;
+  FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
+    SELECT * INTO v_goal FROM public.goals WHERE id=(v_line->>'goalId')::uuid AND user_id=v_owner;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+    IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    IF v_draft->>'type'<>'transfer' OR v_src.type='credit_card' OR v_dst.type='credit_card' OR v_spending>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
+      WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
+    IF v_funds<(v_line->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+    v_carried := v_carried+(v_line->>'amount')::numeric;
+  END LOOP;
+  IF v_carried>v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF v_src.type<>'credit_card' AND v_draft->>'type' IN ('expense','transfer') AND coalesce(v_src.balance,0)<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_ACTUAL'; END IF;
+  IF v_src.type='credit_card' AND v_draft->>'type'='income' AND coalesce(v_src.balance,0)<v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF v_draft->>'type'='transfer' AND v_dst.type='credit_card' THEN
+    IF coalesce(v_dst.balance,0)<v_amount OR extract(day FROM (v_draft->>'date')::date)<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    FOR v_month IN
+      SELECT to_char(date,'YYYY-MM') AS month,sum(CASE
+        WHEN account_id=v_dst.id AND type='expense' THEN amount
+        WHEN account_id=v_dst.id AND type='income' THEN -amount
+        WHEN type='transfer' THEN CASE WHEN account_id=v_dst.id THEN amount ELSE 0 END-CASE WHEN transfer_to_account_id=v_dst.id THEN amount ELSE 0 END
+        ELSE 0 END) AS debt FROM public.transactions WHERE user_id=v_owner AND (account_id=v_dst.id OR transfer_to_account_id=v_dst.id)
+      GROUP BY to_char(date,'YYYY-MM') ORDER BY month
+    LOOP
+      v_funds := v_month.debt+v_carry;
+      v_carry := least(v_funds,0);
+      IF v_month.month=left(v_draft->>'date',7) THEN v_month_debt := greatest(v_funds,0); END IF;
+    END LOOP;
+    IF v_amount>v_month_debt THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  END IF;
+  SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_src.id;
+  v_shortfall := CASE WHEN v_src.type<>'credit_card' AND v_draft->>'type' IN ('expense','transfer')
+    THEN greatest(0,v_amount-(coalesce(v_src.balance,0)-v_reserved)-v_spending-v_carried) ELSE 0 END;
+  IF p_releases IS NULL THEN
+    v_remainder := v_shortfall;
+    FOR v_month IN
+      SELECT g.id,sum(e.reserved_delta)-coalesce((SELECT (m->>'amount')::numeric FROM jsonb_array_elements(v_draft->'reservationMoves') m WHERE (m->>'goalId')::uuid=g.id),0) AS funds
+      FROM public.goals g JOIN public.goal_allocation_events e ON e.goal_id=g.id AND e.account_id=v_src.id AND e.user_id=v_owner
+      WHERE g.user_id=v_owner AND g.status='active' AND g.review_state='confirmed' AND g.archived_at IS NULL
+        AND g.id IS DISTINCT FROM (v_draft->>'goalId')::uuid
+      GROUP BY g.id ORDER BY g.is_priority ASC,g.created_at ASC,g.id ASC
+    LOOP
+      IF v_remainder<=0 THEN EXIT; END IF;
+      v_funds := least(greatest(v_month.funds,0),v_remainder);
+      IF v_funds>0 THEN v_releases := v_releases || jsonb_build_array(jsonb_build_object('goalId',v_month.id,'accountId',v_src.id,'amount',round(v_funds,2)::text)); END IF;
+      v_remainder := v_remainder-v_funds;
+    END LOOP;
+    IF v_remainder>0 THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
+  ELSE
+    IF jsonb_typeof(p_releases)<>'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    v_remainder := 0;
+    BEGIN
+      FOR v_line IN SELECT value FROM jsonb_array_elements(p_releases) LOOP
+        IF jsonb_typeof(v_line)<>'object' OR NOT v_line ?& ARRAY['goalId','accountId','amount']
+          OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_line) k WHERE k NOT IN ('goalId','accountId','amount'))
+          OR jsonb_typeof(v_line->'goalId')<>'string' OR jsonb_typeof(v_line->'accountId')<>'string' OR jsonb_typeof(v_line->'amount')<>'string'
+          OR v_line->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' OR (v_line->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        IF (v_line->>'accountId')::uuid<>v_src.id THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+        SELECT * INTO v_goal FROM public.goals WHERE id=(v_line->>'goalId')::uuid AND user_id=v_owner;
+        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+        IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+        IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL OR v_goal.id=(v_draft->>'goalId')::uuid THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
+        v_funds := v_funds-coalesce((SELECT (m->>'amount')::numeric FROM jsonb_array_elements(v_draft->'reservationMoves') m WHERE (m->>'goalId')::uuid=v_goal.id),0);
+        IF v_funds<(v_line->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+        v_releases := v_releases || jsonb_build_array(jsonb_build_object('goalId',v_goal.id,'accountId',v_src.id,'amount',v_line->>'amount'));
+        v_remainder := v_remainder+(v_line->>'amount')::numeric;
+      END LOOP;
+    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
+    IF (SELECT count(*)<>count(DISTINCT value->>'goalId') FROM jsonb_array_elements(v_releases)) OR v_remainder<>v_shortfall THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT coalesce(jsonb_agg(value ORDER BY value->>'goalId'),'[]'::jsonb) INTO v_releases FROM jsonb_array_elements(v_releases);
+  END IF;
+  SELECT coalesce(jsonb_agg(value ORDER BY value->>'goalId'),'[]'::jsonb) INTO v_releases FROM jsonb_array_elements(v_releases);
+  SELECT jsonb_build_object(
+    'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.accounts a WHERE a.user_id=v_owner AND a.id IN (v_src.id,v_dst.id)),
+    'goals',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]'::jsonb) FROM public.goals g WHERE g.user_id=v_owner),
+    'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM public.goal_allocation_events e WHERE e.user_id=v_owner AND e.account_id IN (v_src.id,v_dst.id)),
+    'debtTransactions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.transactions t WHERE t.user_id=v_owner AND v_dst.type='credit_card' AND (t.account_id=v_dst.id OR t.transfer_to_account_id=v_dst.id))) INTO v_metadata;
+  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('draft',v_draft,'releases',v_releases,'state',v_metadata)::text,'UTF8')),'hex');
+  RETURN jsonb_build_object('fingerprint',v_fingerprint,'actual',round(coalesce(v_src.balance,0),2)::text,'reserved',round(v_reserved,2)::text,
+    'available',round(coalesce(v_src.balance,0)-v_reserved,2)::text,'releases',v_releases);
+END $$;
+
+CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid(); v_draft jsonb; v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
+  v_quote jsonb; v_confirmation jsonb; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
+  v_operation uuid; v_result jsonb; v_line jsonb; v_transaction uuid; v_ids jsonb := '[]'::jsonb;
+  v_amount numeric; v_piece numeric; v_count integer; v_i integer; v_date date; v_description text;
+BEGIN
+  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF p_command->>'kind' IS DISTINCT FROM 'transaction' THEN RETURN public.goal_reservation_apply(p_request_id,p_command,p_quote); END IF;
+  IF p_request_id IS NULL OR jsonb_typeof(p_command)<>'object' OR p_command<>jsonb_build_object('kind','transaction','draft',p_command->'draft') OR p_quote IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  v_draft := public.goal_normalize_transaction(p_command->'draft');
+  v_command := jsonb_build_object('kind','transaction','draft',v_draft);
+  -- Confirmation selection belongs to request identity, while mutable quote state does not.
+  IF jsonb_typeof(p_quote)<>'object' OR NOT p_quote ?& ARRAY['fingerprint','actual','reserved','available','releases'] OR jsonb_typeof(p_quote->'releases')<>'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  BEGIN
+    FOR v_line IN SELECT value FROM jsonb_array_elements(p_quote->'releases') LOOP
+      IF jsonb_typeof(v_line)<>'object' OR NOT v_line ?& ARRAY['goalId','accountId','amount']
+        OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_line) k WHERE k NOT IN ('goalId','accountId','amount'))
+        OR jsonb_typeof(v_line->'goalId')<>'string' OR jsonb_typeof(v_line->'accountId')<>'string' OR jsonb_typeof(v_line->'amount')<>'string'
+        OR v_line->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' OR (v_line->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END LOOP;
+    SELECT p_quote || jsonb_build_object('releases',coalesce(jsonb_agg(jsonb_build_object('goalId',(value->>'goalId')::uuid,
+      'accountId',(value->>'accountId')::uuid,'amount',value->>'amount') ORDER BY (value->>'goalId')::uuid),'[]'::jsonb))
+      INTO v_confirmation FROM jsonb_array_elements(p_quote->'releases');
+  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
+  v_hash := encode(sha256(convert_to(jsonb_build_object('command',v_command,'releases',v_confirmation->'releases')::text,'UTF8')),'hex');
+  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
+  IF FOUND THEN
+    IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
+    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    RETURN v_previous.result || jsonb_build_object('replayed',true);
+  END IF;
+  PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
+  PERFORM id FROM public.accounts WHERE user_id=v_owner AND id IN ((v_draft->>'accountId')::uuid,(v_draft->>'transferToAccountId')::uuid) ORDER BY id FOR UPDATE;
+  IF v_draft->>'categoryId' IS NOT NULL THEN
+    PERFORM id FROM public.categories WHERE id=(v_draft->>'categoryId')::uuid FOR SHARE;
+  END IF;
+  -- A changed state can invalidate the release plan itself; report that as stale before validating it.
+  BEGIN
+    v_quote := public.goal_transaction_quote(v_draft,v_confirmation->'releases');
+  EXCEPTION WHEN raise_exception THEN
+    IF SQLERRM IN ('INVALID_STATE','INSUFFICIENT_RESERVATION','INSUFFICIENT_AVAILABLE','INSUFFICIENT_ACTUAL','NEEDS_REVIEW') THEN RAISE EXCEPTION 'STALE_QUOTE'; END IF;
+    RAISE;
+  END;
+  IF v_quote<>v_confirmation THEN RAISE EXCEPTION 'STALE_QUOTE'; END IF;
+  SELECT * INTO v_src FROM public.accounts WHERE id=(v_draft->>'accountId')::uuid AND user_id=v_owner;
+  SELECT * INTO v_dst FROM public.accounts WHERE id=(v_draft->>'transferToAccountId')::uuid AND user_id=v_owner;
+  v_amount := (v_draft->>'amount')::numeric;
+  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
+  FOR v_line IN SELECT value FROM jsonb_array_elements(v_quote->'releases') LOOP
+    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+      VALUES(v_owner,(v_line->>'goalId')::uuid,v_src.id,v_operation,'release',-(v_line->>'amount')::numeric);
+  END LOOP;
+  v_count := coalesce((v_draft->'installments'->>'count')::integer,1);
+  FOR v_i IN 0..v_count-1 LOOP
+    v_piece := (floor(v_amount*100/v_count)+CASE WHEN v_i<mod(v_amount*100,v_count) THEN 1 ELSE 0 END)/100;
+    v_date := CASE WHEN jsonb_typeof(v_draft->'installments')<>'null' THEN ((v_draft->>'date')::date+make_interval(months=>v_i))::date ELSE (v_draft->>'date')::date END;
+    v_description := CASE WHEN v_count>1 THEN coalesce(v_draft->>'description','') || format(' (Installment %s/%s)',v_i+1,v_count) ELSE v_draft->>'description' END;
+    INSERT INTO public.transactions(user_id,account_id,transfer_to_account_id,category_id,goal_id,type,amount,description,date)
+      VALUES(v_owner,v_src.id,v_dst.id,(v_draft->>'categoryId')::uuid,(v_draft->>'goalId')::uuid,v_draft->>'type',v_piece,v_description,v_date) RETURNING id INTO v_transaction;
+    v_ids := v_ids || jsonb_build_array(v_transaction);
+  END LOOP;
+  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE
+    WHEN v_draft->>'type'='income' THEN CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END
+    ELSE CASE WHEN type='credit_card' THEN v_amount ELSE -v_amount END END WHERE id=v_src.id AND user_id=v_owner;
+  IF v_draft->>'type'='transfer' THEN
+    UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END WHERE id=v_dst.id AND user_id=v_owner;
+  END IF;
+  IF v_draft->>'goalId' IS NOT NULL THEN
+    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id)
+      VALUES(v_owner,(v_draft->>'goalId')::uuid,v_src.id,v_operation,'spend',-v_amount,v_amount,v_transaction);
+  END IF;
+  FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
+    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,transaction_id) VALUES
+      (v_owner,(v_line->>'goalId')::uuid,v_src.id,v_operation,'move_out',-(v_line->>'amount')::numeric,v_transaction),
+      (v_owner,(v_line->>'goalId')::uuid,v_dst.id,v_operation,'move_in',(v_line->>'amount')::numeric,v_transaction);
+  END LOOP;
+  v_result := jsonb_build_object('operationId',v_operation,'transactionIds',v_ids,'replayed',false);
+  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=v_operation AND user_id=v_owner;
+  RETURN v_result;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) FROM PUBLIC,anon;
+REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
+GRANT EXECUTE ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) TO authenticated,service_role;
+GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/supabase/schema.sql b/supabase/schema.sql
index a046ec1..eb9c71c 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -1,11 +1,11 @@
--- Safe reproducible schema: runtime baseline, goal ledger, and reservation operations.
+-- Safe reproducible schema: runtime baseline and ordered goal finance migrations.
 -- Source of truth: the ordered supabase/migrations files.
 
 -- Additive runtime baseline. Requires Supabase auth.users/auth.uid() and its roles.
 -- Existing functions, grants, policies, financial values, and auth users are retained.
 BEGIN;
 CREATE EXTENSION IF NOT EXISTS pgcrypto;
 
 CREATE TABLE IF NOT EXISTS public.users (
   id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
   email text UNIQUE NOT NULL, username text UNIQUE NOT NULL,
@@ -408,10 +408,277 @@ BEGIN
   v_result := jsonb_build_object('operationId',v_operation,'transactionIds','[]'::jsonb,'replayed',false);
   UPDATE public.financial_operations SET result=v_result,completed_at=now() WHERE id=v_operation AND user_id=v_owner;
   RETURN v_result;
 END $$;
 REVOKE ALL ON FUNCTION public.goal_finance_snapshot() FROM PUBLIC,anon;
 REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.goal_finance_snapshot() TO authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
 NOTIFY pgrst, 'reload schema';
 COMMIT;
+
+BEGIN;
+-- Keep the reservation lane private while adding transactions to the public dispatcher.
+DO $$ BEGIN
+  IF to_regprocedure('public.goal_reservation_apply(uuid,jsonb,jsonb)') IS NULL THEN
+    ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_reservation_apply;
+  END IF;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_reservation_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
+
+CREATE OR REPLACE FUNCTION public.goal_normalize_transaction(p_draft jsonb)
+RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
+DECLARE v jsonb; v_moves jsonb; v_date date; v_count integer;
+BEGIN
+  IF p_draft IS NULL OR jsonb_typeof(p_draft)<>'object'
+    OR NOT p_draft ?& ARRAY['type','accountId','transferToAccountId','categoryId','goalId','amount','description','date','installments','reservationMoves']
+    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('type','accountId','transferToAccountId','categoryId','goalId','amount','description','date','installments','reservationMoves'))
+    OR jsonb_typeof(p_draft->'type')<>'string' OR p_draft->>'type' NOT IN ('income','expense','transfer')
+    OR jsonb_typeof(p_draft->'amount')<>'string' OR (p_draft->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
+    OR (p_draft->>'amount')::numeric<=0 OR (p_draft->>'amount')::numeric>=10000000000000
+    OR jsonb_typeof(p_draft->'date')<>'string' OR p_draft->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
+    OR jsonb_typeof(p_draft->'description') NOT IN ('null','string')
+    OR jsonb_typeof(p_draft->'reservationMoves')<>'array'
+    OR jsonb_typeof(p_draft->'accountId')<>'string'
+    OR jsonb_typeof(p_draft->'transferToAccountId') NOT IN ('null','string')
+    OR jsonb_typeof(p_draft->'categoryId') NOT IN ('null','string')
+    OR jsonb_typeof(p_draft->'goalId') NOT IN ('null','string') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  BEGIN
+    v_date := (p_draft->>'date')::date;
+    IF to_char(v_date,'YYYY-MM-DD')<>p_draft->>'date' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    v := p_draft || jsonb_build_object('accountId',(p_draft->>'accountId')::uuid,
+      'transferToAccountId',(p_draft->>'transferToAccountId')::uuid,
+      'categoryId',(p_draft->>'categoryId')::uuid,'goalId',(p_draft->>'goalId')::uuid);
+    IF jsonb_typeof(v->'installments')<>'null' THEN
+      IF jsonb_typeof(v->'installments')<>'object' OR v->'installments' <> jsonb_build_object('count',v->'installments'->'count')
+        OR jsonb_typeof(v->'installments'->'count')<>'number' OR v->'installments'->>'count' !~ '^([1-9]|1[0-2])$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      v_count := (v->'installments'->>'count')::integer;
+      IF (v->>'amount')::numeric*100<v_count THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END IF;
+    FOR v_moves IN SELECT value FROM jsonb_array_elements(v->'reservationMoves') LOOP
+      IF jsonb_typeof(v_moves)<>'object' OR NOT v_moves ?& ARRAY['goalId','amount']
+        OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_moves) k WHERE k NOT IN ('goalId','amount'))
+        OR jsonb_typeof(v_moves->'goalId')<>'string' OR jsonb_typeof(v_moves->'amount')<>'string'
+        OR v_moves->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
+        OR (v_moves->>'amount')::numeric<=0 OR (v_moves->>'amount')::numeric>=10000000000000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+      PERFORM (v_moves->>'goalId')::uuid;
+    END LOOP;
+    SELECT coalesce(jsonb_agg(jsonb_build_object('goalId',(value->>'goalId')::uuid,'amount',value->>'amount') ORDER BY (value->>'goalId')::uuid),'[]'::jsonb)
+      INTO v_moves FROM jsonb_array_elements(v->'reservationMoves');
+    IF (SELECT count(*)<>count(DISTINCT value->>'goalId') FROM jsonb_array_elements(v_moves)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    RETURN v || jsonb_build_object('reservationMoves',v_moves);
+  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVALID_STATE'; END;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_normalize_transaction(jsonb) FROM PUBLIC,anon,authenticated,service_role;
+
+CREATE OR REPLACE FUNCTION public.goal_transaction_quote(p_draft jsonb,p_releases jsonb DEFAULT NULL)
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid(); v_draft jsonb; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
+  v_goal public.goals%ROWTYPE; v_amount numeric; v_reserved numeric; v_shortfall numeric; v_remainder numeric;
+  v_carried numeric := 0; v_spending numeric := 0; v_line jsonb; v_releases jsonb := '[]'::jsonb;
+  v_funds numeric; v_metadata jsonb; v_fingerprint text; v_month record; v_carry numeric := 0; v_month_debt numeric := 0;
+BEGIN
+  IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_owner) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  v_draft := public.goal_normalize_transaction(p_draft);
+  v_amount := (v_draft->>'amount')::numeric;
+  SELECT * INTO v_src FROM public.accounts WHERE id=(v_draft->>'accountId')::uuid AND user_id=v_owner;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF v_src.is_active IS DISTINCT FROM true OR v_src.currency IS DISTINCT FROM 'PHP' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF v_draft->>'categoryId' IS NOT NULL THEN
+    IF NOT EXISTS(SELECT 1 FROM public.categories WHERE id=(v_draft->>'categoryId')::uuid
+      AND (user_id=v_owner OR is_default=true)) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  END IF;
+  IF v_draft->>'type'='transfer' THEN
+    IF v_draft->>'transferToAccountId' IS NULL OR v_draft->>'categoryId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT * INTO v_dst FROM public.accounts WHERE id=(v_draft->>'transferToAccountId')::uuid AND user_id=v_owner;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_src.id=v_dst.id THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    IF v_dst.is_active IS DISTINCT FROM true OR v_dst.currency IS DISTINCT FROM 'PHP' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  ELSIF v_draft->>'transferToAccountId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF jsonb_typeof(v_draft->'installments')<>'null' AND
+    (v_draft->>'type'<>'expense' OR v_src.type<>'credit_card' OR extract(day FROM (v_draft->>'date')::date)<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF v_draft->>'goalId' IS NOT NULL THEN
+    SELECT * INTO v_goal FROM public.goals WHERE id=(v_draft->>'goalId')::uuid AND user_id=v_owner;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+    IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    IF v_src.type='credit_card' OR v_draft->>'type'='income' OR
+      (v_draft->>'type'='transfer' AND (v_dst.type<>'credit_card' OR v_goal.category<>'debt')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
+      WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
+    IF v_funds<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+    v_spending := v_amount;
+  END IF;
+  FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
+    SELECT * INTO v_goal FROM public.goals WHERE id=(v_line->>'goalId')::uuid AND user_id=v_owner;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+    IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    IF v_draft->>'type'<>'transfer' OR v_src.type='credit_card' OR v_dst.type='credit_card' OR v_spending>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
+      WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
+    IF v_funds<(v_line->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+    v_carried := v_carried+(v_line->>'amount')::numeric;
+  END LOOP;
+  IF v_carried>v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF v_src.type<>'credit_card' AND v_draft->>'type' IN ('expense','transfer') AND coalesce(v_src.balance,0)<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_ACTUAL'; END IF;
+  IF v_src.type='credit_card' AND v_draft->>'type'='income' AND coalesce(v_src.balance,0)<v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF v_draft->>'type'='transfer' AND v_dst.type='credit_card' THEN
+    IF coalesce(v_dst.balance,0)<v_amount OR extract(day FROM (v_draft->>'date')::date)<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    FOR v_month IN
+      SELECT to_char(date,'YYYY-MM') AS month,sum(CASE
+        WHEN account_id=v_dst.id AND type='expense' THEN amount
+        WHEN account_id=v_dst.id AND type='income' THEN -amount
+        WHEN type='transfer' THEN CASE WHEN account_id=v_dst.id THEN amount ELSE 0 END-CASE WHEN transfer_to_account_id=v_dst.id THEN amount ELSE 0 END
+        ELSE 0 END) AS debt FROM public.transactions WHERE user_id=v_owner AND (account_id=v_dst.id OR transfer_to_account_id=v_dst.id)
+      GROUP BY to_char(date,'YYYY-MM') ORDER BY month
+    LOOP
+      v_funds := v_month.debt+v_carry;
+      v_carry := least(v_funds,0);
+      IF v_month.month=left(v_draft->>'date',7) THEN v_month_debt := greatest(v_funds,0); END IF;
+    END LOOP;
+    IF v_amount>v_month_debt THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  END IF;
+  SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_src.id;
+  v_shortfall := CASE WHEN v_src.type<>'credit_card' AND v_draft->>'type' IN ('expense','transfer')
+    THEN greatest(0,v_amount-(coalesce(v_src.balance,0)-v_reserved)-v_spending-v_carried) ELSE 0 END;
+  IF p_releases IS NULL THEN
+    v_remainder := v_shortfall;
+    FOR v_month IN
+      SELECT g.id,sum(e.reserved_delta)-coalesce((SELECT (m->>'amount')::numeric FROM jsonb_array_elements(v_draft->'reservationMoves') m WHERE (m->>'goalId')::uuid=g.id),0) AS funds
+      FROM public.goals g JOIN public.goal_allocation_events e ON e.goal_id=g.id AND e.account_id=v_src.id AND e.user_id=v_owner
+      WHERE g.user_id=v_owner AND g.status='active' AND g.review_state='confirmed' AND g.archived_at IS NULL
+        AND g.id IS DISTINCT FROM (v_draft->>'goalId')::uuid
+      GROUP BY g.id ORDER BY g.is_priority ASC,g.created_at ASC,g.id ASC
+    LOOP
+      IF v_remainder<=0 THEN EXIT; END IF;
+      v_funds := least(greatest(v_month.funds,0),v_remainder);
+      IF v_funds>0 THEN v_releases := v_releases || jsonb_build_array(jsonb_build_object('goalId',v_month.id,'accountId',v_src.id,'amount',round(v_funds,2)::text)); END IF;
+      v_remainder := v_remainder-v_funds;
+    END LOOP;
+    IF v_remainder>0 THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
+  ELSE
+    IF jsonb_typeof(p_releases)<>'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    v_remainder := 0;
+    BEGIN
+      FOR v_line IN SELECT value FROM jsonb_array_elements(p_releases) LOOP
+        IF jsonb_typeof(v_line)<>'object' OR NOT v_line ?& ARRAY['goalId','accountId','amount']
+          OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_line) k WHERE k NOT IN ('goalId','accountId','amount'))
+          OR jsonb_typeof(v_line->'goalId')<>'string' OR jsonb_typeof(v_line->'accountId')<>'string' OR jsonb_typeof(v_line->'amount')<>'string'
+          OR v_line->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' OR (v_line->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        IF (v_line->>'accountId')::uuid<>v_src.id THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+        SELECT * INTO v_goal FROM public.goals WHERE id=(v_line->>'goalId')::uuid AND user_id=v_owner;
+        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+        IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+        IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL OR v_goal.id=(v_draft->>'goalId')::uuid THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+        SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
+        v_funds := v_funds-coalesce((SELECT (m->>'amount')::numeric FROM jsonb_array_elements(v_draft->'reservationMoves') m WHERE (m->>'goalId')::uuid=v_goal.id),0);
+        IF v_funds<(v_line->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+        v_releases := v_releases || jsonb_build_array(jsonb_build_object('goalId',v_goal.id,'accountId',v_src.id,'amount',v_line->>'amount'));
+        v_remainder := v_remainder+(v_line->>'amount')::numeric;
+      END LOOP;
+    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
+    IF (SELECT count(*)<>count(DISTINCT value->>'goalId') FROM jsonb_array_elements(v_releases)) OR v_remainder<>v_shortfall THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    SELECT coalesce(jsonb_agg(value ORDER BY value->>'goalId'),'[]'::jsonb) INTO v_releases FROM jsonb_array_elements(v_releases);
+  END IF;
+  SELECT coalesce(jsonb_agg(value ORDER BY value->>'goalId'),'[]'::jsonb) INTO v_releases FROM jsonb_array_elements(v_releases);
+  SELECT jsonb_build_object(
+    'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.accounts a WHERE a.user_id=v_owner AND a.id IN (v_src.id,v_dst.id)),
+    'goals',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]'::jsonb) FROM public.goals g WHERE g.user_id=v_owner),
+    'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM public.goal_allocation_events e WHERE e.user_id=v_owner AND e.account_id IN (v_src.id,v_dst.id)),
+    'debtTransactions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.transactions t WHERE t.user_id=v_owner AND v_dst.type='credit_card' AND (t.account_id=v_dst.id OR t.transfer_to_account_id=v_dst.id))) INTO v_metadata;
+  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('draft',v_draft,'releases',v_releases,'state',v_metadata)::text,'UTF8')),'hex');
+  RETURN jsonb_build_object('fingerprint',v_fingerprint,'actual',round(coalesce(v_src.balance,0),2)::text,'reserved',round(v_reserved,2)::text,
+    'available',round(coalesce(v_src.balance,0)-v_reserved,2)::text,'releases',v_releases);
+END $$;
+
+CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid(); v_draft jsonb; v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
+  v_quote jsonb; v_confirmation jsonb; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
+  v_operation uuid; v_result jsonb; v_line jsonb; v_transaction uuid; v_ids jsonb := '[]'::jsonb;
+  v_amount numeric; v_piece numeric; v_count integer; v_i integer; v_date date; v_description text;
+BEGIN
+  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF p_command->>'kind' IS DISTINCT FROM 'transaction' THEN RETURN public.goal_reservation_apply(p_request_id,p_command,p_quote); END IF;
+  IF p_request_id IS NULL OR jsonb_typeof(p_command)<>'object' OR p_command<>jsonb_build_object('kind','transaction','draft',p_command->'draft') OR p_quote IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  v_draft := public.goal_normalize_transaction(p_command->'draft');
+  v_command := jsonb_build_object('kind','transaction','draft',v_draft);
+  -- Confirmation selection belongs to request identity, while mutable quote state does not.
+  IF jsonb_typeof(p_quote)<>'object' OR NOT p_quote ?& ARRAY['fingerprint','actual','reserved','available','releases'] OR jsonb_typeof(p_quote->'releases')<>'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  BEGIN
+    FOR v_line IN SELECT value FROM jsonb_array_elements(p_quote->'releases') LOOP
+      IF jsonb_typeof(v_line)<>'object' OR NOT v_line ?& ARRAY['goalId','accountId','amount']
+        OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_line) k WHERE k NOT IN ('goalId','accountId','amount'))
+        OR jsonb_typeof(v_line->'goalId')<>'string' OR jsonb_typeof(v_line->'accountId')<>'string' OR jsonb_typeof(v_line->'amount')<>'string'
+        OR v_line->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' OR (v_line->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    END LOOP;
+    SELECT p_quote || jsonb_build_object('releases',coalesce(jsonb_agg(jsonb_build_object('goalId',(value->>'goalId')::uuid,
+      'accountId',(value->>'accountId')::uuid,'amount',value->>'amount') ORDER BY (value->>'goalId')::uuid),'[]'::jsonb))
+      INTO v_confirmation FROM jsonb_array_elements(p_quote->'releases');
+  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
+  v_hash := encode(sha256(convert_to(jsonb_build_object('command',v_command,'releases',v_confirmation->'releases')::text,'UTF8')),'hex');
+  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
+  IF FOUND THEN
+    IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
+    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    RETURN v_previous.result || jsonb_build_object('replayed',true);
+  END IF;
+  PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
+  PERFORM id FROM public.accounts WHERE user_id=v_owner AND id IN ((v_draft->>'accountId')::uuid,(v_draft->>'transferToAccountId')::uuid) ORDER BY id FOR UPDATE;
+  IF v_draft->>'categoryId' IS NOT NULL THEN
+    PERFORM id FROM public.categories WHERE id=(v_draft->>'categoryId')::uuid FOR SHARE;
+  END IF;
+  -- A changed state can invalidate the release plan itself; report that as stale before validating it.
+  BEGIN
+    v_quote := public.goal_transaction_quote(v_draft,v_confirmation->'releases');
+  EXCEPTION WHEN raise_exception THEN
+    IF SQLERRM IN ('INVALID_STATE','INSUFFICIENT_RESERVATION','INSUFFICIENT_AVAILABLE','INSUFFICIENT_ACTUAL','NEEDS_REVIEW') THEN RAISE EXCEPTION 'STALE_QUOTE'; END IF;
+    RAISE;
+  END;
+  IF v_quote<>v_confirmation THEN RAISE EXCEPTION 'STALE_QUOTE'; END IF;
+  SELECT * INTO v_src FROM public.accounts WHERE id=(v_draft->>'accountId')::uuid AND user_id=v_owner;
+  SELECT * INTO v_dst FROM public.accounts WHERE id=(v_draft->>'transferToAccountId')::uuid AND user_id=v_owner;
+  v_amount := (v_draft->>'amount')::numeric;
+  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
+  FOR v_line IN SELECT value FROM jsonb_array_elements(v_quote->'releases') LOOP
+    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+      VALUES(v_owner,(v_line->>'goalId')::uuid,v_src.id,v_operation,'release',-(v_line->>'amount')::numeric);
+  END LOOP;
+  v_count := coalesce((v_draft->'installments'->>'count')::integer,1);
+  FOR v_i IN 0..v_count-1 LOOP
+    v_piece := (floor(v_amount*100/v_count)+CASE WHEN v_i<mod(v_amount*100,v_count) THEN 1 ELSE 0 END)/100;
+    v_date := CASE WHEN jsonb_typeof(v_draft->'installments')<>'null' THEN ((v_draft->>'date')::date+make_interval(months=>v_i))::date ELSE (v_draft->>'date')::date END;
+    v_description := CASE WHEN v_count>1 THEN coalesce(v_draft->>'description','') || format(' (Installment %s/%s)',v_i+1,v_count) ELSE v_draft->>'description' END;
+    INSERT INTO public.transactions(user_id,account_id,transfer_to_account_id,category_id,goal_id,type,amount,description,date)
+      VALUES(v_owner,v_src.id,v_dst.id,(v_draft->>'categoryId')::uuid,(v_draft->>'goalId')::uuid,v_draft->>'type',v_piece,v_description,v_date) RETURNING id INTO v_transaction;
+    v_ids := v_ids || jsonb_build_array(v_transaction);
+  END LOOP;
+  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE
+    WHEN v_draft->>'type'='income' THEN CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END
+    ELSE CASE WHEN type='credit_card' THEN v_amount ELSE -v_amount END END WHERE id=v_src.id AND user_id=v_owner;
+  IF v_draft->>'type'='transfer' THEN
+    UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END WHERE id=v_dst.id AND user_id=v_owner;
+  END IF;
+  IF v_draft->>'goalId' IS NOT NULL THEN
+    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id)
+      VALUES(v_owner,(v_draft->>'goalId')::uuid,v_src.id,v_operation,'spend',-v_amount,v_amount,v_transaction);
+  END IF;
+  FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
+    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,transaction_id) VALUES
+      (v_owner,(v_line->>'goalId')::uuid,v_src.id,v_operation,'move_out',-(v_line->>'amount')::numeric,v_transaction),
+      (v_owner,(v_line->>'goalId')::uuid,v_dst.id,v_operation,'move_in',(v_line->>'amount')::numeric,v_transaction);
+  END LOOP;
+  v_result := jsonb_build_object('operationId',v_operation,'transactionIds',v_ids,'replayed',false);
+  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=v_operation AND user_id=v_owner;
+  RETURN v_result;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) FROM PUBLIC,anon;
+REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
+GRANT EXECUTE ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) TO authenticated,service_role;
+GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/tests/database/financial-transactions.test.mjs b/tests/database/financial-transactions.test.mjs
new file mode 100644
index 0000000..78ee030
--- /dev/null
+++ b/tests/database/financial-transactions.test.mjs
@@ -0,0 +1,259 @@
+import assert from 'node:assert/strict';
+import { before, test } from 'node:test';
+import { randomUUID } from 'node:crypto';
+import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';
+before(async () => {
+    try {
+        await applyMigration('202610060004_goal_transaction_operations.sql');
+    }
+    catch (e) {
+        if (e.code !== 'ENOENT')
+            throw e;
+    }
+    const { admin } = await databaseRuntime();
+    for (let i = 0; i < 50; i++) {
+        const r = await admin.rpc('goal_transaction_quote', { p_draft: {} });
+        if (r.error?.code !== 'PGRST202')
+            return;
+        await new Promise(resolve => setTimeout(resolve, 100));
+    }
+    throw new Error('Quote schema readiness timeout');
+});
+async function setup(t) {
+    const f = await createFinanceFixture();
+    t.after(() => cleanupFinanceFixture(f));
+    return f;
+}
+const apply = (f, c, q = null, id = randomUUID()) => f.owner.client.rpc('goal_finance_apply', { p_request_id: id, p_command: c, p_quote: q });
+const draft = (f, o = {}) => ({
+    type: 'expense', accountId: f.owner.account.id, transferToAccountId: null, categoryId: null, goalId: null, amount: '28000.00', description: null, date: '2026-10-01', installments: null, reservationMoves: [], ...o
+});
+const quote = (f, d, r = null) => f.owner.client.rpc('goal_transaction_quote', { p_draft: d, p_releases: r });
+const snap = async (f) => requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
+async function reserve(f, amount = '5000.00', goalId = f.owner.goal.id) {
+    requireSuccess(await apply(f, {
+        kind: 'reserve', goalId, accountId: f.owner.account.id, amount
+    }));
+}
+async function rows(f) {
+    return Promise.all(['accounts', 'financial_operations', 'goal_allocation_events', 'transactions'].map(async (table) => requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id).order('id'))));
+}
+async function save(f, d) {
+    const q = requireSuccess(await quote(f, d));
+    return requireSuccess(await apply(f, { kind: 'transaction', draft: d }, q));
+}
+test('confirmed overspend releases only its shortfall', async (t) => {
+    const f = await setup(t);
+    await reserve(f);
+    const d = draft(f);
+    const initial = await rows(f);
+    const q = requireSuccess(await quote(f, d));
+    assert.equal(q.releases[0].amount, '3000.00');
+    assert.deepEqual(await rows(f), initial);
+    assert.equal((await apply(f, { kind: 'transaction', draft: d })).error?.message, 'INVALID_STATE');
+    const id = randomUUID();
+    const result = requireSuccess(await apply(f, { kind: 'transaction', draft: d }, q, id));
+    const s = await snap(f);
+    const w = s.wallets.find(w => w.accountId === f.owner.account.id);
+    assert.equal(w.actual, '2000.00');
+    assert.equal(w.reserved, '2000.00');
+    assert.equal(w.available, '0.00');
+    assert.equal(s.goals[0].spent, '0.00');
+    const tx = (await rows(f))[3];
+    assert.equal(tx.length, 1);
+    assert.equal(tx[0].amount, 28000);
+    assert.equal(requireSuccess(await apply(f, { kind: 'transaction', draft: d }, q, id)).operationId, result.operationId);
+});
+test('goal expense consumes its own reservation and income has no allocation', async (t) => {
+    const f = await setup(t);
+    await reserve(f);
+    await save(f, draft(f, { goalId: f.owner.goal.id, amount: '1000.00' }));
+    let s = await snap(f);
+    assert.equal(s.goals[0].reserved, '4000.00');
+    assert.equal(s.goals[0].spent, '1000.00');
+    assert.equal(s.wallets[0].actual, '29000.00');
+    await save(f, draft(f, { type: 'income', amount: '1000.00' }));
+    s = await snap(f);
+    assert.equal(s.goals[0].spent, '1000.00');
+    assert.equal(s.wallets[0].actual, '30000.00');
+    assert.equal((await quote(f, draft(f, { type: 'income', goalId: f.owner.goal.id }))).error?.message, 'INVALID_STATE');
+    assert.equal((await quote(f, draft(f, { goalId: f.owner.goal.id, amount: '5000.00' }))).error?.message, 'INSUFFICIENT_RESERVATION');
+});
+test('cash transfer carries backing and preserves progress', async (t) => {
+    const f = await setup(t);
+    await reserve(f);
+    const dst = requireSuccess(await f.owner.client.from('accounts').insert({
+        user_id: f.owner.id, name: 'Bank', type: 'bank', balance: 0
+    }).select().single());
+    const d = draft(f, {
+        type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }]
+    });
+    await save(f, d);
+    const s = await snap(f);
+    assert.equal(s.goals[0].progressAmount, '5000.00');
+    assert.equal(s.goals[0].spent, '0.00');
+    assert.deepEqual(s.goals[0].walletReservations, [{ accountId: dst.id, amount: '5000.00' }]);
+    assert.equal((await rows(f))[3].length, 1);
+    assert.equal((await quote(f, { ...d, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5001.00' }] })).error?.message, 'INSUFFICIENT_RESERVATION');
+});
+test('custom release must match exact shortfall from paying wallet', async (t) => {
+    const f = await setup(t);
+    await reserve(f);
+    const g = requireSuccess(await f.owner.client.from('goals').insert({
+        user_id: f.owner.id, name: 'Trip', target_amount: 10000, is_priority: true
+    }).select().single());
+    await reserve(f, '5000.00', g.id);
+    const d = draft(f, { amount: '23000.00' });
+    const q = requireSuccess(await quote(f, d));
+    assert.equal(q.releases[0].goalId, f.owner.goal.id);
+    const custom = [{ goalId: g.id, accountId: f.owner.account.id, amount: '3000.00' }];
+    requireSuccess(await quote(f, d, custom));
+    for (const r of [[{ ...custom[0], amount: '3001.00' }], [{ ...custom[0], accountId: f.other.account.id }], [{ ...custom[0], goalId: f.other.goal.id }]])
+        assert.ok((await quote(f, d, r)).error);
+    assert.equal((await quote(f, draft(f, { amount: '30001.00' }))).error?.message, 'INSUFFICIENT_ACTUAL');
+});
+test('stale funds and ordering metadata roll back every write', async (t) => {
+    const f = await setup(t);
+    await reserve(f);
+    const d = draft(f);
+    let q = requireSuccess(await quote(f, d));
+    await reserve(f, '1.00');
+    let baseline = await rows(f);
+    assert.equal((await apply(f, { kind: 'transaction', draft: d }, q)).error?.message, 'STALE_QUOTE');
+    assert.deepEqual(await rows(f), baseline);
+    q = requireSuccess(await quote(f, d));
+    requireSuccess(await f.owner.client.from('goals').update({ is_priority: true }).eq('id', f.owner.goal.id));
+    baseline = await rows(f);
+    assert.equal((await apply(f, { kind: 'transaction', draft: d }, q)).error?.message, 'STALE_QUOTE');
+    assert.deepEqual(await rows(f), baseline);
+});
+test('foreign references and insert failure preserve balances events and operations', async (t) => {
+    const f = await setup(t);
+    await reserve(f);
+    const cat = requireSuccess(await f.other.client.from('categories').insert({ user_id: f.other.id, name: 'Private', type: 'expense' }).select().single());
+    assert.equal((await quote(f, draft(f, { categoryId: cat.id }))).error?.message, 'NOT_ALLOWED');
+    assert.equal((await quote(f, draft(f, { accountId: f.other.account.id }))).error?.message, 'NOT_ALLOWED');
+    const d = draft(f);
+    const q = requireSuccess(await quote(f, d));
+    const baseline = await rows(f);
+    const { queryAdmin } = await databaseRuntime();
+    await queryAdmin(`CREATE OR REPLACE FUNCTION public.test_reject_transaction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${f.owner.id}'::uuid THEN RAISE EXCEPTION 'forced insert failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_transaction BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.test_reject_transaction();`);
+    try {
+        assert.equal((await apply(f, { kind: 'transaction', draft: d }, q)).error?.message, 'forced insert failure');
+        assert.deepEqual(await rows(f), baseline);
+    }
+    finally {
+        await queryAdmin('DROP TRIGGER test_reject_transaction ON public.transactions; DROP FUNCTION public.test_reject_transaction()');
+    }
+});
+test('simultaneous reserve and expense serialize without overbooking', async (t) => {
+    const f = await setup(t);
+    const d = draft(f);
+    const q = requireSuccess(await quote(f, d));
+    const results = await Promise.all([apply(f, { kind: 'transaction', draft: d }, q), apply(f, {
+            kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '5000.00'
+        })]);
+    assert.equal(results.filter(r => !r.error).length, 1);
+    const s = await snap(f);
+    assert.ok(Number(s.wallets[0].available) >= 0);
+});
+test('credit installments distribute centavos and book debt once; debt goal payment spends once', async (t) => {
+    const f = await setup(t);
+    const credit = requireSuccess(await f.owner.client.from('accounts').insert({
+        user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0
+    }).select().single());
+    const d = draft(f, { accountId: credit.id, amount: '1000.01', installments: { count: 3 } });
+    const result = await save(f, d);
+    assert.equal(result.transactionIds.length, 3);
+    const tx = (await rows(f))[3];
+    assert.deepEqual(tx.sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.amount, t.date]), [[333.34, '2026-10-01'], [333.34, '2026-11-01'], [333.33, '2026-12-01']]);
+    assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 1000.01);
+    assert.equal((await quote(f, { ...d, goalId: f.owner.goal.id })).error?.message, 'INVALID_STATE');
+    requireSuccess(await f.owner.client.from('goals').update({ category: 'debt' }).eq('id', f.owner.goal.id));
+    await reserve(f);
+    await save(f, draft(f, {
+        type: 'transfer', amount: '333.34', transferToAccountId: credit.id, goalId: f.owner.goal.id
+    }));
+    const s = await snap(f);
+    assert.equal(s.goals[0].spent, '333.34');
+    assert.equal(s.goals[0].reserved, '4666.66');
+    assert.equal((await quote(f, draft(f, { type: 'transfer', amount: '1.00', transferToAccountId: credit.id }))).error?.message, 'INVALID_STATE');
+});
+test('equivalent normalized requests replay across release ordering and UUID casing', async (t) => {
+    const f = await setup(t);
+    await reserve(f, '5000.00');
+    const g = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: 5000 }).select().single());
+    await reserve(f, '5000.00', g.id);
+    const d = draft(f);
+    const q = requireSuccess(await quote(f, d));
+    assert.equal(q.releases.length, 2);
+    const id = randomUUID();
+    const result = requireSuccess(await apply(f, { kind: 'transaction', draft: d }, q, id));
+    const before = await rows(f);
+    const retry = { ...q, releases: [...q.releases].reverse().map(r => ({ ...r, goalId: r.goalId.toUpperCase(), accountId: r.accountId.toUpperCase() })) };
+    const replay = requireSuccess(await apply(f, { kind: 'transaction', draft: { ...d, accountId: d.accountId.toUpperCase() } }, retry, id));
+    assert.equal(replay.operationId, result.operationId);
+    assert.equal(replay.replayed, true);
+    assert.deepEqual(await rows(f), before);
+    assert.equal((await apply(f, { kind: 'transaction', draft: { ...d, amount: '27999.00' } }, q, id)).error?.message, 'REQUEST_CONFLICT');
+});
+test('authentication expiry and private helper grants prevent writes', async (t) => {
+    const f = await setup(t);
+    const { adapter, url, options, queryAdmin } = await databaseRuntime();
+    const { createClient } = await import('@supabase/supabase-js');
+    const baseline = await rows(f);
+    const expired = adapter?.signTestJwt ? adapter.signTestJwt({ sub: f.owner.id, role: 'authenticated', exp: 1 }) : 'expired';
+    const client = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, { ...options, global: { headers: { Authorization: `Bearer ${expired}` } } });
+    assert.ok((await client.rpc('goal_transaction_quote', { p_draft: draft(f) })).error);
+    assert.ok((await client.rpc('goal_finance_apply', { p_request_id: randomUUID(), p_command: { kind: 'transaction', draft: draft(f) }, p_quote: {} })).error);
+    assert.deepEqual(await rows(f), baseline);
+    const permissions = await queryAdmin("SELECT p.proname,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('service_role',p.oid,'EXECUTE') AS service FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('goal_normalize_transaction','goal_reservation_apply')");
+    assert.equal(permissions.length, 2);
+    for (const p of permissions) {
+        assert.equal(p.authenticated, false);
+        assert.equal(p.anon, false);
+        assert.equal(p.service, false);
+    }
+});
+test('invalid boundaries, carrying excess transfer, and other credit goal transfers fail without writes', async (t) => {
+    const f = await setup(t);
+    await reserve(f);
+    const bank = requireSuccess(await f.owner.client.from('accounts').insert({
+        user_id: f.owner.id, name: 'Bank', type: 'bank', balance: 0
+    }).select().single());
+    const credit = requireSuccess(await f.owner.client.from('accounts').insert({
+        user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0
+    }).select().single());
+    const baseline = await rows(f);
+    for (const o of [{ amount: 1000 }, { amount: '01.00' }, { amount: '1.001' }, { date: '2026-02-30' }, { installments: { count: 13 } }, {
+            type: 'transfer', transferToAccountId: bank.id, amount: '1000.00', reservationMoves: [{ goalId: f.owner.goal.id, amount: '1001.00' }]
+        }, { type: 'transfer', transferToAccountId: credit.id, goalId: f.owner.goal.id }, {
+            type: 'transfer', accountId: credit.id, transferToAccountId: bank.id, goalId: f.owner.goal.id
+        }, { accountId: credit.id, installments: { count: 12 }, amount: '0.01' }])
+        assert.ok((await quote(f, draft(f, o))).error);
+    for (const kind of ['close', 'archive', 'delete_transaction', 'adopt_legacy'])
+        assert.equal((await apply(f, { kind })).error?.message, 'INVALID_STATE');
+    assert.deepEqual(await rows(f), baseline);
+});
+test('credit signs and negative month credits carry forward authoritatively', async (t) => {
+    const f = await setup(t);
+    const credit = requireSuccess(await f.owner.client.from('accounts').insert({
+        user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0
+    }).select().single());
+    await save(f, draft(f, { accountId: credit.id, amount: '1000.00', date: '2026-09-01' }));
+    await save(f, draft(f, { accountId: credit.id, amount: '1000.00', date: '2026-10-01' }));
+    await save(f, draft(f, {
+        accountId: credit.id, type: 'income', amount: '1500.00', date: '2026-09-01'
+    }));
+    const baseline = await rows(f);
+    assert.equal((await quote(f, draft(f, { type: 'transfer', transferToAccountId: credit.id, amount: '500.01' }))).error?.message, 'INVALID_STATE');
+    assert.deepEqual(await rows(f), baseline);
+    await save(f, draft(f, { type: 'transfer', transferToAccountId: credit.id, amount: '500.00' }));
+    assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 0);
+    await save(f, draft(f, {
+        type: 'transfer', accountId: credit.id, transferToAccountId: f.owner.account.id, amount: '10.00'
+    }));
+    const s = await snap(f);
+    assert.equal(s.wallets.find(w => w.accountId === credit.id).actual, '10.00');
+    assert.equal(s.wallets.find(w => w.accountId === f.owner.account.id).actual, '29510.00');
+});
