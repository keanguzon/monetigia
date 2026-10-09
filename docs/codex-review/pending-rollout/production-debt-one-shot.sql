-- Production debt rollout: existing records preserved. Run the entire file once.
-- One transaction: a failure rolls back this batch. No financial commands are executed.

BEGIN;
DO $$
DECLARE required_function text;
BEGIN
  IF to_regclass('public.financial_operations') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.financial_operations. No changes applied.';
  END IF;
  FOREACH required_function IN ARRAY ARRAY['public.goal_finance_apply(uuid,jsonb,jsonb)','public.goal_transaction_quote(jsonb,jsonb)','public.goal_transaction_apply(uuid,jsonb,jsonb)'] LOOP
    IF to_regprocedure(required_function) IS NULL THEN
      RAISE EXCEPTION 'Missing prerequisite: %. No changes applied.', required_function;
    END IF;
  END LOOP;
END $$;

-- 202610070001_installment_purchase_dates.sql
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS installment_group_id uuid;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS purchase_date date;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS history_date date GENERATED ALWAYS AS (coalesce(purchase_date,date)) STORED;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.transactions'::regclass AND conname='transactions_installment_owner_fk') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_installment_owner_fk
      FOREIGN KEY(user_id,installment_group_id) REFERENCES public.financial_operations(user_id,id);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.transactions'::regclass AND conname='transactions_installment_purchase_check') THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_installment_purchase_check
      CHECK ((installment_group_id IS NULL AND purchase_date IS NULL) OR (installment_group_id IS NOT NULL AND type='expense'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS transactions_installment_owner_idx ON public.transactions(user_id,installment_group_id) WHERE installment_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_history_owner_date_idx ON public.transactions(user_id,history_date DESC,created_at DESC,id);

-- Old draft.date identified the schedule month, so it cannot prove the purchase date.
WITH proven AS (
  SELECT op.user_id,op.id AS operation_id,op.command->'draft'->>'accountId' AS account_id,tx_id.value AS transaction_id
  FROM public.financial_operations op
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(op.result->'transactionIds')='array' THEN op.result->'transactionIds' ELSE '[]'::jsonb END) tx_id
  WHERE op.completed_at IS NOT NULL AND op.command->>'kind'='transaction'
    AND op.command->'draft'->>'type'='expense' AND jsonb_typeof(op.command->'draft'->'installments')='object'
    AND op.command->'draft'->'installments'->>'count' ~ '^([1-9]|1[0-2])$'
    AND op.result->>'operationId'=op.id::text
)
UPDATE public.transactions tx SET installment_group_id=proven.operation_id
FROM proven WHERE tx.user_id=proven.user_id AND tx.id::text=proven.transaction_id
  AND tx.account_id::text=proven.account_id AND tx.type='expense' AND tx.installment_group_id IS NULL;

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
      IF jsonb_typeof(v->'installments')<>'object' OR NOT v->'installments' ? 'count'
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(v->'installments') k WHERE k NOT IN ('count','firstDueDate'))
        OR jsonb_typeof(v->'installments'->'count')<>'number' OR v->'installments'->>'count' !~ '^([1-9]|1[0-2])$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      IF v->'installments' ? 'firstDueDate' THEN
        IF jsonb_typeof(v->'installments'->'firstDueDate') IS DISTINCT FROM 'string'
          OR v->'installments'->>'firstDueDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
        v_date := (v->'installments'->>'firstDueDate')::date;
        IF to_char(v_date,'YYYY-MM-DD')<>v->'installments'->>'firstDueDate' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      END IF;
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
    (v_draft->>'type'<>'expense' OR v_src.type<>'credit_card') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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
    IF coalesce(v_dst.balance,0)<v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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

CREATE OR REPLACE FUNCTION public.goal_transaction_apply(p_request_id uuid,p_command jsonb,p_quote jsonb DEFAULT NULL)
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
    v_date := CASE WHEN jsonb_typeof(v_draft->'installments')<>'null' THEN (coalesce(v_draft->'installments'->>'firstDueDate',v_draft->>'date')::date+make_interval(months=>v_i))::date ELSE (v_draft->>'date')::date END;
    v_description := CASE WHEN v_count>1 THEN coalesce(v_draft->>'description','') || format(' (Installment %s/%s)',v_i+1,v_count) ELSE v_draft->>'description' END;
    INSERT INTO public.transactions(user_id,account_id,transfer_to_account_id,category_id,goal_id,type,amount,description,date,installment_group_id,purchase_date)
      VALUES(v_owner,v_src.id,v_dst.id,(v_draft->>'categoryId')::uuid,(v_draft->>'goalId')::uuid,v_draft->>'type',v_piece,v_description,v_date,
        CASE WHEN jsonb_typeof(v_draft->'installments')<>'null' THEN v_operation END,
        CASE WHEN jsonb_typeof(v_draft->'installments')<>'null' THEN (v_draft->>'date')::date END) RETURNING id INTO v_transaction;
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
REVOKE ALL ON FUNCTION public.goal_normalize_transaction(jsonb),public.goal_transaction_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.goal_transaction_quote(jsonb,jsonb) TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';


-- 202610080001_archived_goal_restore.sql
CREATE OR REPLACE FUNCTION public.goal_restore_archived(p_request_id uuid,p_goal_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_command jsonb;
  v_hash text;
  v_previous public.financial_operations%ROWTYPE;
  v_goal public.goals%ROWTYPE;
  v_operation uuid;
  v_result jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_request_id IS NULL OR p_goal_id IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_command := jsonb_build_object('kind','restore','goalId',p_goal_id);
  v_hash := encode(sha256(convert_to(v_command::text,'UTF8')),'hex');

  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;

  SELECT * INTO v_previous FROM public.financial_operations
    WHERE user_id=v_owner AND request_id=p_request_id;
  IF FOUND THEN
    IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN
      RAISE EXCEPTION 'REQUEST_CONFLICT';
    END IF;
    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL THEN
      RAISE EXCEPTION 'INVALID_STATE';
    END IF;
    RETURN v_previous.result || jsonb_build_object('replayed',true);
  END IF;

  PERFORM id FROM public.goals WHERE user_id=v_owner ORDER BY id FOR UPDATE;
  PERFORM id FROM public.accounts WHERE user_id=v_owner ORDER BY id FOR UPDATE;

  SELECT * INTO v_goal FROM public.goals WHERE user_id=v_owner AND id=p_goal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF v_goal.review_state IS DISTINCT FROM 'confirmed'
    OR (v_goal.status IS DISTINCT FROM 'completed' AND v_goal.status IS DISTINCT FROM 'cancelled')
    OR v_goal.archived_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.goal_allocation_events
    WHERE user_id=v_owner AND goal_id=p_goal_id
    GROUP BY account_id
    HAVING sum(reserved_delta)<>0
  ) THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
    VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
  UPDATE public.goals SET archived_at=NULL WHERE user_id=v_owner AND id=p_goal_id;

  v_result := jsonb_build_object('operationId',v_operation,'transactionIds','[]'::jsonb,'replayed',false);
  UPDATE public.financial_operations SET completed_at=now(),result=v_result
    WHERE user_id=v_owner AND id=v_operation;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.goal_restore_archived(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.goal_restore_archived(uuid,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';


-- 202610080002_existing_debt_creation.sql
CREATE TABLE IF NOT EXISTS public.debt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL, operation_id uuid NOT NULL,
  client_id text NOT NULL CHECK(char_length(client_id) BETWEEN 1 AND 100),
  name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 60),
  source text NOT NULL CHECK(source='opening'),
  mode text NOT NULL CHECK(mode IN ('single','installments')),
  original_amount numeric NOT NULL CHECK(original_amount>0 AND original_amount<=9999999999999.99 AND scale(original_amount)<=2),
  first_due_date date NOT NULL CHECK(first_due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  remaining_months integer NOT NULL CHECK(remaining_months BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(mode<>'single' OR remaining_months=1),
  CHECK(original_amount*100>=remaining_months),
  UNIQUE(user_id,id), UNIQUE(user_id,operation_id,client_id),
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,operation_id) REFERENCES public.financial_operations(user_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS public.debt_due_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  debt_item_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 600),
  due_date date NOT NULL CHECK(due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  original_amount numeric NOT NULL CHECK(original_amount>0 AND original_amount<=9999999999999.99 AND scale(original_amount)<=2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id), UNIQUE(user_id,debt_item_id,ordinal),
  FOREIGN KEY(user_id,debt_item_id) REFERENCES public.debt_items(user_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS debt_items_account_idx ON public.debt_items(user_id,account_id,id);
CREATE INDEX IF NOT EXISTS debt_due_rows_owner_date_idx ON public.debt_due_rows(user_id,due_date,debt_item_id,ordinal);
ALTER TABLE public.debt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_due_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS debt_items_owner_select ON public.debt_items;
CREATE POLICY debt_items_owner_select ON public.debt_items FOR SELECT TO authenticated USING(auth.uid()=user_id);
DROP POLICY IF EXISTS debt_due_rows_owner_select ON public.debt_due_rows;
CREATE POLICY debt_due_rows_owner_select ON public.debt_due_rows FOR SELECT TO authenticated USING(auth.uid()=user_id);
REVOKE ALL ON public.debt_items,public.debt_due_rows FROM PUBLIC,anon,authenticated;
DO $$ DECLARE v_table text; v_columns text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['debt_items','debt_due_rows'] LOOP
    SELECT string_agg(quote_ident(attname),',') INTO v_columns FROM pg_attribute WHERE attrelid=('public.'||v_table)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC,anon,authenticated',v_columns,v_table);
  END LOOP;
END $$;
GRANT SELECT ON public.debt_items,public.debt_due_rows TO authenticated;

-- Match JavaScript String.trim without changing opaque client IDs or icon basenames.
CREATE OR REPLACE FUNCTION public.debt_trim_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public AS $$
  SELECT btrim(p_name, E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195)
    || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279));
$$;
REVOKE ALL ON FUNCTION public.debt_trim_name(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.debt_account_create(p_request_id uuid,p_account jsonb,p_opening_debts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_account jsonb; v_items jsonb := '[]'::jsonb; v_item jsonb;
  v_name text; v_client_id text; v_count integer; v_count_numeric numeric; v_date date;
  v_amount numeric; v_total numeric := 0; v_rows integer := 0; v_clients text[] := ARRAY[]::text[];
  v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
  v_operation uuid; v_account_id uuid; v_item_id uuid; v_item_ids jsonb := '[]'::jsonb;
  v_centavos numeric; v_base numeric; v_ordinal integer; v_result jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_account) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_opening_debts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_account))<>9
    OR NOT p_account ?& ARRAY['name','type','currency','color','icon','is_savings','interest_rate','include_in_networth','display_order']
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_account) k WHERE k<>ALL(ARRAY['name','type','currency','color','icon','is_savings','interest_rate','include_in_networth','display_order'])) THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF jsonb_typeof(p_account->'name') IS DISTINCT FROM 'string'
    OR p_account->'type' IS DISTINCT FROM '"credit_card"'::jsonb OR p_account->'currency' IS DISTINCT FROM '"PHP"'::jsonb
    OR jsonb_typeof(p_account->'color') NOT IN ('string','null') OR jsonb_typeof(p_account->'icon') NOT IN ('string','null')
    OR p_account->'is_savings' IS DISTINCT FROM 'false'::jsonb OR p_account->'interest_rate' IS DISTINCT FROM '0'::jsonb
    OR jsonb_typeof(p_account->'include_in_networth') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_account->'display_order') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_name := public.debt_trim_name(p_account->>'name');
  IF char_length(v_name) NOT BETWEEN 1 AND 60
    OR (p_account->>'color' IS NOT NULL AND p_account->>'color' !~ '^#[0-9a-fA-F]{6}$')
    OR (p_account->>'icon' IS NOT NULL AND p_account->>'icon' !~* '^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif|svg)$')
    OR (p_account->>'display_order')::numeric NOT BETWEEN 0 AND 2147483647
    OR trunc((p_account->>'display_order')::numeric)<>(p_account->>'display_order')::numeric THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_account := p_account || jsonb_build_object('name',v_name,'interest_rate',0,'display_order',(p_account->>'display_order')::numeric::integer);
  IF jsonb_array_length(p_opening_debts)>100 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_opening_debts) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(v_item))<>6
      OR NOT v_item ?& ARRAY['clientId','name','mode','amount','firstDueDate','count']
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k<>ALL(ARRAY['clientId','name','mode','amount','firstDueDate','count'])) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF jsonb_typeof(v_item->'clientId') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
      OR v_item->'mode' NOT IN ('"single"'::jsonb,'"installments"'::jsonb)
      OR jsonb_typeof(v_item->'amount') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item->'firstDueDate') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_item->'count') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_name := public.debt_trim_name(v_item->>'name'); v_client_id := v_item->>'clientId';
    IF char_length(v_name) NOT BETWEEN 1 AND 60 OR char_length(v_client_id) NOT BETWEEN 1 AND 100
      OR v_client_id=ANY(v_clients) OR v_item->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
      OR v_item->>'firstDueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_count_numeric := (v_item->>'count')::numeric;
    IF v_count_numeric NOT BETWEEN 1 AND 600 OR trunc(v_count_numeric)<>v_count_numeric
      OR (v_item->>'mode'='single' AND v_count_numeric<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_count := v_count_numeric::integer; v_amount := (v_item->>'amount')::numeric;
    IF v_amount<=0 OR v_amount>9999999999999.99 OR v_amount*100<v_count THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_date := make_date(substring(v_item->>'firstDueDate',1,4)::integer,substring(v_item->>'firstDueDate',6,2)::integer,substring(v_item->>'firstDueDate',9,2)::integer);
    IF v_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
      OR (v_date+make_interval(months=>v_count-1))::date>DATE '9999-12-31' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_total := v_total+v_amount; v_rows := v_rows+v_count;
    IF v_total>9999999999999.99 OR v_rows>6000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_clients := array_append(v_clients,v_client_id);
    v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('name',v_name,'count',v_count));
  END LOOP;
  v_command := jsonb_build_object('kind','create_debt_account','account',v_account,'openingDebts',v_items);
  v_hash := encode(sha256(convert_to(v_command::text,'UTF8')),'hex');
  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO v_previous FROM public.financial_operations WHERE user_id=v_owner AND request_id=p_request_id;
  IF FOUND THEN
    IF v_previous.command_hash<>v_hash OR v_previous.command<>v_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    IF v_previous.completed_at IS NULL OR v_previous.result IS NULL
      OR jsonb_typeof(v_previous.result) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_previous.result->'accountId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_previous.result->'debtItemIds') IS DISTINCT FROM 'array'
      OR v_previous.result->'replayed' IS DISTINCT FROM 'false'::jsonb
      OR (SELECT count(*) FROM jsonb_object_keys(v_previous.result))<>3
      OR jsonb_array_length(v_previous.result->'debtItemIds')<>jsonb_array_length(v_items) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE user_id=v_owner AND id=(v_previous.result->>'accountId')::uuid)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_previous.result->'debtItemIds') i WHERE NOT EXISTS(
        SELECT 1 FROM public.debt_items WHERE user_id=v_owner AND id=i::uuid AND operation_id=v_previous.id
          AND account_id=(v_previous.result->>'accountId')::uuid)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    RETURN v_previous.result || jsonb_build_object('replayed',true);
  END IF;
  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
    VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
  INSERT INTO public.accounts(user_id,name,type,balance,currency,color,icon,is_active,is_savings,interest_rate,include_in_networth,display_order)
    VALUES(v_owner,v_account->>'name','credit_card',v_total,'PHP',v_account->>'color',v_account->>'icon',true,false,0,
      (v_account->>'include_in_networth')::boolean,(v_account->>'display_order')::integer) RETURNING id INTO v_account_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_count := (v_item->>'count')::integer; v_amount := (v_item->>'amount')::numeric; v_date := (v_item->>'firstDueDate')::date;
    INSERT INTO public.debt_items(user_id,account_id,operation_id,client_id,name,source,mode,original_amount,first_due_date,remaining_months)
      VALUES(v_owner,v_account_id,v_operation,v_item->>'clientId',v_item->>'name','opening',v_item->>'mode',v_amount,v_date,v_count) RETURNING id INTO v_item_id;
    v_item_ids := v_item_ids || jsonb_build_array(v_item_id); v_centavos := v_amount*100; v_base := floor(v_centavos/v_count);
    FOR v_ordinal IN 1..v_count LOOP
      INSERT INTO public.debt_due_rows(user_id,debt_item_id,ordinal,due_date,original_amount)
        VALUES(v_owner,v_item_id,v_ordinal,(v_date+make_interval(months=>v_ordinal-1))::date,
          trunc((CASE WHEN v_ordinal=v_count THEN v_centavos-v_base*(v_count-1) ELSE v_base END)/100,2));
    END LOOP;
  END LOOP;
  v_result := jsonb_build_object('accountId',v_account_id,'debtItemIds',v_item_ids,'replayed',false);
  UPDATE public.financial_operations SET result=v_result,completed_at=now() WHERE user_id=v_owner AND id=v_operation;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.debt_account_create(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.debt_account_create(uuid,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_financial_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
    IF EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.transactions WHERE account_id=OLD.id OR transfer_to_account_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.debt_items WHERE account_id=OLD.id) THEN
      RAISE EXCEPTION 'Wallet with financial history cannot be deleted' USING ERRCODE='23503';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME='accounts' AND TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.user_id,NEW.type,NEW.currency,NEW.is_active) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.type,OLD.currency,OLD.is_active)
      AND (EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id)
        OR EXISTS(SELECT 1 FROM public.debt_items WHERE account_id=OLD.id)) THEN
      RAISE EXCEPTION 'Wallet identity with financial history cannot change' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_financial_identity() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';


