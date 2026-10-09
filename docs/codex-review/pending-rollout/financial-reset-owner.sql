-- Manual admin script; not a migration. Default ending is ROLLBACK.
-- Replace the UUID only in a reviewed copy. Read financial-reset-guide.md first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE reset_owner(id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO reset_owner VALUES ('REPLACE_WITH_EXPLICIT_OWNER_UUID'::uuid);

DO $$
DECLARE v_table text; v_unknown text; v_debt_count integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=(SELECT id FROM reset_owner))
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=(SELECT id FROM reset_owner)) THEN
    RAISE EXCEPTION 'Owner must exist in both public.users and auth.users';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Use a reviewed administrative database role with BYPASSRLS';
  END IF;
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_unknown
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
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

CREATE TEMP TABLE reset_before(table_name text PRIMARY KEY, owner_count bigint, other_hash text, preserved_hash text) ON COMMIT DROP;
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
DECLARE v_table record; v_owner uuid := (SELECT id FROM reset_owner); v_count bigint; v_other text; v_keep text; v_expression text; v_columns text;
BEGIN
  IF EXISTS(SELECT 1 FROM reset_guard_targets x LEFT JOIN reset_guards g USING(table_name,trigger_name) WHERE g.trigger_name IS NULL) THEN
    RAISE EXCEPTION 'Expected history guard missing; review deployed triggers';
  END IF;
  IF EXISTS(SELECT 1 FROM reset_guards WHERE enabled='D') THEN
    RAISE EXCEPTION 'A public trigger is already disabled; review protections before reset';
  END IF;
  IF EXISTS(SELECT 1 FROM reset_guards WHERE trigger_name <> ALL(ARRAY[
    'allocation_transaction_owner','allocation_history_immutable','financial_identity_guard','financial_opening_guard',
    'goal_target_money_guard','goal_allocation_money_guard','debt_settlement_validate','debt_correction_validate',
    'debt_settlement_immutable','debt_correction_immutable','debt_settlement_payment_delete_reverse'])) THEN
    RAISE EXCEPTION 'Unreviewed public trigger: inspect reset_guards before reset';
  END IF;
  SELECT string_agg(attname, ', ' ORDER BY attname) INTO v_columns FROM pg_attribute
    WHERE attrelid='public.accounts'::regclass AND attnum>0 AND NOT attisdropped
      AND attname <> ALL(ARRAY['id','user_id','name','type','balance','currency','color','icon','is_active','is_savings',
        'interest_rate','include_in_networth','display_order','created_at','updated_at']);
  IF v_columns IS NOT NULL THEN RAISE EXCEPTION 'Unreviewed account columns (possible cached finances): %',v_columns; END IF;
  SELECT string_agg(attname, ', ' ORDER BY attname) INTO v_columns FROM pg_attribute
    WHERE attrelid='public.goals'::regclass AND attnum>0 AND NOT attisdropped
      AND attname <> ALL(ARRAY['id','user_id','name','target_amount','current_amount','target_date','color','icon','is_completed',
        'is_priority','category','allocation_per_cycle','allocation_frequency','created_at','updated_at','status',
        'review_state','completed_at','archived_at']);
  IF v_columns IS NOT NULL THEN RAISE EXCEPTION 'Unreviewed goal columns (possible cached finances): %',v_columns; END IF;
  FOR v_table IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'users' ORDER BY c.relname LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id=$1',v_table.relname)
      INTO v_count USING v_owner;
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY id), '''')) FROM public.%I t WHERE user_id IS DISTINCT FROM $1',v_table.relname)
      INTO v_other USING v_owner;
    v_expression := CASE v_table.relname WHEN 'accounts' THEN 'to_jsonb(t)-''balance'''
      WHEN 'goals' THEN 'to_jsonb(t)-''current_amount''' ELSE 'to_jsonb(t)' END;
    IF v_table.relname=ANY(ARRAY['accounts','goals','categories','budgets','user_preferences']) THEN
      EXECUTE format('SELECT md5(coalesce(string_agg((%s)::text, '''' ORDER BY id), '''')) FROM public.%I t WHERE user_id=$1',v_expression,v_table.relname)
        INTO v_keep USING v_owner;
    ELSE v_keep := NULL; END IF;
    INSERT INTO reset_before VALUES(v_table.relname,v_count,v_other,v_keep);
    RAISE NOTICE 'Preflight owner %: % rows in %',v_owner,v_count,v_table.relname;
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
DO $$ DECLARE v_owner uuid := (SELECT id FROM reset_owner); BEGIN
  IF to_regclass('public.debt_items') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.debt_settlement_events WHERE user_id=$1' USING v_owner;
    EXECUTE 'DELETE FROM public.debt_correction_events WHERE user_id=$1' USING v_owner;
    EXECUTE 'DELETE FROM public.debt_due_rows WHERE user_id=$1' USING v_owner;
    EXECUTE 'DELETE FROM public.debt_items WHERE user_id=$1' USING v_owner;
  END IF;
END $$;
DELETE FROM public.goal_allocation_events WHERE user_id=(SELECT id FROM reset_owner);
DELETE FROM public.transactions WHERE user_id=(SELECT id FROM reset_owner);
DELETE FROM public.financial_operations WHERE user_id=(SELECT id FROM reset_owner);
UPDATE public.accounts SET balance=0 WHERE user_id=(SELECT id FROM reset_owner);
UPDATE public.goals SET current_amount=0 WHERE user_id=(SELECT id FROM reset_owner);

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
DECLARE v_row record; v_owner uuid := (SELECT id FROM reset_owner); v_count bigint; v_other text; v_keep text; v_expression text;
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
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id=$1',v_row.table_name) INTO v_count USING v_owner;
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY id), '''')) FROM public.%I t WHERE user_id IS DISTINCT FROM $1',v_row.table_name)
      INTO v_other USING v_owner;
    IF v_other IS DISTINCT FROM v_row.other_hash THEN RAISE EXCEPTION 'Unrelated owner rows changed in %',v_row.table_name; END IF;
    IF v_row.preserved_hash IS NOT NULL THEN
      v_expression := CASE v_row.table_name WHEN 'accounts' THEN 'to_jsonb(t)-''balance'''
        WHEN 'goals' THEN 'to_jsonb(t)-''current_amount''' ELSE 'to_jsonb(t)' END;
      EXECUTE format('SELECT md5(coalesce(string_agg((%s)::text, '''' ORDER BY id), '''')) FROM public.%I t WHERE user_id=$1',v_expression,v_row.table_name)
        INTO v_keep USING v_owner;
      IF v_keep IS DISTINCT FROM v_row.preserved_hash OR v_count<>v_row.owner_count THEN RAISE EXCEPTION 'Preserved owner fields changed in %',v_row.table_name; END IF;
    ELSIF v_count<>0 THEN RAISE EXCEPTION 'Financial rows remain in %',v_row.table_name; END IF;
    RAISE NOTICE 'Postcheck owner %: % rows in %',v_owner,v_count,v_row.table_name;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.accounts WHERE user_id=v_owner AND balance IS DISTINCT FROM 0)
    OR EXISTS(SELECT 1 FROM public.goals WHERE user_id=v_owner AND current_amount IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'Wallet balances or cached goal progress did not clear';
  END IF;
END $$;
SELECT b.table_name,b.owner_count AS before_rows,
  CASE WHEN b.preserved_hash IS NOT NULL THEN 'rows retained; reviewed finance fields zeroed' ELSE 'financial history removed' END AS rehearsal_result
FROM reset_before b ORDER BY b.table_name;

-- Change this single terminator to COMMIT only after the later reset authorization.
ROLLBACK;
