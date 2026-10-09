-- Manual admin script; not a migration. Default ending is ROLLBACK.
-- ALL USERS in the checked database. Read financial-reset-all-users-guide.md first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE reset_database(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO reset_database VALUES ('REPLACE_WITH_REVIEWED_DATABASE_NAME');

DO $$
DECLARE v_table text; v_unknown text; v_debt_count integer;
BEGIN
  IF current_database() IS DISTINCT FROM (SELECT name FROM reset_database) THEN
    RAISE EXCEPTION 'Database name confirmation failed: verify the intended project host and database';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Use a reviewed administrative database role with BYPASSRLS';
  END IF;
  IF current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'Use origin session_replication_role so foreign keys remain enforced';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.relnamespace='public'::regnamespace AND t.tgisinternal AND t.tgenabled NOT IN ('O','A')) THEN
    RAISE EXCEPTION 'Foreign-key or internal protection trigger is disabled for origin';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND NOT convalidated) THEN
    RAISE EXCEPTION 'Unvalidated foreign key: review existing integrity before reset';
  END IF;
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_unknown
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','m','f')
    AND c.relname <> ALL(ARRAY['users','accounts','categories','goals','transactions','budgets','user_preferences',
      'financial_operations','goal_allocation_events','debt_items','debt_due_rows','debt_settlement_events','debt_correction_events']);
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Unreviewed public tables: %. Classify their scope before updating this artifact; no reset applied.', v_unknown;
  END IF;
  FOREACH v_table IN ARRAY ARRAY['users','accounts','categories','goals','transactions','budgets','user_preferences','financial_operations','goal_allocation_events'] LOOP
    IF to_regclass('public.'||v_table) IS NULL THEN RAISE EXCEPTION 'Missing required table: %',v_table; END IF;
  END LOOP;
  SELECT count(*) INTO v_debt_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname=ANY(ARRAY['debt_items','debt_due_rows','debt_settlement_events','debt_correction_events']);
  IF v_debt_count NOT IN (0,4) THEN RAISE EXCEPTION 'Partial debt deployment: review schema before reset'; END IF;
END $$;

-- These locks block concurrent writes while table-level guards are disabled.
LOCK TABLE public.users, public.accounts, public.categories, public.goals, public.transactions,
  public.budgets, public.user_preferences, public.financial_operations, public.goal_allocation_events IN ACCESS EXCLUSIVE MODE;
LOCK TABLE auth.users IN SHARE MODE;
DO $$ BEGIN
  IF to_regclass('public.debt_items') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.debt_items, public.debt_due_rows, public.debt_settlement_events, public.debt_correction_events IN ACCESS EXCLUSIVE MODE';
  END IF;
END $$;


CREATE TEMP TABLE reset_columns(table_name text PRIMARY KEY, columns text[]) ON COMMIT DROP;
INSERT INTO reset_columns VALUES
  ('accounts', ARRAY['balance','color','created_at','currency','display_order','icon','id','include_in_networth','interest_rate','is_active','is_savings','name','type','updated_at','user_id']),
  ('budgets', ARRAY['amount','category_id','created_at','end_date','id','period','start_date','updated_at','user_id']),
  ('categories', ARRAY['color','created_at','icon','id','is_default','name','type','user_id']),
  ('debt_correction_events', ARRAY['account_id','amount','created_at','id','opening_due_row_id','operation_id','purchase_transaction_id','user_id']),
  ('debt_due_rows', ARRAY['created_at','debt_item_id','due_date','id','ordinal','original_amount','user_id']),
  ('debt_items', ARRAY['account_id','client_id','created_at','first_due_date','id','mode','name','operation_id','original_amount','remaining_months','source','user_id']),
  ('debt_settlement_events', ARRAY['account_id','amount','created_at','id','kind','opening_due_row_id','operation_id','payment_operation_id','payment_transaction_id','purchase_transaction_id','residual_account_id','reversal_of','user_id']),
  ('financial_operations', ARRAY['command','command_hash','completed_at','created_at','id','request_id','result','user_id']),
  ('goal_allocation_events', ARRAY['account_id','created_at','goal_id','id','kind','operation_id','reserved_delta','reversal_of','spent_delta','transaction_id','user_id']),
  ('goals', ARRAY['allocation_frequency','allocation_per_cycle','archived_at','category','color','completed_at','created_at','current_amount','icon','id','is_completed','is_priority','name','review_state','status','target_amount','target_date','updated_at','user_id']),
  ('transactions', ARRAY['account_id','amount','category_id','created_at','date','description','goal_id','history_date','id','installment_group_id','purchase_date','transfer_to_account_id','type','updated_at','user_id']),
  ('user_preferences', ARRAY['created_at','currency','id','language','notifications_enabled','theme','updated_at','user_id']),
  ('users', ARRAY['avatar_url','created_at','email','id','is_verified','name','updated_at','username']);