-- 202610080003_debt_settlements.sql
CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_id_id_key ON public.transactions(user_id,id);

CREATE TABLE IF NOT EXISTS public.debt_settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  amount numeric NOT NULL CHECK(amount>0 AND amount<10000000000000 AND scale(amount)<=2),
  kind text NOT NULL CHECK(kind IN ('settlement','reversal')),
  payment_operation_id uuid NOT NULL,
  payment_transaction_id uuid NOT NULL,
  opening_due_row_id uuid,
  purchase_transaction_id uuid,
  residual_account_id uuid,
  reversal_of uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(opening_due_row_id,purchase_transaction_id,residual_account_id)=1),
  CHECK((kind='reversal')=(reversal_of IS NOT NULL)),
  UNIQUE(user_id,id),
  UNIQUE(user_id,reversal_of),
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,operation_id) REFERENCES public.financial_operations(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,payment_operation_id) REFERENCES public.financial_operations(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,opening_due_row_id) REFERENCES public.debt_due_rows(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,purchase_transaction_id) REFERENCES public.transactions(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,residual_account_id) REFERENCES public.accounts(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,reversal_of) REFERENCES public.debt_settlement_events(user_id,id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS public.debt_correction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  amount numeric NOT NULL CHECK(amount>0 AND amount<10000000000000 AND scale(amount)<=2),
  opening_due_row_id uuid,
  purchase_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(opening_due_row_id,purchase_transaction_id)=1),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,operation_id) REFERENCES public.financial_operations(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,opening_due_row_id) REFERENCES public.debt_due_rows(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,purchase_transaction_id) REFERENCES public.transactions(user_id,id) DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS debt_settlement_payment_target_once
  ON public.debt_settlement_events(user_id,payment_transaction_id,
    coalesce(opening_due_row_id,purchase_transaction_id,residual_account_id))
  WHERE kind='settlement';
CREATE INDEX IF NOT EXISTS debt_settlement_account_history_idx
  ON public.debt_settlement_events(user_id,account_id,created_at,id);
CREATE INDEX IF NOT EXISTS debt_settlement_operation_idx
  ON public.debt_settlement_events(user_id,operation_id);
CREATE INDEX IF NOT EXISTS debt_settlement_target_opening_idx
  ON public.debt_settlement_events(user_id,opening_due_row_id) WHERE opening_due_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS debt_settlement_target_purchase_idx
  ON public.debt_settlement_events(user_id,purchase_transaction_id) WHERE purchase_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS debt_correction_account_history_idx
  ON public.debt_correction_events(user_id,account_id,created_at,id);
CREATE INDEX IF NOT EXISTS debt_correction_target_opening_idx
  ON public.debt_correction_events(user_id,opening_due_row_id) WHERE opening_due_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS debt_correction_target_purchase_idx
  ON public.debt_correction_events(user_id,purchase_transaction_id) WHERE purchase_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_debt_history_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Debt history is append-only' USING ERRCODE='55000';
END $$;

CREATE OR REPLACE FUNCTION public.validate_debt_settlement_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_operation public.financial_operations%ROWTYPE;
  v_payment public.transactions%ROWTYPE;
  v_target_owner uuid;
  v_target_account uuid;
  v_original public.debt_settlement_events%ROWTYPE;
  v_original_amount numeric;
  v_paid numeric;
  v_corrected numeric;
  v_allocated numeric;
BEGIN
  SELECT * INTO v_payment FROM public.transactions
  WHERE user_id=NEW.user_id AND id=NEW.payment_transaction_id;

  IF NEW.kind='reversal' THEN
    SELECT * INTO v_original FROM public.debt_settlement_events
    WHERE user_id=NEW.user_id AND id=NEW.reversal_of FOR UPDATE;
    IF NOT FOUND OR v_original.kind<>'settlement'
      OR (NEW.account_id,NEW.amount,NEW.payment_operation_id,NEW.payment_transaction_id,
          NEW.opening_due_row_id,NEW.purchase_transaction_id,NEW.residual_account_id)
        IS DISTINCT FROM
         (v_original.account_id,v_original.amount,v_original.payment_operation_id,v_original.payment_transaction_id,
          v_original.opening_due_row_id,v_original.purchase_transaction_id,v_original.residual_account_id) THEN
      RAISE EXCEPTION 'Debt settlement reversal must match its source' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.operation_id<>NEW.payment_operation_id OR NOT FOUND THEN
    RAISE EXCEPTION 'Debt settlement requires its proven payment operation' USING ERRCODE='23503';
  END IF;
  SELECT * INTO v_operation FROM public.financial_operations
  WHERE user_id=NEW.user_id AND id=NEW.payment_operation_id;
  IF NOT FOUND OR v_operation.completed_at IS NULL OR v_operation.command->>'kind'<>'transaction'
    OR v_operation.command->'draft'->>'type'<>'transfer'
    OR v_operation.command->'draft'->>'transferToAccountId'<>NEW.account_id::text
    OR v_operation.result->>'operationId'<>v_operation.id::text
    OR jsonb_typeof(v_operation.result->'transactionIds') IS DISTINCT FROM 'array'
    OR NOT (v_operation.result->'transactionIds' ? NEW.payment_transaction_id::text)
    OR v_payment.type<>'transfer' OR v_payment.transfer_to_account_id<>NEW.account_id THEN
    RAISE EXCEPTION 'Debt settlement payment provenance is invalid' USING ERRCODE='23503';
  END IF;

  IF NEW.opening_due_row_id IS NOT NULL THEN
    SELECT item.user_id,item.account_id,due.original_amount
      INTO v_target_owner,v_target_account,v_original_amount
      FROM public.debt_due_rows due JOIN public.debt_items item
        ON item.user_id=due.user_id AND item.id=due.debt_item_id
      WHERE due.id=NEW.opening_due_row_id FOR UPDATE OF due;
    IF FOUND AND v_target_owner=NEW.user_id AND v_target_account<>NEW.account_id THEN
      RAISE EXCEPTION 'Settlement target account mismatch' USING ERRCODE='23503';
    END IF;
    IF FOUND AND v_target_owner=NEW.user_id THEN
      SELECT coalesce(sum(CASE WHEN kind='settlement' THEN amount ELSE -amount END),0)
        INTO v_paid FROM public.debt_settlement_events
        WHERE user_id=NEW.user_id AND opening_due_row_id=NEW.opening_due_row_id;
      SELECT coalesce(sum(amount),0) INTO v_corrected FROM public.debt_correction_events
        WHERE user_id=NEW.user_id AND opening_due_row_id=NEW.opening_due_row_id;
      IF NEW.amount>v_original_amount-v_paid-v_corrected THEN
        RAISE EXCEPTION 'Debt settlement exceeds the unpaid row amount' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF NEW.purchase_transaction_id IS NOT NULL THEN
    SELECT user_id,account_id,amount INTO v_target_owner,v_target_account,v_original_amount
      FROM public.transactions WHERE id=NEW.purchase_transaction_id FOR UPDATE;
    IF FOUND AND v_target_owner=NEW.user_id AND v_target_account<>NEW.account_id THEN
      RAISE EXCEPTION 'Settlement target account mismatch' USING ERRCODE='23503';
    END IF;
    IF FOUND AND v_target_owner=NEW.user_id THEN
      SELECT coalesce(sum(CASE WHEN kind='settlement' THEN amount ELSE -amount END),0)
        INTO v_paid FROM public.debt_settlement_events
        WHERE user_id=NEW.user_id AND purchase_transaction_id=NEW.purchase_transaction_id;
      SELECT coalesce(sum(amount),0) INTO v_corrected FROM public.debt_correction_events
        WHERE user_id=NEW.user_id AND purchase_transaction_id=NEW.purchase_transaction_id;
      IF NEW.amount>v_original_amount-v_paid-v_corrected THEN
        RAISE EXCEPTION 'Debt settlement exceeds the unpaid row amount' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF NEW.residual_account_id<>NEW.account_id THEN
    RAISE EXCEPTION 'Residual settlement account mismatch' USING ERRCODE='23503';
  END IF;

  SELECT coalesce(sum(CASE WHEN kind='settlement' THEN amount ELSE -amount END),0)
    INTO v_allocated FROM public.debt_settlement_events
    WHERE user_id=NEW.user_id AND payment_transaction_id=NEW.payment_transaction_id;
  IF v_allocated+NEW.amount>v_payment.amount THEN
    RAISE EXCEPTION 'Debt settlement exceeds the actual payment amount' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.validate_debt_correction_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_target_owner uuid;
  v_target_account uuid;
  v_original numeric;
  v_paid numeric;
  v_corrected numeric;
BEGIN
  IF NEW.opening_due_row_id IS NOT NULL THEN
    SELECT item.user_id,item.account_id,due.original_amount
      INTO v_target_owner,v_target_account,v_original
      FROM public.debt_due_rows due JOIN public.debt_items item
        ON item.user_id=due.user_id AND item.id=due.debt_item_id
      WHERE due.id=NEW.opening_due_row_id FOR UPDATE OF due;
    IF FOUND AND v_target_owner=NEW.user_id AND v_target_account<>NEW.account_id THEN
      RAISE EXCEPTION 'Correction target account mismatch' USING ERRCODE='23503';
    END IF;
    IF FOUND AND v_target_owner=NEW.user_id THEN
      SELECT coalesce(sum(CASE WHEN kind='settlement' THEN amount ELSE -amount END),0)
        INTO v_paid FROM public.debt_settlement_events WHERE user_id=NEW.user_id AND opening_due_row_id=NEW.opening_due_row_id;
      SELECT coalesce(sum(amount),0) INTO v_corrected FROM public.debt_correction_events WHERE user_id=NEW.user_id AND opening_due_row_id=NEW.opening_due_row_id;
      IF NEW.amount>v_original-v_paid-v_corrected THEN RAISE EXCEPTION 'Debt correction exceeds unpaid row amount' USING ERRCODE='23514'; END IF;
    END IF;
  ELSE
    SELECT user_id,account_id,amount INTO v_target_owner,v_target_account,v_original
      FROM public.transactions WHERE id=NEW.purchase_transaction_id FOR UPDATE;
    IF FOUND AND v_target_owner=NEW.user_id AND v_target_account<>NEW.account_id THEN
      RAISE EXCEPTION 'Correction target account mismatch' USING ERRCODE='23503';
    END IF;
    IF FOUND AND v_target_owner=NEW.user_id THEN
      SELECT coalesce(sum(CASE WHEN kind='settlement' THEN amount ELSE -amount END),0)
        INTO v_paid FROM public.debt_settlement_events WHERE user_id=NEW.user_id AND purchase_transaction_id=NEW.purchase_transaction_id;
      SELECT coalesce(sum(amount),0) INTO v_corrected FROM public.debt_correction_events WHERE user_id=NEW.user_id AND purchase_transaction_id=NEW.purchase_transaction_id;
      IF NEW.amount>v_original-v_paid-v_corrected THEN RAISE EXCEPTION 'Debt correction exceeds unpaid row amount' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.prevent_debt_history_change() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.validate_debt_settlement_event() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.validate_debt_correction_event() FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS debt_settlement_validate ON public.debt_settlement_events;
