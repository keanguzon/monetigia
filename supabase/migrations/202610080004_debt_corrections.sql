BEGIN;

CREATE OR REPLACE FUNCTION public.goal_debt_correction_apply(p_request_id uuid,p_command jsonb,p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_account_id uuid;
  v_row_ids uuid[] := '{}'::uuid[];
  v_sorted_ids uuid[];
  v_row_ids_json jsonb;
  v_raw_id text;
  v_element jsonb;
  v_kind text;
  v_fingerprint text;
  v_command jsonb;
  v_hash text;
  v_previous public.financial_operations%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_state jsonb;
  v_row jsonb;
  v_selected jsonb := '[]'::jsonb;
  v_row_id uuid;
  v_group_id uuid;
  v_group_set boolean := false;
  v_source text;
  v_amount numeric;
  v_total numeric := 0;
  v_operation uuid;
  v_result jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR p_quote IS NOT NULL OR p_command - ARRAY['kind','accountId','rowIds','fingerprint'] <> '{}'::jsonb
    OR p_command->>'kind' IS DISTINCT FROM 'correct_debt_rows'
    OR jsonb_typeof(p_command->'accountId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_command->'rowIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_command->'fingerprint') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF jsonb_array_length(p_command->'rowIds') NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_raw_id := p_command->>'accountId';
  IF v_raw_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_command->>'fingerprint' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_account_id := v_raw_id::uuid;
  v_fingerprint := p_command->>'fingerprint';

  FOR v_element IN SELECT value FROM jsonb_array_elements(p_command->'rowIds') LOOP
    IF jsonb_typeof(v_element) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_raw_id := v_element #>> '{}';
    IF v_raw_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'INVALID_STATE';
    END IF;
    v_row_id := v_raw_id::uuid;
    IF v_row_id = ANY(v_row_ids) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_row_ids := array_append(v_row_ids,v_row_id);
  END LOOP;

  SELECT array_agg(item.id ORDER BY item.id) INTO v_sorted_ids FROM unnest(v_row_ids) AS item(id);
  SELECT coalesce(jsonb_agg(to_jsonb(item.id::text) ORDER BY item.id),'[]'::jsonb)
    INTO v_row_ids_json FROM unnest(v_sorted_ids) AS item(id);
  v_command := jsonb_build_object('kind','correct_debt_rows','accountId',v_account_id::text,
    'rowIds',v_row_ids_json,'fingerprint',v_fingerprint);
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
  SELECT * INTO v_account FROM public.accounts WHERE user_id=v_owner AND id=v_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;

  PERFORM id FROM public.debt_due_rows WHERE user_id=v_owner AND id=ANY(v_sorted_ids) ORDER BY id FOR UPDATE;
  PERFORM id FROM public.transactions WHERE user_id=v_owner AND id=ANY(v_sorted_ids) ORDER BY id FOR UPDATE;

  v_state := public.debt_account_state(v_owner,v_account_id);
  IF v_state->'account'->>'fingerprint' IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'STALE_QUOTE'; END IF;
  IF v_account.type IS DISTINCT FROM 'credit_card' OR v_account.currency IS DISTINCT FROM 'PHP'
    OR v_account.is_active IS DISTINCT FROM true OR v_state->'account'->>'reconciliation' IS DISTINCT FROM 'balanced' THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  FOREACH v_row_id IN ARRAY v_sorted_ids LOOP
    SELECT value INTO v_row FROM jsonb_array_elements(v_state->'rows') AS item(value)
      WHERE value->>'id'=v_row_id::text;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_row->>'accountId' IS DISTINCT FROM v_account_id::text THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    v_amount := (v_row->>'remainingAmount')::numeric;
    IF v_amount<=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF v_row->>'groupId' IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF v_group_set AND v_group_id IS DISTINCT FROM (v_row->>'groupId')::uuid THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_group_id := (v_row->>'groupId')::uuid;
    v_group_set := true;
    v_source := v_row->>'source';
    IF v_source='opening' THEN
      v_selected := v_selected || jsonb_build_array(jsonb_build_object(
        'source',v_source,'rowId',v_row_id,'amount',v_row->>'remainingAmount'));
    ELSIF v_source='purchase' AND v_row->>'transactionId' IS NOT NULL THEN
      v_selected := v_selected || jsonb_build_array(jsonb_build_object(
        'source',v_source,'rowId',v_row_id,'transactionId',v_row->>'transactionId','amount',v_row->>'remainingAmount'));
    ELSE
      RAISE EXCEPTION 'INVALID_STATE';
    END IF;
    v_total := v_total+v_amount;
  END LOOP;
  IF NOT v_group_set OR v_total<=0 OR v_total>coalesce(v_account.balance,0) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
    VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_selected) LOOP
    INSERT INTO public.debt_correction_events(user_id,account_id,operation_id,amount,opening_due_row_id,purchase_transaction_id)
    VALUES(v_owner,v_account_id,v_operation,(v_row->>'amount')::numeric,
      CASE WHEN v_row->>'source'='opening' THEN (v_row->>'rowId')::uuid END,
      CASE WHEN v_row->>'source'='purchase' THEN (v_row->>'transactionId')::uuid END);
  END LOOP;
  UPDATE public.accounts SET balance=coalesce(balance,0)-v_total
    WHERE user_id=v_owner AND id=v_account_id AND type='credit_card' AND currency='PHP' AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_result := jsonb_build_object('operationId',v_operation,'transactionIds','[]'::jsonb,'replayed',false);
  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE user_id=v_owner AND id=v_operation;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.goal_debt_correction_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $correction_dispatch$
