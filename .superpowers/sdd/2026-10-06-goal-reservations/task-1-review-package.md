# Task 1 review: 6f178701ee16bcbfd992a8c6336017e65b78fea6..44d4bd03cd9e36a42c3b9e7a6253b67e19819085
44d4bd0 feat: add goal allocation ledger and reproducible schema
 .gitignore                                         |  17 +-
 docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md     |  73 +++
 package.json                                       |   1 +
 src/types/database.ts                              |  71 +++
 .../migrations/202610060001_runtime_baseline.sql   | 143 ++++++
 .../202610060002_goal_allocation_ledger.sql        | 115 +++++
 supabase/schema.sql                                | 540 ++++++++++-----------
 tests/database/helpers.mjs                         | 122 +++++
 tests/database/ledger.test.mjs                     | 138 ++++++
 9 files changed, 930 insertions(+), 290 deletions(-)
diff --git a/.gitignore b/.gitignore
index a9ec4d5..f73bd38 100644
--- a/.gitignore
+++ b/.gitignore
@@ -44,21 +44,34 @@ next-env.d.ts
 
 # Agent Customizations & Workspaces
 .agents/
 .superpowers/
 AGENTS.md
 GEMINI.md
 SKILL.md
 skills-lock.json
 
 # Documentation & Specs
