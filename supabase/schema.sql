-- Safe reproducible schema: runtime baseline and ordered goal finance migrations.
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

BEGIN;
-- Keep the reservation lane private while adding transactions to the public dispatcher.
DO $$ BEGIN
  IF to_regprocedure('public.goal_reservation_apply(uuid,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_reservation_apply;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.goal_reservation_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.goal_normalize_transaction(p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v jsonb; v_moves jsonb; v_date date; v_count integer;
BEGIN
  IF p_draft IS NULL OR jsonb_typeof(p_draft)<>'object'
    OR NOT p_draft ?& ARRAY['type','accountId','transferToAccountId','categoryId','goalId','amount','description','date','installments','reservationMoves']
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_draft) k WHERE k NOT IN ('type','accountId','transferToAccountId','categoryId','goalId','amount','description','date','installments','reservationMoves'))
    OR jsonb_typeof(p_draft->'type')<>'string' OR p_draft->>'type' NOT IN ('income','expense','transfer')
    OR jsonb_typeof(p_draft->'amount')<>'string' OR (p_draft->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
    OR (p_draft->>'amount')::numeric<=0 OR (p_draft->>'amount')::numeric>=10000000000000
    OR jsonb_typeof(p_draft->'date')<>'string' OR p_draft->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(p_draft->'description') NOT IN ('null','string')
    OR jsonb_typeof(p_draft->'reservationMoves')<>'array'
    OR jsonb_typeof(p_draft->'accountId')<>'string'
    OR jsonb_typeof(p_draft->'transferToAccountId') NOT IN ('null','string')
    OR jsonb_typeof(p_draft->'categoryId') NOT IN ('null','string')
    OR jsonb_typeof(p_draft->'goalId') NOT IN ('null','string') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  BEGIN
    v_date := (p_draft->>'date')::date;
    IF to_char(v_date,'YYYY-MM-DD')<>p_draft->>'date' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v := p_draft || jsonb_build_object('accountId',(p_draft->>'accountId')::uuid,
      'transferToAccountId',(p_draft->>'transferToAccountId')::uuid,
      'categoryId',(p_draft->>'categoryId')::uuid,'goalId',(p_draft->>'goalId')::uuid);
    IF jsonb_typeof(v->'installments')<>'null' THEN
      IF jsonb_typeof(v->'installments')<>'object' OR v->'installments' <> jsonb_build_object('count',v->'installments'->'count')
        OR jsonb_typeof(v->'installments'->'count')<>'number' OR v->'installments'->>'count' !~ '^([1-9]|1[0-2])$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      v_count := (v->'installments'->>'count')::integer;
      IF (v->>'amount')::numeric*100<v_count THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    END IF;
    FOR v_moves IN SELECT value FROM jsonb_array_elements(v->'reservationMoves') LOOP
      IF jsonb_typeof(v_moves)<>'object' OR NOT v_moves ?& ARRAY['goalId','amount']
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_moves) k WHERE k NOT IN ('goalId','amount'))
        OR jsonb_typeof(v_moves->'goalId')<>'string' OR jsonb_typeof(v_moves->'amount')<>'string'
        OR v_moves->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
        OR (v_moves->>'amount')::numeric<=0 OR (v_moves->>'amount')::numeric>=10000000000000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      PERFORM (v_moves->>'goalId')::uuid;
    END LOOP;
    SELECT coalesce(jsonb_agg(jsonb_build_object('goalId',(value->>'goalId')::uuid,'amount',value->>'amount') ORDER BY (value->>'goalId')::uuid),'[]'::jsonb)
      INTO v_moves FROM jsonb_array_elements(v->'reservationMoves');
    IF (SELECT count(*)<>count(DISTINCT value->>'goalId') FROM jsonb_array_elements(v_moves)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    RETURN v || jsonb_build_object('reservationMoves',v_moves);
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVALID_STATE'; END;
END $$;
REVOKE ALL ON FUNCTION public.goal_normalize_transaction(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.goal_transaction_quote(p_draft jsonb,p_releases jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid(); v_draft jsonb; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
  v_goal public.goals%ROWTYPE; v_amount numeric; v_reserved numeric; v_shortfall numeric; v_remainder numeric;
  v_carried numeric := 0; v_spending numeric := 0; v_line jsonb; v_releases jsonb := '[]'::jsonb;
  v_funds numeric; v_metadata jsonb; v_fingerprint text; v_month record; v_carry numeric := 0; v_month_debt numeric := 0;
BEGIN
  IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_owner) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  v_draft := public.goal_normalize_transaction(p_draft);
  v_amount := (v_draft->>'amount')::numeric;
  SELECT * INTO v_src FROM public.accounts WHERE id=(v_draft->>'accountId')::uuid AND user_id=v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF v_src.is_active IS DISTINCT FROM true OR v_src.currency IS DISTINCT FROM 'PHP' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF v_draft->>'categoryId' IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.categories WHERE id=(v_draft->>'categoryId')::uuid
      AND (user_id=v_owner OR is_default=true)) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  END IF;
  IF v_draft->>'type'='transfer' THEN
    IF v_draft->>'transferToAccountId' IS NULL OR v_draft->>'categoryId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    SELECT * INTO v_dst FROM public.accounts WHERE id=(v_draft->>'transferToAccountId')::uuid AND user_id=v_owner;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_src.id=v_dst.id THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF v_dst.is_active IS DISTINCT FROM true OR v_dst.currency IS DISTINCT FROM 'PHP' THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  ELSIF v_draft->>'transferToAccountId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF jsonb_typeof(v_draft->'installments')<>'null' AND
    (v_draft->>'type'<>'expense' OR v_src.type<>'credit_card' OR extract(day FROM (v_draft->>'date')::date)<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_draft->>'goalId' IS NOT NULL THEN
    SELECT * INTO v_goal FROM public.goals WHERE id=(v_draft->>'goalId')::uuid AND user_id=v_owner;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
    IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF v_draft->>'type'='income' OR (v_src.type='credit_card' AND v_draft->>'type'<>'expense') OR
      (v_draft->>'type'='transfer' AND (v_dst.type<>'credit_card' OR v_goal.category<>'debt')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF v_src.type<>'credit_card' THEN
      SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
        WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
      IF v_funds<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
      v_spending := v_amount;
    END IF;
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
    SELECT * INTO v_goal FROM public.goals WHERE id=(v_line->>'goalId')::uuid AND user_id=v_owner;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
    IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF v_draft->>'type'<>'transfer' OR v_src.type='credit_card' OR v_dst.type='credit_card' OR v_spending>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
      WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
    IF v_funds<(v_line->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
    v_carried := v_carried+(v_line->>'amount')::numeric;
  END LOOP;
  IF v_carried>v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_src.type<>'credit_card' AND v_draft->>'type' IN ('expense','transfer') AND coalesce(v_src.balance,0)<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_ACTUAL'; END IF;
  IF v_src.type='credit_card' AND v_draft->>'type'='income' AND coalesce(v_src.balance,0)<v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_draft->>'type'='transfer' AND v_dst.type='credit_card' THEN
    IF coalesce(v_dst.balance,0)<v_amount OR extract(day FROM (v_draft->>'date')::date)<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    FOR v_month IN
      SELECT to_char(date,'YYYY-MM') AS month,sum(CASE
        WHEN account_id=v_dst.id AND type='expense' THEN amount
        WHEN account_id=v_dst.id AND type='income' THEN -amount
        WHEN type='transfer' THEN CASE WHEN account_id=v_dst.id THEN amount ELSE 0 END-CASE WHEN transfer_to_account_id=v_dst.id THEN amount ELSE 0 END
        ELSE 0 END) AS debt FROM public.transactions WHERE user_id=v_owner AND (account_id=v_dst.id OR transfer_to_account_id=v_dst.id)
      GROUP BY to_char(date,'YYYY-MM') ORDER BY month
    LOOP
      v_funds := v_month.debt+v_carry;
      v_carry := least(v_funds,0);
      IF v_month.month=left(v_draft->>'date',7) THEN v_month_debt := greatest(v_funds,0); END IF;
    END LOOP;
    IF v_amount>v_month_debt THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  END IF;
  SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_src.id;
  v_shortfall := CASE WHEN v_src.type<>'credit_card' AND v_draft->>'type' IN ('expense','transfer')
    THEN greatest(0,v_amount-(coalesce(v_src.balance,0)-v_reserved)-v_spending-v_carried) ELSE 0 END;
  IF p_releases IS NULL THEN
    v_remainder := v_shortfall;
    FOR v_month IN
      SELECT g.id,sum(e.reserved_delta)-coalesce((SELECT (m->>'amount')::numeric FROM jsonb_array_elements(v_draft->'reservationMoves') m WHERE (m->>'goalId')::uuid=g.id),0) AS funds
      FROM public.goals g JOIN public.goal_allocation_events e ON e.goal_id=g.id AND e.account_id=v_src.id AND e.user_id=v_owner
      WHERE g.user_id=v_owner AND g.status='active' AND g.review_state='confirmed' AND g.archived_at IS NULL
        AND g.id IS DISTINCT FROM (v_draft->>'goalId')::uuid
      GROUP BY g.id ORDER BY g.is_priority ASC,g.created_at ASC,g.id ASC
    LOOP
      IF v_remainder<=0 THEN EXIT; END IF;
      v_funds := least(greatest(v_month.funds,0),v_remainder);
      IF v_funds>0 THEN v_releases := v_releases || jsonb_build_array(jsonb_build_object('goalId',v_month.id,'accountId',v_src.id,'amount',round(v_funds,2)::text)); END IF;
      v_remainder := v_remainder-v_funds;
    END LOOP;
    IF v_remainder>0 THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
  ELSE
    IF jsonb_typeof(p_releases)<>'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_remainder := 0;
    BEGIN
      FOR v_line IN SELECT value FROM jsonb_array_elements(p_releases) LOOP
        IF jsonb_typeof(v_line)<>'object' OR NOT v_line ?& ARRAY['goalId','accountId','amount']
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_line) k WHERE k NOT IN ('goalId','accountId','amount'))
          OR jsonb_typeof(v_line->'goalId')<>'string' OR jsonb_typeof(v_line->'accountId')<>'string' OR jsonb_typeof(v_line->'amount')<>'string'
          OR v_line->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' OR (v_line->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
        IF (v_line->>'accountId')::uuid<>v_src.id THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
        SELECT * INTO v_goal FROM public.goals WHERE id=(v_line->>'goalId')::uuid AND user_id=v_owner;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
        IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
        IF v_goal.status<>'active' OR v_goal.archived_at IS NOT NULL OR v_goal.id=(v_draft->>'goalId')::uuid THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
        SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
        v_funds := v_funds-coalesce((SELECT (m->>'amount')::numeric FROM jsonb_array_elements(v_draft->'reservationMoves') m WHERE (m->>'goalId')::uuid=v_goal.id),0);
        IF v_funds<(v_line->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
        v_releases := v_releases || jsonb_build_array(jsonb_build_object('goalId',v_goal.id,'accountId',v_src.id,'amount',v_line->>'amount'));
        v_remainder := v_remainder+(v_line->>'amount')::numeric;
      END LOOP;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
    IF (SELECT count(*)<>count(DISTINCT value->>'goalId') FROM jsonb_array_elements(v_releases)) OR v_remainder<>v_shortfall THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    SELECT coalesce(jsonb_agg(value ORDER BY value->>'goalId'),'[]'::jsonb) INTO v_releases FROM jsonb_array_elements(v_releases);
  END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'goalId'),'[]'::jsonb) INTO v_releases FROM jsonb_array_elements(v_releases);
  SELECT jsonb_build_object(
    'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.accounts a WHERE a.user_id=v_owner AND a.id IN (v_src.id,v_dst.id)),
    'goals',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]'::jsonb) FROM public.goals g WHERE g.user_id=v_owner),
    'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM public.goal_allocation_events e WHERE e.user_id=v_owner AND e.account_id IN (v_src.id,v_dst.id)),
    'debtTransactions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.transactions t WHERE t.user_id=v_owner AND v_dst.type='credit_card' AND (t.account_id=v_dst.id OR t.transfer_to_account_id=v_dst.id))) INTO v_metadata;
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('draft',v_draft,'releases',v_releases,'state',v_metadata)::text,'UTF8')),'hex');
  RETURN jsonb_build_object('fingerprint',v_fingerprint,'actual',round(coalesce(v_src.balance,0),2)::text,'reserved',round(v_reserved,2)::text,
    'available',round(coalesce(v_src.balance,0)-v_reserved,2)::text,'releases',v_releases);