CREATE TRIGGER debt_settlement_validate BEFORE INSERT ON public.debt_settlement_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_debt_settlement_event();
DROP TRIGGER IF EXISTS debt_correction_validate ON public.debt_correction_events;
CREATE TRIGGER debt_correction_validate BEFORE INSERT ON public.debt_correction_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_debt_correction_event();
DROP TRIGGER IF EXISTS debt_settlement_immutable ON public.debt_settlement_events;
CREATE TRIGGER debt_settlement_immutable BEFORE UPDATE OR DELETE ON public.debt_settlement_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_debt_history_change();
DROP TRIGGER IF EXISTS debt_correction_immutable ON public.debt_correction_events;
CREATE TRIGGER debt_correction_immutable BEFORE UPDATE OR DELETE ON public.debt_correction_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_debt_history_change();

ALTER TABLE public.debt_settlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_correction_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS debt_settlement_owner_read ON public.debt_settlement_events;
CREATE POLICY debt_settlement_owner_read ON public.debt_settlement_events FOR SELECT TO authenticated USING(auth.uid()=user_id);
DROP POLICY IF EXISTS debt_correction_owner_read ON public.debt_correction_events;
CREATE POLICY debt_correction_owner_read ON public.debt_correction_events FOR SELECT TO authenticated USING(auth.uid()=user_id);
REVOKE ALL ON public.debt_settlement_events,public.debt_correction_events FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE v_table text; v_columns text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['debt_settlement_events','debt_correction_events'] LOOP
    SELECT string_agg(quote_ident(attname),',') INTO v_columns FROM pg_attribute
      WHERE attrelid=('public.'||v_table)::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC,anon,authenticated,service_role',v_columns,v_table);
  END LOOP;
END $$;
GRANT SELECT ON public.debt_settlement_events,public.debt_correction_events TO authenticated;

CREATE OR REPLACE FUNCTION public.debt_account_state(p_owner uuid,p_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_account public.accounts%ROWTYPE;
  v_total numeric;
  v_scheduled numeric := 0;
  v_undated numeric := 0;
  v_delta numeric := 0;
  v_rows jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_settlements jsonb := '[]'::jsonb;
  v_corrections jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_review boolean := false;
  v_row_review boolean := false;
  v_payload jsonb;
BEGIN
  IF p_owner IS NULL OR p_account_id IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO v_account FROM public.accounts WHERE user_id=p_owner AND id=p_account_id AND type='credit_card';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;

  v_total := greatest(coalesce(v_account.balance,0),0);
  IF v_account.currency IS DISTINCT FROM 'PHP' OR coalesce(v_account.balance,0)<0 THEN v_review := true; END IF;

  WITH transaction_claims AS (
    SELECT tx.id,tx.user_id,tx.account_id,tx.transfer_to_account_id,tx.type,tx.amount,tx.description,tx.date,tx.created_at,
      tx.installment_group_id,tx.purchase_date,membership.claim_count,
      op.id AS source_operation_id,op.created_at AS operation_created_at,op.completed_at AS source_completed_at,
      op.command_hash AS source_command_hash,op.command AS source_command,op.result AS source_result,
      CASE WHEN jsonb_typeof(op.result->'transactionIds')='array'
        THEN array_position(ARRAY(SELECT jsonb_array_elements_text(op.result->'transactionIds')),tx.id::text) END AS result_ordinal,
      CASE WHEN jsonb_typeof(op.result->'transactionIds')='array'
        THEN jsonb_array_length(op.result->'transactionIds') END AS result_count
    FROM public.transactions tx
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS claim_count,(array_agg(candidate.id))[1] AS claimed_operation_id
      FROM public.financial_operations candidate
      WHERE candidate.user_id=tx.user_id AND candidate.result->'transactionIds' ? tx.id::text
    ) membership ON true
    LEFT JOIN public.financial_operations op
      ON op.user_id=tx.user_id AND op.id=membership.claimed_operation_id AND membership.claim_count=1
    WHERE tx.user_id=p_owner
  ), transaction_provenance AS (
    SELECT claim.*,
      CASE
        WHEN claim.source_operation_id IS NULL OR claim.claim_count<>1 OR claim.operation_created_at IS NULL
          OR claim.source_completed_at IS NULL
          OR claim.source_result->>'operationId'<>claim.source_operation_id::text
          OR claim.source_command->>'kind'<>'transaction'
          OR claim.source_command->'draft'->>'type'<>claim.type
          OR claim.source_command->'draft'->>'accountId'<>claim.account_id::text
          OR claim.result_ordinal IS NULL THEN false
        WHEN claim.type='expense' AND jsonb_typeof(claim.source_command->'draft'->'installments')='null' THEN
          claim.result_count=1 AND claim.result_ordinal=1 AND claim.installment_group_id IS NULL
          AND claim.source_command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND (claim.source_command->'draft'->>'amount')::numeric=claim.amount
        WHEN claim.type='expense' AND jsonb_typeof(claim.source_command->'draft'->'installments')='object'
          AND claim.source_command->'draft'->'installments'->>'count' ~ '^([1-9]|1[0-2])$' THEN
          claim.result_count=(claim.source_command->'draft'->'installments'->>'count')::integer
          AND claim.result_ordinal BETWEEN 1 AND claim.result_count
          AND claim.installment_group_id=claim.source_operation_id
          AND claim.source_command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND claim.amount=(floor((claim.source_command->'draft'->>'amount')::numeric*100/claim.result_count)
            + CASE WHEN claim.result_ordinal<=mod((claim.source_command->'draft'->>'amount')::numeric*100,claim.result_count)
              THEN 1 ELSE 0 END)/100
          AND claim.result_count=(SELECT count(DISTINCT listed.value)::integer
            FROM jsonb_array_elements_text(claim.source_result->'transactionIds') listed(value))
          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(claim.source_result->'transactionIds') listed(value)
            WHERE NOT EXISTS(SELECT 1 FROM public.transactions sibling
              WHERE sibling.user_id=claim.user_id AND sibling.id=listed.value::uuid
                AND sibling.account_id=claim.account_id AND sibling.type='expense'
                AND sibling.installment_group_id=claim.source_operation_id))
        WHEN claim.type='transfer' AND jsonb_typeof(claim.source_command->'draft'->'installments')='null' THEN
          claim.result_count=1 AND claim.result_ordinal=1 AND claim.installment_group_id IS NULL
          AND claim.source_command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND (claim.source_command->'draft'->>'amount')::numeric=claim.amount
          AND claim.transfer_to_account_id IS NOT NULL
          AND claim.source_command->'draft'->>'transferToAccountId'=claim.transfer_to_account_id::text
        ELSE false
      END AS proven
    FROM transaction_claims claim
  ), purchase_rows AS (
    SELECT p.id,p.user_id,p.account_id,p.type,p.amount,p.description,
      CASE WHEN p.proven THEN p.date ELSE NULL::date END AS date,p.created_at,p.installment_group_id,p.purchase_date,
      p.source_operation_id,p.operation_created_at,p.source_command_hash,p.source_result,p.proven,
      CASE WHEN p.proven AND p.installment_group_id IS NOT NULL THEN p.installment_group_id ELSE p.id END AS group_id,
      CASE WHEN p.proven AND p.installment_group_id IS NOT NULL THEN p.result_ordinal ELSE 1 END AS ordinal,
      coalesce(nullif(btrim(p.description),''),nullif(c.name,''),'Purchase') AS row_name
    FROM transaction_provenance p
    LEFT JOIN public.transactions tx ON tx.user_id=p.user_id AND tx.id=p.id
    LEFT JOIN public.categories c ON c.id=tx.category_id
    WHERE p.account_id=p_account_id AND p.type='expense'
  ), row_base AS (
    SELECT due.id,due.user_id,item.account_id,item.id AS group_id,'opening'::text AS source,
      NULL::uuid AS transaction_id,due.due_date,due.original_amount,due.ordinal,item.name,
      EXISTS(SELECT 1 FROM public.financial_operations op
        WHERE op.user_id=item.user_id AND op.id=item.operation_id AND op.completed_at IS NOT NULL
          AND op.command->>'kind'='create_debt_account'
          AND op.result->>'accountId'=item.account_id::text
          AND jsonb_typeof(op.result->'debtItemIds')='array'
          AND op.result->'debtItemIds' ? item.id::text
          AND (SELECT count(*) FROM public.financial_operations claim
            WHERE claim.user_id=item.user_id AND claim.result->'debtItemIds' ? item.id::text)=1) AS proven,
      coalesce((SELECT sum(CASE WHEN event.kind='settlement' THEN event.amount ELSE -event.amount END)
        FROM public.debt_settlement_events event WHERE event.user_id=due.user_id AND event.opening_due_row_id=due.id),0) AS paid,
      coalesce((SELECT sum(event.amount) FROM public.debt_correction_events event
        WHERE event.user_id=due.user_id AND event.opening_due_row_id=due.id),0) AS corrected
    FROM public.debt_due_rows due JOIN public.debt_items item
      ON item.user_id=due.user_id AND item.id=due.debt_item_id
    WHERE due.user_id=p_owner AND item.account_id=p_account_id AND item.source='opening'
    UNION ALL
    SELECT p.id,p.user_id,p.account_id,p.group_id,'purchase'::text,p.id,p.date,p.amount,p.ordinal,p.row_name,
      p.proven,
      coalesce((SELECT sum(CASE WHEN event.kind='settlement' THEN event.amount ELSE -event.amount END)
        FROM public.debt_settlement_events event WHERE event.user_id=p.user_id AND event.purchase_transaction_id=p.id),0),
      coalesce((SELECT sum(event.amount) FROM public.debt_correction_events event
        WHERE event.user_id=p.user_id AND event.purchase_transaction_id=p.id),0)
    FROM purchase_rows p
    WHERE p.amount>0 AND p.amount<10000000000000 AND scale(p.amount)<=2
  ), row_values AS (
    SELECT row_base.*,(original_amount-paid-corrected) AS remaining
    FROM row_base
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'accountId',account_id,'groupId',group_id,'source',source,'transactionId',transaction_id,
      'dueDate',due_date::text,'originalAmount',to_char(original_amount,'FM9999999999990.00'),
      'paidAmount',to_char(paid,'FM9999999999990.00'),'remainingAmount',to_char(remaining,'FM9999999999990.00'),
      'correctedAmount',to_char(corrected,'FM9999999999990.00'),'ordinal',ordinal,'name',name
    ) ORDER BY due_date NULLS LAST,group_id,ordinal,id),'[]'::jsonb),
    coalesce(sum(remaining),0),coalesce(bool_or(NOT proven OR remaining<0),false)
    INTO v_rows,v_scheduled,v_row_review FROM row_values;

  IF v_row_review THEN v_review := true; END IF;

  WITH related AS (
    SELECT tx.*,
      op.id AS source_operation_id,op.command_hash AS source_command_hash,op.command AS source_command,op.result AS source_result,
      CASE
        WHEN membership.claim_count<>1 OR op.id IS NULL OR op.completed_at IS NULL
          OR op.result->>'operationId'<>op.id::text OR op.command->>'kind'<>'transaction'
          OR op.command->'draft'->>'type'<>tx.type OR op.command->'draft'->>'accountId'<>tx.account_id::text
          OR jsonb_typeof(op.result->'transactionIds') IS DISTINCT FROM 'array'
          OR array_position(ARRAY(SELECT jsonb_array_elements_text(op.result->'transactionIds')),tx.id::text) IS NULL THEN false
        WHEN tx.type='expense' AND jsonb_typeof(op.command->'draft'->'installments')='null' THEN
          jsonb_array_length(op.result->'transactionIds')=1 AND tx.installment_group_id IS NULL
          AND op.command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND (op.command->'draft'->>'amount')::numeric=tx.amount
        WHEN tx.type='expense' AND jsonb_typeof(op.command->'draft'->'installments')='object'
          AND op.command->'draft'->'installments'->>'count' ~ '^([1-9]|1[0-2])$' THEN
          jsonb_array_length(op.result->'transactionIds')=(op.command->'draft'->'installments'->>'count')::integer
          AND tx.installment_group_id=op.id
        WHEN tx.type='transfer' AND jsonb_typeof(op.command->'draft'->'installments')='null' THEN
          jsonb_array_length(op.result->'transactionIds')=1 AND tx.installment_group_id IS NULL
          AND op.command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND (op.command->'draft'->>'amount')::numeric=tx.amount
          AND op.command->'draft'->>'transferToAccountId' IS NOT DISTINCT FROM tx.transfer_to_account_id::text
        ELSE false
      END AS proven
    FROM public.transactions tx
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS claim_count,(array_agg(candidate.id))[1] AS claimed_operation_id
      FROM public.financial_operations candidate
      WHERE candidate.user_id=tx.user_id AND candidate.result->'transactionIds' ? tx.id::text
    ) membership ON true
    LEFT JOIN public.financial_operations op
      ON op.user_id=tx.user_id AND op.id=membership.claimed_operation_id AND membership.claim_count=1
    WHERE tx.user_id=p_owner AND (tx.account_id=p_account_id OR tx.transfer_to_account_id=p_account_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'transactionId',id,'accountId',account_id,'transferToAccountId',transfer_to_account_id,
    'type',type,'amount',to_char(amount,'FM9999999999990.00'),'date',date::text,
    'installmentGroupId',installment_group_id,'purchaseDate',purchase_date::text,
    'operationId',source_operation_id,'commandHash',source_command_hash,'command',source_command,'result',source_result,'proven',proven
  ) ORDER BY id),'[]'::jsonb),
  coalesce(bool_or(NOT proven OR type='income'),false)
  INTO v_history,v_row_review FROM related;
  IF v_row_review THEN v_review := true; END IF;

  IF EXISTS(
    SELECT 1 FROM public.transactions tx
    WHERE tx.user_id=p_owner AND tx.transfer_to_account_id=p_account_id AND tx.type='transfer'
      AND (SELECT coalesce(sum(CASE WHEN event.kind='settlement' THEN event.amount ELSE -event.amount END),0)
        FROM public.debt_settlement_events event
        WHERE event.user_id=tx.user_id AND event.payment_transaction_id=tx.id)<>tx.amount
  ) THEN v_review := true; END IF;

  v_delta := v_total-v_scheduled;
  v_undated := greatest(v_delta,0);
  IF v_delta<0 THEN v_review := true; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'accountId',account_id,'operationId',operation_id,'amount',to_char(amount,'FM9999999999990.00'),
    'kind',kind,'paymentOperationId',payment_operation_id,'paymentTransactionId',payment_transaction_id,
    'openingDueRowId',opening_due_row_id,'purchaseTransactionId',purchase_transaction_id,
    'residualAccountId',residual_account_id,'reversalOf',reversal_of
  ) ORDER BY id),'[]'::jsonb) INTO v_settlements
  FROM public.debt_settlement_events WHERE user_id=p_owner AND account_id=p_account_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'accountId',account_id,'operationId',operation_id,'amount',to_char(amount,'FM9999999999990.00'),
    'openingDueRowId',opening_due_row_id,'purchaseTransactionId',purchase_transaction_id
  ) ORDER BY id),'[]'::jsonb) INTO v_corrections
  FROM public.debt_correction_events WHERE user_id=p_owner AND account_id=p_account_id;

  v_payload := jsonb_build_object(
    'account',jsonb_build_object('accountId',v_account.id,'name',v_account.name,'type',v_account.type,
      'currency',v_account.currency,'isActive',v_account.is_active,'balance',to_char(v_account.balance,'FM9999999999990.00')),
    'rows',v_rows,'settlements',v_settlements,'corrections',v_corrections,'history',v_history
  );
  v_fingerprint := encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  RETURN jsonb_build_object('account',jsonb_build_object(
      'accountId',v_account.id,'totalOutstanding',to_char(v_total,'FM9999999999990.00'),
      'undatedOutstanding',to_char(v_undated,'FM9999999999990.00'),'fingerprint',v_fingerprint,
      'reconciliation',CASE WHEN v_review THEN 'needs_review' ELSE 'balanced' END,
      'reconciliationDelta',to_char(CASE WHEN v_review THEN v_delta
        ELSE v_total-v_scheduled-v_undated END,'FM9999999999990.00')),
    'rows',v_rows);