-docs/
+docs/*
 !docs/codex-review/
+!docs/superpowers/
+docs/superpowers/*
+!docs/superpowers/plans/
+!docs/superpowers/specs/
+docs/superpowers/plans/*
+docs/superpowers/specs/*
+!docs/superpowers/plans/2026-10-06-goal-reservations.md
+!docs/superpowers/specs/2026-10-06-goal-reservations-design.md
 
 # Database & Migrations
-supabase/
+supabase/*
+!supabase/schema.sql
+!supabase/migrations/
+supabase/migrations/*
+!supabase/migrations/202610060001_runtime_baseline.sql
+!supabase/migrations/202610060002_goal_allocation_ledger.sql
 
 # Verification & Test Scripts
 scripts/
 
 
 
diff --git a/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md b/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
new file mode 100644
index 0000000..cebe1ca
--- /dev/null
+++ b/docs/codex-review/GOAL_RESERVATIONS_ROLLOUT.md
@@ -0,0 +1,73 @@
+# Goal reservations rollout
+
+Local implementation is authorized. Remote push, production SQL, permission cutover, merge, and deployment require separate authorization.
+
+## Schema evidence and required deployment preflight
+
+The former `supabase/schema.sql` was a destructive reset. It omitted `transactions.goal_id` and the goal priority, category, allocation amount, and cadence columns already used by the application. The 2026-10-05 Goals plans specify those additions. The runtime account types also require savings, interest, net-worth inclusion, and display order. Migration `202610060001_runtime_baseline.sql` reproduces these columns on an empty database and adds missing known columns without changing old financial values.
+
+The deployed schema and existing transaction deletion RPC remain unverified. The available public credentials do not expose their definitions. No live database write has been performed. Before finalizing deployment SQL, an authorized operator must capture this read-only evidence from the actual deployment:
+
+```sql
+SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
+       numeric_precision, numeric_scale
+FROM information_schema.columns
+WHERE table_schema = 'public'
+ORDER BY table_name, ordinal_position;
+
+SELECT conrelid::regclass AS relation, conname, pg_get_constraintdef(oid)
+FROM pg_constraint WHERE connamespace = 'public'::regnamespace;
+
+SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
+FROM pg_policies WHERE schemaname = 'public';
+
+SELECT p.oid::regprocedure AS signature, p.prosecdef, p.proconfig, p.proacl,
+       pg_get_functiondef(p.oid) AS definition
+FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
+WHERE n.nspname = 'public' AND p.prokind = 'f';
+
+SELECT event_object_schema, event_object_table, trigger_name, action_statement
+FROM information_schema.triggers
+WHERE event_object_schema IN ('public', 'auth');
+
+SELECT table_name, grantee, privilege_type
+FROM information_schema.role_table_grants WHERE table_schema = 'public';
+```
+
+Identify the deletion RPC called by the deployed app, including its complete overload signatures, grants, owner checks, balance reversal, debt, and installment behavior. Compare the evidence with both migrations. Resolve differences additively and rerun disposable database tests. Do not invent or overwrite a missing RPC body.
+
+## Additive ledger behavior
+
+Pre-existing goals become `needs_review`; their old `current_amount`, completion flag, tagged transactions, and balances retain their values. Legacy completion maps to lifecycle status `completed` without inventing a completion timestamp. New goals default to `active` and `confirmed`. Reapplying the migration preserves a goal's review and lifecycle decisions. No legacy transaction becomes an allocation event automatically.
+
+Allocation deltas use exact PostgreSQL `numeric` with a two-decimal scale check and the same range as `numeric(15,2)`. A literal `numeric(15,2)` column rounds excess decimal places before constraints can reject them. The checked numeric columns reject such input instead. New RPC money inputs must also validate decimal strings before any casts and return canonical two-decimal strings.
+
+Composite foreign keys bind each event's goal, wallet, operation, and reversal to the same owner. Authenticated clients can read their history through `auth.uid()` but cannot directly write events or operations. Event updates and deletes fail, including service-role edits. Whole-user deletion remains possible for disposable fixture cleanup and account erasure; this is the sole history deletion exception. An account or goal with allocation history cannot be deleted independently.
+
+The event's `transaction_id` retains the original UUID after transaction deletion. An insert trigger checks that a referenced transaction exists and belongs to the owner. This retained identifier deliberately has no deletion foreign key because setting it to null would modify immutable history.
+
+## Disposable database verification
+
+Use an isolated Supabase project, apply the baseline and ledger migrations in order, and set the following environment variables through a private shell or ignored environment file:
+
+- `TEST_SUPABASE_URL`
+- `TEST_SUPABASE_ANON_KEY`
+- `TEST_SUPABASE_SERVICE_ROLE_KEY`
+- `TEST_DATABASE_DISPOSABLE=true`
+- `TEST_DATABASE_URL`, a direct PostgreSQL connection URI used by `psql`; optionally `TEST_PSQL_PATH`.
+
+Then run `npm run test:db`. The test harness creates two independent users, signs each in, creates fixtures, and deletes the fixture users afterward. It never falls back to the application's live environment variables. Database test files run serially so upgrade checks cannot race other test files.
+
+For the local native PostgreSQL/PostgREST setup, use `TEST_DATABASE_ADAPTER` pointing to an ignored module exporting `queryAdmin(sql, params)`, `createUser(email)`, and `deleteUser(id)`. The adapter must return PostgreSQL rows and signed authenticated access tokens. This replaces GoTrue fixture setup only; schema, constraints, privileges, RLS, JWT verification, and HTTP database calls still execute in real PostgreSQL/PostgREST. The ignored local runner loads its own test configuration without reading the application's `.env`.
+
+The upgrade test builds and drops a uniquely named isolated schema in the disposable database. It verifies first-upgrade preservation and safe reapplication. Never run the test suite against production.
+
+## Coordinated cutover
+
+1. Capture the deployed-schema evidence above and audit existing debt discrepancies without correcting balances automatically.
+2. Apply reviewed additive migrations after deployment authorization. Verify legacy goals require review and newly created goals are confirmed.
+3. Update every financial writer to the atomic RPC lane, including expense, transfer, installments, deletion, legacy adoption, and lifecycle actions. Remove fetch-time balance writes.
+4. Audit old RPC grants and restrict direct transaction, balance, lifecycle, and allocation mutations as a coordinated cutover. Retain opening-balance account creation and safe metadata changes.
+5. Run integration and owner-isolation checks, then verify the user examples and cache refresh behavior.
+
+Once reservations exist, a rollback to legacy writers can corrupt available money. Preserve ledger history and use a forward fix or temporarily disable writes if the cutover fails.
diff --git a/package.json b/package.json
index 75621a9..156fe82 100644
--- a/package.json
+++ b/package.json
@@ -1,16 +1,17 @@
 {
   "name": "monetigia",
   "version": "1.0.0",
   "private": true,
   "scripts": {
     "test": "node --test tests/navigation-goals.test.cjs && vitest run",
+    "test:db": "node --test --test-concurrency=1 tests/database/*.test.mjs",
     "dev": "next dev",
     "build": "next build",
     "start": "next start",
     "lint": "next lint",
     "db:generate": "prisma generate",
     "db:push": "prisma db push",
     "db:studio": "prisma studio"
   },
   "dependencies": {
     "@hookform/resolvers": "^3.3.4",
diff --git a/src/types/database.ts b/src/types/database.ts
index 1a39067..d09765d 100644
--- a/src/types/database.ts
+++ b/src/types/database.ts
@@ -211,63 +211,132 @@ export interface Database {
         Row: {
           id: string;
           user_id: string;
           name: string;
           target_amount: number;
           current_amount: number;
           target_date: string | null;
           color: string | null;
           icon: string | null;
           is_completed: boolean;
+          status: "active" | "completed" | "cancelled";
+          review_state: "needs_review" | "confirmed";
+          completed_at: string | null;
+          archived_at: string | null;
           is_priority: boolean;
           category: string;
           allocation_per_cycle: number;
           allocation_frequency: "monthly" | "kinsenas" | string | null;
           created_at: string;
           updated_at: string;
         };
         Insert: {
           id?: string;
           user_id: string;
           name: string;
           target_amount: number;
           current_amount?: number;
           target_date?: string | null;
           color?: string | null;
           icon?: string | null;
           is_completed?: boolean;
+          status?: "active" | "completed" | "cancelled";
+          review_state?: "needs_review" | "confirmed";
+          completed_at?: string | null;
+          archived_at?: string | null;
           is_priority?: boolean;
           category?: string;
           allocation_per_cycle?: number;
           allocation_frequency?: "monthly" | "kinsenas" | string | null;
           created_at?: string;
           updated_at?: string;
         };
         Update: {
           id?: string;
           user_id?: string;
           name?: string;
           target_amount?: number;
           current_amount?: number;
           target_date?: string | null;
           color?: string | null;
           icon?: string | null;
           is_completed?: boolean;
+          status?: "active" | "completed" | "cancelled";
+          review_state?: "needs_review" | "confirmed";
+          completed_at?: string | null;
+          archived_at?: string | null;
           is_priority?: boolean;
           category?: string;
           allocation_per_cycle?: number;
           allocation_frequency?: "monthly" | "kinsenas" | string | null;
           created_at?: string;
           updated_at?: string;
         };
         Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
       };
+      financial_operations: {
+        Row: {
+          id: string;
+          user_id: string;
+          request_id: string;
+          command_hash: string;
+          command: Json;
+          result: Json | null;
+          created_at: string;
+          completed_at: string | null;
+        };
+        Insert: {
+          id?: string;
+          user_id: string;
+          request_id: string;
+          command_hash: string;
+          command: Json;
+          result?: Json | null;
+          created_at?: string;
+          completed_at?: string | null;
+        };
+        Update: {
+          result?: Json | null;
+          completed_at?: string | null;
+        };
+        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
+      };
+      goal_allocation_events: {
+        Row: {
+          id: string;
+          user_id: string;
+          goal_id: string;
+          account_id: string;
+          operation_id: string;
+          kind: "reserve" | "release" | "spend" | "move_in" | "move_out" | "legacy_spent" | "reversal";
+          reserved_delta: string | number;
+          spent_delta: string | number;
+          transaction_id: string | null;
+          reversal_of: string | null;
+          created_at: string;
+        };
+        Insert: {
+          id?: string;
+          user_id: string;
+          goal_id: string;
+          account_id: string;
+          operation_id: string;
+          kind: "reserve" | "release" | "spend" | "move_in" | "move_out" | "legacy_spent" | "reversal";
+          reserved_delta?: string;
+          spent_delta?: string;
+          transaction_id?: string | null;
+          reversal_of?: string | null;
+          created_at?: string;
+        };
+        Update: never;
+        Relationships: { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[]; }[];
+      };
       user_preferences: {
         Row: {
           id: string;
           user_id: string;
           currency: string;
           theme: "light" | "dark" | "system";
           language: string;
           notifications_enabled: boolean;
           created_at: string;
           updated_at: string;
@@ -303,11 +372,13 @@ export interface Database {
 
 // Convenience types
 export type User = Database["public"]["Tables"]["users"]["Row"];
 export type Account = Database["public"]["Tables"]["accounts"]["Row"];
 export type Category = Database["public"]["Tables"]["categories"]["Row"];
 export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
 export type Budget = Database["public"]["Tables"]["budgets"]["Row"];
 export type Goal = Database["public"]["Tables"]["goals"]["Row"];
 export type GoalInsert = Database["public"]["Tables"]["goals"]["Insert"];
 export type GoalUpdate = Database["public"]["Tables"]["goals"]["Update"];
+export type GoalAllocationEvent = Database["public"]["Tables"]["goal_allocation_events"]["Row"];
+export type FinancialOperation = Database["public"]["Tables"]["financial_operations"]["Row"];
 export type UserPreference = Database["public"]["Tables"]["user_preferences"]["Row"];
diff --git a/supabase/migrations/202610060001_runtime_baseline.sql b/supabase/migrations/202610060001_runtime_baseline.sql
new file mode 100644
index 0000000..3945651
--- /dev/null
+++ b/supabase/migrations/202610060001_runtime_baseline.sql
@@ -0,0 +1,143 @@
+-- Additive runtime baseline. Requires Supabase auth.users/auth.uid() and its roles.
+-- Existing functions, grants, policies, financial values, and auth users are retained.
+BEGIN;
+CREATE EXTENSION IF NOT EXISTS pgcrypto;
+
+CREATE TABLE IF NOT EXISTS public.users (
+  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
+  email text UNIQUE NOT NULL, username text UNIQUE NOT NULL,
+  name text, avatar_url text, is_verified boolean DEFAULT false,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
+);
+CREATE TABLE IF NOT EXISTS public.accounts (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  name text NOT NULL,
+  type text NOT NULL CHECK (type IN ('cash','bank','credit_card','e_wallet','investment')),
+  balance numeric(15,2) DEFAULT 0, currency text DEFAULT 'PHP', color text, icon text,
+  is_active boolean DEFAULT true, is_savings boolean DEFAULT false,
+  interest_rate numeric(5,2) DEFAULT 0, include_in_networth boolean DEFAULT true,
+  display_order integer DEFAULT 0,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
+);
+CREATE TABLE IF NOT EXISTS public.categories (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
+  name text NOT NULL, type text NOT NULL CHECK (type IN ('income','expense')),
+  color text, icon text, is_default boolean DEFAULT false, created_at timestamptz DEFAULT now()
+);
+CREATE TABLE IF NOT EXISTS public.goals (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  name text NOT NULL, target_amount numeric(15,2) NOT NULL,
+  current_amount numeric(15,2) DEFAULT 0, target_date date, color text, icon text,
+  is_completed boolean DEFAULT false, is_priority boolean DEFAULT false,
+  category text DEFAULT 'lifestyle', allocation_per_cycle numeric(15,2) DEFAULT 0,
+  allocation_frequency text DEFAULT 'monthly',
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
+);
+CREATE TABLE IF NOT EXISTS public.transactions (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
+  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
+  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
+  type text NOT NULL CHECK (type IN ('income','expense','transfer')),
+  amount numeric(15,2) NOT NULL, description text, date date NOT NULL,
+  transfer_to_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
+);
+CREATE TABLE IF NOT EXISTS public.budgets (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
+  amount numeric(15,2) NOT NULL,
+  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly','monthly','yearly')),
+  start_date date NOT NULL, end_date date,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
+);
+CREATE TABLE IF NOT EXISTS public.user_preferences (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  currency text DEFAULT 'PHP', theme text DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
+  language text DEFAULT 'en', notifications_enabled boolean DEFAULT true,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
+);
+
+ALTER TABLE public.accounts
+  ADD COLUMN IF NOT EXISTS is_savings boolean DEFAULT false,
+  ADD COLUMN IF NOT EXISTS interest_rate numeric(5,2) DEFAULT 0,
+  ADD COLUMN IF NOT EXISTS include_in_networth boolean DEFAULT true,
+  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;
+ALTER TABLE public.goals
+  ADD COLUMN IF NOT EXISTS is_priority boolean DEFAULT false,
+  ADD COLUMN IF NOT EXISTS category text DEFAULT 'lifestyle',
+  ADD COLUMN IF NOT EXISTS allocation_per_cycle numeric(15,2) DEFAULT 0,
+  ADD COLUMN IF NOT EXISTS allocation_frequency text DEFAULT 'monthly';
+ALTER TABLE public.transactions
+  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL;
+
+CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts(user_id);
+CREATE INDEX IF NOT EXISTS idx_categories_user_id ON public.categories(user_id);
+CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
+CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON public.transactions(account_id);
+CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
+CREATE INDEX IF NOT EXISTS idx_transactions_goal_id ON public.transactions(goal_id);
+CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON public.budgets(user_id);
+CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals(user_id);
+
+-- Only fresh tables without policies receive the compatibility policies.
+-- A deployed project's policies need a separate read-only audit before cutover.
+DO $$
+DECLARE table_name text;
+BEGIN
+  FOREACH table_name IN ARRAY ARRAY['users','accounts','categories','goals','transactions','budgets','user_preferences'] LOOP
+    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
+    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name) THEN
+      IF table_name='users' THEN
+        EXECUTE 'CREATE POLICY baseline_owner_read ON public.users FOR SELECT TO authenticated USING (auth.uid()=id)';
+        EXECUTE 'CREATE POLICY baseline_owner_update ON public.users FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id)';
+      ELSIF table_name='categories' THEN
+        EXECUTE 'CREATE POLICY baseline_category_read ON public.categories FOR SELECT TO authenticated USING (auth.uid()=user_id OR is_default=true)';
+        EXECUTE 'CREATE POLICY baseline_category_write ON public.categories FOR ALL TO authenticated USING (auth.uid()=user_id AND is_default=false) WITH CHECK (auth.uid()=user_id AND is_default=false)';
+      ELSE
+        EXECUTE format('CREATE POLICY baseline_owner_access ON public.%I FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id)', table_name);
+      END IF;
+      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
+      EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
+    END IF;
+  END LOOP;
+END $$;
+
+-- Create the registration trigger only when absent; never replace a deployed body.
+DO $setup$
+BEGIN
+  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created') THEN
+    IF to_regprocedure('public.handle_new_user()') IS NULL THEN
+      EXECUTE $function$
+        CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
+        SET search_path = pg_catalog, public AS $body$
+        BEGIN
+          INSERT INTO public.users(id,email,username,name,avatar_url,is_verified)
+          VALUES (NEW.id,NEW.email,COALESCE(NEW.raw_user_meta_data->>'username',lower(split_part(NEW.email,'@',1))),
+            COALESCE(NEW.raw_user_meta_data->>'name',NEW.raw_user_meta_data->>'full_name'),
+            NEW.raw_user_meta_data->>'avatar_url',NEW.email_confirmed_at IS NOT NULL);
+          INSERT INTO public.user_preferences(user_id) VALUES(NEW.id);
+          INSERT INTO public.categories(user_id,name,type,icon,color,is_default) VALUES
+            (NEW.id,'Salary','income','Banknote','#22c55e',false),
+            (NEW.id,'Freelance','income','Laptop','#3b82f6',false),
+            (NEW.id,'Other Income','income','Plus','#6b7280',false),
+            (NEW.id,'Food & Dining','expense','UtensilsCrossed','#f97316',false),
+            (NEW.id,'Transportation','expense','Car','#eab308',false),
+            (NEW.id,'Shopping','expense','ShoppingBag','#ec4899',false),
+            (NEW.id,'Bills & Utilities','expense','Receipt','#ef4444',false),
+            (NEW.id,'Entertainment','expense','Film','#8b5cf6',false),
+            (NEW.id,'Other Expense','expense','Minus','#6b7280',false);
+          RETURN NEW;
+        END $body$
+      $function$;
+    END IF;
+    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
+  END IF;
+END $setup$;
+COMMIT;
diff --git a/supabase/migrations/202610060002_goal_allocation_ledger.sql b/supabase/migrations/202610060002_goal_allocation_ledger.sql
new file mode 100644
index 0000000..595e1c1
--- /dev/null
+++ b/supabase/migrations/202610060002_goal_allocation_ledger.sql
@@ -0,0 +1,115 @@
+BEGIN;
+ALTER TABLE public.goals
+  ADD COLUMN IF NOT EXISTS status text,
+  ADD COLUMN IF NOT EXISTS review_state text,
+  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
+  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
+-- Only previously uninitialized rows are migrated; reapplication keeps review decisions.
+UPDATE public.goals SET status=CASE WHEN is_completed THEN 'completed' ELSE 'active' END WHERE status IS NULL;
+UPDATE public.goals SET review_state='needs_review' WHERE review_state IS NULL;
+ALTER TABLE public.goals
+  ALTER COLUMN status SET DEFAULT 'active', ALTER COLUMN status SET NOT NULL,
+  ALTER COLUMN review_state SET DEFAULT 'confirmed', ALTER COLUMN review_state SET NOT NULL;
+DO $$ BEGIN
+  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goals'::regclass AND conname='goals_status_check') THEN
+    ALTER TABLE public.goals ADD CONSTRAINT goals_status_check CHECK(status IN ('active','completed','cancelled'));
+  END IF;
+  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goals'::regclass AND conname='goals_review_state_check') THEN
+    ALTER TABLE public.goals ADD CONSTRAINT goals_review_state_check CHECK(review_state IN ('needs_review','confirmed'));
+  END IF;
+END $$;
+CREATE UNIQUE INDEX IF NOT EXISTS goals_owner_id_key ON public.goals(user_id,id);
+CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_id_key ON public.accounts(user_id,id);
+
+CREATE TABLE IF NOT EXISTS public.financial_operations (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  request_id uuid NOT NULL,
+  command_hash text NOT NULL CHECK(command_hash ~ '^[0-9a-f]{64}$'),
+  command jsonb NOT NULL,
+  result jsonb,
+  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
+  UNIQUE(user_id,request_id), UNIQUE(user_id,id)
+);
+CREATE TABLE IF NOT EXISTS public.goal_allocation_events (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  goal_id uuid NOT NULL, account_id uuid NOT NULL, operation_id uuid NOT NULL,
+  kind text NOT NULL CHECK(kind IN ('reserve','release','spend','move_in','move_out','legacy_spent','reversal')),
+  -- Unconstrained numeric rejects excess scale before any numeric(15,2) rounding.
+  reserved_delta numeric NOT NULL DEFAULT 0
+    CHECK(abs(reserved_delta)<10000000000000 AND scale(reserved_delta)<=2),
+  spent_delta numeric NOT NULL DEFAULT 0
+    CHECK(abs(spent_delta)<10000000000000 AND scale(spent_delta)<=2),
+  transaction_id uuid,
+  reversal_of uuid UNIQUE,
+  created_at timestamptz NOT NULL DEFAULT now(),
+  CHECK(reserved_delta<>0 OR spent_delta<>0),
+  CHECK((kind='reversal')=(reversal_of IS NOT NULL)),
+  UNIQUE(user_id,id),
+  FOREIGN KEY(user_id,goal_id) REFERENCES public.goals(user_id,id) DEFERRABLE INITIALLY DEFERRED,
+  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) DEFERRABLE INITIALLY DEFERRED,
+  FOREIGN KEY(user_id,operation_id) REFERENCES public.financial_operations(user_id,id) DEFERRABLE INITIALLY DEFERRED,
+  FOREIGN KEY(user_id,reversal_of) REFERENCES public.goal_allocation_events(user_id,id) DEFERRABLE INITIALLY DEFERRED
+);
+CREATE INDEX IF NOT EXISTS allocation_owner_history_idx ON public.goal_allocation_events(user_id,created_at,id);
+CREATE INDEX IF NOT EXISTS allocation_goal_history_idx ON public.goal_allocation_events(user_id,goal_id,created_at,id);
+CREATE INDEX IF NOT EXISTS allocation_account_history_idx ON public.goal_allocation_events(user_id,account_id,created_at,id);
+CREATE INDEX IF NOT EXISTS allocation_operation_idx ON public.goal_allocation_events(operation_id);
+CREATE INDEX IF NOT EXISTS allocation_transaction_idx ON public.goal_allocation_events(user_id,transaction_id) WHERE transaction_id IS NOT NULL;
+CREATE INDEX IF NOT EXISTS operations_owner_history_idx ON public.financial_operations(user_id,created_at,id);
+
+CREATE OR REPLACE FUNCTION public.check_allocation_transaction_owner()
+RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+BEGIN
+  IF NEW.transaction_id IS NOT NULL THEN
+    IF EXISTS(SELECT 1 FROM public.transactions WHERE id=NEW.transaction_id AND user_id=NEW.user_id) THEN
+      RETURN NEW;
+    END IF;
+    -- Reversals retain a deleted transaction UUID only through its same-owner source.
+    IF NEW.kind='reversal' AND EXISTS(
+      SELECT 1 FROM public.goal_allocation_events
+      WHERE id=NEW.reversal_of AND user_id=NEW.user_id AND transaction_id=NEW.transaction_id
+    ) THEN
+      RETURN NEW;
+    END IF;
+    RAISE EXCEPTION 'Allocation transaction must belong to the event owner' USING ERRCODE='23503';
+  END IF;
+  RETURN NEW;
+END $$;
+CREATE OR REPLACE FUNCTION public.prevent_allocation_history_change()
+RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+BEGIN
+  -- Whole-user erasure cascades after the profile disappears; standalone deletion is forbidden.
+  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN
+    RETURN OLD;
+  END IF;
+  RAISE EXCEPTION 'Allocation history is append-only' USING ERRCODE='55000';
+END $$;
+REVOKE ALL ON FUNCTION public.check_allocation_transaction_owner() FROM PUBLIC;
+REVOKE ALL ON FUNCTION public.prevent_allocation_history_change() FROM PUBLIC;
+DO $$ BEGIN
+  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.goal_allocation_events'::regclass AND tgname='allocation_transaction_owner') THEN
+    CREATE TRIGGER allocation_transaction_owner BEFORE INSERT ON public.goal_allocation_events
+      FOR EACH ROW EXECUTE FUNCTION public.check_allocation_transaction_owner();
+  END IF;
+  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.goal_allocation_events'::regclass AND tgname='allocation_history_immutable') THEN
+    CREATE TRIGGER allocation_history_immutable BEFORE UPDATE OR DELETE ON public.goal_allocation_events
+      FOR EACH ROW EXECUTE FUNCTION public.prevent_allocation_history_change();
+  END IF;
+END $$;
+ALTER TABLE public.goal_allocation_events ENABLE ROW LEVEL SECURITY;
+ALTER TABLE public.financial_operations ENABLE ROW LEVEL SECURITY;
+DO $$ BEGIN
+  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='goal_allocation_events' AND policyname='allocation_owner_read') THEN
+    CREATE POLICY allocation_owner_read ON public.goal_allocation_events FOR SELECT TO authenticated USING(auth.uid()=user_id);
+  END IF;
+  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='financial_operations' AND policyname='operation_owner_read') THEN
+    CREATE POLICY operation_owner_read ON public.financial_operations FOR SELECT TO authenticated USING(auth.uid()=user_id);
+  END IF;
+END $$;
+REVOKE ALL ON public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
+GRANT SELECT ON public.goal_allocation_events,public.financial_operations TO authenticated;
+GRANT ALL ON public.goal_allocation_events,public.financial_operations TO service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/supabase/schema.sql b/supabase/schema.sql
index 8b61431..fdb04d4 100644
--- a/supabase/schema.sql
+++ b/supabase/schema.sql
@@ -1,298 +1,262 @@
--- =====================================================
--- MONETIGIA MONEY TRACKER - COMPLETE DATABASE RESET
--- =====================================================
--- This script will DROP ALL existing tables and recreate them from scratch
--- WARNING: This will delete ALL data AND ALL USERS in your database!
--- Run this in your Supabase SQL Editor
-
--- =====================================================
--- STEP 1: DROP ALL EXISTING TABLES
--- =====================================================
-DROP TABLE IF EXISTS public.transactions CASCADE;
-DROP TABLE IF EXISTS public.budgets CASCADE;
-DROP TABLE IF EXISTS public.goals CASCADE;
-DROP TABLE IF EXISTS public.accounts CASCADE;
-DROP TABLE IF EXISTS public.categories CASCADE;
-DROP TABLE IF EXISTS public.user_preferences CASCADE;
-DROP TABLE IF EXISTS public.users CASCADE;
-
--- Drop the trigger and function
-DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-DROP FUNCTION IF EXISTS public.handle_new_user();
-
--- =====================================================
--- STEP 1.5: DELETE ALL AUTH USERS (COMPLETE RESET)
--- =====================================================
--- WARNING: This will delete ALL registered users!
-DELETE FROM auth.users;
-
--- =====================================================
--- STEP 2: ENABLE EXTENSIONS
--- =====================================================
-CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-
--- =====================================================
--- STEP 3: CREATE TABLES
--- =====================================================
-
--- Users table (extends Supabase auth.users)
-CREATE TABLE public.users (
-  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
-  email TEXT UNIQUE NOT NULL,
-  username TEXT UNIQUE NOT NULL,
-  name TEXT,
-  avatar_url TEXT,
-  is_verified BOOLEAN DEFAULT FALSE,
-  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
-  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
+-- Safe reproducible schema: runtime baseline followed by additive goal ledger.
+-- Source of truth: the ordered supabase/migrations files.
+
+-- Additive runtime baseline. Requires Supabase auth.users/auth.uid() and its roles.
+-- Existing functions, grants, policies, financial values, and auth users are retained.
+BEGIN;
+CREATE EXTENSION IF NOT EXISTS pgcrypto;
+
+CREATE TABLE IF NOT EXISTS public.users (
+  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
+  email text UNIQUE NOT NULL, username text UNIQUE NOT NULL,
+  name text, avatar_url text, is_verified boolean DEFAULT false,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
 );
-
--- Accounts table
-CREATE TABLE public.accounts (
-  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
-  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
-  name TEXT NOT NULL,
-  type TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'credit_card', 'e_wallet', 'investment')),
-  balance DECIMAL(15, 2) DEFAULT 0,
-  currency TEXT DEFAULT 'PHP',
-  color TEXT,
-  icon TEXT,
-  is_active BOOLEAN DEFAULT TRUE,
-  is_savings BOOLEAN DEFAULT FALSE,
-  interest_rate DECIMAL(5, 2) DEFAULT 0,
-  include_in_networth BOOLEAN DEFAULT TRUE,
-  display_order INTEGER DEFAULT 0,
-  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
-  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
+CREATE TABLE IF NOT EXISTS public.accounts (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  name text NOT NULL,
+  type text NOT NULL CHECK (type IN ('cash','bank','credit_card','e_wallet','investment')),
+  balance numeric(15,2) DEFAULT 0, currency text DEFAULT 'PHP', color text, icon text,
+  is_active boolean DEFAULT true, is_savings boolean DEFAULT false,
+  interest_rate numeric(5,2) DEFAULT 0, include_in_networth boolean DEFAULT true,
+  display_order integer DEFAULT 0,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
 );
-
--- Categories table
-CREATE TABLE public.categories (
-  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
-  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
-  name TEXT NOT NULL,
-  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
-  color TEXT,
-  icon TEXT,
-  is_default BOOLEAN DEFAULT FALSE,
-  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
+CREATE TABLE IF NOT EXISTS public.categories (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
+  name text NOT NULL, type text NOT NULL CHECK (type IN ('income','expense')),
+  color text, icon text, is_default boolean DEFAULT false, created_at timestamptz DEFAULT now()
 );
-
--- Transactions table
-CREATE TABLE public.transactions (
-  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
-  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
-  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
-  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
-  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
-  amount DECIMAL(15, 2) NOT NULL,
-  description TEXT,
-  date DATE NOT NULL,
-  transfer_to_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
-  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
-  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
+CREATE TABLE IF NOT EXISTS public.goals (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  name text NOT NULL, target_amount numeric(15,2) NOT NULL,
+  current_amount numeric(15,2) DEFAULT 0, target_date date, color text, icon text,
+  is_completed boolean DEFAULT false, is_priority boolean DEFAULT false,
+  category text DEFAULT 'lifestyle', allocation_per_cycle numeric(15,2) DEFAULT 0,
+  allocation_frequency text DEFAULT 'monthly',
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
 );
-
--- Budgets table
-CREATE TABLE public.budgets (
-  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
-  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
-  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
-  amount DECIMAL(15, 2) NOT NULL,
-  period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly', 'yearly')),
-  start_date DATE NOT NULL,
-  end_date DATE,
-  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
-  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
+CREATE TABLE IF NOT EXISTS public.transactions (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
+  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
+  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
+  type text NOT NULL CHECK (type IN ('income','expense','transfer')),
+  amount numeric(15,2) NOT NULL, description text, date date NOT NULL,
+  transfer_to_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
 );
-
--- Goals table
-CREATE TABLE public.goals (
-  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
-  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
-  name TEXT NOT NULL,
-  target_amount DECIMAL(15, 2) NOT NULL,
-  current_amount DECIMAL(15, 2) DEFAULT 0,
-  target_date DATE,
-  color TEXT,
-  icon TEXT,
-  is_completed BOOLEAN DEFAULT FALSE,
-  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
-  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
+CREATE TABLE IF NOT EXISTS public.budgets (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
+  amount numeric(15,2) NOT NULL,
+  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly','monthly','yearly')),
+  start_date date NOT NULL, end_date date,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
 );
-
--- User preferences table
-CREATE TABLE public.user_preferences (
-  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
-  user_id UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
-  currency TEXT DEFAULT 'PHP',
-  theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
-  language TEXT DEFAULT 'en',
-  notifications_enabled BOOLEAN DEFAULT TRUE,
-  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
-  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
+CREATE TABLE IF NOT EXISTS public.user_preferences (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  currency text DEFAULT 'PHP', theme text DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
+  language text DEFAULT 'en', notifications_enabled boolean DEFAULT true,
+  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
 );
 
--- =====================================================
--- STEP 4: CREATE INDEXES
--- =====================================================
-CREATE INDEX idx_accounts_user_id ON public.accounts(user_id);
-CREATE INDEX idx_categories_user_id ON public.categories(user_id);
-CREATE INDEX idx_transactions_user_id ON public.transactions(user_id);
-CREATE INDEX idx_transactions_account_id ON public.transactions(account_id);
-CREATE INDEX idx_transactions_date ON public.transactions(date);
-CREATE INDEX idx_budgets_user_id ON public.budgets(user_id);
-CREATE INDEX idx_goals_user_id ON public.goals(user_id);
-
--- =====================================================
--- STEP 5: ENABLE ROW LEVEL SECURITY
--- =====================================================
-ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
-ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
-ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
-ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
-ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
-ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
-
--- =====================================================
--- STEP 6: CREATE RLS POLICIES
--- =====================================================
-
--- Users policies
-CREATE POLICY "Users can view own profile" ON public.users
-  FOR SELECT USING (auth.uid() = id);
-
-CREATE POLICY "Users can update own profile" ON public.users
-  FOR UPDATE USING (auth.uid() = id);
-
--- Accounts policies
-CREATE POLICY "Users can view own accounts" ON public.accounts
-  FOR SELECT USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can insert own accounts" ON public.accounts
-  FOR INSERT WITH CHECK (auth.uid() = user_id);
-
-CREATE POLICY "Users can update own accounts" ON public.accounts
-  FOR UPDATE USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can delete own accounts" ON public.accounts
-  FOR DELETE USING (auth.uid() = user_id);
-
--- Categories policies
-CREATE POLICY "Users can view own and default categories" ON public.categories
-  FOR SELECT USING (auth.uid() = user_id OR is_default = TRUE);
-
-CREATE POLICY "Users can insert own categories" ON public.categories
-  FOR INSERT WITH CHECK (auth.uid() = user_id);
-
-CREATE POLICY "Users can update own categories" ON public.categories
-  FOR UPDATE USING (auth.uid() = user_id AND is_default = FALSE);
-
-CREATE POLICY "Users can delete own categories" ON public.categories
-  FOR DELETE USING (auth.uid() = user_id AND is_default = FALSE);
-
--- Transactions policies
-CREATE POLICY "Users can view own transactions" ON public.transactions
-  FOR SELECT USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can insert own transactions" ON public.transactions
-  FOR INSERT WITH CHECK (auth.uid() = user_id);
-
-CREATE POLICY "Users can update own transactions" ON public.transactions
-  FOR UPDATE USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can delete own transactions" ON public.transactions
-  FOR DELETE USING (auth.uid() = user_id);
-
--- Budgets policies
-CREATE POLICY "Users can view own budgets" ON public.budgets
-  FOR SELECT USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can insert own budgets" ON public.budgets
-  FOR INSERT WITH CHECK (auth.uid() = user_id);
-
-CREATE POLICY "Users can update own budgets" ON public.budgets
-  FOR UPDATE USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can delete own budgets" ON public.budgets
-  FOR DELETE USING (auth.uid() = user_id);
-
--- Goals policies
-CREATE POLICY "Users can view own goals" ON public.goals
-  FOR SELECT USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can insert own goals" ON public.goals
-  FOR INSERT WITH CHECK (auth.uid() = user_id);
-
-CREATE POLICY "Users can update own goals" ON public.goals
-  FOR UPDATE USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can delete own goals" ON public.goals
-  FOR DELETE USING (auth.uid() = user_id);
-
--- User preferences policies
-CREATE POLICY "Users can view own preferences" ON public.user_preferences
-  FOR SELECT USING (auth.uid() = user_id);
-
-CREATE POLICY "Users can insert own preferences" ON public.user_preferences
-  FOR INSERT WITH CHECK (auth.uid() = user_id);
-
-CREATE POLICY "Users can update own preferences" ON public.user_preferences
-  FOR UPDATE USING (auth.uid() = user_id);
-
--- =====================================================
--- STEP 7: CREATE TRIGGER FOR NEW USER REGISTRATION
--- =====================================================
-
--- Function to handle new user registration
-CREATE OR REPLACE FUNCTION public.handle_new_user()
-RETURNS TRIGGER AS $$
-DECLARE
-  is_oauth_user BOOLEAN;
+ALTER TABLE public.accounts
+  ADD COLUMN IF NOT EXISTS is_savings boolean DEFAULT false,
+  ADD COLUMN IF NOT EXISTS interest_rate numeric(5,2) DEFAULT 0,
+  ADD COLUMN IF NOT EXISTS include_in_networth boolean DEFAULT true,
+  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;
+ALTER TABLE public.goals
+  ADD COLUMN IF NOT EXISTS is_priority boolean DEFAULT false,
+  ADD COLUMN IF NOT EXISTS category text DEFAULT 'lifestyle',
+  ADD COLUMN IF NOT EXISTS allocation_per_cycle numeric(15,2) DEFAULT 0,
+  ADD COLUMN IF NOT EXISTS allocation_frequency text DEFAULT 'monthly';
+ALTER TABLE public.transactions
+  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL;
+
+CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts(user_id);
+CREATE INDEX IF NOT EXISTS idx_categories_user_id ON public.categories(user_id);
+CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
+CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON public.transactions(account_id);
+CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
+CREATE INDEX IF NOT EXISTS idx_transactions_goal_id ON public.transactions(goal_id);
+CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON public.budgets(user_id);
+CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals(user_id);
+
+-- Only fresh tables without policies receive the compatibility policies.
+-- A deployed project's policies need a separate read-only audit before cutover.
+DO $$
+DECLARE table_name text;
+BEGIN
+  FOREACH table_name IN ARRAY ARRAY['users','accounts','categories','goals','transactions','budgets','user_preferences'] LOOP
+    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
+    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name) THEN
+      IF table_name='users' THEN
+        EXECUTE 'CREATE POLICY baseline_owner_read ON public.users FOR SELECT TO authenticated USING (auth.uid()=id)';
+        EXECUTE 'CREATE POLICY baseline_owner_update ON public.users FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id)';
+      ELSIF table_name='categories' THEN
+        EXECUTE 'CREATE POLICY baseline_category_read ON public.categories FOR SELECT TO authenticated USING (auth.uid()=user_id OR is_default=true)';
+        EXECUTE 'CREATE POLICY baseline_category_write ON public.categories FOR ALL TO authenticated USING (auth.uid()=user_id AND is_default=false) WITH CHECK (auth.uid()=user_id AND is_default=false)';
+      ELSE
+        EXECUTE format('CREATE POLICY baseline_owner_access ON public.%I FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id)', table_name);
+      END IF;
+      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
+      EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
+    END IF;
+  END LOOP;
+END $$;
+
+-- Create the registration trigger only when absent; never replace a deployed body.
+DO $setup$
 BEGIN
-  -- Check if user signed up via OAuth (Google, Facebook, etc.)
-  -- OAuth users have email_confirmed_at set automatically
-  is_oauth_user := NEW.email_confirmed_at IS NOT NULL;
-  
-  INSERT INTO public.users (id, email, username, name, avatar_url, is_verified)
-  VALUES (
-    NEW.id,
-    NEW.email,
-    COALESCE(NEW.raw_user_meta_data->>'username', LOWER(SPLIT_PART(NEW.email, '@', 1))),
-    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
-    NEW.raw_user_meta_data->>'avatar_url',
-    is_oauth_user  -- Auto-verify OAuth users
-  );
-  
-  -- Create default preferences
-  INSERT INTO public.user_preferences (user_id)
-  VALUES (NEW.id);
-  
-  -- Create default categories
-  INSERT INTO public.categories (user_id, name, type, icon, color, is_default) VALUES
-    (NEW.id, 'Salary', 'income', 'Banknote', '#22c55e', FALSE),
-    (NEW.id, 'Freelance', 'income', 'Laptop', '#3b82f6', FALSE),
-    (NEW.id, 'Other Income', 'income', 'Plus', '#6b7280', FALSE),
-    (NEW.id, 'Food & Dining', 'expense', 'UtensilsCrossed', '#f97316', FALSE),
-    (NEW.id, 'Transportation', 'expense', 'Car', '#eab308', FALSE),
-    (NEW.id, 'Shopping', 'expense', 'ShoppingBag', '#ec4899', FALSE),
-    (NEW.id, 'Bills & Utilities', 'expense', 'Receipt', '#ef4444', FALSE),
-    (NEW.id, 'Entertainment', 'expense', 'Film', '#8b5cf6', FALSE),
-    (NEW.id, 'Other Expense', 'expense', 'Minus', '#6b7280', FALSE);
-  
+  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created') THEN
+    IF to_regprocedure('public.handle_new_user()') IS NULL THEN
+      EXECUTE $function$
+        CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
+        SET search_path = pg_catalog, public AS $body$
+        BEGIN
+          INSERT INTO public.users(id,email,username,name,avatar_url,is_verified)
+          VALUES (NEW.id,NEW.email,COALESCE(NEW.raw_user_meta_data->>'username',lower(split_part(NEW.email,'@',1))),
+            COALESCE(NEW.raw_user_meta_data->>'name',NEW.raw_user_meta_data->>'full_name'),
+            NEW.raw_user_meta_data->>'avatar_url',NEW.email_confirmed_at IS NOT NULL);
+          INSERT INTO public.user_preferences(user_id) VALUES(NEW.id);
+          INSERT INTO public.categories(user_id,name,type,icon,color,is_default) VALUES
+            (NEW.id,'Salary','income','Banknote','#22c55e',false),
+            (NEW.id,'Freelance','income','Laptop','#3b82f6',false),
+            (NEW.id,'Other Income','income','Plus','#6b7280',false),
+            (NEW.id,'Food & Dining','expense','UtensilsCrossed','#f97316',false),
+            (NEW.id,'Transportation','expense','Car','#eab308',false),
+            (NEW.id,'Shopping','expense','ShoppingBag','#ec4899',false),
+            (NEW.id,'Bills & Utilities','expense','Receipt','#ef4444',false),
+            (NEW.id,'Entertainment','expense','Film','#8b5cf6',false),
+            (NEW.id,'Other Expense','expense','Minus','#6b7280',false);
+          RETURN NEW;
+        END $body$
+      $function$;
+    END IF;
+    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
+  END IF;
+END $setup$;
+COMMIT;
+
+BEGIN;
+ALTER TABLE public.goals
+  ADD COLUMN IF NOT EXISTS status text,
+  ADD COLUMN IF NOT EXISTS review_state text,
+  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
+  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
+-- Only previously uninitialized rows are migrated; reapplication keeps review decisions.
+UPDATE public.goals SET status=CASE WHEN is_completed THEN 'completed' ELSE 'active' END WHERE status IS NULL;
+UPDATE public.goals SET review_state='needs_review' WHERE review_state IS NULL;
+ALTER TABLE public.goals
+  ALTER COLUMN status SET DEFAULT 'active', ALTER COLUMN status SET NOT NULL,
+  ALTER COLUMN review_state SET DEFAULT 'confirmed', ALTER COLUMN review_state SET NOT NULL;
+DO $$ BEGIN
+  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goals'::regclass AND conname='goals_status_check') THEN
+    ALTER TABLE public.goals ADD CONSTRAINT goals_status_check CHECK(status IN ('active','completed','cancelled'));
+  END IF;
+  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goals'::regclass AND conname='goals_review_state_check') THEN
+    ALTER TABLE public.goals ADD CONSTRAINT goals_review_state_check CHECK(review_state IN ('needs_review','confirmed'));
+  END IF;
+END $$;
+CREATE UNIQUE INDEX IF NOT EXISTS goals_owner_id_key ON public.goals(user_id,id);
+CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_id_key ON public.accounts(user_id,id);
+
+CREATE TABLE IF NOT EXISTS public.financial_operations (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  request_id uuid NOT NULL,
+  command_hash text NOT NULL CHECK(command_hash ~ '^[0-9a-f]{64}$'),
+  command jsonb NOT NULL,
+  result jsonb,
+  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
+  UNIQUE(user_id,request_id), UNIQUE(user_id,id)
+);
+CREATE TABLE IF NOT EXISTS public.goal_allocation_events (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
+  goal_id uuid NOT NULL, account_id uuid NOT NULL, operation_id uuid NOT NULL,
+  kind text NOT NULL CHECK(kind IN ('reserve','release','spend','move_in','move_out','legacy_spent','reversal')),
+  -- Unconstrained numeric rejects excess scale before any numeric(15,2) rounding.
+  reserved_delta numeric NOT NULL DEFAULT 0
+    CHECK(abs(reserved_delta)<10000000000000 AND scale(reserved_delta)<=2),
+  spent_delta numeric NOT NULL DEFAULT 0
+    CHECK(abs(spent_delta)<10000000000000 AND scale(spent_delta)<=2),
+  transaction_id uuid,
+  reversal_of uuid UNIQUE,
+  created_at timestamptz NOT NULL DEFAULT now(),
+  CHECK(reserved_delta<>0 OR spent_delta<>0),
+  CHECK((kind='reversal')=(reversal_of IS NOT NULL)),
+  UNIQUE(user_id,id),
+  FOREIGN KEY(user_id,goal_id) REFERENCES public.goals(user_id,id) DEFERRABLE INITIALLY DEFERRED,
+  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) DEFERRABLE INITIALLY DEFERRED,
+  FOREIGN KEY(user_id,operation_id) REFERENCES public.financial_operations(user_id,id) DEFERRABLE INITIALLY DEFERRED,
+  FOREIGN KEY(user_id,reversal_of) REFERENCES public.goal_allocation_events(user_id,id) DEFERRABLE INITIALLY DEFERRED
+);
+CREATE INDEX IF NOT EXISTS allocation_owner_history_idx ON public.goal_allocation_events(user_id,created_at,id);
+CREATE INDEX IF NOT EXISTS allocation_goal_history_idx ON public.goal_allocation_events(user_id,goal_id,created_at,id);
+CREATE INDEX IF NOT EXISTS allocation_account_history_idx ON public.goal_allocation_events(user_id,account_id,created_at,id);
+CREATE INDEX IF NOT EXISTS allocation_operation_idx ON public.goal_allocation_events(operation_id);
+CREATE INDEX IF NOT EXISTS allocation_transaction_idx ON public.goal_allocation_events(user_id,transaction_id) WHERE transaction_id IS NOT NULL;
+CREATE INDEX IF NOT EXISTS operations_owner_history_idx ON public.financial_operations(user_id,created_at,id);
+
+CREATE OR REPLACE FUNCTION public.check_allocation_transaction_owner()
+RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+BEGIN
+  IF NEW.transaction_id IS NOT NULL THEN
+    IF EXISTS(SELECT 1 FROM public.transactions WHERE id=NEW.transaction_id AND user_id=NEW.user_id) THEN
+      RETURN NEW;
+    END IF;
+    -- Reversals retain a deleted transaction UUID only through its same-owner source.
+    IF NEW.kind='reversal' AND EXISTS(
+      SELECT 1 FROM public.goal_allocation_events
+      WHERE id=NEW.reversal_of AND user_id=NEW.user_id AND transaction_id=NEW.transaction_id
+    ) THEN
+      RETURN NEW;
+    END IF;
+    RAISE EXCEPTION 'Allocation transaction must belong to the event owner' USING ERRCODE='23503';
+  END IF;
   RETURN NEW;
-END;
-$$ LANGUAGE plpgsql SECURITY DEFINER;
-
--- Trigger for new user registration
-CREATE TRIGGER on_auth_user_created
-  AFTER INSERT ON auth.users
-  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-
--- =====================================================
--- DATABASE RESET COMPLETE!
--- =====================================================
--- Your database has been completely reset and is ready to use.
--- You can now register new users and start using the application.
+END $$;
+CREATE OR REPLACE FUNCTION public.prevent_allocation_history_change()
+RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
+BEGIN
+  -- Whole-user erasure cascades after the profile disappears; standalone deletion is forbidden.
+  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN
+    RETURN OLD;
+  END IF;
+  RAISE EXCEPTION 'Allocation history is append-only' USING ERRCODE='55000';
+END $$;
+REVOKE ALL ON FUNCTION public.check_allocation_transaction_owner() FROM PUBLIC;
+REVOKE ALL ON FUNCTION public.prevent_allocation_history_change() FROM PUBLIC;
+DO $$ BEGIN
+  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.goal_allocation_events'::regclass AND tgname='allocation_transaction_owner') THEN
+    CREATE TRIGGER allocation_transaction_owner BEFORE INSERT ON public.goal_allocation_events
+      FOR EACH ROW EXECUTE FUNCTION public.check_allocation_transaction_owner();
+  END IF;
+  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.goal_allocation_events'::regclass AND tgname='allocation_history_immutable') THEN
+    CREATE TRIGGER allocation_history_immutable BEFORE UPDATE OR DELETE ON public.goal_allocation_events
+      FOR EACH ROW EXECUTE FUNCTION public.prevent_allocation_history_change();
+  END IF;
+END $$;
+ALTER TABLE public.goal_allocation_events ENABLE ROW LEVEL SECURITY;
+ALTER TABLE public.financial_operations ENABLE ROW LEVEL SECURITY;
+DO $$ BEGIN
+  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='goal_allocation_events' AND policyname='allocation_owner_read') THEN
+    CREATE POLICY allocation_owner_read ON public.goal_allocation_events FOR SELECT TO authenticated USING(auth.uid()=user_id);
+  END IF;
+  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='financial_operations' AND policyname='operation_owner_read') THEN
+    CREATE POLICY operation_owner_read ON public.financial_operations FOR SELECT TO authenticated USING(auth.uid()=user_id);
+  END IF;
+END $$;
+REVOKE ALL ON public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
+GRANT SELECT ON public.goal_allocation_events,public.financial_operations TO authenticated;
+GRANT ALL ON public.goal_allocation_events,public.financial_operations TO service_role;
+NOTIFY pgrst, 'reload schema';
+COMMIT;
diff --git a/tests/database/helpers.mjs b/tests/database/helpers.mjs
new file mode 100644
index 0000000..519bcc0
--- /dev/null
+++ b/tests/database/helpers.mjs
@@ -0,0 +1,122 @@
+import { randomUUID } from 'node:crypto';
+import { readFile } from 'node:fs/promises';
+import { resolve } from 'node:path';
+import { pathToFileURL } from 'node:url';
+import { execFile } from 'node:child_process';
+import { promisify } from 'node:util';
+import { createClient } from '@supabase/supabase-js';
+
+const executeFile = promisify(execFile);
+let runtime;
+
+export async function databaseRuntime() {
+  if (runtime) return runtime;
+  const required = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY'];
+  const missing = required.filter((key) => !process.env[key]);
+  if (missing.length) throw new Error(`Disposable database tests require ${missing.join(', ')}. Never use a live project.`);
+  if (process.env.TEST_DATABASE_DISPOSABLE !== 'true') {
+    throw new Error('Set TEST_DATABASE_DISPOSABLE=true only for an isolated disposable database. Tests create users and apply migrations.');
+  }
+  const adapter = process.env.TEST_DATABASE_ADAPTER
+    ? await import(pathToFileURL(resolve(process.env.TEST_DATABASE_ADAPTER)).href)
+    : null;
+  const url = process.env.TEST_SUPABASE_URL;
+  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
+  const admin = createClient(url, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, options);
+  const queryAdmin = adapter?.queryAdmin ?? (async (sql, params = []) => {
+    if (!process.env.TEST_DATABASE_URL) throw new Error('Migration tests require TEST_DATABASE_URL and psql, or TEST_DATABASE_ADAPTER with queryAdmin.');
+    if (params.length) throw new Error('The psql adapter accepts complete migration SQL only.');
+    const isQuery = /^\s*SELECT\b/i.test(sql);
+    const command = isQuery ? `SELECT COALESCE(json_agg(result), '[]'::json) FROM (${sql.trim().replace(/;$/, '')}) result` : sql;
+    let connection;
+    try { connection = new URL(process.env.TEST_DATABASE_URL); }
+    catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URI.'); }
+    if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('TEST_DATABASE_URL must use postgres:// or postgresql://.');
+    const sqlEnvironment = {
+      ...process.env,
+      PGHOST: connection.hostname,
+      PGPORT: connection.port || '5432',
+      PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
+      PGUSER: decodeURIComponent(connection.username),
+      PGPASSWORD: decodeURIComponent(connection.password),
+    };
+    const connectionOptions = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', connect_timeout: 'PGCONNECT_TIMEOUT', options: 'PGOPTIONS', application_name: 'PGAPPNAME' };
+    for (const [parameter, variable] of Object.entries(connectionOptions)) {
+      if (connection.searchParams.has(parameter)) sqlEnvironment[variable] = connection.searchParams.get(parameter);
+    }
+    const { stdout } = await executeFile(process.env.TEST_PSQL_PATH || 'psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', command], {
+      env: sqlEnvironment, maxBuffer: 4 * 1024 * 1024,
+    });
+    return { rows: isQuery ? JSON.parse(stdout.trim()) : [] };
+  });
+  runtime = { adapter, admin, queryAdmin: async (...args) => {
+    const result = await queryAdmin(...args);
+    return result.rows ?? result;
+  }, url, options };
+  return runtime;
+}
+
+export async function applyMigration(filename) {
+  const { queryAdmin } = await databaseRuntime();
+  const sql = await readFile(new URL(`../../supabase/migrations/${filename}`, import.meta.url), 'utf8');
+  await queryAdmin(sql);
+  await queryAdmin("NOTIFY pgrst, 'reload schema'");
+  // PostgREST reloads its schema asynchronously after the transaction commits.
+  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
+}
+
+export function requireSuccess(result, context = 'Database request') {
+  if (result.error) throw new Error(`${context}: ${result.error.code}: ${result.error.message}`);
+  return result.data;
+}
+
+export async function createFinanceFixture() {
+  const { adapter, admin, url, options } = await databaseRuntime();
+  const fixture = { admin, users: [], owner: null, other: null };
+  try {
+    for (const label of ['owner', 'other']) {
+      const email = `goal-ledger-${randomUUID()}@example.test`;
+      let identity;
+      if (adapter) identity = await adapter.createUser(email);
+      else {
+        const password = `${randomUUID()}Aa1!`;
+        const created = requireSuccess(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create disposable user');
+        fixture.users.push(created.user.id);
+        const client = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
+        const signedIn = requireSuccess(await client.auth.signInWithPassword({ email, password }), 'Sign in disposable user');
+        identity = { id: created.user.id, accessToken: signedIn.session.access_token };
+      }
+      if (!fixture.users.includes(identity.id)) fixture.users.push(identity.id);
+      const client = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, {
+        ...options, global: { headers: { Authorization: `Bearer ${identity.accessToken}` } },
+      });
+      requireSuccess(await admin.from('users').upsert({ id: identity.id, email, username: `test_${identity.id}`, name: label }), 'Create profile');
+      const account = requireSuccess(await client.from('accounts').insert({ user_id: identity.id, name: 'Cash', type: 'cash', balance: '30000.00' }).select().single());
+      const goal = requireSuccess(await client.from('goals').insert({ user_id: identity.id, name: 'Laptop', target_amount: '5000.00' }).select().single());
+      fixture[label] = { ...identity, client, account, goal };
+    }
+    return fixture;
+  } catch (error) {
+    await cleanupFinanceFixture(fixture);
+    throw error;
+  }
+}
+
+export async function cleanupFinanceFixture(fixture) {
+  const { adapter, admin } = await databaseRuntime();
+  for (const userId of [...fixture.users].reverse()) {
+    if (adapter) await adapter.deleteUser(userId);
+    else requireSuccess(await admin.auth.admin.deleteUser(userId), 'Delete disposable user');
+  }
+}
+
+export async function insertOperation(fixture, userId = fixture.owner.id, overrides = {}) {
+  return requireSuccess(await fixture.admin.from('financial_operations').insert({
+    user_id: userId, request_id: randomUUID(), command_hash: 'a'.repeat(64), command: { kind: 'reserve' }, ...overrides,
+  }).select().single());
+}
+
+export function eventInput(fixture, operation, overrides = {}) {
+  return { user_id: fixture.owner.id, goal_id: fixture.owner.goal.id, account_id: fixture.owner.account.id,
+    operation_id: operation.id, kind: 'reserve', reserved_delta: '10.00', spent_delta: '0.00', ...overrides };
+}
diff --git a/tests/database/ledger.test.mjs b/tests/database/ledger.test.mjs
new file mode 100644
index 0000000..7ff54e0
--- /dev/null
+++ b/tests/database/ledger.test.mjs
@@ -0,0 +1,138 @@
+import assert from 'node:assert/strict';
+import { after, before, test } from 'node:test';
+import { randomUUID } from 'node:crypto';
+import { cleanupFinanceFixture, createFinanceFixture, databaseRuntime, eventInput, insertOperation, requireSuccess } from './helpers.mjs';
+
+let fixture;
+before(async () => { fixture = await createFinanceFixture(); });
+after(async () => { if (fixture) await cleanupFinanceFixture(fixture); });
+
+test('owner-scoped allocation reads', async () => {
+  const operation = await insertOperation(fixture);
+  const inserted = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)).select().single());
+  const ownerEvents = requireSuccess(await fixture.owner.client.from('goal_allocation_events').select('*').eq('id', inserted.id));
+  const otherUserEvents = requireSuccess(await fixture.other.client.from('goal_allocation_events').select('*').eq('id', inserted.id));
+  assert.equal(ownerEvents.length, 1);
+  assert.equal(otherUserEvents.length, 0);
+  const otherOperations = requireSuccess(await fixture.other.client.from('financial_operations').select('*').eq('id', operation.id));
+  assert.equal(otherOperations.length, 0);
+});
+
+test('allocation references enforce the same owner', async () => {
+  const operation = await insertOperation(fixture);
+  const otherOperation = await insertOperation(fixture, fixture.other.id);
+  for (const overrides of [{ goal_id: fixture.other.goal.id }, { account_id: fixture.other.account.id }, { operation_id: otherOperation.id }]) {
+    const result = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, overrides));
+    assert.equal(result.error?.code, '23503');
+  }
+});
+
+test('invalid precision, zero values, and unknown kinds are rejected', async () => {
+  const operation = await insertOperation(fixture);
+  for (const overrides of [{ reserved_delta: '0.001' }, { spent_delta: '0.001' }, { reserved_delta: '10000000000000.00' }, { reserved_delta: '0.00' }, { reserved_delta: 'NaN' }, { kind: 'unknown' }]) {
+    const result = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, overrides));
+    assert.equal(result.error?.code, '23514', JSON.stringify(overrides));
+  }
+  const result = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { reserved_delta: '0.01' })).select().single();
+  assert.equal(requireSuccess(result).reserved_delta, 0.01);
+});
+
+test('request IDs are unique per owner', async () => {
+  const requestId = randomUUID();
+  await insertOperation(fixture, fixture.owner.id, { request_id: requestId });
+  const duplicate = await fixture.admin.from('financial_operations').insert({ user_id: fixture.owner.id, request_id: requestId, command_hash: 'a'.repeat(64), command: {} });
+  assert.equal(duplicate.error?.code, '23505');
+  await insertOperation(fixture, fixture.other.id, { request_id: requestId });
+});
+
+test('allocation writes are restricted and history is immutable', async () => {
+  const operation = await insertOperation(fixture);
+  const blocked = await fixture.owner.client.from('goal_allocation_events').insert(eventInput(fixture, operation));
+  assert.equal(blocked.error?.code, '42501');
+  const blockedOperation = await fixture.owner.client.from('financial_operations').insert({ user_id: fixture.owner.id, request_id: randomUUID(), command_hash: 'a'.repeat(64), command: {} });
+  assert.equal(blockedOperation.error?.code, '42501');
+  const event = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)).select().single());
+  const update = await fixture.admin.from('goal_allocation_events').update({ reserved_delta: '20.00' }).eq('id', event.id);
+  const deletion = await fixture.admin.from('goal_allocation_events').delete().eq('id', event.id);
+  assert.equal(update.error?.code, '55000');
+  assert.equal(deletion.error?.code, '55000');
+  const accountDeletion = await fixture.admin.from('accounts').delete().eq('id', fixture.owner.account.id);
+  assert.equal(accountDeletion.error?.code, '23503');
+  const goalDeletion = await fixture.admin.from('goals').delete().eq('id', fixture.owner.goal.id);
+  assert.equal(goalDeletion.error?.code, '23503');
+});
+
+test('transaction deletion retains the original event reference', async () => {
+  const operation = await insertOperation(fixture);
+  const transaction = requireSuccess(await fixture.admin.from('transactions').insert({ user_id: fixture.owner.id, account_id: fixture.owner.account.id, type: 'expense', amount: '10.00', date: '2026-10-06' }).select().single());
+  const event = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { kind: 'spend', reserved_delta: '-10.00', spent_delta: '10.00', transaction_id: transaction.id })).select().single());
+  requireSuccess(await fixture.admin.from('transactions').delete().eq('id', transaction.id));
+  const retained = requireSuccess(await fixture.owner.client.from('goal_allocation_events').select('*').eq('id', event.id).single());
+  assert.equal(retained.transaction_id, transaction.id);
+  const reversal = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, {
+    kind: 'reversal', reserved_delta: '10.00', spent_delta: '-10.00', transaction_id: transaction.id, reversal_of: event.id,
+  })).select().single());
+  assert.equal(reversal.transaction_id, transaction.id);
+  const invented = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { transaction_id: randomUUID() }));
+  assert.equal(invented.error?.code, '23503');
+  const otherTransaction = requireSuccess(await fixture.admin.from('transactions').insert({ user_id: fixture.other.id, account_id: fixture.other.account.id, type: 'expense', amount: '10.00', date: '2026-10-06' }).select().single());
+  const wrongOwner = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { transaction_id: otherTransaction.id }));
+  assert.equal(wrongOwner.error?.code, '23503');
+});
+
+test('one event can be reversed once by the same owner', async () => {
+  const operation = await insertOperation(fixture);
+  const event = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)).select().single());
+  const reversal = eventInput(fixture, operation, { kind: 'reversal', reserved_delta: '-10.00', reversal_of: event.id });
+  requireSuccess(await fixture.admin.from('goal_allocation_events').insert(reversal));
+  assert.equal((await fixture.admin.from('goal_allocation_events').insert(reversal)).error?.code, '23505');
+  const otherOp = await insertOperation(fixture, fixture.other.id);
+  const otherEvent = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, otherOp, { user_id: fixture.other.id, goal_id: fixture.other.goal.id, account_id: fixture.other.account.id })).select().single());
+  assert.equal((await fixture.admin.from('goal_allocation_events').insert({ ...reversal, reversal_of: otherEvent.id })).error?.code, '23503');
+});
+
+test('new goals default to confirmed active lifecycle', async () => {
+  const goal = requireSuccess(await fixture.owner.client.from('goals').select('*').eq('id', fixture.owner.goal.id).single());
+  assert.equal(goal.status, 'active');
+  assert.equal(goal.review_state, 'confirmed');
+  assert.equal(goal.completed_at, null);
+  assert.equal(goal.archived_at, null);
+});
+
+test('upgrade preserves legacy finances', async () => {
+  const { queryAdmin } = await databaseRuntime();
+  // An isolated schema exercises first upgrade and reapplication without resetting public tables.
+  const schema = `ledger_upgrade_${randomUUID().replaceAll('-', '')}`;
+  const owner = fixture.owner.id;
+  await queryAdmin(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.users (LIKE public.users INCLUDING ALL); INSERT INTO ${schema}.users SELECT * FROM public.users WHERE id='${owner}';`);
+  try {
+    const baseline = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../supabase/migrations/202610060001_runtime_baseline.sql', import.meta.url), 'utf8'));
+    const ledger = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../supabase/migrations/202610060002_goal_allocation_ledger.sql', import.meta.url), 'utf8'));
+    // The migration only uses explicit public references; rewrite them for this disposable schema.
+    const inSchema = (sql) => sql.replaceAll('public.', `${schema}.`).replaceAll("'public'", `'${schema}'`).replaceAll('SCHEMA public', `SCHEMA ${schema}`);
+    await queryAdmin(inSchema(baseline));
+    await queryAdmin(`INSERT INTO ${schema}.accounts(id,user_id,name,type,balance) VALUES ('00000000-0000-0000-0000-000000000001','${owner}','Legacy wallet','cash',30000.37); INSERT INTO ${schema}.goals(id,user_id,name,target_amount,current_amount,is_completed) VALUES ('00000000-0000-0000-0000-000000000002','${owner}','Legacy completed',5000,2345.67,true); INSERT INTO ${schema}.transactions(user_id,account_id,goal_id,type,amount,date) VALUES ('${owner}','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','expense',123.45,'2026-10-06');`);
+    const snapshot = async () => {
+      const result = await queryAdmin(`SELECT jsonb_build_object('balances',(SELECT jsonb_agg(balance::text ORDER BY id) FROM ${schema}.accounts),'tags',(SELECT jsonb_agg(jsonb_build_object('goal_id',goal_id,'amount',amount::text) ORDER BY id) FROM ${schema}.transactions),'legacy',(SELECT jsonb_agg(jsonb_build_object('current_amount',current_amount::text,'is_completed',is_completed) ORDER BY id) FROM ${schema}.goals)) AS snapshot;`);
+      if (!Array.isArray(result)) throw new Error('Upgrade test needs queryAdmin returning row arrays; use TEST_DATABASE_ADAPTER.');
+      return result[0].snapshot;
+    };
+    const before = await snapshot();
+    await queryAdmin(inSchema(baseline));
+    assert.deepEqual(await snapshot(), before);
+    await queryAdmin(inSchema(ledger));
+    const after = await snapshot();
+    assert.deepEqual(after.balances, before.balances);
+    assert.deepEqual(after.tags, before.tags);
+    assert.deepEqual(after.legacy, before.legacy);
+    let rows = await queryAdmin(`SELECT review_state,status FROM ${schema}.goals;`);
+    assert.deepEqual(rows, [{ review_state: 'needs_review', status: 'completed' }]);
+    await queryAdmin(`UPDATE ${schema}.goals SET review_state='confirmed',status='cancelled';`);
+    await queryAdmin(inSchema(ledger));
+    rows = await queryAdmin(`SELECT review_state,status FROM ${schema}.goals;`);
+    assert.deepEqual(rows, [{ review_state: 'confirmed', status: 'cancelled' }]);
+    assert.deepEqual((await snapshot()).balances, before.balances);
+    const events = await queryAdmin(`SELECT count(*)::int AS count FROM ${schema}.goal_allocation_events;`);
+    assert.equal(events[0].count, 0);
+  } finally { await queryAdmin(`DROP SCHEMA ${schema} CASCADE;`); }
+});