DECLARE
  v_definition text;
  v_before constant text := $branch$
  v_kind := p_command->>'kind';
  IF v_kind IN ('reserve','release','reallocate','transaction') THEN
    RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
  END IF;
$branch$;
  v_after constant text := $branch_with_correction$
  v_kind := p_command->>'kind';
  IF v_kind='correct_debt_rows' THEN
    RETURN public.goal_debt_correction_apply(p_request_id,p_command,p_quote);
  END IF;
  IF v_kind IN ('reserve','release','reallocate','transaction') THEN
    RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
  END IF;
$branch_with_correction$;
  v_delete_before constant text := $delete_branch$
    SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
$delete_branch$;
  v_delete_after constant text := $delete_branch_with_debt_guard$
    SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF EXISTS(SELECT 1 FROM public.debt_settlement_events WHERE user_id=v_owner AND purchase_transaction_id=v_tx.id)
      OR EXISTS(SELECT 1 FROM public.debt_correction_events WHERE user_id=v_owner AND purchase_transaction_id=v_tx.id) THEN
      RAISE EXCEPTION 'INVALID_STATE';
    END IF;
    SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
$delete_branch_with_debt_guard$;
BEGIN
  v_definition := replace(pg_get_functiondef('public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure),chr(13),'');
  IF strpos(v_definition,'public.goal_debt_correction_apply')=0 THEN
    IF strpos(v_definition,v_before)=0 THEN RAISE EXCEPTION 'Current financial dispatcher source did not match'; END IF;
    v_definition := replace(v_definition,v_before,v_after);
  ELSIF strpos(v_definition,v_after)=0 THEN
    RAISE EXCEPTION 'Existing correction dispatcher sentinel did not match';
  END IF;
  IF strpos(v_definition,'purchase_transaction_id=v_tx.id')=0 THEN
    IF strpos(v_definition,v_delete_before)=0 THEN RAISE EXCEPTION 'Current transaction-delete branch source did not match'; END IF;
    v_definition := replace(v_definition,v_delete_before,v_delete_after);
  ELSIF strpos(v_definition,v_delete_after)=0 THEN
    RAISE EXCEPTION 'Existing transaction-delete guard sentinel did not match';
  END IF;
  EXECUTE v_definition;
END
$correction_dispatch$;

NOTIFY pgrst, 'reload schema';
COMMIT;