DO $$ DECLARE v_table record; v_actual text[]; BEGIN
  FOR v_table IN SELECT * FROM reset_columns WHERE to_regclass('public.'||table_name) IS NOT NULL LOOP
    SELECT array_agg(attname::text ORDER BY attname) INTO v_actual FROM pg_attribute
      WHERE attrelid=to_regclass('public.'||v_table.table_name) AND attnum>0 AND NOT attisdropped;
    IF v_actual IS DISTINCT FROM v_table.columns THEN
      RAISE EXCEPTION 'Unreviewed columns in %: %; no reset applied',v_table.table_name,v_actual;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid
    WHERE f.contype='f' AND f.confrelid IN (SELECT c.oid FROM pg_class c WHERE c.relnamespace='public'::regnamespace)
      AND child.relnamespace<>'public'::regnamespace) THEN
    RAISE EXCEPTION 'Unreviewed foreign-key dependency outside public; no reset applied';
  END IF;
END $$;

CREATE TEMP TABLE reset_before(table_name text PRIMARY KEY, row_count bigint, preserved_hash text) ON COMMIT DROP;
CREATE TEMP TABLE reset_guards ON COMMIT DROP AS
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS enabled, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal;
CREATE TEMP TABLE reset_guard_targets(table_name text, trigger_name text, PRIMARY KEY(table_name,trigger_name)) ON COMMIT DROP;
INSERT INTO reset_guard_targets VALUES ('goal_allocation_events','allocation_history_immutable');
DO $$ BEGIN
  IF to_regclass('public.debt_items') IS NOT NULL THEN
    INSERT INTO reset_guard_targets VALUES ('debt_settlement_events','debt_settlement_immutable'),('debt_correction_events','debt_correction_immutable');
  END IF;
END $$;

DO $$
DECLARE v_table record; v_count bigint; v_keep text; v_expression text;
BEGIN
  IF EXISTS(SELECT 1 FROM reset_guard_targets x LEFT JOIN reset_guards g USING(table_name,trigger_name) WHERE g.trigger_name IS NULL) THEN
    RAISE EXCEPTION 'Expected history guard missing; review deployed triggers';
  END IF;
  IF EXISTS(SELECT 1 FROM reset_guards WHERE enabled='D') THEN
    RAISE EXCEPTION 'A public trigger is already disabled; review protections before reset';
  END IF;
  IF EXISTS(SELECT 1 FROM reset_guards WHERE (table_name,trigger_name) NOT IN (
    ('goal_allocation_events','allocation_transaction_owner'),('goal_allocation_events','allocation_history_immutable'),
    ('accounts','financial_identity_guard'),('accounts','financial_opening_guard'),('goals','financial_opening_guard'),
    ('goals','goal_target_money_guard'),('goals','goal_allocation_money_guard'),
    ('debt_settlement_events','debt_settlement_validate'),('debt_correction_events','debt_correction_validate'),
    ('debt_settlement_events','debt_settlement_immutable'),('debt_correction_events','debt_correction_immutable'),
    ('transactions','debt_settlement_payment_delete_reverse'))) THEN
    RAISE EXCEPTION 'Unreviewed public trigger: inspect reset_guards before reset';
  END IF;
  FOR v_table IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'users' ORDER BY c.relname LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',v_table.relname) INTO v_count;
    v_expression := CASE v_table.relname WHEN 'accounts' THEN 'to_jsonb(t)-''balance'''
      WHEN 'goals' THEN 'to_jsonb(t)-''current_amount''' ELSE 'to_jsonb(t)' END;
    IF v_table.relname=ANY(ARRAY['accounts','goals','categories','budgets','user_preferences']) THEN
      EXECUTE format('SELECT md5(coalesce(string_agg((%s)::text, '''' ORDER BY id), '''')) FROM public.%I t',v_expression,v_table.relname) INTO v_keep;
    ELSE v_keep := NULL; END IF;
    INSERT INTO reset_before VALUES(v_table.relname,v_count,v_keep);
    RAISE NOTICE 'Preflight ALL USERS: % rows in %',v_count,v_table.relname;
  END LOOP;