END $$;

REVOKE ALL ON FUNCTION public.debt_account_state(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE
  v_payment record;
  v_target record;
  v_remaining numeric;
  v_paid numeric;
  v_corrected numeric;
  v_allocate numeric;
BEGIN
  FOR v_payment IN
    SELECT op.user_id,op.id AS operation_id,op.created_at AS operation_created_at,tx.created_at AS transaction_created_at,
      tx.id AS transaction_id,tx.transfer_to_account_id AS account_id,tx.amount
    FROM public.transactions tx
    JOIN public.accounts target_account ON target_account.user_id=tx.user_id AND target_account.id=tx.transfer_to_account_id
    JOIN LATERAL (
      SELECT count(*)::integer AS claim_count,(array_agg(candidate.id))[1] AS claimed_operation_id
      FROM public.financial_operations candidate
      WHERE candidate.user_id=tx.user_id AND candidate.result->'transactionIds' ? tx.id::text
    ) membership ON true
    JOIN public.financial_operations op
      ON op.user_id=tx.user_id AND op.id=membership.claimed_operation_id AND membership.claim_count=1
    WHERE op.completed_at IS NOT NULL AND op.command->>'kind'='transaction'
      AND op.command->'draft'->>'type'='transfer'
      AND op.command->'draft'->>'accountId'=tx.account_id::text
      AND op.command->'draft'->>'transferToAccountId'=tx.transfer_to_account_id::text
      AND op.command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
      AND (op.command->'draft'->>'amount')::numeric=tx.amount
      AND jsonb_typeof(op.command->'draft'->'installments')='null'
      AND op.result->>'operationId'=op.id::text
      AND jsonb_typeof(op.result->'transactionIds')='array'
      AND jsonb_array_length(op.result->'transactionIds')=1
      AND op.result->'transactionIds' ? tx.id::text
      AND target_account.type='credit_card' AND tx.type='transfer'
      AND tx.transfer_to_account_id IS NOT NULL AND tx.installment_group_id IS NULL
    ORDER BY op.created_at,tx.created_at,op.id,tx.id
  LOOP
    IF EXISTS(SELECT 1 FROM public.debt_settlement_events event
      WHERE event.user_id=v_payment.user_id AND event.payment_transaction_id=v_payment.transaction_id AND event.kind='settlement') THEN
      CONTINUE;
    END IF;
    -- A payment can be reconstructed only when the account history preceding it is complete.
    IF EXISTS(
      SELECT 1 FROM public.transactions prior
      WHERE prior.user_id=v_payment.user_id
        AND (prior.account_id=v_payment.account_id OR prior.transfer_to_account_id=v_payment.account_id)
        AND prior.created_at<=v_payment.transaction_created_at
        AND (prior.type='income' OR NOT EXISTS(
          SELECT 1 FROM public.financial_operations source_op
          WHERE source_op.user_id=prior.user_id AND source_op.completed_at IS NOT NULL
            AND source_op.command->>'kind'='transaction'
            AND source_op.command->'draft'->>'type'=prior.type
            AND source_op.command->'draft'->>'accountId'=prior.account_id::text
            AND source_op.result->>'operationId'=source_op.id::text
            AND jsonb_typeof(source_op.result->'transactionIds')='array'
            AND source_op.result->'transactionIds' ? prior.id::text
            AND (SELECT count(*) FROM public.financial_operations claimed
              WHERE claimed.user_id=prior.user_id AND claimed.result->'transactionIds' ? prior.id::text)=1
            AND ((prior.type='transfer'
                AND jsonb_typeof(source_op.command->'draft'->'installments')='null'
                AND jsonb_array_length(source_op.result->'transactionIds')=1
                AND prior.installment_group_id IS NULL
                AND source_op.command->'draft'->>'transferToAccountId' IS NOT DISTINCT FROM prior.transfer_to_account_id::text
                AND source_op.command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
                AND (source_op.command->'draft'->>'amount')::numeric=prior.amount)
              OR (prior.type='expense' AND source_op.command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
                AND ((jsonb_typeof(source_op.command->'draft'->'installments')='null'
                    AND jsonb_array_length(source_op.result->'transactionIds')=1
                    AND prior.installment_group_id IS NULL
                    AND (source_op.command->'draft'->>'amount')::numeric=prior.amount)
                  OR (jsonb_typeof(source_op.command->'draft'->'installments')='object'
                    AND source_op.command->'draft'->'installments'->>'count' ~ '^([1-9]|1[0-2])$'
                    AND jsonb_array_length(source_op.result->'transactionIds')=(source_op.command->'draft'->'installments'->>'count')::integer
                    AND prior.installment_group_id=source_op.id))))
        ))
    ) OR EXISTS(
      SELECT 1 FROM public.debt_items item JOIN public.debt_due_rows due
        ON due.user_id=item.user_id AND due.debt_item_id=item.id
      WHERE item.user_id=v_payment.user_id AND item.account_id=v_payment.account_id
        AND item.source='opening' AND item.created_at<=v_payment.transaction_created_at
        AND NOT EXISTS(SELECT 1 FROM public.financial_operations source_op
          WHERE source_op.user_id=item.user_id AND source_op.id=item.operation_id AND source_op.completed_at IS NOT NULL
            AND source_op.command->>'kind'='create_debt_account'
            AND source_op.result->>'accountId'=item.account_id::text
            AND source_op.result->'debtItemIds' ? item.id::text
            AND (SELECT count(*) FROM public.financial_operations claimed
              WHERE claimed.user_id=item.user_id AND claimed.result->'debtItemIds' ? item.id::text)=1)
    ) THEN
      CONTINUE;
    END IF;
    v_remaining := v_payment.amount;
    FOR v_target IN
      WITH eligible AS (
        SELECT 'opening'::text AS target_kind,due.id AS opening_id,NULL::uuid AS purchase_id,
          due.original_amount,due.due_date,item.id AS group_id,due.ordinal,source_op.created_at AS source_created_at
        FROM public.debt_due_rows due JOIN public.debt_items item
          ON item.user_id=due.user_id AND item.id=due.debt_item_id
        JOIN public.financial_operations source_op ON source_op.user_id=item.user_id AND source_op.id=item.operation_id
        WHERE due.user_id=v_payment.user_id AND item.account_id=v_payment.account_id AND item.source='opening'
          AND source_op.completed_at IS NOT NULL AND item.created_at<=v_payment.transaction_created_at
          AND source_op.command->>'kind'='create_debt_account'
          AND source_op.result->>'accountId'=item.account_id::text
          AND source_op.result->'debtItemIds' ? item.id::text
          AND (SELECT count(*) FROM public.financial_operations claimed
            WHERE claimed.user_id=item.user_id AND claimed.result->'debtItemIds' ? item.id::text)=1
        UNION ALL
        SELECT 'purchase'::text,NULL::uuid,tx.id,tx.amount,tx.date,
          CASE WHEN jsonb_typeof(source_op.command->'draft'->'installments')='object'
            THEN tx.installment_group_id ELSE tx.id END,
          CASE WHEN jsonb_typeof(source_op.command->'draft'->'installments')='object'
            THEN array_position(ARRAY(SELECT jsonb_array_elements_text(source_op.result->'transactionIds')),tx.id::text)
            ELSE 1 END,source_op.created_at
        FROM public.transactions tx
        JOIN public.financial_operations source_op ON source_op.user_id=tx.user_id
          AND source_op.completed_at IS NOT NULL AND source_op.command->>'kind'='transaction'
          AND source_op.command->'draft'->>'type'='expense' AND source_op.command->'draft'->>'accountId'=tx.account_id::text
          AND source_op.result->>'operationId'=source_op.id::text
          AND source_op.result->'transactionIds' ? tx.id::text
          AND (SELECT count(*) FROM public.financial_operations claimed
            WHERE claimed.user_id=tx.user_id AND claimed.result->'transactionIds' ? tx.id::text)=1
        WHERE tx.user_id=v_payment.user_id AND tx.account_id=v_payment.account_id AND tx.type='expense'
          AND tx.amount>0 AND tx.amount<10000000000000 AND tx.created_at<=v_payment.transaction_created_at
          AND ((jsonb_typeof(source_op.command->'draft'->'installments')='null'
              AND jsonb_array_length(source_op.result->'transactionIds')=1
              AND tx.installment_group_id IS NULL
              AND source_op.command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
              AND (source_op.command->'draft'->>'amount')::numeric=tx.amount)
            OR (jsonb_typeof(source_op.command->'draft'->'installments')='object'
              AND source_op.command->'draft'->'installments'->>'count' ~ '^([1-9]|1[0-2])$'
              AND jsonb_array_length(source_op.result->'transactionIds')=(source_op.command->'draft'->'installments'->>'count')::integer
              AND tx.installment_group_id=source_op.id))
      )
      SELECT eligible.* FROM eligible
      ORDER BY due_date,group_id,ordinal,coalesce(opening_id,purchase_id)
    LOOP
      EXIT WHEN v_remaining<=0;
      IF v_target.target_kind='opening' THEN
        SELECT coalesce(sum(CASE WHEN kind='settlement' THEN amount ELSE -amount END),0)
          INTO v_paid FROM public.debt_settlement_events
          WHERE user_id=v_payment.user_id AND opening_due_row_id=v_target.opening_id;
        SELECT coalesce(sum(amount),0) INTO v_corrected FROM public.debt_correction_events
          WHERE user_id=v_payment.user_id AND opening_due_row_id=v_target.opening_id;
      ELSE
        SELECT coalesce(sum(CASE WHEN kind='settlement' THEN amount ELSE -amount END),0)
          INTO v_paid FROM public.debt_settlement_events
          WHERE user_id=v_payment.user_id AND purchase_transaction_id=v_target.purchase_id;
        SELECT coalesce(sum(amount),0) INTO v_corrected FROM public.debt_correction_events
          WHERE user_id=v_payment.user_id AND purchase_transaction_id=v_target.purchase_id;
      END IF;
      v_allocate := least(v_remaining,greatest(v_target.original_amount-v_paid-v_corrected,0));
      IF v_allocate>0 THEN
        INSERT INTO public.debt_settlement_events(user_id,account_id,operation_id,amount,kind,payment_operation_id,
          payment_transaction_id,opening_due_row_id,purchase_transaction_id,created_at)
        VALUES(v_payment.user_id,v_payment.account_id,v_payment.operation_id,v_allocate,'settlement',v_payment.operation_id,
          v_payment.transaction_id,v_target.opening_id,v_target.purchase_id,v_payment.operation_created_at);
        v_remaining := v_remaining-v_allocate;
      END IF;
    END LOOP;
    IF v_remaining>0 THEN
      INSERT INTO public.debt_settlement_events(user_id,account_id,operation_id,amount,kind,payment_operation_id,
        payment_transaction_id,residual_account_id,created_at)
      VALUES(v_payment.user_id,v_payment.account_id,v_payment.operation_id,v_remaining,'settlement',v_payment.operation_id,
        v_payment.transaction_id,v_payment.account_id,v_payment.operation_created_at);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guard_financial_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
    IF EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.transactions WHERE account_id=OLD.id OR transfer_to_account_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.debt_items WHERE account_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.debt_settlement_events WHERE account_id=OLD.id)
      OR EXISTS(SELECT 1 FROM public.debt_correction_events WHERE account_id=OLD.id) THEN
      RAISE EXCEPTION 'Wallet with financial history cannot be deleted' USING ERRCODE='23503';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME='accounts' AND TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.user_id,NEW.type,NEW.currency,NEW.is_active) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.type,OLD.currency,OLD.is_active)
      AND (EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id)
        OR EXISTS(SELECT 1 FROM public.debt_items WHERE account_id=OLD.id)
        OR EXISTS(SELECT 1 FROM public.debt_settlement_events WHERE account_id=OLD.id)
        OR EXISTS(SELECT 1 FROM public.debt_correction_events WHERE account_id=OLD.id)) THEN
      RAISE EXCEPTION 'Wallet identity with financial history cannot change' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_financial_identity() FROM PUBLIC,anon,authenticated,service_role;

