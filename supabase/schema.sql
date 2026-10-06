-- Safe reproducible schema: runtime baseline, goal ledger, and reservation operations.
-- Source of truth: the ordered supabase/migrations files.

-- Additive runtime baseline. Requires Supabase auth.users/auth.uid() and its roles.
-- Existing functions, grants, policies, financial values, and auth users are retained.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL, username text UNIQUE NOT NULL,
  name text, avatar_url text, is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('cash','bank','credit_card','e_wallet','investment')),
  balance numeric(15,2) DEFAULT 0, currency text DEFAULT 'PHP', color text, icon text,
  is_active boolean DEFAULT true, is_savings boolean DEFAULT false,
  interest_rate numeric(5,2) DEFAULT 0, include_in_networth boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL, type text NOT NULL CHECK (type IN ('income','expense')),
  color text, icon text, is_default boolean DEFAULT false, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL, target_amount numeric(15,2) NOT NULL,
  current_amount numeric(15,2) DEFAULT 0, target_date date, color text, icon text,
  is_completed boolean DEFAULT false, is_priority boolean DEFAULT false,
  category text DEFAULT 'lifestyle', allocation_per_cycle numeric(15,2) DEFAULT 0,
  allocation_frequency text DEFAULT 'monthly',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount numeric(15,2) NOT NULL, description text, date date NOT NULL,
  transfer_to_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL,
  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly','monthly','yearly')),
  start_date date NOT NULL, end_date date,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  currency text DEFAULT 'PHP', theme text DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  language text DEFAULT 'en', notifications_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_savings boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS interest_rate numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS include_in_networth boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS is_priority boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'lifestyle',
  ADD COLUMN IF NOT EXISTS allocation_per_cycle numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocation_frequency text DEFAULT 'monthly';
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON public.categories(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_goal_id ON public.transactions(goal_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON public.budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals(user_id);

-- Only fresh tables without policies receive the compatibility policies.
-- A deployed project's policies need a separate read-only audit before cutover.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','accounts','categories','goals','transactions','budgets','user_preferences'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name) THEN
      IF table_name='users' THEN
        EXECUTE 'CREATE POLICY baseline_owner_read ON public.users FOR SELECT TO authenticated USING (auth.uid()=id)';
        EXECUTE 'CREATE POLICY baseline_owner_update ON public.users FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id)';
      ELSIF table_name='categories' THEN
        EXECUTE 'CREATE POLICY baseline_category_read ON public.categories FOR SELECT TO authenticated USING (auth.uid()=user_id OR is_default=true)';
        EXECUTE 'CREATE POLICY baseline_category_write ON public.categories FOR ALL TO authenticated USING (auth.uid()=user_id AND is_default=false) WITH CHECK (auth.uid()=user_id AND is_default=false)';
      ELSE
        EXECUTE format('CREATE POLICY baseline_owner_access ON public.%I FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id)', table_name);
      END IF;
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END $$;

-- Create the registration trigger only when absent; never replace a deployed body.
DO $setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created') THEN
    IF to_regprocedure('public.handle_new_user()') IS NULL THEN
      EXECUTE $function$
        CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, public AS $body$
        BEGIN
          INSERT INTO public.users(id,email,username,name,avatar_url,is_verified)
          VALUES (NEW.id,NEW.email,COALESCE(NEW.raw_user_meta_data->>'username',lower(split_part(NEW.email,'@',1))),
            COALESCE(NEW.raw_user_meta_data->>'name',NEW.raw_user_meta_data->>'full_name'),
            NEW.raw_user_meta_data->>'avatar_url',NEW.email_confirmed_at IS NOT NULL);
          INSERT INTO public.user_preferences(user_id) VALUES(NEW.id);
          INSERT INTO public.categories(user_id,name,type,icon,color,is_default) VALUES
            (NEW.id,'Salary','income','Banknote','#22c55e',false),
            (NEW.id,'Freelance','income','Laptop','#3b82f6',false),
            (NEW.id,'Other Income','income','Plus','#6b7280',false),
            (NEW.id,'Food & Dining','expense','UtensilsCrossed','#f97316',false),
            (NEW.id,'Transportation','expense','Car','#eab308',false),
            (NEW.id,'Shopping','expense','ShoppingBag','#ec4899',false),
            (NEW.id,'Bills & Utilities','expense','Receipt','#ef4444',false),
            (NEW.id,'Entertainment','expense','Film','#8b5cf6',false),
            (NEW.id,'Other Expense','expense','Minus','#6b7280',false);
          RETURN NEW;
        END $body$
      $function$;
    END IF;
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
  END IF;
END $setup$;
COMMIT;

BEGIN;
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS review_state text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- Only previously uninitialized rows are migrated; reapplication keeps review decisions.
UPDATE public.goals SET status=CASE WHEN is_completed THEN 'completed' ELSE 'active' END WHERE status IS NULL;
UPDATE public.goals SET review_state='needs_review' WHERE review_state IS NULL;
ALTER TABLE public.goals
  ALTER COLUMN status SET DEFAULT 'active', ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN review_state SET DEFAULT 'confirmed', ALTER COLUMN review_state SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goals'::regclass AND conname='goals_status_check') THEN
    ALTER TABLE public.goals ADD CONSTRAINT goals_status_check CHECK(status IN ('active','completed','cancelled'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goals'::regclass AND conname='goals_review_state_check') THEN
    ALTER TABLE public.goals ADD CONSTRAINT goals_review_state_check CHECK(review_state IN ('needs_review','confirmed'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS goals_owner_id_key ON public.goals(user_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_id_key ON public.accounts(user_id,id);

CREATE TABLE IF NOT EXISTS public.financial_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  command_hash text NOT NULL CHECK(command_hash ~ '^[0-9a-f]{64}$'),
  command jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(user_id,request_id), UNIQUE(user_id,id)
);
CREATE TABLE IF NOT EXISTS public.goal_allocation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL, account_id uuid NOT NULL, operation_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('reserve','release','spend','move_in','move_out','legacy_spent','reversal')),
  -- Unconstrained numeric rejects excess scale before any numeric(15,2) rounding.
  reserved_delta numeric NOT NULL DEFAULT 0
    CHECK(abs(reserved_delta)<10000000000000 AND scale(reserved_delta)<=2),
  spent_delta numeric NOT NULL DEFAULT 0
    CHECK(abs(spent_delta)<10000000000000 AND scale(spent_delta)<=2),
  transaction_id uuid,
  reversal_of uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(reserved_delta<>0 OR spent_delta<>0),
  CHECK((kind='reversal')=(reversal_of IS NOT NULL)),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,goal_id) REFERENCES public.goals(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,operation_id) REFERENCES public.financial_operations(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,reversal_of) REFERENCES public.goal_allocation_events(user_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS allocation_owner_history_idx ON public.goal_allocation_events(user_id,created_at,id);
CREATE INDEX IF NOT EXISTS allocation_goal_history_idx ON public.goal_allocation_events(user_id,goal_id,created_at,id);
CREATE INDEX IF NOT EXISTS allocation_account_history_idx ON public.goal_allocation_events(user_id,account_id,created_at,id);
CREATE INDEX IF NOT EXISTS allocation_operation_idx ON public.goal_allocation_events(operation_id);
CREATE INDEX IF NOT EXISTS allocation_transaction_idx ON public.goal_allocation_events(user_id,transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operations_owner_history_idx ON public.financial_operations(user_id,created_at,id);

CREATE OR REPLACE FUNCTION public.check_allocation_transaction_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.transactions WHERE id=NEW.transaction_id AND user_id=NEW.user_id) THEN
      RETURN NEW;
    END IF;
    -- Reversals retain a deleted transaction UUID only through its same-owner source.
    IF NEW.kind='reversal' AND EXISTS(
      SELECT 1 FROM public.goal_allocation_events
      WHERE id=NEW.reversal_of AND user_id=NEW.user_id AND transaction_id=NEW.transaction_id
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Allocation transaction must belong to the event owner' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.prevent_allocation_history_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  -- Whole-user erasure cascades after the profile disappears; standalone deletion is forbidden.
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Allocation history is append-only' USING ERRCODE='55000';
END $$;
REVOKE ALL ON FUNCTION public.check_allocation_transaction_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_allocation_history_change() FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.goal_allocation_events'::regclass AND tgname='allocation_transaction_owner') THEN
    CREATE TRIGGER allocation_transaction_owner BEFORE INSERT ON public.goal_allocation_events
      FOR EACH ROW EXECUTE FUNCTION public.check_allocation_transaction_owner();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.goal_allocation_events'::regclass AND tgname='allocation_history_immutable') THEN
    CREATE TRIGGER allocation_history_immutable BEFORE UPDATE OR DELETE ON public.goal_allocation_events
      FOR EACH ROW EXECUTE FUNCTION public.prevent_allocation_history_change();
  END IF;
END $$;
ALTER TABLE public.goal_allocation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_operations ENABLE ROW LEVEL SECURITY;
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
GRANT SELECT,INSERT,UPDATE,DELETE ON public.goal_allocation_events,public.financial_operations TO service_role;
REVOKE TRUNCATE ON public.goal_allocation_events,public.financial_operations FROM service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

BEGIN;
CREATE OR REPLACE FUNCTION public.goal_finance_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  WITH owned_goals AS (
    SELECT * FROM public.goals WHERE user_id=v_owner
  ), owned_accounts AS (
    SELECT * FROM public.accounts WHERE user_id=v_owner
  ), allocations AS (
    SELECT e.goal_id,e.account_id,sum(e.reserved_delta) AS reserved,sum(e.spent_delta) AS spent
    FROM public.goal_allocation_events e
    JOIN owned_goals g ON g.id=e.goal_id
    JOIN owned_accounts a ON a.id=e.account_id
    WHERE e.user_id=v_owner GROUP BY e.goal_id,e.account_id
  ), totals AS (
    SELECT goal_id,sum(reserved) AS reserved,sum(spent) AS spent,
      coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'amount',round(reserved,2)::text)
        ORDER BY account_id) FILTER (WHERE reserved>0),'[]'::jsonb) AS wallets
    FROM allocations GROUP BY goal_id
  ), legacy AS (
    SELECT t.goal_id,sum(t.amount) AS amount FROM public.transactions t
    JOIN owned_goals g ON g.id=t.goal_id
    WHERE t.user_id=v_owner AND g.review_state='needs_review' AND t.type IN ('expense','transfer')
    GROUP BY t.goal_id
  ), goal_rows AS (
    SELECT g.id,to_jsonb(g) || jsonb_build_object(
      'target_amount',round(g.target_amount,2)::text,
      'current_amount',round(coalesce(g.current_amount,0),2)::text,
      'allocation_per_cycle',round(coalesce(g.allocation_per_cycle,0),2)::text,
      'goalId',g.id,'reserved',round(coalesce(t.reserved,0),2)::text,
      'spent',round(coalesce(t.spent,0),2)::text,
      'progressAmount',round(coalesce(t.reserved,0)+coalesce(t.spent,0),2)::text,
      'remaining',round(greatest(0,g.target_amount-coalesce(t.reserved,0)-coalesce(t.spent,0)),2)::text,
      'progressPercent',CASE WHEN g.target_amount>0 THEN least(100,
        (coalesce(t.reserved,0)+coalesce(t.spent,0))/g.target_amount*100) ELSE 0 END,
      'walletReservations',coalesce(t.wallets,'[]'::jsonb),
      'legacyTaggedAmount',CASE WHEN g.review_state='needs_review' THEN round(coalesce(l.amount,0),2)::text ELSE NULL END
    ) AS data FROM owned_goals g LEFT JOIN totals t ON t.goal_id=g.id LEFT JOIN legacy l ON l.goal_id=g.id
  ), wallet_rows AS (
    SELECT a.id,jsonb_build_object('accountId',a.id,'actual',round(coalesce(a.balance,0),2)::text,
      'reserved',round(coalesce(sum(e.reserved),0),2)::text,
      'available',round(coalesce(a.balance,0)-coalesce(sum(e.reserved),0),2)::text) AS data
    FROM owned_accounts a LEFT JOIN allocations e ON e.account_id=a.id GROUP BY a.id,a.balance
  )
  SELECT jsonb_build_object('goals',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM goal_rows),'[]'::jsonb),
    'wallets',coalesce((SELECT jsonb_agg(data ORDER BY id) FROM wallet_rows),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_kind text;
  v_goal uuid;
  v_destination uuid;
  v_account uuid;
  v_amount numeric;
  v_hash text;
  v_previous public.financial_operations%ROWTYPE;
  v_wallet public.accounts%ROWTYPE;
  v_source public.goals%ROWTYPE;
  v_target public.goals%ROWTYPE;
  v_reserved numeric;
  v_operation uuid;
  v_result jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  v_kind := p_command->>'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('reserve','release','reallocate') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF NOT p_command ?& ARRAY['kind','goalId','accountId','amount']
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE k NOT IN ('kind','goalId','accountId','amount','destinationGoalId'))
    OR (v_kind='reallocate' AND NOT p_command ? 'destinationGoalId')
    OR (v_kind<>'reallocate' AND p_command ? 'destinationGoalId')
    OR jsonb_typeof(p_command->'kind')<>'string'
    OR jsonb_typeof(p_command->'goalId')<>'string'
    OR jsonb_typeof(p_command->'accountId')<>'string'
    OR jsonb_typeof(p_command->'amount')<>'string'
    OR (v_kind='reallocate' AND jsonb_typeof(p_command->'destinationGoalId')<>'string')
    OR (p_command->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  BEGIN
    v_goal := (p_command->>'goalId')::uuid;
    v_account := (p_command->>'accountId')::uuid;
    IF v_kind='reallocate' THEN v_destination := (p_command->>'destinationGoalId')::uuid; END IF;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE';
  END;
  v_amount := (p_command->>'amount')::numeric;
  IF v_amount<=0 OR v_amount>=10000000000000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_hash := encode(sha256(convert_to(p_command::text,'UTF8')),'hex');

  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
  IF FOUND THEN
    IF v_previous.command_hash<>v_hash OR v_previous.command<>p_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    RETURN v_previous.result || jsonb_build_object('replayed',true);
  END IF;

  PERFORM id FROM public.goals WHERE user_id=v_owner AND id IN (v_goal,v_destination) ORDER BY id FOR UPDATE;
  PERFORM id FROM public.accounts WHERE user_id=v_owner AND id=v_account ORDER BY id FOR UPDATE;
  SELECT * INTO v_wallet FROM public.accounts WHERE user_id=v_owner AND id=v_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO v_source FROM public.goals WHERE user_id=v_owner AND id=v_goal;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF v_wallet.type='credit_card' OR v_wallet.currency IS DISTINCT FROM 'PHP' OR v_wallet.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF v_source.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
  IF v_source.status<>'active' OR v_source.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_kind='reallocate' THEN
    SELECT * INTO v_target FROM public.goals WHERE user_id=v_owner AND id=v_destination;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_target.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
    IF v_target.status<>'active' OR v_target.archived_at IS NOT NULL OR v_goal=v_destination THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  END IF;
  IF v_kind='reserve' THEN
    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_account;
    IF coalesce(v_wallet.balance,0)-v_reserved<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
  ELSE
    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal AND account_id=v_account;
    IF v_reserved<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
  END IF;

  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
    VALUES(v_owner,p_request_id,v_hash,p_command) RETURNING id INTO v_operation;
  INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
    VALUES(v_owner,v_goal,v_account,v_operation,
      CASE v_kind WHEN 'reallocate' THEN 'move_out' ELSE v_kind END,
      CASE v_kind WHEN 'reserve' THEN v_amount ELSE -v_amount END);
  IF v_kind='reallocate' THEN
    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
      VALUES(v_owner,v_destination,v_account,v_operation,'move_in',v_amount);
  END IF;
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