END $$;

CREATE TEMP TABLE reset_profile_before ON COMMIT DROP AS SELECT to_jsonb(t) AS data FROM public.users t ORDER BY id;
CREATE TEMP TABLE reset_auth_before ON COMMIT DROP AS SELECT to_jsonb(t) AS data FROM auth.users t ORDER BY id;

DO $$ DECLARE v_guard record; BEGIN
  FOR v_guard IN SELECT * FROM reset_guard_targets LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I',v_guard.table_name,v_guard.trigger_name);
  END LOOP;
END $$;

-- Delete settlements first so the payment-delete reversal trigger has no work.
DO $$ BEGIN
  IF to_regclass('public.debt_items') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.debt_settlement_events';
    EXECUTE 'DELETE FROM public.debt_correction_events';
    EXECUTE 'DELETE FROM public.debt_due_rows';
    EXECUTE 'DELETE FROM public.debt_items';
  END IF;
END $$;
DELETE FROM public.goal_allocation_events;
DELETE FROM public.transactions;
DELETE FROM public.financial_operations;
UPDATE public.accounts SET balance=0;
UPDATE public.goals SET current_amount=0;

SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE v_guard record; BEGIN
  FOR v_guard IN SELECT g.* FROM reset_guards g JOIN reset_guard_targets x USING(table_name,trigger_name) LOOP
    EXECUTE format('ALTER TABLE public.%I %s TRIGGER %I',v_guard.table_name,
      CASE v_guard.enabled WHEN 'O' THEN 'ENABLE' WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'D' THEN 'DISABLE' END,
      v_guard.trigger_name);
  END LOOP;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE v_row record; v_count bigint; v_keep text; v_expression text;
BEGIN
  IF EXISTS((SELECT * FROM reset_guards EXCEPT SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)
    UNION ALL (SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal EXCEPT SELECT * FROM reset_guards)) THEN
    RAISE EXCEPTION 'Trigger definitions or enabled modes changed';
  END IF;
  IF EXISTS((SELECT data FROM reset_profile_before EXCEPT SELECT to_jsonb(t) FROM public.users t)
    UNION ALL (SELECT to_jsonb(t) FROM public.users t EXCEPT SELECT data FROM reset_profile_before))
    OR EXISTS((SELECT data FROM reset_auth_before EXCEPT SELECT to_jsonb(t) FROM auth.users t)
    UNION ALL (SELECT to_jsonb(t) FROM auth.users t EXCEPT SELECT data FROM reset_auth_before)) THEN
    RAISE EXCEPTION 'Profile or authentication rows changed';
  END IF;
  FOR v_row IN SELECT * FROM reset_before LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',v_row.table_name) INTO v_count;
    IF v_row.preserved_hash IS NOT NULL THEN
      v_expression := CASE v_row.table_name WHEN 'accounts' THEN 'to_jsonb(t)-''balance'''
        WHEN 'goals' THEN 'to_jsonb(t)-''current_amount''' ELSE 'to_jsonb(t)' END;
      EXECUTE format('SELECT md5(coalesce(string_agg((%s)::text, '''' ORDER BY id), '''')) FROM public.%I t',v_expression,v_row.table_name) INTO v_keep;
      IF v_keep IS DISTINCT FROM v_row.preserved_hash OR v_count<>v_row.row_count THEN RAISE EXCEPTION 'Preserved fields changed in %',v_row.table_name; END IF;
    ELSIF v_count<>0 THEN RAISE EXCEPTION 'Financial rows remain in %',v_row.table_name; END IF;
    RAISE NOTICE 'Postcheck ALL USERS: % rows in %',v_count,v_row.table_name;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.accounts WHERE balance IS DISTINCT FROM 0)
    OR EXISTS(SELECT 1 FROM public.goals WHERE current_amount IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Wallet balances or cached goal progress did not clear';
  END IF;
END $$;
SELECT b.table_name,b.row_count AS before_rows,
  CASE WHEN b.preserved_hash IS NOT NULL THEN 'rows retained; reviewed finance fields zeroed' ELSE 'financial history removed' END AS rehearsal_result
FROM reset_before b ORDER BY b.table_name;

-- Change this single terminator to COMMIT only after the verified rehearsal in the intended project.
ROLLBACK;