-- Patch the newest transaction functions in place so later migration changes are not replaced by an older copy.
DO $debt_payment_integration$
DECLARE
  v_quote text := pg_get_functiondef('public.goal_transaction_quote(jsonb,jsonb)'::regprocedure);
  v_apply text := pg_get_functiondef('public.goal_transaction_apply(uuid,jsonb,jsonb)'::regprocedure);
  v_before text;
BEGIN
  v_quote := replace(v_quote,chr(13),'');
  v_apply := replace(v_apply,chr(13),'');
  IF strpos(v_quote,'public.debt_account_state')=0 THEN
  v_before := replace($quote_declaration$
  v_funds numeric; v_metadata jsonb; v_fingerprint text; v_month record; v_carry numeric := 0; v_month_debt numeric := 0;
$quote_declaration$,chr(13),'');
  IF strpos(v_quote,v_before)=0 THEN RAISE EXCEPTION 'Latest transaction quote declaration did not match'; END IF;
  v_quote := replace(v_quote,v_before,replace($quote_declaration_new$
  v_funds numeric; v_metadata jsonb; v_fingerprint text; v_month record; v_debt_state jsonb; v_outstanding numeric;
$quote_declaration_new$,chr(13),''));

  v_before := replace($quote_month_ceiling$
  IF v_draft->>'type'='transfer' AND v_dst.type='credit_card' THEN
    IF coalesce(v_dst.balance,0)<v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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
$quote_month_ceiling$,chr(13),'');
  IF strpos(v_quote,v_before)=0 THEN RAISE EXCEPTION 'Latest transaction quote ceiling did not match'; END IF;
  v_quote := replace(v_quote,v_before,replace($quote_month_ceiling_new$
  IF v_draft->>'type'='transfer' AND v_dst.type='credit_card' THEN
    IF coalesce(v_dst.balance,0)<v_amount THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_debt_state := public.debt_account_state(v_owner,v_dst.id);
    v_outstanding := (v_debt_state->'account'->>'totalOutstanding')::numeric;
    IF v_amount>v_outstanding THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  END IF;
$quote_month_ceiling_new$,chr(13),''));

  v_before := replace($quote_metadata$
    'debtTransactions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.transactions t WHERE t.user_id=v_owner AND v_dst.type='credit_card' AND (t.account_id=v_dst.id OR t.transfer_to_account_id=v_dst.id))) INTO v_metadata;
$quote_metadata$,chr(13),'');
  IF strpos(v_quote,v_before)=0 THEN RAISE EXCEPTION 'Latest transaction quote fingerprint did not match'; END IF;
  v_quote := replace(v_quote,v_before,replace($quote_metadata_new$
    'debtAccountState',CASE WHEN v_dst.type='credit_card' THEN v_debt_state ELSE 'null'::jsonb END,
    'debtTransactions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.transactions t WHERE t.user_id=v_owner AND v_dst.type='credit_card' AND (t.account_id=v_dst.id OR t.transfer_to_account_id=v_dst.id))) INTO v_metadata;
$quote_metadata_new$,chr(13),''));
  END IF;
  EXECUTE v_quote;

  IF strpos(v_apply,'public.debt_settlement_events')=0 THEN
  v_before := replace($apply_declaration$
  v_amount numeric; v_piece numeric; v_count integer; v_i integer; v_date date; v_description text;
$apply_declaration$,chr(13),'');
  IF strpos(v_apply,v_before)=0 THEN RAISE EXCEPTION 'Latest transaction apply declaration did not match'; END IF;
  v_apply := replace(v_apply,v_before,replace($apply_declaration_new$
  v_amount numeric; v_piece numeric; v_count integer; v_i integer; v_date date; v_description text;
  v_debt_state jsonb; v_target jsonb; v_allocate numeric; v_remaining numeric; v_payment_transaction_id uuid;
$apply_declaration_new$,chr(13),''));

  v_before := replace($apply_account_lock$
  v_amount := (v_draft->>'amount')::numeric;
  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
$apply_account_lock$,chr(13),'');
  IF strpos(v_apply,v_before)=0 THEN RAISE EXCEPTION 'Latest transaction apply lock point did not match'; END IF;
  v_apply := replace(v_apply,v_before,replace($apply_account_lock_new$
  v_amount := (v_draft->>'amount')::numeric;
  IF v_draft->>'type'='transfer' AND v_dst.type='credit_card' THEN
    v_debt_state := public.debt_account_state(v_owner,v_dst.id);
    FOR v_target IN SELECT value FROM jsonb_array_elements(v_debt_state->'rows') LOOP
      IF v_target->>'source'='opening' THEN
        PERFORM id FROM public.debt_due_rows WHERE user_id=v_owner AND id=(v_target->>'id')::uuid FOR UPDATE;
      ELSIF v_target->>'source'='purchase' AND v_target->>'transactionId' IS NOT NULL THEN
        PERFORM id FROM public.transactions WHERE user_id=v_owner AND id=(v_target->>'transactionId')::uuid FOR UPDATE;
      END IF;
    END LOOP;
  END IF;
  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command) VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
$apply_account_lock_new$,chr(13),''));

  v_before := replace($apply_finish$
  v_result := jsonb_build_object('operationId',v_operation,'transactionIds',v_ids,'replayed',false);
  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=v_operation AND user_id=v_owner;
  RETURN v_result;
$apply_finish$,chr(13),'');
  IF strpos(v_apply,v_before)=0 THEN RAISE EXCEPTION 'Latest transaction apply finish did not match'; END IF;
  v_apply := replace(v_apply,v_before,replace($apply_finish_new$
  v_result := jsonb_build_object('operationId',v_operation,'transactionIds',v_ids,'replayed',false);
  IF v_draft->>'type'='transfer' AND v_dst.type='credit_card'
    AND v_debt_state->'account'->>'reconciliation'='balanced' THEN
    v_payment_transaction_id := (v_ids->>0)::uuid;
    UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=v_operation AND user_id=v_owner;
    v_remaining := v_amount;
    FOR v_target IN
      SELECT row_value.value FROM jsonb_array_elements(v_debt_state->'rows') WITH ORDINALITY AS row_value(value,position)
      WHERE row_value.value->>'dueDate' IS NOT NULL ORDER BY row_value.position
    LOOP
      EXIT WHEN v_remaining<=0;
      v_allocate := least(v_remaining,greatest((v_target->>'remainingAmount')::numeric,0));
      IF v_allocate>0 THEN
        INSERT INTO public.debt_settlement_events(user_id,account_id,operation_id,amount,kind,payment_operation_id,
          payment_transaction_id,opening_due_row_id,purchase_transaction_id)
        VALUES(v_owner,v_dst.id,v_operation,v_allocate,'settlement',v_operation,v_payment_transaction_id,
          CASE WHEN v_target->>'source'='opening' THEN (v_target->>'id')::uuid END,
          CASE WHEN v_target->>'source'='purchase' THEN (v_target->>'transactionId')::uuid END);
        v_remaining := v_remaining-v_allocate;
      END IF;
    END LOOP;
    IF v_remaining>0 THEN
      INSERT INTO public.debt_settlement_events(user_id,account_id,operation_id,amount,kind,payment_operation_id,
        payment_transaction_id,residual_account_id)
      VALUES(v_owner,v_dst.id,v_operation,v_remaining,'settlement',v_operation,v_payment_transaction_id,v_dst.id);
    END IF;
  ELSE
    UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=v_operation AND user_id=v_owner;
  END IF;
  RETURN v_result;
$apply_finish_new$,chr(13),''));
  END IF;
  EXECUTE v_apply;
END
$debt_payment_integration$;

CREATE OR REPLACE FUNCTION public.reverse_debt_settlements_before_transaction_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_event public.debt_settlement_events%ROWTYPE;
  v_operation_id uuid;
  v_operation_count integer;
  v_payment_count integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
  IF OLD.type<>'transfer' OR OLD.transfer_to_account_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.accounts account WHERE account.user_id=OLD.user_id
      AND account.id=OLD.transfer_to_account_id AND account.type='credit_card') THEN
    RETURN OLD;
  END IF;

  SELECT count(*) INTO v_payment_count FROM public.debt_settlement_events event
    WHERE event.user_id=OLD.user_id AND event.payment_transaction_id=OLD.id AND event.kind='settlement';
  IF v_payment_count=0 THEN RETURN OLD; END IF;
  IF EXISTS(SELECT 1 FROM public.debt_settlement_events event
      JOIN public.debt_settlement_events reversal ON reversal.user_id=event.user_id AND reversal.reversal_of=event.id
      WHERE event.user_id=OLD.user_id AND event.payment_transaction_id=OLD.id AND event.kind='settlement') THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  SELECT count(*)::integer,(array_agg(operation.id ORDER BY operation.id))[1]
    INTO v_operation_count,v_operation_id
    FROM public.financial_operations operation
    WHERE operation.user_id=OLD.user_id AND operation.completed_at IS NULL
      AND operation.command->>'kind'='delete_transaction'
      AND operation.command->>'transactionId'=OLD.id::text;
  IF v_operation_count<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  FOR v_event IN SELECT * FROM public.debt_settlement_events event
    WHERE event.user_id=OLD.user_id AND event.payment_transaction_id=OLD.id AND event.kind='settlement'
    ORDER BY event.id FOR UPDATE
  LOOP
    INSERT INTO public.debt_settlement_events(user_id,account_id,operation_id,amount,kind,payment_operation_id,
      payment_transaction_id,opening_due_row_id,purchase_transaction_id,residual_account_id,reversal_of)
    VALUES(v_event.user_id,v_event.account_id,v_operation_id,v_event.amount,'reversal',v_event.payment_operation_id,
      v_event.payment_transaction_id,v_event.opening_due_row_id,v_event.purchase_transaction_id,
      v_event.residual_account_id,v_event.id);
  END LOOP;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.reverse_debt_settlements_before_transaction_delete() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS debt_settlement_payment_delete_reverse ON public.transactions;
CREATE TRIGGER debt_settlement_payment_delete_reverse BEFORE DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.reverse_debt_settlements_before_transaction_delete();

NOTIFY pgrst, 'reload schema';


-- 202610080004_debt_corrections.sql
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
  v_before constant text := replace($branch$
  v_kind := p_command->>'kind';
  IF v_kind IN ('reserve','release','reallocate','transaction') THEN
    RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
  END IF;
$branch$,chr(13),'');
  v_after constant text := replace($branch_with_correction$
  v_kind := p_command->>'kind';
  IF v_kind='correct_debt_rows' THEN
    RETURN public.goal_debt_correction_apply(p_request_id,p_command,p_quote);
  END IF;
  IF v_kind IN ('reserve','release','reallocate','transaction') THEN
    RETURN public.goal_transaction_apply(p_request_id,p_command,p_quote);
  END IF;
$branch_with_correction$,chr(13),'');
  v_delete_before constant text := replace($delete_branch$
    SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
$delete_branch$,chr(13),'');
  v_delete_after constant text := replace($delete_branch_with_debt_guard$
    SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF EXISTS(SELECT 1 FROM public.debt_settlement_events WHERE user_id=v_owner AND purchase_transaction_id=v_tx.id)
      OR EXISTS(SELECT 1 FROM public.debt_correction_events WHERE user_id=v_owner AND purchase_transaction_id=v_tx.id) THEN
      RAISE EXCEPTION 'INVALID_STATE';
    END IF;
    SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
$delete_branch_with_debt_guard$,chr(13),'');
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


-- 202610080005_debt_snapshot_adoption.sql
CREATE OR REPLACE FUNCTION public.debt_validate_opening_items(p_opening_debts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_items jsonb := '[]'::jsonb; v_item jsonb; v_name text; v_client_id text;
  v_count integer; v_count_numeric numeric; v_date date; v_amount numeric;
  v_total numeric := 0; v_rows integer := 0; v_clients text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(p_opening_debts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF jsonb_array_length(p_opening_debts)>100 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_opening_debts) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(v_item))<>6
      OR NOT v_item ?& ARRAY['clientId','name','mode','amount','firstDueDate','count']
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k<>ALL(ARRAY['clientId','name','mode','amount','firstDueDate','count'])) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF jsonb_typeof(v_item->'clientId') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
      OR v_item->'mode' NOT IN ('"single"'::jsonb,'"installments"'::jsonb)
      OR jsonb_typeof(v_item->'amount') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item->'firstDueDate') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_item->'count') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_name := public.debt_trim_name(v_item->>'name'); v_client_id := v_item->>'clientId';
    IF char_length(v_name) NOT BETWEEN 1 AND 60 OR char_length(v_client_id) NOT BETWEEN 1 AND 100
      OR v_client_id=ANY(v_clients) OR v_item->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
      OR v_item->>'firstDueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_count_numeric := (v_item->>'count')::numeric;
    IF v_count_numeric NOT BETWEEN 1 AND 600 OR trunc(v_count_numeric)<>v_count_numeric
      OR (v_item->>'mode'='single' AND v_count_numeric<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_count := v_count_numeric::integer; v_amount := (v_item->>'amount')::numeric;
    IF v_amount<=0 OR v_amount>9999999999999.99 OR v_amount*100<v_count THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_date := make_date(substring(v_item->>'firstDueDate',1,4)::integer,substring(v_item->>'firstDueDate',6,2)::integer,substring(v_item->>'firstDueDate',9,2)::integer);
    IF v_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
      OR (v_date+make_interval(months=>v_count-1))::date>DATE '9999-12-31' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_total := v_total+v_amount; v_rows := v_rows+v_count;
    IF v_total>9999999999999.99 OR v_rows>6000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_clients := array_append(v_clients,v_client_id);
    v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('name',v_name,'count',v_count));
  END LOOP;
  RETURN v_items;
