BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.goal_transaction_apply(uuid,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.goal_finance_apply(uuid,jsonb,jsonb) RENAME TO goal_transaction_apply;
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
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  v_kind := p_command->>'kind';
  IF v_kind IN ('reserve','release','reallocate','transaction') THEN
    RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
  END IF;
  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR p_quote IS NOT NULL
    OR v_kind IS NULL OR v_kind NOT IN ('close','reopen','archive','delete_transaction') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  BEGIN
    IF v_kind='delete_transaction' THEN
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
    IF p_command<>v_command THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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
  IF v_kind<>'delete_transaction' THEN
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
