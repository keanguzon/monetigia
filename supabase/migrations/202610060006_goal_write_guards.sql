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
