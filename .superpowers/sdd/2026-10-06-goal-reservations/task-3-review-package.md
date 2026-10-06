fff3e0b feat: add atomic goal reservation operations
 .gitignore                                         |   1 +
 .../2026-10-06-goal-reservations/task-3-report.md  |  48 ++++
 src/types/database.ts                              |  11 +-
 .../202610060003_goal_reservation_operations.sql   | 153 +++++++++++++
 supabase/schema.sql                                | 156 ++++++++++++-
 tests/database/reservations.test.mjs               | 242 +++++++++++++++++++++
 6 files changed, 609 insertions(+), 2 deletions(-)
diff --git a/.gitignore b/.gitignore
index 83a0fc4..61a6e7c 100644
--- a/.gitignore
+++ b/.gitignore
@@ -66,16 +66,17 @@ docs/superpowers/specs/*
 !docs/superpowers/plans/2026-10-06-goal-reservations.md
 !docs/superpowers/specs/2026-10-06-goal-reservations-design.md
 
 # Database & Migrations
 supabase/*
 !supabase/schema.sql
 !supabase/migrations/
 supabase/migrations/*
 !supabase/migrations/202610060001_runtime_baseline.sql
 !supabase/migrations/202610060002_goal_allocation_ledger.sql
+!supabase/migrations/202610060003_goal_reservation_operations.sql
 
 # Verification & Test Scripts
 scripts/
 
 
 
diff --git a/.superpowers/sdd/2026-10-06-goal-reservations/task-3-report.md b/.superpowers/sdd/2026-10-06-goal-reservations/task-3-report.md
new file mode 100644
index 0000000..16df6c8
--- /dev/null
+++ b/.superpowers/sdd/2026-10-06-goal-reservations/task-3-report.md
@@ -0,0 +1,48 @@
+# Task 3: Atomic reservation operations
+
+Status: DONE
+
+## Implementation
+
+Added `goal_finance_snapshot()` and reserve/release/reallocate branches of `goal_finance_apply(uuid,jsonb,jsonb)`. Both are security definers scoped by `auth.uid()`, with pinned `pg_catalog,public` search paths, owner predicates, anonymous execution revocation, and identity-less caller rejection.
+
+Apply requires positive canonical bounded decimal strings, exact supported command fields, eligible owned wallets, confirmed active/unarchived goals, and sufficient funds. Unsupported commands/non-null quotes fail explicitly. It locks the existing profile row, then owned goals in UUID order, then owned accounts in UUID order. Lifecycle/fund validation follows locks. Operation, event changes, and stored result commit atomically. Matching completed requests replay the original result even after lifecycle changes; conflicting commands fail `REQUEST_CONFLICT`.
+
+Snapshot derives amounts in one coherent CTE query using PostgreSQL numeric arithmetic and canonical two-decimal strings. It returns per-wallet actual/reserved/available funds and per-goal reservations/spending/progress/breakdowns. Per the binding controller/ledger ruling, it includes archived metadata for historical names; later UI callers filter `archived_at`. Expense/transfer legacy tags contribute only `legacyTaggedAmount` for `needs_review`; confirmed goals return null. Tags never become allocations or progress.
+
+## TDD and verification evidence
+
+RED, before production SQL existed:
+
+`node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/reservations.test.mjs`
+
+Exit 1; 12 tests, 0 passed, 12 failed. Primary failure: `PGRST202: Could not find the function public.goal_finance_apply(p_command, p_quote, p_request_id) in the schema cache`. Snapshot was also missing; catalog assertions found zero RPCs. These were expected missing-feature failures against real disposable PostgreSQL/PostgREST.
+
+First implementation run: 11/12 passed; the initial request encountered asynchronous PostgREST schema reload. The test setup now waits up to five seconds for the read-only RPC to become visible after migration, checking the expected identity-less rejection. Financial mutations are never retried by this readiness check. Next run: 12/12 passed. Expanded rollback/centavo coverage then passed 14/14 in the same focused command.
+
+Final full DB command: `node .superpowers/local-db/run-test.mjs --test-concurrency=1 tests/database/ledger.test.mjs tests/database/reservations.test.mjs`
+
+Exit 0; 24 tests, 24 passed, 0 failed/skipped/cancelled. These are all database test files currently present; output is passing test results and totals only.
+
+`npx tsc --noEmit`: exit 0, no diagnostics. `git diff --cached --check`: exit 0. Git's Windows LF/CRLF notices are unrelated to test/compiler output. No build was run, per controller instruction.
+
+## Covered behavior
+
+Fourteen reservation tests assert unchanged PHP 30,000 actual cash after reserving 5,000; exact `30000.00`/`5000.00`/`25000.00` snapshot; zero transactions; releasing 2,000; moving 1,000 without changing total reserved; unchanged goals/balances; owned reads; rejected foreign/missing IDs; credit/non-PHP/inactive wallets; closed/archived/unreviewed goals; invalid destinations; insufficient funds; exact canonical money; unsupported command/quote rejection; anonymous permissions; pinned search paths; competing 20,000 reserves; matching/conflicting and concurrent duplicate requests; legacy separation; and per-wallet `0.01`/`99.99` accuracy.
+
+A disposable trigger rejects the second reallocation event after the first insert. Snapshot, operation rows, and event rows remain unchanged, proving late-failure rollback. The trigger/function are removed in `finally`. All writes used local disposable fixture PostgreSQL 16/PostgREST on loopback, without reading live environment files or printing credentials.
+
+## Files and ancillary changes
+
+- `supabase/migrations/202610060003_goal_reservation_operations.sql`: new RPC migration.
+- `tests/database/reservations.test.mjs`: real tests, migration application, and schema readiness check.
+- `src/types/database.ts`: two RPC type entries.
+- `.gitignore`: narrow tracking exception next to existing migration exceptions.
+- `supabase/schema.sql`: appends the same migration to the reproducible ordered schema bundle; updated factual header.
+- `.superpowers/sdd/2026-10-06-goal-reservations/task-3-report.md`: this report.
+
+## Self-review and limits
+
+Reviewed own SQL/tests/diffs, owner predicates, grants, deterministic locks, exact money validation, replay, and rollback. Corrected EOF whitespace; no outstanding findings. Antislop during session override: comment hygiene PASS, with only the factual schema header changed; UI/copy/mobile gates do not apply to this backend task.
+
+Existing UI/direct writers and grants remain for the later planned cutover. Other commands/quote/lifecycle/adoption behavior explicitly fail pending subsequent tasks. No Task 4+ implementation, build, push, merge, deployment, or live DB migration. Controller-owned plan/progress edits remain untouched and excluded from the commit.
diff --git a/src/types/database.ts b/src/types/database.ts
index d09765d..8b4f57a 100644
--- a/src/types/database.ts
+++ b/src/types/database.ts
@@ -358,21 +358,30 @@ export interface Database {
           theme?: "light" | "dark" | "system";
           language?: string;
           notifications_enabled?: boolean;
           created_at?: string;
           updated_at?: string;
         };
         Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
       };
     };
     Views: {};
-    Functions: {};
+    Functions: {
+      goal_finance_snapshot: {
+        Args: Record<string, never>;
+        Returns: Json;
+      };
+      goal_finance_apply: {
+        Args: { p_request_id: string; p_command: Json; p_quote?: Json | null };
+        Returns: Json;
+      };
+    };
     Enums: {};
   };
 }
 
 // Convenience types
 export type User = Database["public"]["Tables"]["users"]["Row"];
 export type Account = Database["public"]["Tables"]["accounts"]["Row"];
 export type Category = Database["public"]["Tables"]["categories"]["Row"];
 export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
 export type Budget = Database["public"]["Tables"]["budgets"]["Row"];
diff --git a/supabase/migrations/202610060003_goal_reservation_operations.sql b/supabase/migrations/202610060003_goal_reservation_operations.sql
new file mode 100644
index 0000000..102782a
--- /dev/null
+++ b/supabase/migrations/202610060003_goal_reservation_operations.sql
@@ -0,0 +1,153 @@
+BEGIN;
+CREATE OR REPLACE FUNCTION public.goal_finance_snapshot()
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid();
+  v_result jsonb;
+BEGIN
+  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  WITH owned_goals AS (
+    SELECT * FROM public.goals WHERE user_id=v_owner
+  ), owned_accounts AS (
+    SELECT * FROM public.accounts WHERE user_id=v_owner
+  ), allocations AS (
+    SELECT e.goal_id,e.account_id,sum(e.reserved_delta) AS reserved,sum(e.spent_delta) AS spent
+    FROM public.goal_allocation_events e
+    JOIN owned_goals g ON g.id=e.goal_id
+    JOIN owned_accounts a ON a.id=e.account_id
+    WHERE e.user_id=v_owner GROUP BY e.goal_id,e.account_id
+  ), totals AS (
+    SELECT goal_id,sum(reserved) AS reserved,sum(spent) AS spent,
+      coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'amount',round(reserved,2)::text)
+        ORDER BY account_id) FILTER (WHERE reserved>0),'[]'::jsonb) AS wallets
+    FROM allocations GROUP BY goal_id
+  ), legacy AS (
+    SELECT t.goal_id,sum(t.amount) AS amount FROM public.transactions t
+    JOIN owned_goals g ON g.id=t.goal_id
+    WHERE t.user_id=v_owner AND g.review_state='needs_review' AND t.type IN ('expense','transfer')
+    GROUP BY t.goal_id
+  ), goal_rows AS (
+    SELECT g.id,to_jsonb(g) || jsonb_build_object(
+      'target_amount',round(g.target_amount,2)::text,
+      'current_amount',round(coalesce(g.current_amount,0),2)::text,
+      'allocation_per_cycle',round(coalesce(g.allocation_per_cycle,0),2)::text,
+      'goalId',g.id,'reserved',round(coalesce(t.reserved,0),2)::text,
+      'spent',round(coalesce(t.spent,0),2)::text,
+      'progressAmount',round(coalesce(t.reserved,0)+coalesce(t.spent,0),2)::text,
+      'remaining',round(greatest(0,g.target_amount-coalesce(t.reserved,0)-coalesce(t.spent,0)),2)::text,
+      'progressPercent',CASE WHEN g.target_amount>0 THEN least(100,
+        (coalesce(t.reserved,0)+coalesce(t.spent,0))/g.target_amount*100) ELSE 0 END,
+      'walletReservations',coalesce(t.wallets,'[]'::jsonb),
+      'legacyTaggedAmount',CASE WHEN g.review_state='needs_review' THEN round(coalesce(l.amount,0),2)::text ELSE NULL END
+    ) AS data FROM owned_goals g LEFT JOIN totals t ON t.goal_id=g.id LEFT JOIN legacy l ON l.goal_id=g.id
+  ), wallet_rows AS (
+    SELECT a.id,jsonb_build_object('accountId',a.id,'actual',round(coalesce(a.balance,0),2)::text,
+      'reserved',round(coalesce(sum(e.reserved),0),2)::text,
+      'available',round(coalesce(a.balance,0)-coalesce(sum(e.reserved),0),2)::text) AS data
+    FROM owned_accounts a LEFT JOIN allocations e ON e.account_id=a.id GROUP BY a.id,a.balance
+  )
+  SELECT jsonb_build_object('goals',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM goal_rows),'[]'::jsonb),
+    'wallets',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM wallet_rows),'[]'::jsonb)) INTO v_result;
+  RETURN v_result;
+END $$;
+
+CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid();
+  v_kind text;
+  v_goal uuid;
+  v_destination uuid;
+  v_account uuid;
+  v_amount numeric;
+  v_hash text;
+  v_previous public.financial_operations%ROWTYPE;
+  v_wallet public.accounts%ROWTYPE;
+  v_source public.goals%ROWTYPE;
+  v_target public.goals%ROWTYPE;
+  v_reserved numeric;
+  v_operation uuid;
+  v_result jsonb;
+BEGIN
+  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL THEN
+    RAISE EXCEPTION 'INVALID_STATE';
+  END IF;
+  v_kind := p_command->>'kind';
+  IF v_kind IS NULL OR v_kind NOT IN ('reserve','release','reallocate') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF NOT p_command ?& ARRAY['kind','goalId','accountId','amount']
+    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE k NOT IN ('kind','goalId','accountId','amount','destinationGoalId'))
+    OR (v_kind='reallocate' AND NOT p_command ? 'destinationGoalId')
+    OR (v_kind<>'reallocate' AND p_command ? 'destinationGoalId')
+    OR jsonb_typeof(p_command->'kind')<>'string'
+    OR jsonb_typeof(p_command->'goalId')<>'string'
+    OR jsonb_typeof(p_command->'accountId')<>'string'
+    OR jsonb_typeof(p_command->'amount')<>'string'
+    OR (v_kind='reallocate' AND jsonb_typeof(p_command->'destinationGoalId')<>'string')
+    OR (p_command->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' THEN
+    RAISE EXCEPTION 'INVALID_STATE';
+  END IF;
+  BEGIN
+    v_goal := (p_command->>'goalId')::uuid;
+    v_account := (p_command->>'accountId')::uuid;
+    IF v_kind='reallocate' THEN v_destination := (p_command->>'destinationGoalId')::uuid; END IF;
+  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE';
+  END;
+  v_amount := (p_command->>'amount')::numeric;
+  IF v_amount<=0 OR v_amount>=10000000000000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  v_hash := encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
+
+  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
+  IF FOUND THEN
+    IF v_previous.command_hash<>v_hash OR v_previous.command<>p_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
+    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    RETURN v_previous.result || jsonb_build_object('replayed',true);
+  END IF;
+
+  PERFORM id FROM public.goals WHERE user_id=v_owner AND id IN (v_goal,v_destination) ORDER BY id FOR UPDATE;
+  PERFORM id FROM public.accounts WHERE user_id=v_owner AND id=v_account ORDER BY id FOR UPDATE;
+  SELECT * INTO v_wallet FROM public.accounts WHERE user_id=v_owner AND id=v_account;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  SELECT * INTO v_source FROM public.goals WHERE user_id=v_owner AND id=v_goal;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF v_wallet.type='credit_card' OR v_wallet.currency IS DISTINCT FROM 'PHP' OR v_wallet.is_active IS DISTINCT FROM true THEN
+    RAISE EXCEPTION 'NOT_ALLOWED';
+  END IF;
+  IF v_source.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+  IF v_source.status<>'active' OR v_source.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF v_kind='reallocate' THEN
+    SELECT * INTO v_target FROM public.goals WHERE user_id=v_owner AND id=v_destination;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_target.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+    IF v_target.status<>'active' OR v_target.archived_at IS NOT NULL OR v_goal=v_destination THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  END IF;
+  IF v_kind='reserve' THEN
+    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_account;
+    IF coalesce(v_wallet.balance,0)-v_reserved<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
+  ELSE
+    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal AND account_id=v_account;
+    IF v_reserved<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+  END IF;
+
+  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
+    VALUES(v_owner,p_request_id,v_hash,p_command) RETURNING id INTO v_operation;
+  INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+    VALUES(v_owner,v_goal,v_account,v_operation,
+      CASE v_kind WHEN 'reallocate' THEN 'move_out' ELSE v_kind END,
+      CASE v_kind WHEN 'reserve' THEN v_amount ELSE -v_amount END);
+  IF v_kind='reallocate' THEN
+    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+      VALUES(v_owner,v_destination,v_account,v_operation,'move_in',v_amount);
+  END IF;
+  v_result := jsonb_build_object('operationId',v_operation,'transactionIds','[]'::jsonb,'replayed',false);
+  UPDATE public.financial_operations SET result=v_result,completed_at=now() WHERE id=v_operation AND user_id=v_owner;
+  RETURN v_result;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_finance_snapshot() FROM PUBLIC,anon;
+REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
+GRANT EXECUTE ON FUNCTION public.goal_finance_snapshot() TO authenticated,service_role;
+GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 75dee3d..a046ec1 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -1,11 +1,11 @@
--- Safe reproducible schema: runtime baseline followed by additive goal ledger.
+-- Safe reproducible schema: runtime baseline, goal ledger, and reservation operations.
 -- Source of truth: the ordered supabase/migrations files.
 
 -- Additive runtime baseline. Requires Supabase auth.users/auth.uid() and its roles.
 -- Existing functions, grants, policies, financial values, and auth users are retained.
 BEGIN;
 CREATE EXTENSION IF NOT EXISTS pgcrypto;
 
 CREATE TABLE IF NOT EXISTS public.users (
   id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
   email text UNIQUE NOT NULL, username text UNIQUE NOT NULL,
@@ -254,10 +254,164 @@ DO $$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='financial_operations' AND policyname='operation_owner_read') THEN
     CREATE POLICY operation_owner_read ON public.financial_operations FOR SELECT TO authenticated USING(auth.uid()=user_id);
   END IF;
 END $$;
 REVOKE ALL ON public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.goal_allocation_events,public.financial_operations TO authenticated;
 GRANT SELECT,INSERT,UPDATE,DELETE ON public.goal_allocation_events,public.financial_operations TO service_role;
 REVOKE TRUNCATE ON public.goal_allocation_events,public.financial_operations FROM service_role;
 NOTIFY pgrst, 'reload schema';
 COMMIT;
+
+BEGIN;
+CREATE OR REPLACE FUNCTION public.goal_finance_snapshot()
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid();
+  v_result jsonb;
+BEGIN
+  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  WITH owned_goals AS (
+    SELECT * FROM public.goals WHERE user_id=v_owner
+  ), owned_accounts AS (
+    SELECT * FROM public.accounts WHERE user_id=v_owner
+  ), allocations AS (
+    SELECT e.goal_id,e.account_id,sum(e.reserved_delta) AS reserved,sum(e.spent_delta) AS spent
+    FROM public.goal_allocation_events e
+    JOIN owned_goals g ON g.id=e.goal_id
+    JOIN owned_accounts a ON a.id=e.account_id
+    WHERE e.user_id=v_owner GROUP BY e.goal_id,e.account_id
+  ), totals AS (
+    SELECT goal_id,sum(reserved) AS reserved,sum(spent) AS spent,
+      coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'amount',round(reserved,2)::text)
+        ORDER BY account_id) FILTER (WHERE reserved>0),'[]'::jsonb) AS wallets
+    FROM allocations GROUP BY goal_id
+  ), legacy AS (
+    SELECT t.goal_id,sum(t.amount) AS amount FROM public.transactions t
+    JOIN owned_goals g ON g.id=t.goal_id
+    WHERE t.user_id=v_owner AND g.review_state='needs_review' AND t.type IN ('expense','transfer')
+    GROUP BY t.goal_id
+  ), goal_rows AS (
+    SELECT g.id,to_jsonb(g) || jsonb_build_object(
+      'target_amount',round(g.target_amount,2)::text,
+      'current_amount',round(coalesce(g.current_amount,0),2)::text,
+      'allocation_per_cycle',round(coalesce(g.allocation_per_cycle,0),2)::text,
+      'goalId',g.id,'reserved',round(coalesce(t.reserved,0),2)::text,
+      'spent',round(coalesce(t.spent,0),2)::text,
+      'progressAmount',round(coalesce(t.reserved,0)+coalesce(t.spent,0),2)::text,
+      'remaining',round(greatest(0,g.target_amount-coalesce(t.reserved,0)-coalesce(t.spent,0)),2)::text,
+      'progressPercent',CASE WHEN g.target_amount>0 THEN least(100,
+        (coalesce(t.reserved,0)+coalesce(t.spent,0))/g.target_amount*100) ELSE 0 END,
+      'walletReservations',coalesce(t.wallets,'[]'::jsonb),
+      'legacyTaggedAmount',CASE WHEN g.review_state='needs_review' THEN round(coalesce(l.amount,0),2)::text ELSE NULL END
+    ) AS data FROM owned_goals g LEFT JOIN totals t ON t.goal_id=g.id LEFT JOIN legacy l ON l.goal_id=g.id
+  ), wallet_rows AS (
+    SELECT a.id,jsonb_build_object('accountId',a.id,'actual',round(coalesce(a.balance,0),2)::text,
+      'reserved',round(coalesce(sum(e.reserved),0),2)::text,
+      'available',round(coalesce(a.balance,0)-coalesce(sum(e.reserved),0),2)::text) AS data
+    FROM owned_accounts a LEFT JOIN allocations e ON e.account_id=a.id GROUP BY a.id,a.balance
+  )
+  SELECT jsonb_build_object('goals',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM goal_rows),'[]'::jsonb),
+    'wallets',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM wallet_rows),'[]'::jsonb)) INTO v_result;
+  RETURN v_result;
+END $$;
+
+CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
+RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+DECLARE
+  v_owner uuid := auth.uid();
+  v_kind text;
+  v_goal uuid;
+  v_destination uuid;
+  v_account uuid;
+  v_amount numeric;
+  v_hash text;
+  v_previous public.financial_operations%ROWTYPE;
+  v_wallet public.accounts%ROWTYPE;
+  v_source public.goals%ROWTYPE;
+  v_target public.goals%ROWTYPE;
+  v_reserved numeric;
+  v_operation uuid;
+  v_result jsonb;
+BEGIN
+  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL THEN
+    RAISE EXCEPTION 'INVALID_STATE';
+  END IF;
+  v_kind := p_command->>'kind';
+  IF v_kind IS NULL OR v_kind NOT IN ('reserve','release','reallocate') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF NOT p_command ?& ARRAY['kind','goalId','accountId','amount']
+    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE k NOT IN ('kind','goalId','accountId','amount','destinationGoalId'))
+    OR (v_kind='reallocate' AND NOT p_command ? 'destinationGoalId')
+    OR (v_kind<>'reallocate' AND p_command ? 'destinationGoalId')
+    OR jsonb_typeof(p_command->'kind')<>'string'
+    OR jsonb_typeof(p_command->'goalId')<>'string'
+    OR jsonb_typeof(p_command->'accountId')<>'string'
+    OR jsonb_typeof(p_command->'amount')<>'string'
+    OR (v_kind='reallocate' AND jsonb_typeof(p_command->'destinationGoalId')<>'string')
+    OR (p_command->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' THEN
+    RAISE EXCEPTION 'INVALID_STATE';
+  END IF;
+  BEGIN
+    v_goal := (p_command->>'goalId')::uuid;
+    v_account := (p_command->>'accountId')::uuid;
+    IF v_kind='reallocate' THEN v_destination := (p_command->>'destinationGoalId')::uuid; END IF;
+  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE';
+  END;
+  v_amount := (p_command->>'amount')::numeric;
+  IF v_amount<=0 OR v_amount>=10000000000000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  v_hash := encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
+
+  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
+  IF FOUND THEN
+    IF v_previous.command_hash<>v_hash OR v_previous.command<>p_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
+    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+    RETURN v_previous.result || jsonb_build_object('replayed',true);
+  END IF;
+
+  PERFORM id FROM public.goals WHERE user_id=v_owner AND id IN (v_goal,v_destination) ORDER BY id FOR UPDATE;
+  PERFORM id FROM public.accounts WHERE user_id=v_owner AND id=v_account ORDER BY id FOR UPDATE;
+  SELECT * INTO v_wallet FROM public.accounts WHERE user_id=v_owner AND id=v_account;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  SELECT * INTO v_source FROM public.goals WHERE user_id=v_owner AND id=v_goal;
+  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+  IF v_wallet.type='credit_card' OR v_wallet.currency IS DISTINCT FROM 'PHP' OR v_wallet.is_active IS DISTINCT FROM true THEN
+    RAISE EXCEPTION 'NOT_ALLOWED';
+  END IF;
+  IF v_source.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+  IF v_source.status<>'active' OR v_source.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  IF v_kind='reallocate' THEN
+    SELECT * INTO v_target FROM public.goals WHERE user_id=v_owner AND id=v_destination;
+    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
+    IF v_target.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
+    IF v_target.status<>'active' OR v_target.archived_at IS NOT NULL OR v_goal=v_destination THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
+  END IF;
+  IF v_kind='reserve' THEN
+    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_account;
+    IF coalesce(v_wallet.balance,0)-v_reserved<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
+  ELSE
+    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal AND account_id=v_account;
+    IF v_reserved<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
+  END IF;
+
+  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
+    VALUES(v_owner,p_request_id,v_hash,p_command) RETURNING id INTO v_operation;
+  INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+    VALUES(v_owner,v_goal,v_account,v_operation,
+      CASE v_kind WHEN 'reallocate' THEN 'move_out' ELSE v_kind END,
+      CASE v_kind WHEN 'reserve' THEN v_amount ELSE -v_amount END);
+  IF v_kind='reallocate' THEN
+    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
+      VALUES(v_owner,v_destination,v_account,v_operation,'move_in',v_amount);
+  END IF;
+  v_result := jsonb_build_object('operationId',v_operation,'transactionIds','[]'::jsonb,'replayed',false);
+  UPDATE public.financial_operations SET result=v_result,completed_at=now() WHERE id=v_operation AND user_id=v_owner;
+  RETURN v_result;
+END $$;
+REVOKE ALL ON FUNCTION public.goal_finance_snapshot() FROM PUBLIC,anon;
+REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
+GRANT EXECUTE ON FUNCTION public.goal_finance_snapshot() TO authenticated,service_role;
+GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/tests/database/reservations.test.mjs b/tests/database/reservations.test.mjs
new file mode 100644
index 0000000..3cb3d55
--- /dev/null
+++ b/tests/database/reservations.test.mjs
@@ -0,0 +1,242 @@
+import assert from 'node:assert/strict';
+import { before, test } from 'node:test';
+import { randomUUID } from 'node:crypto';
+import { createClient } from '@supabase/supabase-js';
+import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';
+
+before(async () => {
+  await applyMigration('202610060003_goal_reservation_operations.sql');
+  const { admin } = await databaseRuntime();
+  for (let attempt = 0; attempt < 50; attempt++) {
+    const result = await admin.rpc('goal_finance_snapshot');
+    if (result.error?.code !== 'PGRST202') {
+      assert.equal(result.error?.message, 'NOT_ALLOWED');
+      return;
+    }
+    await new Promise(resolve => setTimeout(resolve, 100));
+  }
+  throw new Error('PostgREST did not reload goal_finance_snapshot');
+});
+
+async function setup(t) {
+  const fixture = await createFinanceFixture();
+  t.after(() => cleanupFinanceFixture(fixture));
+  return fixture;
+}
+const command = (f, kind = 'reserve', amount = '5000.00', overrides = {}) => ({
+  kind, goalId: f.owner.goal.id, accountId: f.owner.account.id, amount, ...overrides,
+});
+const apply = (f, cmd, requestId = randomUUID(), quote = null) => f.owner.client.rpc('goal_finance_apply', {
+  p_request_id: requestId, p_command: cmd, p_quote: quote,
+});
+const snapshot = async f => requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
+async function counts(f) {
+  return Promise.all(['financial_operations', 'goal_allocation_events', 'transactions'].map(async table =>
+    requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id))));
+}
+async function expectFailure(f, cmd, code, quote = null) {
+  const before = await counts(f);
+  const result = await apply(f, cmd, randomUUID(), quote);
+  assert.equal(result.error?.message, code);
+  assert.deepEqual(await counts(f), before);
+}
+
+test('reserve, release and reallocate preserve actual cash and create no transactions', async t => {
+  const f = await setup(t);
+  const goal2 = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: '10000.00' }).select().single());
+  const initialGoal = requireSuccess(await f.owner.client.from('goals').select('*').eq('id', f.owner.goal.id).single());
+  requireSuccess(await apply(f, command(f)));
+  let state = await snapshot(f);
+  assert.deepEqual(state.wallets.find(w => w.accountId === f.owner.account.id), {
+    accountId: f.owner.account.id, actual: '30000.00', reserved: '5000.00', available: '25000.00',
+  });
+  assert.equal((await counts(f))[2].length, 0);
+  let goal = state.goals.find(g => g.id === f.owner.goal.id);
+  assert.equal(goal.reserved, '5000.00');
+  assert.equal(goal.spent, '0.00');
+  assert.equal(goal.progressAmount, '5000.00');
+  assert.equal(goal.remaining, '0.00');
+  assert.equal(goal.progressPercent, 100);
+  assert.deepEqual(goal.walletReservations, [{ accountId: f.owner.account.id, amount: '5000.00' }]);
+  for (const field of ['target_amount', 'current_amount', 'allocation_per_cycle']) assert.match(goal[field], /^\d+\.\d{2}$/);
+  requireSuccess(await apply(f, command(f, 'release', '2000.00')));
+  assert.equal((await snapshot(f)).wallets[0].reserved, '3000.00');
+  requireSuccess(await apply(f, command(f, 'reallocate', '1000.00', { destinationGoalId: goal2.id })));
+  state = await snapshot(f);
+  assert.deepEqual(state.wallets[0], { accountId: f.owner.account.id, actual: '30000.00', reserved: '3000.00', available: '27000.00' });
+  assert.equal(state.goals.find(g => g.id === f.owner.goal.id).reserved, '2000.00');
+  assert.equal(state.goals.find(g => g.id === goal2.id).reserved, '1000.00');
+  const [operations, events, transactions] = await counts(f);
+  assert.equal(operations.length, 3);
+  assert.equal(events.length, 4);
+  assert.deepEqual(events.map(e => e.kind).sort(), ['move_in', 'move_out', 'release', 'reserve']);
+  assert.equal(transactions.length, 0);
+  assert.deepEqual(requireSuccess(await f.owner.client.from('goals').select('*').eq('id', initialGoal.id).single()), initialGoal);
+  assert.equal(requireSuccess(await f.owner.client.from('accounts').select('balance').eq('id', f.owner.account.id).single()).balance, 30000);
+});
+
+test('foreign and missing account/goal references fail without writes', async t => {
+  const f = await setup(t);
+  for (const overrides of [{ accountId: f.other.account.id }, { goalId: f.other.goal.id }, { accountId: randomUUID() }, { goalId: randomUUID() }]) {
+    await expectFailure(f, command(f, 'reserve', '1.00', overrides), 'NOT_ALLOWED');
+  }
+  await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: f.other.goal.id }), 'NOT_ALLOWED');
+});
+
+test('credit, non-PHP and inactive wallets cannot be reserved', async t => {
+  const f = await setup(t);
+  for (const overrides of [{ type: 'credit_card' }, { currency: 'USD' }, { is_active: false }]) {
+    const wallet = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Ineligible', type: 'cash', balance: '30000.00', ...overrides }).select().single());
+    await expectFailure(f, command(f, 'reserve', '1.00', { accountId: wallet.id }), 'NOT_ALLOWED');
+  }
+});
+
+test('closed, archived and unreviewed goals reject allocation changes', async t => {
+  const f = await setup(t);
+  for (const [patch, error] of [[{ status: 'completed' }, 'INVALID_STATE'], [{ status: 'cancelled' }, 'INVALID_STATE'], [{ archived_at: '2026-10-06T00:00:00Z' }, 'INVALID_STATE'], [{ review_state: 'needs_review' }, 'NEEDS_REVIEW']]) {
+    requireSuccess(await f.admin.from('goals').update({ status: 'active', archived_at: null, review_state: 'confirmed', ...patch }).eq('id', f.owner.goal.id));
+    for (const kind of ['reserve', 'release', 'reallocate']) await expectFailure(f, command(f, kind, '1.00', kind === 'reallocate' ? { destinationGoalId: f.owner.goal.id } : {}), error);
+  }
+});
+
+test('reallocation validates destination and rejects moving to the same goal', async t => {
+  const f = await setup(t);
+  requireSuccess(await apply(f, command(f)));
+  const destination = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Closed', target_amount: '1000.00', status: 'completed' }).select().single());
+  await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: destination.id }), 'INVALID_STATE');
+  requireSuccess(await f.admin.from('goals').update({ status: 'active', review_state: 'needs_review' }).eq('id', destination.id));
+  await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: destination.id }), 'NEEDS_REVIEW');
+  await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: f.owner.goal.id }), 'INVALID_STATE');
+});
+
+test('insufficient availability and excessive release or move roll back', async t => {
+  const f = await setup(t);
+  requireSuccess(await apply(f, command(f)));
+  await expectFailure(f, command(f, 'reserve', '25000.01'), 'INSUFFICIENT_AVAILABLE');
+  await expectFailure(f, command(f, 'release', '5000.01'), 'INSUFFICIENT_RESERVATION');
+  const destination = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: '1000.00' }).select().single());
+  await expectFailure(f, command(f, 'reallocate', '5000.01', { destinationGoalId: destination.id }), 'INSUFFICIENT_RESERVATION');
+});
+
+test('money must be a positive canonical bounded decimal string and commands must be supported', async t => {
+  const f = await setup(t);
+  for (const amount of ['0.00', '-1.00', '1.001', '1', '01.00', 'NaN', '10000000000000.00', 1, null]) await expectFailure(f, command(f, 'reserve', amount), 'INVALID_STATE');
+  for (const kind of ['transaction', 'close', 'reopen', 'archive', 'delete_transaction', 'adopt_legacy', 'unknown']) await expectFailure(f, { kind }, 'INVALID_STATE');
+  await expectFailure(f, command(f), 'INVALID_STATE', {});
+  await expectFailure(f, { ...command(f), unexpected: true }, 'INVALID_STATE');
+});
+
+test('concurrent over-allocation serializes and request replay retains the original result', async t => {
+  const f = await setup(t);
+  const requests = [randomUUID(), randomUUID()];
+  const results = await Promise.all(requests.map(id => apply(f, command(f, 'reserve', '20000.00'), id)));
+  assert.equal(results.filter(r => !r.error).length, 1);
+  assert.equal(results.find(r => r.error).error.message, 'INSUFFICIENT_AVAILABLE');
+  const winner = results.findIndex(r => !r.error);
+  const original = requireSuccess(results[winner]);
+  assert.equal(original.replayed, false);
+  assert.deepEqual(original.transactionIds, []);
+  assert.match(original.operationId, /^[0-9a-f-]{36}$/);
+  const before = await counts(f);
+  requireSuccess(await f.admin.from('goals').update({ status: 'completed' }).eq('id', f.owner.goal.id));
+  assert.deepEqual(requireSuccess(await apply(f, command(f, 'reserve', '20000.00'), requests[winner])), { ...original, replayed: true });
+  assert.equal((await apply(f, command(f, 'reserve', '1.00'), requests[winner])).error?.message, 'REQUEST_CONFLICT');
+  assert.deepEqual(await counts(f), before);
+  assert.equal((await snapshot(f)).wallets[0].reserved, '20000.00');
+});
+
+test('concurrent duplicate requests append a single event', async t => {
+  const f = await setup(t);
+  const request = randomUUID();
+  const results = await Promise.all([apply(f, command(f), request), apply(f, command(f), request)]);
+  const values = results.map(r => requireSuccess(r));
+  assert.equal(values[0].operationId, values[1].operationId);
+  assert.deepEqual(values.map(v => v.replayed).sort(), [false, true]);
+  const [operations, events] = await counts(f);
+  assert.equal(operations.length, 1);
+  assert.equal(events.length, 1);
+});
+
+test('snapshot is owned, read-only, retains archived metadata and separates legacy tags', async t => {
+  const f = await setup(t);
+  requireSuccess(await f.admin.from('goals').update({ review_state: 'needs_review', current_amount: '999.99' }).eq('id', f.owner.goal.id));
+  const archived = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Historical name', target_amount: '5000.00', status: 'cancelled', archived_at: '2026-10-06T00:00:00Z' }).select().single());
+  for (const [type, amount] of [['expense', '123.45'], ['transfer', '76.55'], ['income', '500.00']]) {
+    requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: f.owner.account.id, goal_id: f.owner.goal.id, type, amount, date: '2026-10-06' }));
+  }
+  const before = await counts(f);
+  const row = requireSuccess(await f.admin.from('goals').select('*').eq('id', f.owner.goal.id).single());
+  const state = await snapshot(f);
+  assert.equal(state.goals.length, 2);
+  assert.equal(state.wallets.length, 1);
+  assert.equal(state.goals.find(g => g.id === archived.id).name, 'Historical name');
+  const legacy = state.goals.find(g => g.id === f.owner.goal.id);
+  assert.equal(legacy.review_state, 'needs_review');
+  assert.equal(legacy.legacyTaggedAmount, '200.00');
+  assert.equal(legacy.reserved, '0.00');
+  assert.equal(legacy.spent, '0.00');
+  assert.equal(legacy.progressAmount, '0.00');
+  assert.equal(legacy.remaining, '5000.00');
+  assert.equal(legacy.progressPercent, 0);
+  assert.equal(state.goals.find(g => g.id === archived.id).legacyTaggedAmount, null);
+  assert.deepEqual(await counts(f), before);
+  assert.deepEqual(requireSuccess(await f.admin.from('goals').select('*').eq('id', row.id).single()), row);
+});
+
+test('anonymous and identity-less callers cannot execute finance RPCs', async t => {
+  const f = await setup(t);
+  const { url, options } = await databaseRuntime();
+  const anon = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
+  assert.equal((await anon.rpc('goal_finance_snapshot')).error?.code, '42501');
+  assert.equal((await anon.rpc('goal_finance_apply', { p_request_id: randomUUID(), p_command: command(f) })).error?.code, '42501');
+  assert.equal((await f.admin.rpc('goal_finance_snapshot')).error?.message, 'NOT_ALLOWED');
+});
+
+test('RPCs are security definers with pinned search paths', async () => {
+  const { queryAdmin } = await databaseRuntime();
+  const rows = await queryAdmin("SELECT proname,prosecdef,proconfig FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname IN ('goal_finance_snapshot','goal_finance_apply') ORDER BY proname;");
+  assert.equal(rows.length, 2);
+  for (const row of rows) {
+    assert.equal(row.prosecdef, true);
+    assert.ok(row.proconfig.includes('search_path=pg_catalog, public'));
+  }
+});
+
+test('a failure after the first reallocation event rolls back the operation and all events', async t => {
+  const f = await setup(t);
+  requireSuccess(await apply(f, command(f)));
+  const destination = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: '1000.00' }).select().single());
+  const { queryAdmin } = await databaseRuntime();
+  const name = `reservation_rollback_${randomUUID().replaceAll('-', '')}`;
+  await queryAdmin(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FORCED_FAILURE'; END $$;
+    CREATE TRIGGER ${name} BEFORE INSERT ON public.goal_allocation_events FOR EACH ROW
+    WHEN (NEW.user_id='${f.owner.id}'::uuid AND NEW.kind='move_in') EXECUTE FUNCTION public.${name}();`);
+  try {
+    const state = await snapshot(f);
+    await expectFailure(f, command(f, 'reallocate', '1000.00', { destinationGoalId: destination.id }), 'FORCED_FAILURE');
+    assert.deepEqual(await snapshot(f), state);
+  } finally {
+    await queryAdmin(`DROP TRIGGER ${name} ON public.goal_allocation_events; DROP FUNCTION public.${name}();`);
+  }
+});
+
+test('reservations remain exact and release is scoped to the chosen wallet', async t => {
+  const f = await setup(t);
+  const second = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Bank', type: 'bank', balance: '100.01' }).select().single());
+  requireSuccess(await apply(f, command(f, 'reserve', '0.01')));
+  requireSuccess(await apply(f, command(f, 'reserve', '99.99', { accountId: second.id })));
+  let state = await snapshot(f);
+  const goal = state.goals.find(g => g.id === f.owner.goal.id);
+  assert.equal(goal.reserved, '100.00');
+  assert.equal(goal.remaining, '4900.00');
+  assert.equal(goal.progressPercent, 2);
+  assert.deepEqual(goal.walletReservations, [
+    { accountId: f.owner.account.id, amount: '0.01' }, { accountId: second.id, amount: '99.99' },
+  ].sort((a, b) => a.accountId.localeCompare(b.accountId)));
+  assert.deepEqual(state.wallets.find(w => w.accountId === second.id), { accountId: second.id, actual: '100.01', reserved: '99.99', available: '0.02' });
+  await expectFailure(f, command(f, 'release', '0.02'), 'INSUFFICIENT_RESERVATION');
+  requireSuccess(await apply(f, command(f, 'release', '0.01')));
+  state = await snapshot(f);
+  assert.equal(state.goals[0].reserved, '99.99');
+  assert.deepEqual(state.goals[0].walletReservations, [{ accountId: second.id, amount: '99.99' }]);
+});