END $$;
REVOKE ALL ON FUNCTION public.debt_validate_opening_items(jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $share_creation_validator$
DECLARE v_definition text;
  v_before constant text := replace($validator$  IF jsonb_array_length(p_opening_debts)>100 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_opening_debts) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(v_item))<>6
      OR NOT v_item ?& ARRAY['clientId','name','mode','amount','firstDueDate','count']
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k<>ALL(ARRAY['clientId','name','mode','amount','firstDueDate','count'])) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF jsonb_typeof(v_item->'clientId') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
      OR v_item->'mode' NOT IN ('"single"'::jsonb,'"installments"'::jsonb)
      OR jsonb_typeof(v_item->'amount') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item->'firstDueDate') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_item->'count') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_name := public.debt_trim_name(v_item->>'name'); v_client_id := v_item->>'clientId';
    IF char_length(v_name) NOT BETWEEN 1 AND 60 OR char_length(v_client_id) NOT BETWEEN 1 AND 100
      OR v_client_id=ANY(v_clients) OR v_item->>'amount' !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
      OR v_item->>'firstDueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_count_numeric := (v_item->>'count')::numeric;
    IF v_count_numeric NOT BETWEEN 1 AND 600 OR trunc(v_count_numeric)<>v_count_numeric
      OR (v_item->>'mode'='single' AND v_count_numeric<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_count := v_count_numeric::integer; v_amount := (v_item->>'amount')::numeric;
    IF v_amount<=0 OR v_amount>9999999999999.99 OR v_amount*100<v_count THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_date := make_date(substring(v_item->>'firstDueDate',1,4)::integer,substring(v_item->>'firstDueDate',6,2)::integer,substring(v_item->>'firstDueDate',9,2)::integer);
    IF v_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
      OR (v_date+make_interval(months=>v_count-1))::date>DATE '9999-12-31' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_total := v_total+v_amount; v_rows := v_rows+v_count;
    IF v_total>9999999999999.99 OR v_rows>6000 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    v_clients := array_append(v_clients,v_client_id);
    v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('name',v_name,'count',v_count));
  END LOOP;
$validator$,chr(13),'');
BEGIN
  v_definition := replace(pg_get_functiondef('public.debt_account_create(uuid,jsonb,jsonb)'::regprocedure),chr(13),'');
  IF strpos(v_definition,'public.debt_validate_opening_items')=0 THEN
    IF strpos(v_definition,v_before)=0 THEN RAISE EXCEPTION 'Existing opening validator did not match'; END IF;
    EXECUTE replace(v_definition,v_before,E'  v_items := public.debt_validate_opening_items(p_opening_debts);\n  SELECT coalesce(sum((value->>\'amount\')::numeric),0) INTO v_total FROM jsonb_array_elements(v_items);\n');
  END IF;
END $share_creation_validator$;

CREATE OR REPLACE FUNCTION public.debt_opening_item_proven(p_owner uuid,p_item_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.debt_items item JOIN public.financial_operations op
      ON op.user_id=item.user_id AND op.id=item.operation_id
    WHERE item.user_id=p_owner AND item.id=p_item_id AND op.completed_at IS NOT NULL
      AND ((op.command->>'kind'='create_debt_account'
        AND op.result->>'accountId'=item.account_id::text
        AND jsonb_typeof(op.result->'debtItemIds')='array'
        AND op.result->'debtItemIds' ? item.id::text
        AND (SELECT count(*) FROM public.financial_operations claim
          WHERE claim.user_id=item.user_id AND claim.result->'debtItemIds' ? item.id::text)=1)
      OR (op.command->>'kind'='adopt_opening_debt'
        AND op.command->>'accountId'=item.account_id::text
        AND op.result->>'operationId'=op.id::text
        AND op.result->'transactionIds'='[]'::jsonb
        AND jsonb_typeof(op.command->'items')='array'
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(op.command->'items') draft
          WHERE draft->>'clientId'=item.client_id AND draft->>'name'=item.name
            AND draft->>'mode'=item.mode AND draft->>'amount'=to_char(item.original_amount,'FM9999999999990.00')
            AND draft->>'firstDueDate'=item.first_due_date::text
            AND draft->>'count'=item.remaining_months::text)))
  );
$$;
REVOKE ALL ON FUNCTION public.debt_opening_item_proven(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.debt_account_state(p_owner uuid,p_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_account public.accounts%ROWTYPE;
  v_total numeric;
  v_scheduled numeric := 0;
  v_undated numeric := 0;
  v_delta numeric := 0;
  v_rows jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_settlements jsonb := '[]'::jsonb;
  v_corrections jsonb := '[]'::jsonb;
  v_fingerprint text;
  v_review boolean := false;
  v_row_review boolean := false;
  v_payload jsonb;
BEGIN
  IF p_owner IS NULL OR p_account_id IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO v_account FROM public.accounts WHERE user_id=p_owner AND id=p_account_id AND type='credit_card';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;

  v_total := greatest(coalesce(v_account.balance,0),0);
  IF v_account.currency IS DISTINCT FROM 'PHP' OR coalesce(v_account.balance,0)<0 THEN v_review := true; END IF;

  WITH transaction_claims AS (
    SELECT tx.id,tx.user_id,tx.account_id,tx.transfer_to_account_id,tx.type,tx.amount,tx.description,tx.date,tx.created_at,
      tx.installment_group_id,tx.purchase_date,membership.claim_count,
      op.id AS source_operation_id,op.created_at AS operation_created_at,op.completed_at AS source_completed_at,
      op.command_hash AS source_command_hash,op.command AS source_command,op.result AS source_result,
      CASE WHEN jsonb_typeof(op.result->'transactionIds')='array'
        THEN array_position(ARRAY(SELECT jsonb_array_elements_text(op.result->'transactionIds')),tx.id::text) END AS result_ordinal,
      CASE WHEN jsonb_typeof(op.result->'transactionIds')='array'
        THEN jsonb_array_length(op.result->'transactionIds') END AS result_count
    FROM public.transactions tx
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS claim_count,(array_agg(candidate.id))[1] AS claimed_operation_id
      FROM public.financial_operations candidate
      WHERE candidate.user_id=tx.user_id AND candidate.result->'transactionIds' ? tx.id::text
    ) membership ON true
    LEFT JOIN public.financial_operations op
      ON op.user_id=tx.user_id AND op.id=membership.claimed_operation_id AND membership.claim_count=1
    WHERE tx.user_id=p_owner
  ), transaction_provenance AS (
    SELECT claim.*,
      CASE
        WHEN claim.source_operation_id IS NULL OR claim.claim_count<>1 OR claim.operation_created_at IS NULL
          OR claim.source_completed_at IS NULL
          OR claim.source_result->>'operationId'<>claim.source_operation_id::text
          OR claim.source_command->>'kind'<>'transaction'
          OR claim.source_command->'draft'->>'type'<>claim.type
          OR claim.source_command->'draft'->>'accountId'<>claim.account_id::text
          OR claim.result_ordinal IS NULL THEN false
        WHEN claim.type='expense' AND jsonb_typeof(claim.source_command->'draft'->'installments')='null' THEN
          claim.result_count=1 AND claim.result_ordinal=1 AND claim.installment_group_id IS NULL
          AND claim.source_command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND (claim.source_command->'draft'->>'amount')::numeric=claim.amount
        WHEN claim.type='expense' AND jsonb_typeof(claim.source_command->'draft'->'installments')='object'
          AND claim.source_command->'draft'->'installments'->>'count' ~ '^([1-9]|1[0-2])$' THEN
          claim.result_count=(claim.source_command->'draft'->'installments'->>'count')::integer
          AND claim.result_ordinal BETWEEN 1 AND claim.result_count
          AND claim.installment_group_id=claim.source_operation_id
          AND claim.source_command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND claim.amount=(floor((claim.source_command->'draft'->>'amount')::numeric*100/claim.result_count)
            + CASE WHEN claim.result_ordinal<=mod((claim.source_command->'draft'->>'amount')::numeric*100,claim.result_count)
              THEN 1 ELSE 0 END)/100
          AND claim.result_count=(SELECT count(DISTINCT listed.value)::integer
            FROM jsonb_array_elements_text(claim.source_result->'transactionIds') listed(value))
          AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(claim.source_result->'transactionIds') listed(value)
            WHERE NOT EXISTS(SELECT 1 FROM public.transactions sibling
              WHERE sibling.user_id=claim.user_id AND sibling.id=listed.value::uuid
                AND sibling.account_id=claim.account_id AND sibling.type='expense'
                AND sibling.installment_group_id=claim.source_operation_id))
        WHEN claim.type='transfer' AND jsonb_typeof(claim.source_command->'draft'->'installments')='null' THEN
          claim.result_count=1 AND claim.result_ordinal=1 AND claim.installment_group_id IS NULL
          AND claim.source_command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND (claim.source_command->'draft'->>'amount')::numeric=claim.amount
          AND claim.transfer_to_account_id IS NOT NULL
          AND claim.source_command->'draft'->>'transferToAccountId'=claim.transfer_to_account_id::text
        ELSE false
      END AS proven
    FROM transaction_claims claim
  ), purchase_rows AS (
    SELECT p.id,p.user_id,p.account_id,p.type,p.amount,p.description,
      CASE WHEN p.proven THEN p.date ELSE NULL::date END AS date,p.created_at,p.installment_group_id,p.purchase_date,
      p.source_operation_id,p.operation_created_at,p.source_command_hash,p.source_result,p.proven,
      CASE WHEN p.proven AND p.installment_group_id IS NOT NULL THEN p.installment_group_id ELSE p.id END AS group_id,
      CASE WHEN p.proven AND p.installment_group_id IS NOT NULL THEN p.result_ordinal ELSE 1 END AS ordinal,
      coalesce(nullif(btrim(p.description),''),nullif(c.name,''),'Purchase') AS row_name
    FROM transaction_provenance p
    LEFT JOIN public.transactions tx ON tx.user_id=p.user_id AND tx.id=p.id
    LEFT JOIN public.categories c ON c.id=tx.category_id
    WHERE p.account_id=p_account_id AND p.type='expense'
  ), row_base AS (
    SELECT due.id,due.user_id,item.account_id,item.id AS group_id,'opening'::text AS source,
      NULL::uuid AS transaction_id,due.due_date,due.original_amount,due.ordinal,item.name,
      public.debt_opening_item_proven(item.user_id,item.id) AS proven,
      coalesce((SELECT sum(CASE WHEN event.kind='settlement' THEN event.amount ELSE -event.amount END)
        FROM public.debt_settlement_events event WHERE event.user_id=due.user_id AND event.opening_due_row_id=due.id),0) AS paid,
      coalesce((SELECT sum(event.amount) FROM public.debt_correction_events event
        WHERE event.user_id=due.user_id AND event.opening_due_row_id=due.id),0) AS corrected
    FROM public.debt_due_rows due JOIN public.debt_items item
      ON item.user_id=due.user_id AND item.id=due.debt_item_id
    WHERE due.user_id=p_owner AND item.account_id=p_account_id AND item.source='opening'
    UNION ALL
    SELECT p.id,p.user_id,p.account_id,p.group_id,'purchase'::text,p.id,p.date,p.amount,p.ordinal,p.row_name,
      p.proven,
      coalesce((SELECT sum(CASE WHEN event.kind='settlement' THEN event.amount ELSE -event.amount END)
        FROM public.debt_settlement_events event WHERE event.user_id=p.user_id AND event.purchase_transaction_id=p.id),0),
      coalesce((SELECT sum(event.amount) FROM public.debt_correction_events event
        WHERE event.user_id=p.user_id AND event.purchase_transaction_id=p.id),0)
    FROM purchase_rows p
    WHERE p.amount>0 AND p.amount<10000000000000 AND scale(p.amount)<=2
  ), row_values AS (
    SELECT row_base.*,(original_amount-paid-corrected) AS remaining
    FROM row_base
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'accountId',account_id,'groupId',group_id,'source',source,'transactionId',transaction_id,
      'dueDate',due_date::text,'originalAmount',to_char(original_amount,'FM9999999999990.00'),
      'paidAmount',to_char(paid,'FM9999999999990.00'),'remainingAmount',to_char(remaining,'FM9999999999990.00'),
      'correctedAmount',to_char(corrected,'FM9999999999990.00'),'ordinal',ordinal,'name',name
    ) ORDER BY due_date NULLS LAST,group_id,ordinal,id),'[]'::jsonb),
    coalesce(sum(remaining),0),coalesce(bool_or(NOT proven OR remaining<0),false)
    INTO v_rows,v_scheduled,v_row_review FROM row_values;

  IF v_row_review THEN v_review := true; END IF;

  WITH related AS (
    SELECT tx.*,
      op.id AS source_operation_id,op.command_hash AS source_command_hash,op.command AS source_command,op.result AS source_result,
      CASE
        WHEN membership.claim_count<>1 OR op.id IS NULL OR op.completed_at IS NULL
          OR op.result->>'operationId'<>op.id::text OR op.command->>'kind'<>'transaction'
          OR op.command->'draft'->>'type'<>tx.type OR op.command->'draft'->>'accountId'<>tx.account_id::text
          OR jsonb_typeof(op.result->'transactionIds') IS DISTINCT FROM 'array'
          OR array_position(ARRAY(SELECT jsonb_array_elements_text(op.result->'transactionIds')),tx.id::text) IS NULL THEN false
        WHEN tx.type='expense' AND jsonb_typeof(op.command->'draft'->'installments')='null' THEN
          jsonb_array_length(op.result->'transactionIds')=1 AND tx.installment_group_id IS NULL
          AND op.command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND (op.command->'draft'->>'amount')::numeric=tx.amount
        WHEN tx.type='expense' AND jsonb_typeof(op.command->'draft'->'installments')='object'
          AND op.command->'draft'->'installments'->>'count' ~ '^([1-9]|1[0-2])$' THEN
          jsonb_array_length(op.result->'transactionIds')=(op.command->'draft'->'installments'->>'count')::integer
          AND tx.installment_group_id=op.id
        WHEN tx.type='transfer' AND jsonb_typeof(op.command->'draft'->'installments')='null' THEN
          jsonb_array_length(op.result->'transactionIds')=1 AND tx.installment_group_id IS NULL
          AND op.command->'draft'->>'amount' ~ '^(0|[1-9][0-9]{0,12})\.[0-9]{2}$'
          AND (op.command->'draft'->>'amount')::numeric=tx.amount
          AND op.command->'draft'->>'transferToAccountId' IS NOT DISTINCT FROM tx.transfer_to_account_id::text
        ELSE false
      END AS proven
    FROM public.transactions tx
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS claim_count,(array_agg(candidate.id))[1] AS claimed_operation_id
      FROM public.financial_operations candidate
      WHERE candidate.user_id=tx.user_id AND candidate.result->'transactionIds' ? tx.id::text
    ) membership ON true
    LEFT JOIN public.financial_operations op
      ON op.user_id=tx.user_id AND op.id=membership.claimed_operation_id AND membership.claim_count=1
    WHERE tx.user_id=p_owner AND (tx.account_id=p_account_id OR tx.transfer_to_account_id=p_account_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'transactionId',id,'accountId',account_id,'transferToAccountId',transfer_to_account_id,
    'type',type,'amount',to_char(amount,'FM9999999999990.00'),'date',date::text,
    'installmentGroupId',installment_group_id,'purchaseDate',purchase_date::text,
    'operationId',source_operation_id,'commandHash',source_command_hash,'command',source_command,'result',source_result,'proven',proven
  ) ORDER BY id),'[]'::jsonb),
  coalesce(bool_or(NOT proven OR type='income'),false)
  INTO v_history,v_row_review FROM related;
  IF v_row_review THEN v_review := true; END IF;

  IF EXISTS(
    SELECT 1 FROM public.transactions tx
    WHERE tx.user_id=p_owner AND tx.transfer_to_account_id=p_account_id AND tx.type='transfer'
      AND (SELECT coalesce(sum(CASE WHEN event.kind='settlement' THEN event.amount ELSE -event.amount END),0)
        FROM public.debt_settlement_events event
        WHERE event.user_id=tx.user_id AND event.payment_transaction_id=tx.id)<>tx.amount
  ) THEN v_review := true; END IF;

  v_delta := v_total-v_scheduled;
  v_undated := greatest(v_delta,0);
  IF v_delta<0 THEN v_review := true; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'accountId',account_id,'operationId',operation_id,'amount',to_char(amount,'FM9999999999990.00'),
    'kind',kind,'paymentOperationId',payment_operation_id,'paymentTransactionId',payment_transaction_id,
    'openingDueRowId',opening_due_row_id,'purchaseTransactionId',purchase_transaction_id,
    'residualAccountId',residual_account_id,'reversalOf',reversal_of
  ) ORDER BY id),'[]'::jsonb) INTO v_settlements
  FROM public.debt_settlement_events WHERE user_id=p_owner AND account_id=p_account_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'accountId',account_id,'operationId',operation_id,'amount',to_char(amount,'FM9999999999990.00'),
    'openingDueRowId',opening_due_row_id,'purchaseTransactionId',purchase_transaction_id
  ) ORDER BY id),'[]'::jsonb) INTO v_corrections
  FROM public.debt_correction_events WHERE user_id=p_owner AND account_id=p_account_id;

  v_payload := jsonb_build_object(
    'account',jsonb_build_object('accountId',v_account.id,'name',v_account.name,'type',v_account.type,
      'currency',v_account.currency,'isActive',v_account.is_active,'balance',to_char(v_account.balance,'FM9999999999990.00')),
    'rows',v_rows,'settlements',v_settlements,'corrections',v_corrections,'history',v_history
  );
  v_fingerprint := encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  RETURN jsonb_build_object('account',jsonb_build_object(
      'accountId',v_account.id,'totalOutstanding',to_char(v_total,'FM9999999999990.00'),
      'undatedOutstanding',to_char(v_undated,'FM9999999999990.00'),'fingerprint',v_fingerprint,
      'reconciliation',CASE WHEN v_review THEN 'needs_review' ELSE 'balanced' END,
      'reconciliationDelta',to_char(CASE WHEN v_review THEN v_delta
        ELSE v_total-v_scheduled-v_undated END,'FM9999999999990.00')),
    'rows',v_rows);
