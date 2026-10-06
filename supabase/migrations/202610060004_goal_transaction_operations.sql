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
    IF v_src.type='credit_card' OR v_draft->>'type'='income' OR
      (v_draft->>'type'='transfer' AND (v_dst.type<>'credit_card' OR v_goal.category<>'debt')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    SELECT coalesce(sum(reserved_delta),0) INTO v_funds FROM public.goal_allocation_events
      WHERE user_id=v_owner AND goal_id=v_goal.id AND account_id=v_src.id;
    IF v_funds<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_RESERVATION'; END IF;
    v_spending := v_amount;
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
  IF v_draft->>'goalId' IS NOT NULL THEN
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