END $$;

CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid(); v_draft jsonb; v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
  v_quote jsonb; v_confirmation jsonb; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
  v_operation uuid; v_result jsonb; v_line jsonb; v_transaction uuid; v_ids jsonb := '[]'::jsonb;
  v_amount numeric; v_piece numeric; v_count integer; v_i integer; v_date date; v_description text;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_command->>'kind' IS DISTINCT FROM 'transaction' THEN RETURN public.goal_reservation_apply(p_request_id,p_command,p_quote); END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_command)<>'object' OR p_command<>jsonb_build_object('kind','transaction','draft',p_command->'draft') OR p_quote IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_draft := public.goal_normalize_transaction(p_command->'draft');
  v_command := jsonb_build_object('kind','transaction','draft',v_draft);
  -- Confirmation selection belongs to request identity, while mutable quote state does not.
  IF jsonb_typeof(p_quote)<>'object' OR NOT p_quote ?& ARRAY['fingerprint','actual','reserved','available','releases'] OR jsonb_typeof(p_quote->'releases')<>'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  BEGIN
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_quote->'releases') LOOP
      IF jsonb_typeof(v_line)<>'object' OR NOT v_line ?& ARRAY['goalId','accountId','amount']
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_line) k WHERE k NOT IN ('goalId','accountId','amount'))
        OR jsonb_typeof(v_line->'goalId')<>'string' OR jsonb_typeof(v_line->'accountId')<>'string' OR jsonb_typeof(v_line->'amount')<>'string'
        OR v_line->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$' OR (v_line->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    END LOOP;
    SELECT p_quote || jsonb_build_object('releases',coalesce(jsonb_agg(jsonb_build_object('goalId',(value->>'goalId')::uuid,
      'accountId',(value->>'accountId')::uuid,'amount',value->>'amount') ORDER BY (value->>'goalId')::uuid),'[]'::jsonb))
      INTO v_confirmation FROM jsonb_array_elements(p_quote->'releases');
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
  v_hash := encode(sha256(convert_to(jsonb_build_object('command',v_command,'releases',v_confirmation->'releases')::text,'UTF8')),'hex');
  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
  IF FOUND THEN
    IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    RETURN v_previous.result || jsonb_build_object('replayed',true);
  END IF;
  PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
  PERFORM id FROM public.accounts WHERE user_id=v_owner AND id IN ((v_draft->>'accountId')::uuid,(v_draft->>'transferToAccountId')::uuid) ORDER BY id FOR UPDATE;
  IF v_draft->>'categoryId' IS NOT NULL THEN
    PERFORM id FROM public.categories WHERE id=(v_draft->>'categoryId')::uuid FOR SHARE;
  END IF;
  -- A changed state can invalidate the release plan itself; report that as stale before validating it.
  BEGIN
    v_quote := public.goal_transaction_quote(v_draft,v_confirmation->'releases');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IN ('INVALID_STATE','INSUFFICIENT_RESERVATION','INSUFFICIENT_AVAILABLE','INSUFFICIENT_ACTUAL','NEEDS_REVIEW') THEN RAISE EXCEPTION 'STALE_QUOTE'; END IF;
    RAISE;
  END;
  IF v_quote<>v_confirmation THEN RAISE EXCEPTION 'STALE_QUOTE'; END IF;
  SELECT * INTO v_src FROM public.accounts WHERE id=(v_draft->>'accountId')::uuid AND user_id=v_owner;
  SELECT * INTO v_dst FROM public.accounts WHERE id=(v_draft->>'transferToAccountId')::uuid AND user_id=v_owner;
  v_amount := (v_draft->>'amount')::numeric;
  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_quote->'releases') LOOP
    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
      VALUES(v_owner,(v_line->>'goalId')::uuid,v_src.id,v_operation,'release',-(v_line->>'amount')::numeric);
  END LOOP;
  v_count := coalesce((v_draft->'installments'->>'count')::integer,1);
  FOR v_i IN 0..v_count-1 LOOP
    v_piece := (floor(v_amount*100/v_count)+CASE WHEN v_i<mod(v_amount*100,v_count) THEN 1 ELSE 0 END)/100;
    v_date := CASE WHEN jsonb_typeof(v_draft->'installments')<>'null' THEN ((v_draft->>'date')::date+make_interval(months=>v_i))::date ELSE (v_draft->>'date')::date END;
    v_description := CASE WHEN v_count>1 THEN coalesce(v_draft->>'description','') || format(' (Installment %s/%s)',v_i+1,v_count) ELSE v_draft->>'description' END;
    INSERT INTO public.transactions(user_id,account_id,transfer_to_account_id,category_id,goal_id,type,amount,description,date)
      VALUES(v_owner,v_src.id,v_dst.id,(v_draft->>'categoryId')::uuid,(v_draft->>'goalId')::uuid,v_draft->>'type',v_piece,v_description,v_date) RETURNING id INTO v_transaction;
    v_ids := v_ids || jsonb_build_array(v_transaction);
  END LOOP;
  UPDATE public.accounts SET balance=coalesce(balance,0)+CASE
    WHEN v_draft->>'type'='income' THEN CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END
    ELSE CASE WHEN type='credit_card' THEN v_amount ELSE -v_amount END END WHERE id=v_src.id AND user_id=v_owner;
  IF v_draft->>'type'='transfer' THEN
    UPDATE public.accounts SET balance=coalesce(balance,0)+CASE WHEN type='credit_card' THEN -v_amount ELSE v_amount END WHERE id=v_dst.id AND user_id=v_owner;
  END IF;
  IF v_draft->>'goalId' IS NOT NULL AND v_src.type<>'credit_card' THEN
    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id)
      VALUES(v_owner,(v_draft->>'goalId')::uuid,v_src.id,v_operation,'spend',-v_amount,v_amount,v_transaction);
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_draft->'reservationMoves') LOOP
    INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,transaction_id) VALUES
      (v_owner,(v_line->>'goalId')::uuid,v_src.id,v_operation,'move_out',-(v_line->>'amount')::numeric,v_transaction),
      (v_owner,(v_line->>'goalId')::uuid,v_dst.id,v_operation,'move_in',(v_line->>'amount')::numeric,v_transaction);
  END LOOP;
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