END $$;

REVOKE ALL ON FUNCTION public.debt_account_state(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.debt_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_owner uuid := auth.uid(); v_id uuid; v_state jsonb;
  v_accounts jsonb := '[]'::jsonb; v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  -- Financial writes lock this owner first; retain that lock across every account read.
  PERFORM id FROM public.users WHERE id=v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  FOR v_id IN SELECT id FROM public.accounts WHERE user_id=v_owner AND type='credit_card' ORDER BY id LOOP
    v_state := public.debt_account_state(v_owner,v_id);
    v_accounts := v_accounts || jsonb_build_array(v_state->'account');
    v_rows := v_rows || (v_state->'rows');
  END LOOP;
  RETURN jsonb_build_object('accounts',v_accounts,'rows',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.debt_snapshot() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.debt_snapshot() TO authenticated;

CREATE OR REPLACE FUNCTION public.goal_debt_adoption_apply(p_request_id uuid,p_command jsonb,p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid(); v_account_id uuid; v_account public.accounts%ROWTYPE;
  v_items jsonb; v_item jsonb; v_command jsonb; v_hash text; v_state jsonb;
  v_previous public.financial_operations%ROWTYPE; v_total numeric; v_operation uuid; v_result jsonb;
  v_count integer; v_amount numeric; v_date date; v_item_id uuid; v_centavos numeric; v_base numeric; v_ordinal integer;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_request_id IS NULL OR p_quote IS NOT NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR p_command - ARRAY['kind','accountId','items','fingerprint'] <> '{}'::jsonb
    OR NOT p_command ?& ARRAY['kind','accountId','items','fingerprint']
    OR p_command->>'kind' IS DISTINCT FROM 'adopt_opening_debt'
    OR jsonb_typeof(p_command->'accountId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_command->'fingerprint') IS DISTINCT FROM 'string'
    OR p_command->>'accountId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_command->>'fingerprint' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_items := public.debt_validate_opening_items(p_command->'items');
  IF jsonb_array_length(v_items)=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_account_id := (p_command->>'accountId')::uuid;
  SELECT sum((value->>'amount')::numeric) INTO v_total FROM jsonb_array_elements(v_items);
  v_command := p_command || jsonb_build_object('accountId',v_account_id::text,'items',v_items);
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
  v_state := public.debt_account_state(v_owner,v_account_id);
  IF v_state->'account'->>'fingerprint' IS DISTINCT FROM p_command->>'fingerprint' THEN RAISE EXCEPTION 'STALE_QUOTE'; END IF;
  IF v_account.type IS DISTINCT FROM 'credit_card' OR v_account.currency IS DISTINCT FROM 'PHP'
    OR v_account.is_active IS DISTINCT FROM true OR v_state->'account'->>'reconciliation' IS DISTINCT FROM 'balanced'
    OR (v_state->'account'->>'undatedOutstanding')::numeric<=0
    OR v_total<>(v_state->'account'->>'undatedOutstanding')::numeric THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
    VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_count := (v_item->>'count')::integer; v_amount := (v_item->>'amount')::numeric; v_date := (v_item->>'firstDueDate')::date;
    INSERT INTO public.debt_items(user_id,account_id,operation_id,client_id,name,source,mode,original_amount,first_due_date,remaining_months)
      VALUES(v_owner,v_account_id,v_operation,v_item->>'clientId',v_item->>'name','opening',v_item->>'mode',v_amount,v_date,v_count) RETURNING id INTO v_item_id;
    v_centavos := v_amount*100; v_base := floor(v_centavos/v_count);
    FOR v_ordinal IN 1..v_count LOOP
      INSERT INTO public.debt_due_rows(user_id,debt_item_id,ordinal,due_date,original_amount)
        VALUES(v_owner,v_item_id,v_ordinal,(v_date+make_interval(months=>v_ordinal-1))::date,
          trunc((CASE WHEN v_ordinal=v_count THEN v_centavos-v_base*(v_count-1) ELSE v_base END)/100,2));
    END LOOP;
  END LOOP;
  v_result := jsonb_build_object('operationId',v_operation,'transactionIds','[]'::jsonb,'replayed',false);
  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE user_id=v_owner AND id=v_operation;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.goal_debt_adoption_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $adoption_dispatch$
DECLARE v_definition text;
  v_before constant text := replace($branch$
  v_kind := p_command->>'kind';
  IF v_kind='correct_debt_rows' THEN
$branch$,chr(13),'');
  v_after constant text := replace($branch_with_adoption$
  v_kind := p_command->>'kind';
  IF v_kind='adopt_opening_debt' THEN
    RETURN public.goal_debt_adoption_apply(p_request_id,p_command,p_quote);
  END IF;
  IF v_kind='correct_debt_rows' THEN
$branch_with_adoption$,chr(13),'');
BEGIN
  v_definition := replace(pg_get_functiondef('public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure),chr(13),'');
  IF strpos(v_definition,'public.goal_debt_adoption_apply')=0 THEN
    IF strpos(v_definition,v_before)=0 THEN RAISE EXCEPTION 'Current correction dispatcher source did not match'; END IF;
    EXECUTE replace(v_definition,v_before,v_after);
  ELSIF strpos(v_definition,v_after)=0 THEN RAISE EXCEPTION 'Existing adoption dispatcher sentinel did not match'; END IF;
END $adoption_dispatch$;

NOTIFY pgrst, 'reload schema';


-- 202610080006_transaction_description.sql
DO $debt_source_claims$
DECLARE
  v_definition text;
  v_before constant text := replace($predicate$
      WHERE candidate.user_id=tx.user_id AND candidate.result->'transactionIds' ? tx.id::text
$predicate$,chr(13),'');
  v_after constant text := replace($predicate_with_kind$
      WHERE candidate.user_id=tx.user_id AND candidate.command->>'kind'='transaction'
        AND candidate.result->'transactionIds' ? tx.id::text
$predicate_with_kind$,chr(13),'');
  v_before_count integer;
  v_after_count integer;
BEGIN
  v_definition := replace(pg_get_functiondef('public.debt_account_state(uuid,uuid)'::regprocedure),chr(13),'');
  v_before_count := (length(v_definition)-length(replace(v_definition,v_before,'')))/length(v_before);
  v_after_count := (length(v_definition)-length(replace(v_definition,v_after,'')))/length(v_after);
  IF v_before_count=2 AND v_after_count=0 THEN
    EXECUTE replace(v_definition,v_before,v_after);
  ELSIF v_before_count=0 AND v_after_count=2 THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Current debt source-claim predicates did not match the two expected transaction lookups';
  END IF;
END
$debt_source_claims$;

CREATE OR REPLACE FUNCTION public.goal_transaction_description_apply(p_request_id uuid,p_command jsonb,p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_command jsonb;
  v_hash text;
  v_previous public.financial_operations%ROWTYPE;
  v_transaction_id uuid;
  v_group_id uuid;
  v_group_operation public.financial_operations%ROWTYPE;
  v_target public.transactions%ROWTYPE;
  v_account_id uuid;
  v_account_type text;
  v_operation uuid;
  v_result_ids jsonb;
  v_count integer;
  v_unique_count integer;
  v_claim_count integer;
  v_group_claim_count integer;
  v_item text;
  v_member record;
  v_ordinal integer;
  v_base text;
  v_member_base text;
  v_expected text;
  v_description text;
  v_suffix text;
  v_live_count integer := 0;
  v_base_set boolean := false;
  v_ids jsonb := '[]'::jsonb;
  v_result jsonb;
  v_trim_chars constant text := chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||' ';
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_request_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR p_quote IS NOT NULL
    OR p_command - ARRAY['kind','transactionId','groupId','description','expectedDescription'] <> '{}'::jsonb
    OR NOT p_command ?& ARRAY['kind','transactionId','groupId','description','expectedDescription']
    OR p_command->>'kind' IS DISTINCT FROM 'edit_transaction_description'
    OR jsonb_typeof(p_command->'transactionId') NOT IN ('null','string')
    OR jsonb_typeof(p_command->'groupId') NOT IN ('null','string')
    OR jsonb_typeof(p_command->'description') NOT IN ('null','string')
    OR jsonb_typeof(p_command->'expectedDescription') NOT IN ('null','string') THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF (p_command->>'transactionId' IS NULL)=(p_command->>'groupId' IS NULL) THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF p_command->>'transactionId' IS NOT NULL AND p_command->>'transactionId' !~* v_uuid_pattern THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF p_command->>'groupId' IS NOT NULL AND p_command->>'groupId' !~* v_uuid_pattern THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF (p_command->'description'<>'null'::jsonb AND char_length(p_command->>'description')>500)
    OR (p_command->'expectedDescription'<>'null'::jsonb AND char_length(p_command->>'expectedDescription')>500) THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  v_transaction_id := CASE WHEN p_command->>'transactionId' IS NULL THEN NULL ELSE (p_command->>'transactionId')::uuid END;
  v_group_id := CASE WHEN p_command->>'groupId' IS NULL THEN NULL ELSE (p_command->>'groupId')::uuid END;
  v_description := CASE WHEN p_command->'description'='null'::jsonb THEN NULL
    ELSE nullif(btrim(p_command->>'description',v_trim_chars),'') END;
  v_expected := CASE WHEN p_command->'expectedDescription'='null'::jsonb THEN NULL
    ELSE nullif(btrim(p_command->>'expectedDescription',v_trim_chars),'') END;
  v_command := jsonb_build_object('kind','edit_transaction_description','transactionId',v_transaction_id,
    'groupId',v_group_id,'description',v_description,'expectedDescription',v_expected);
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

  IF v_group_id IS NOT NULL THEN
    SELECT * INTO v_group_operation FROM public.financial_operations WHERE user_id=v_owner AND id=v_group_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_group_operation.command->>'kind' IS DISTINCT FROM 'transaction'
      OR v_group_operation.completed_at IS NULL
      OR v_group_operation.result->>'operationId' IS DISTINCT FROM v_group_operation.id::text
      OR jsonb_typeof(v_group_operation.command->'draft') IS DISTINCT FROM 'object'
      OR v_group_operation.command->'draft'->>'type' IS DISTINCT FROM 'expense'
      OR jsonb_typeof(v_group_operation.command->'draft'->'installments') IS DISTINCT FROM 'object'
      OR coalesce(v_group_operation.command->'draft'->'installments'->>'count','') !~ '^([1-9]|1[0-2])$'
      OR coalesce(v_group_operation.command->'draft'->>'accountId','') !~* v_uuid_pattern
      OR jsonb_typeof(v_group_operation.result->'transactionIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.';
    END IF;
    v_count := (v_group_operation.command->'draft'->'installments'->>'count')::integer;
    v_account_id := (v_group_operation.command->'draft'->>'accountId')::uuid;
    v_result_ids := v_group_operation.result->'transactionIds';
    IF jsonb_array_length(v_result_ids)<>v_count OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_result_ids) listed(value)
      WHERE jsonb_typeof(listed.value) IS DISTINCT FROM 'string'
        OR coalesce(listed.value#>>'{}','') !~* v_uuid_pattern
    ) THEN
      RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.';
    END IF;
    SELECT count(DISTINCT listed.value::uuid)::integer INTO v_unique_count
      FROM jsonb_array_elements_text(v_result_ids) listed(value);
    IF v_unique_count<>v_count THEN
      RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.';
    END IF;
    SELECT type INTO v_account_type FROM public.accounts WHERE user_id=v_owner AND id=v_account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.'; END IF;
    IF EXISTS(
      SELECT 1 FROM jsonb_array_elements_text(v_result_ids) listed(value)
      JOIN public.transactions tx ON tx.id=listed.value::uuid
      WHERE tx.user_id IS DISTINCT FROM v_owner OR tx.account_id IS DISTINCT FROM v_account_id
        OR tx.type IS DISTINCT FROM 'expense' OR tx.installment_group_id IS DISTINCT FROM v_group_id
    ) OR EXISTS(
      SELECT 1 FROM public.transactions tx
      WHERE tx.user_id=v_owner AND tx.installment_group_id=v_group_id
        AND NOT (tx.id=ANY(ARRAY(SELECT listed.value::uuid FROM jsonb_array_elements_text(v_result_ids) listed(value))))
    ) THEN
      RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.';
    END IF;
    FOR v_item IN SELECT listed.value FROM jsonb_array_elements_text(v_result_ids) listed(value) LOOP
      SELECT count(*)::integer,count(*) FILTER (WHERE candidate.id=v_group_id)::integer
        INTO v_claim_count,v_group_claim_count
      FROM public.financial_operations candidate
      WHERE candidate.user_id=v_owner AND candidate.command->>'kind'='transaction'
        AND candidate.result->'transactionIds' ? v_item::uuid::text;
      IF v_claim_count<>1 OR v_group_claim_count<>1 THEN
        RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.';
      END IF;
    END LOOP;

    PERFORM tx.id FROM public.transactions tx
      WHERE tx.user_id=v_owner AND tx.installment_group_id=v_group_id ORDER BY tx.id FOR UPDATE;
    FOR v_member IN
      SELECT tx.id,tx.description,
        array_position(ARRAY(SELECT listed.value::uuid FROM jsonb_array_elements_text(v_result_ids) listed(value)),tx.id) AS ordinal
      FROM public.transactions tx
      WHERE tx.user_id=v_owner AND tx.installment_group_id=v_group_id
      ORDER BY tx.id
    LOOP
      IF v_member.ordinal IS NULL OR v_member.ordinal<1 OR v_member.ordinal>v_count THEN
        RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.';
      END IF;
      v_ordinal := v_member.ordinal;
      IF v_count=1 THEN
        v_member_base := CASE WHEN v_member.description IS NULL THEN NULL
          ELSE nullif(btrim(v_member.description,v_trim_chars),'') END;
      ELSE
        v_suffix := format(' (Installment %s/%s)',v_ordinal,v_count);
        IF v_member.description IS NULL OR char_length(v_member.description)<char_length(v_suffix)
          OR right(v_member.description,char_length(v_suffix)) IS DISTINCT FROM v_suffix THEN
          RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.';
        END IF;
        v_member_base := nullif(btrim(left(v_member.description,char_length(v_member.description)-char_length(v_suffix)),v_trim_chars),'');
      END IF;
      IF v_base_set AND v_base IS DISTINCT FROM v_member_base THEN
        RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Review this installment history before editing its description.';
      END IF;
      IF NOT v_base_set THEN v_base := v_member_base; v_base_set := true; END IF;
      v_live_count := v_live_count+1;
      v_ids := v_ids || jsonb_build_array(v_member.id);
    END LOOP;
    IF v_live_count=0 THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_base IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'STALE_QUOTE' USING HINT='The installment description changed. Review the latest description before saving.';
    END IF;
    UPDATE public.transactions tx SET description=CASE WHEN v_count=1 THEN v_description
      ELSE coalesce(v_description,'')||format(' (Installment %s/%s)',
        array_position(ARRAY(SELECT listed.value::uuid FROM jsonb_array_elements_text(v_result_ids) listed(value)),tx.id),v_count)
      END,updated_at=now()
    WHERE tx.user_id=v_owner AND tx.installment_group_id=v_group_id;
  ELSE
    SELECT * INTO v_target FROM public.transactions WHERE user_id=v_owner AND id=v_transaction_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_target.installment_group_id IS NOT NULL THEN
      RAISE EXCEPTION 'NEEDS_REVIEW' USING HINT='Edit this transaction through its complete installment group.';
    END IF;
    SELECT type INTO v_account_type FROM public.accounts WHERE user_id=v_owner AND id=v_target.account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    v_base := CASE WHEN v_target.description IS NULL THEN NULL ELSE nullif(btrim(v_target.description,v_trim_chars),'') END;
    IF v_base IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'STALE_QUOTE' USING HINT='The transaction description changed. Review the latest description before saving.';
    END IF;
    UPDATE public.transactions SET description=v_description,updated_at=now()
      WHERE user_id=v_owner AND id=v_transaction_id;
    v_ids := jsonb_build_array(v_transaction_id);
  END IF;

  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
    VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
  v_result := jsonb_build_object('operationId',v_operation,'transactionIds',v_ids,'replayed',false);
  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE user_id=v_owner AND id=v_operation;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.goal_transaction_description_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $description_dispatch$
DECLARE
  v_definition text;
  v_before constant text := replace($branch$
  v_kind := p_command->>'kind';
  IF v_kind='adopt_opening_debt' THEN
    RETURN public.goal_debt_adoption_apply(p_request_id,p_command,p_quote);
  END IF;
$branch$,chr(13),'');
  v_after constant text := replace($branch_with_description$
  v_kind := p_command->>'kind';
  IF v_kind='edit_transaction_description' THEN
    RETURN public.goal_transaction_description_apply(p_request_id,p_command,p_quote);
  END IF;
  IF v_kind='adopt_opening_debt' THEN
    RETURN public.goal_debt_adoption_apply(p_request_id,p_command,p_quote);
  END IF;
$branch_with_description$,chr(13),'');
BEGIN
  v_definition := replace(pg_get_functiondef('public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure),chr(13),'');
  IF strpos(v_definition,'public.goal_debt_correction_apply')=0
    OR strpos(v_definition,'public.goal_debt_adoption_apply')=0 THEN
    RAISE EXCEPTION 'Current financial dispatcher did not retain the correction and adoption branches';
  END IF;
  IF strpos(v_definition,'public.goal_transaction_description_apply')=0 THEN
    IF strpos(v_definition,v_before)=0 THEN RAISE EXCEPTION 'Current debt dispatcher source did not match'; END IF;
    v_definition := replace(v_definition,v_before,v_after);
  ELSIF strpos(v_definition,v_after)=0 THEN
    RAISE EXCEPTION 'Existing transaction description dispatcher sentinel did not match';
  END IF;
  EXECUTE v_definition;
END
$description_dispatch$;

NOTIFY pgrst, 'reload schema';


-- 202610090001_transaction_metadata.sql
DO $$
DECLARE definition text;
BEGIN
  IF to_regprocedure('public.goal_transaction_description_core(uuid,jsonb,jsonb)') IS NULL THEN
    definition := pg_get_functiondef('public.goal_transaction_description_apply(uuid,jsonb,jsonb)'::regprocedure);
    EXECUTE replace(definition, 'public.goal_transaction_description_apply(', 'public.goal_transaction_description_core(');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.goal_transaction_description_core(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.goal_transaction_description_apply(p_request_id uuid,p_command jsonb,p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  owner_id uuid := auth.uid();
  metadata jsonb := p_command->'metadata';
  previous public.financial_operations%ROWTYPE;
  target public.transactions%ROWTYPE;
  target_id uuid;
  group_id uuid;
  v_category_id uuid;
  expected_category uuid;
  edited_date date;
  expected_date date;
  v_command_hash text;
  operation_id uuid;
  v_result jsonb;
BEGIN
  IF NOT p_command ? 'metadata' THEN
    RETURN public.goal_transaction_description_core(p_request_id,p_command,p_quote);
  END IF;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_request_id IS NULL OR p_quote IS NOT NULL
    OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR p_command - ARRAY['kind','transactionId','groupId','description','expectedDescription','metadata'] <> '{}'::jsonb
    OR jsonb_typeof(metadata) IS DISTINCT FROM 'object'
    OR metadata - ARRAY['date','categoryId','expectedDate','expectedCategoryId'] <> '{}'::jsonb
    OR NOT metadata ?& ARRAY['date','categoryId','expectedDate','expectedCategoryId']
    OR jsonb_typeof(metadata->'date') IS DISTINCT FROM 'string'
    OR metadata->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(metadata->'expectedDate') NOT IN ('string','null')
    OR jsonb_typeof(metadata->'categoryId') NOT IN ('string','null')
    OR jsonb_typeof(metadata->'expectedCategoryId') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  BEGIN
    edited_date := (metadata->>'date')::date;
    expected_date := (metadata->>'expectedDate')::date;
    v_category_id := (metadata->>'categoryId')::uuid;
    expected_category := (metadata->>'expectedCategoryId')::uuid;
    target_id := (p_command->>'transactionId')::uuid;
    group_id := (p_command->>'groupId')::uuid;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END;
  v_command_hash := encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  PERFORM id FROM public.users WHERE id=owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO previous FROM public.financial_operations WHERE user_id=owner_id AND request_id=p_request_id;
  IF FOUND THEN
    IF previous.command_hash <> v_command_hash OR previous.command <> p_command THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    IF previous.completed_at IS NULL OR previous.result IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    RETURN previous.result || jsonb_build_object('replayed',true);
  END IF;
  IF (target_id IS NULL)=(group_id IS NULL) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  PERFORM id FROM public.goals WHERE user_id=owner_id ORDER BY id FOR UPDATE;
  PERFORM id FROM public.accounts WHERE user_id=owner_id ORDER BY id FOR UPDATE;
  PERFORM id FROM public.transactions WHERE user_id=owner_id AND
    ((group_id IS NOT NULL AND installment_group_id=group_id) OR (group_id IS NULL AND id=target_id)) ORDER BY id FOR UPDATE;
  SELECT * INTO target FROM public.transactions WHERE user_id=owner_id AND
    ((group_id IS NOT NULL AND installment_group_id=group_id) OR (group_id IS NULL AND id=target_id)) ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.user_id=owner_id AND
    ((group_id IS NOT NULL AND tx.installment_group_id=group_id) OR (group_id IS NULL AND tx.id=target_id)) AND
    (tx.category_id IS DISTINCT FROM expected_category OR
      (CASE WHEN group_id IS NOT NULL THEN tx.purchase_date ELSE tx.date END) IS DISTINCT FROM expected_date)) THEN
    RAISE EXCEPTION 'STALE_QUOTE' USING HINT='Transaction details changed. Review the latest details before saving.';
  END IF;
  IF v_category_id IS NOT NULL AND (target.type='transfer' OR NOT EXISTS(
    SELECT 1 FROM public.categories category WHERE category.id=v_category_id AND category.type=target.type
      AND (category.user_id=owner_id OR category.user_id IS NULL AND category.is_default=true))) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  v_result := public.goal_transaction_description_core(gen_random_uuid(),p_command-'metadata',NULL);
  UPDATE public.transactions tx SET category_id=v_category_id,
    date=CASE WHEN group_id IS NULL THEN edited_date ELSE tx.date END,
    purchase_date=CASE WHEN group_id IS NOT NULL THEN edited_date ELSE tx.purchase_date END,
    updated_at=now()
    WHERE tx.user_id=owner_id AND tx.id=ANY(ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(v_result->'transactionIds')));
  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
    VALUES(owner_id,p_request_id,v_command_hash,p_command) RETURNING id INTO operation_id;
  v_result := v_result || jsonb_build_object('operationId',operation_id,'replayed',false);
  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE id=operation_id AND user_id=owner_id;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.goal_transaction_description_apply(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';

SELECT
  to_regprocedure('public.debt_snapshot()') IS NOT NULL AS debt_snapshot_exists,
  to_regclass('public.debt_items') IS NOT NULL AS debt_items_exists,
  to_regclass('public.debt_due_rows') IS NOT NULL AS debt_due_rows_exists,
  to_regclass('public.debt_settlement_events') IS NOT NULL AS debt_settlements_exists,
  has_function_privilege('authenticated','public.debt_snapshot()','EXECUTE') AS debt_snapshot_authenticated_access,
  to_regprocedure('public.goal_transaction_description_core(uuid,jsonb,jsonb)') IS NOT NULL AS transaction_metadata_installed;
COMMIT;