BEGIN;
DO $$
DECLARE
  v_public regprocedure := to_regprocedure('public.goal_finance_apply(uuid,jsonb,jsonb)');
  v_body text; v_definition text;
  v_header constant text := 'CREATE OR REPLACE FUNCTION public.goal_finance_apply(';
BEGIN
  IF v_public IS NULL THEN RAISE EXCEPTION 'Transaction dispatcher is missing'; END IF;
  SELECT prosrc INTO v_body FROM pg_proc WHERE oid=v_public;
  IF to_regprocedure('public.goal_transaction_apply(uuid,jsonb,jsonb)') IS NULL THEN
    IF position('public.goal_normalize_transaction' IN v_body)=0 OR position('public.goal_transaction_apply' IN v_body)>0 THEN
      RAISE EXCEPTION 'Expected transaction implementation before lifecycle dispatcher';
    END IF;
    ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_transaction_apply;
  ELSE
    IF position('public.goal_normalize_transaction' IN v_body)>0 AND position('public.goal_transaction_apply' IN v_body)=0 THEN
      v_definition := pg_get_functiondef(v_public);
      IF left(v_definition,length(v_header))<>v_header THEN RAISE EXCEPTION 'Unexpected transaction function definition'; END IF;
      EXECUTE 'CREATE OR REPLACE FUNCTION public.goal_transaction_apply(' || substr(v_definition,length(v_header)+1);
    ELSIF position('public.goal_transaction_apply' IN v_body)>0 AND position('public.goal_normalize_transaction' IN v_body)=0 THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Ambiguous transaction dispatcher definition';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.goal_transaction_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid(); v_kind text; v_goal_id uuid; v_target_id uuid; v_transaction_id uuid;
  v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
  v_goal public.goals%ROWTYPE; v_target public.goals%ROWTYPE;
  v_tx public.transactions%ROWTYPE; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
  v_operation uuid; v_result jsonb; v_row record; v_events jsonb := '[]'::jsonb;
  v_reserved numeric; v_delta numeric; v_src_balance numeric; v_dst_balance numeric;
  v_reservations jsonb := '[]'::jsonb; v_spent_ids jsonb := '[]'::jsonb; v_value jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  v_kind := p_command->>'kind';
  IF v_kind IN ('reserve','release','reallocate','transaction') THEN
    RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
  END IF;
  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL
    OR v_kind IS NULL OR v_kind NOT IN ('close','reopen','archive','delete_transaction','adopt_legacy') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  BEGIN
    IF v_kind='adopt_legacy' THEN
      IF jsonb_typeof(p_command->'goalId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string' OR p_command->>'status' NOT IN ('active','completed','cancelled')
        OR jsonb_typeof(p_command->'reservations') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p_command->'spentTransactionIds') IS DISTINCT FROM 'array'
        OR p_command - ARRAY['kind','goalId','status','reservations','spentTransactionIds'] <> '{}'::jsonb THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      v_goal_id := (p_command->>'goalId')::uuid;
      FOR v_value IN SELECT value FROM jsonb_array_elements(p_command->'reservations') LOOP
        IF jsonb_typeof(v_value->'accountId') IS DISTINCT FROM 'string' OR jsonb_typeof(v_value->'amount') IS DISTINCT FROM 'string'
          OR v_value - ARRAY['accountId','amount'] <> '{}'::jsonb
          OR (v_value->>'amount') !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          OR (v_value->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
        v_reservations := v_reservations || jsonb_build_array(jsonb_build_object('accountId',(v_value->>'accountId')::uuid,'amount',v_value->>'amount'));
      END LOOP;
      FOR v_value IN SELECT value FROM jsonb_array_elements(p_command->'spentTransactionIds') LOOP
        IF jsonb_typeof(v_value)<>'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
        v_spent_ids := v_spent_ids || jsonb_build_array((v_value#>>'{}')::uuid);
      END LOOP;
      IF (SELECT count(*)<>count(DISTINCT value->>'accountId') FROM jsonb_array_elements(v_reservations))
        OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(v_spent_ids)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      SELECT coalesce(jsonb_agg(value ORDER BY value->>'accountId'),'[]') INTO v_reservations FROM jsonb_array_elements(v_reservations);
      SELECT coalesce(jsonb_agg(value ORDER BY value#>>'{}'),'[]') INTO v_spent_ids FROM jsonb_array_elements(v_spent_ids);
      v_command := jsonb_build_object('kind',v_kind,'goalId',v_goal_id,'status',p_command->>'status','reservations',v_reservations,'spentTransactionIds',v_spent_ids);
    ELSIF v_kind='delete_transaction' THEN
      IF jsonb_typeof(p_command->'transactionId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      v_transaction_id := (p_command->>'transactionId')::uuid;
      v_command := jsonb_build_object('kind',v_kind,'transactionId',v_transaction_id);
    ELSE
      IF jsonb_typeof(p_command->'goalId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      v_goal_id := (p_command->>'goalId')::uuid;
      v_command := jsonb_build_object('kind',v_kind,'goalId',v_goal_id);
      IF v_kind='close' THEN
        IF jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string'
          OR p_command->>'status' NOT IN ('completed','cancelled') OR NOT p_command ? 'leftovers' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
        IF p_command->'leftovers'<>'null'::jsonb THEN
          IF p_command->'leftovers'=jsonb_build_object('mode','release') THEN NULL;
          ELSIF jsonb_typeof(p_command->'leftovers'->'goalId')='string' AND p_command->'leftovers'->>'mode'='move' THEN
            v_target_id := (p_command->'leftovers'->>'goalId')::uuid;
            IF p_command->'leftovers'<>jsonb_build_object('mode','move','goalId',p_command->'leftovers'->>'goalId') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
          ELSE RAISE EXCEPTION 'INVALID_STATE'; END IF;
        END IF;
        v_command := v_command || jsonb_build_object('status',p_command->>'status','leftovers',
          CASE WHEN v_target_id IS NOT NULL THEN jsonb_build_object('mode','move','goalId',v_target_id) ELSE p_command->'leftovers' END);
      END IF;
    END IF;
    IF v_kind<>'adopt_legacy' AND p_command<>v_command THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_STATE'; END;
  v_hash := encode(sha256(convert_to(v_command::text,'UTF8')),'hex');
  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
  IF FOUND THEN
    IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    RETURN v_previous.result || jsonb_build_object('replayed',true);
  END IF;
  PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
  PERFORM id FROM public.accounts WHERE user_id=v_owner ORDER BY id FOR UPDATE;
  IF v_kind='adopt_legacy' THEN
    SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=v_goal_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_goal.review_state<>'needs_review' OR v_goal.archived_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal_id)
      OR (p_command->>'status'<>'active' AND jsonb_array_length(v_reservations)>0) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    FOR v_value IN SELECT value FROM jsonb_array_elements(v_reservations) LOOP
      SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=(v_value->>'accountId')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
      IF v_src.is_active IS DISTINCT FROM true OR v_src.currency IS DISTINCT FROM 'PHP' OR v_src.type='credit_card' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_src.id;
      IF coalesce(v_src.balance,0)-v_reserved<(v_value->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
    END LOOP;
    FOR v_value IN SELECT value FROM jsonb_array_elements(v_spent_ids) LOOP
      SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=(v_value#>>'{}')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
      SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
      IF v_src.type='credit_card' OR v_src.currency IS DISTINCT FROM 'PHP' OR v_src.is_active IS DISTINCT FROM true
        OR v_tx.amount<=0 OR EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE transaction_id=v_tx.id AND kind IN ('spend','legacy_spent')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      IF v_tx.type='transfer' THEN
        SELECT * INTO v_dst FROM public.accounts WHERE user_id=v_owner AND id=v_tx.transfer_to_account_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
        IF v_goal.category IS DISTINCT FROM 'debt' OR v_dst.type<>'credit_card' OR v_dst.currency IS DISTINCT FROM 'PHP' OR v_dst.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      ELSIF v_tx.type<>'expense' OR v_tx.transfer_to_account_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    END LOOP;
    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
    FOR v_value IN SELECT value FROM jsonb_array_elements(v_reservations) LOOP
      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
        VALUES(v_owner,v_goal_id,(v_value->>'accountId')::uuid,v_operation,'reserve',(v_value->>'amount')::numeric);
    END LOOP;
    FOR v_value IN SELECT value FROM jsonb_array_elements(v_spent_ids) LOOP
      SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=(v_value#>>'{}')::uuid;
      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id)
        VALUES(v_owner,v_goal_id,v_tx.account_id,v_operation,'legacy_spent',0,v_tx.amount,v_tx.id);
    END LOOP;
    UPDATE public.goals SET review_state='confirmed',status=p_command->>'status',is_completed=(p_command->>'status'='completed'),
      completed_at=CASE WHEN p_command->>'status'='completed' THEN coalesce(completed_at,now()) ELSE NULL END WHERE user_id=v_owner AND id=v_goal_id;
  ELSIF v_kind<>'delete_transaction' THEN
    SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=v_goal_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_goal.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
    IF v_goal.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND goal_id=v_goal_id;
    IF v_kind='close' THEN
      IF v_goal.status<>'active' OR (v_reserved>0 AND p_command->'leftovers'='null'::jsonb) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      IF v_target_id IS NOT NULL THEN
        SELECT * INTO v_target FROM public.goals WHERE user_id=v_owner AND id=v_target_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
        IF v_target.review_state<>'confirmed' THEN RAISE EXCEPTION 'NEEDS_REVIEW'; END IF;
        IF v_target.id=v_goal.id OR v_target.status<>'active' OR v_target.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      END IF;
    ELSIF v_kind='reopen' THEN
      IF v_goal.status='active' OR v_reserved<>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    ELSE
      IF v_goal.status='active' OR v_reserved<>0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    END IF;
    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
    IF v_kind='close' THEN
      FOR v_row IN SELECT account_id,sum(reserved_delta) AS funds FROM public.goal_allocation_events
        WHERE user_id=v_owner AND goal_id=v_goal_id GROUP BY account_id ORDER BY account_id
      LOOP
        IF v_row.funds<0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
        IF v_row.funds=0 THEN CONTINUE; END IF;
        INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
          VALUES(v_owner,v_goal_id,v_row.account_id,v_operation,CASE WHEN v_target_id IS NULL THEN 'release' ELSE 'move_out' END,-v_row.funds);
        IF v_target_id IS NOT NULL THEN
          INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
            VALUES(v_owner,v_target_id,v_row.account_id,v_operation,'move_in',v_row.funds);
        END IF;
      END LOOP;
      UPDATE public.goals SET status=p_command->>'status',is_completed=(p_command->>'status'='completed'),
        completed_at=CASE WHEN p_command->>'status'='completed' THEN now() ELSE NULL END WHERE id=v_goal_id AND user_id=v_owner;
    ELSIF v_kind='reopen' THEN
      UPDATE public.goals SET status='active',is_completed=false,completed_at=NULL WHERE id=v_goal_id AND user_id=v_owner;
    ELSE
      UPDATE public.goals SET archived_at=now() WHERE id=v_goal_id AND user_id=v_owner;
    END IF;
  ELSE
    SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    v_src_balance := coalesce(v_src.balance,0)+CASE WHEN v_tx.type='income' THEN
      CASE WHEN v_src.type='credit_card' THEN v_tx.amount ELSE -v_tx.amount END
      ELSE CASE WHEN v_src.type='credit_card' THEN -v_tx.amount ELSE v_tx.amount END END;
    IF v_tx.type='transfer' THEN
      SELECT * INTO v_dst FROM public.accounts WHERE user_id=v_owner AND id=v_tx.transfer_to_account_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
      v_dst_balance := coalesce(v_dst.balance,0)+CASE WHEN v_dst.type='credit_card' THEN v_tx.amount ELSE -v_tx.amount END;
    END IF;
    IF v_src_balance<0 OR v_dst_balance<0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_ACTUAL' USING HINT='Release funds or make a corrective transaction before deleting this transaction.';
    END IF;
    -- Older transaction operations link auto-releases through their result, rather than an event transaction UUID.
    FOR v_row IN SELECT e.*,g.status,g.archived_at FROM public.goal_allocation_events e
      JOIN public.goals g ON g.id=e.goal_id AND g.user_id=e.user_id
      WHERE e.user_id=v_owner AND e.kind<>'reversal' AND
        (e.transaction_id=v_transaction_id OR (e.kind='release' AND e.transaction_id IS NULL AND EXISTS(
          SELECT 1 FROM public.financial_operations o WHERE o.id=e.operation_id AND o.user_id=v_owner
            AND o.command->>'kind'='transaction' AND o.result->'transactionIds' @> jsonb_build_array(v_transaction_id))))
        AND NOT EXISTS(SELECT 1 FROM public.goal_allocation_events r WHERE r.reversal_of=e.id)
      ORDER BY e.id
    LOOP
      v_delta := CASE WHEN v_row.status='active' AND v_row.archived_at IS NULL THEN -v_row.reserved_delta ELSE 0 END;
      IF v_delta<>0 OR v_row.spent_delta<>0 THEN
        v_events := v_events || jsonb_build_array(jsonb_build_object('id',v_row.id,'goal',v_row.goal_id,'account',v_row.account_id,
          'reserved',v_delta,'spent',-v_row.spent_delta,'transaction',v_row.transaction_id));
      END IF;
    END LOOP;
    FOR v_row IN SELECT (value->>'goal')::uuid AS goal_id,(value->>'account')::uuid AS account_id,
      sum((value->>'reserved')::numeric) AS delta FROM jsonb_array_elements(v_events) GROUP BY 1,2
    LOOP
      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events
        WHERE user_id=v_owner AND goal_id=v_row.goal_id AND account_id=v_row.account_id;
      IF v_reserved+v_row.delta<0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_RESERVATION' USING HINT='Restore the carried allocation or make a corrective transaction before deleting this transfer.';
      END IF;
    END LOOP;
    FOR v_row IN SELECT a.id,a.type,CASE WHEN a.id=v_src.id THEN v_src_balance WHEN a.id=v_dst.id THEN v_dst_balance ELSE coalesce(a.balance,0) END AS balance
      FROM public.accounts a WHERE a.user_id=v_owner ORDER BY a.id
    LOOP
      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_row.id;
      SELECT coalesce(sum((value->>'reserved')::numeric),0) INTO v_delta FROM jsonb_array_elements(v_events) WHERE (value->>'account')::uuid=v_row.id;
      IF v_row.type<>'credit_card' AND v_row.balance<v_reserved+v_delta THEN
        RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE' USING HINT='Release funds or make a corrective transaction before deleting this transaction.';
      END IF;
    END LOOP;
    INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_events) LOOP
      INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta,spent_delta,transaction_id,reversal_of)
        VALUES(v_owner,(v_row.value->>'goal')::uuid,(v_row.value->>'account')::uuid,v_operation,'reversal',
          (v_row.value->>'reserved')::numeric,(v_row.value->>'spent')::numeric,(v_row.value->>'transaction')::uuid,(v_row.value->>'id')::uuid);
    END LOOP;
    UPDATE public.accounts SET balance=v_src_balance WHERE user_id=v_owner AND id=v_src.id;
    IF v_tx.type='transfer' THEN UPDATE public.accounts SET balance=v_dst_balance WHERE user_id=v_owner AND id=v_dst.id; END IF;
    DELETE FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id;
  END IF;
  v_result := jsonb_build_object('operationId',v_operation,'transactionIds',
    CASE WHEN v_kind='delete_transaction' THEN jsonb_build_array(v_transaction_id) ELSE '[]'::jsonb END,'replayed',false);
  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE user_id=v_owner AND id=v_operation;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS allocation_legacy_spent_once ON public.goal_allocation_events(transaction_id) WHERE kind='legacy_spent';

REVOKE ALL ON public.transactions,public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.transactions,public.goal_allocation_events,public.financial_operations TO authenticated;
REVOKE ALL ON public.accounts,public.goals FROM PUBLIC,anon,authenticated;
-- Remove column grants left by previous deployments before applying the reviewed allowlist.
DO $$ DECLARE v_table text; v_columns text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['accounts','goals','transactions','goal_allocation_events','financial_operations'] LOOP
    SELECT string_agg(quote_ident(attname),',') INTO v_columns FROM pg_attribute WHERE attrelid=('public.'||v_table)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC,anon,authenticated',v_columns,v_table);
  END LOOP;
END $$;
GRANT SELECT ON public.accounts,public.goals TO authenticated;
GRANT INSERT(user_id,name,type,balance,currency,color,icon,is_active,is_savings,interest_rate,include_in_networth,display_order) ON public.accounts TO authenticated;
GRANT UPDATE(name,color,icon,display_order,interest_rate,include_in_networth) ON public.accounts TO authenticated;
GRANT DELETE ON public.accounts TO authenticated;
GRANT INSERT(user_id,name,target_amount,current_amount,target_date,color,icon,is_completed,is_priority,category,allocation_per_cycle,allocation_frequency) ON public.goals TO authenticated;
GRANT UPDATE(name,target_amount,target_date,color,icon,is_priority,category,allocation_per_cycle,allocation_frequency) ON public.goals TO authenticated;
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['accounts','goals','transactions','goal_allocation_events','financial_operations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('DROP POLICY IF EXISTS finance_owner_boundary ON public.%I',v_table);
    EXECUTE format('CREATE POLICY finance_owner_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)',v_table);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guard_financial_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
    IF EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.transactions WHERE account_id=OLD.id OR transfer_to_account_id=OLD.id) THEN
      RAISE EXCEPTION 'Wallet with financial history cannot be deleted' USING ERRCODE='23503';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME='accounts' AND TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.user_id,NEW.type,NEW.currency,NEW.is_active) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.type,OLD.currency,OLD.is_active)
      AND EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id) THEN
      RAISE EXCEPTION 'Wallet identity with allocation history cannot change' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_financial_opening() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_user='authenticated' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF TG_TABLE_NAME='accounts' THEN
      IF NEW.balance IS NULL OR NEW.balance::text IN ('NaN','Infinity','-Infinity') OR NEW.balance<0 OR NEW.balance>=10000000000000
        OR NEW.currency IS DISTINCT FROM 'PHP' OR NEW.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    ELSE
      IF NEW.current_amount IS DISTINCT FROM 0 OR NEW.is_completed IS DISTINCT FROM false OR NEW.status<>'active'
        OR NEW.review_state<>'confirmed' OR NEW.completed_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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
    IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=10000000000000
      OR (TG_ARGV[0]='target_amount' AND v_amount<=0) THEN
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
DROP TRIGGER IF EXISTS financial_opening_guard ON public.goals;
CREATE TRIGGER financial_opening_guard BEFORE INSERT ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_financial_opening();
DROP TRIGGER IF EXISTS goal_target_money_guard ON public.goals;
CREATE TRIGGER goal_target_money_guard BEFORE INSERT OR UPDATE OF target_amount ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_goal_money('target_amount');
DROP TRIGGER IF EXISTS goal_allocation_money_guard ON public.goals;
CREATE TRIGGER goal_allocation_money_guard BEFORE INSERT OR UPDATE OF allocation_per_cycle ON public.goals FOR EACH ROW EXECUTE FUNCTION public.guard_goal_money('allocation_per_cycle');

-- Unknown deployed definer RPCs fail closed until their complete signatures and bodies are reviewed.
DO $$ DECLARE v_function record; BEGIN
  FOR v_function IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND (p.prosecdef OR p.proname LIKE 'goal_%' OR p.proname LIKE 'guard_financial_%')
      AND p.oid NOT IN ('public.goal_finance_snapshot()'::regprocedure,'public.goal_transaction_quote(jsonb,jsonb)'::regprocedure,'public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure)
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_function.signature); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.goal_finance_snapshot(),public.goal_transaction_quote(jsonb,jsonb),public.goal_finance_apply(uuid,jsonb,jsonb) TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
