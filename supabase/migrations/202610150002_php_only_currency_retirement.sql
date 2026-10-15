-- PHP is the sole unit of account. Existing money and operation records are never rewritten.
BEGIN;
LOCK TABLE public.accounts, public.user_preferences IN ACCESS EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts' AND column_name='currency') THEN
    IF EXISTS (SELECT 1 FROM public.accounts WHERE currency IS DISTINCT FROM 'PHP') THEN
      RAISE EXCEPTION 'PHP_RETIREMENT_REQUIRES_PHP_ACCOUNTS';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_preferences' AND column_name='currency') THEN
    IF EXISTS (SELECT 1 FROM public.user_preferences WHERE currency IS DISTINCT FROM 'PHP') THEN
      RAISE EXCEPTION 'PHP_RETIREMENT_REQUIRES_PHP_PREFERENCES';
    END IF;
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.debt_account_create(p_request_id uuid, p_account jsonb, p_opening_debts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_input jsonb := p_account - 'currency'; v_account jsonb; v_items jsonb := '[]'::jsonb; v_item jsonb;
  v_name text; v_client_id text; v_count integer; v_count_numeric numeric; v_date date;
  v_amount numeric; v_total numeric := 0; v_rows integer := 0; v_clients text[] := ARRAY[]::text[];
  v_command jsonb; v_hash text; v_previous public.financial_operations%ROWTYPE;
  v_operation uuid; v_account_id uuid; v_item_id uuid; v_item_ids jsonb := '[]'::jsonb;
  v_centavos numeric; v_base numeric; v_ordinal integer; v_result jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_account) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_opening_debts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_input))<>8
    OR NOT v_input ?& ARRAY['name','type','color','icon','is_savings','interest_rate','include_in_networth','display_order']
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_input) k WHERE k<>ALL(ARRAY['name','type','color','icon','is_savings','interest_rate','include_in_networth','display_order'])) THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF jsonb_typeof(p_account->'name') IS DISTINCT FROM 'string'
    OR p_account->'type' IS DISTINCT FROM '"credit_card"'::jsonb
    OR jsonb_typeof(p_account->'color') NOT IN ('string','null') OR jsonb_typeof(p_account->'icon') NOT IN ('string','null')
    OR p_account->'is_savings' IS DISTINCT FROM 'false'::jsonb OR p_account->'interest_rate' IS DISTINCT FROM '0'::jsonb
    OR jsonb_typeof(p_account->'include_in_networth') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_account->'display_order') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF p_account ? 'currency' AND p_account->'currency' IS DISTINCT FROM '"PHP"'::jsonb THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_name := public.debt_trim_name(p_account->>'name');
  IF char_length(v_name) NOT BETWEEN 1 AND 60
    OR (p_account->>'color' IS NOT NULL AND p_account->>'color' !~ '^#[0-9a-fA-F]{6}$')
    OR (p_account->>'icon' IS NOT NULL AND p_account->>'icon' !~* '^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif|svg)$')
    OR (p_account->>'display_order')::numeric NOT BETWEEN 0 AND 2147483647
    OR trunc((p_account->>'display_order')::numeric)<>(p_account->>'display_order')::numeric THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_account := p_account || jsonb_build_object('name',v_name,'interest_rate',0,'display_order',(p_account->>'display_order')::numeric::integer);
  v_items := public.debt_validate_opening_items(p_opening_debts);
  SELECT coalesce(sum((value->>'amount')::numeric),0) INTO v_total FROM jsonb_array_elements(v_items);
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
  IF p_account ? 'currency' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  INSERT INTO public.financial_operations(user_id,request_id,command_hash,command)
    VALUES(v_owner,p_request_id,v_hash,v_command) RETURNING id INTO v_operation;
  INSERT INTO public.accounts(user_id,name,type,balance,color,icon,is_active,is_savings,interest_rate,include_in_networth,display_order)
    VALUES(v_owner,v_account->>'name','credit_card',v_total,v_account->>'color',v_account->>'icon',true,false,0,
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
END $function$;

CREATE OR REPLACE FUNCTION public.debt_account_state(p_owner uuid, p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  IF coalesce(v_account.balance,0)<0 THEN v_review := true; END IF;

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
      WHERE candidate.user_id=tx.user_id AND candidate.command->>'kind'='transaction'
        AND candidate.result->'transactionIds' ? tx.id::text
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
      WHERE candidate.user_id=tx.user_id AND candidate.command->>'kind'='transaction'
        AND candidate.result->'transactionIds' ? tx.id::text
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
      'isActive',v_account.is_active,'balance',to_char(v_account.balance,'FM9999999999990.00')),
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
END $function$;

CREATE OR REPLACE FUNCTION public.goal_debt_adoption_apply(p_request_id uuid, p_command jsonb, p_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  IF v_account.type IS DISTINCT FROM 'credit_card'
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
END $function$;

CREATE OR REPLACE FUNCTION public.goal_debt_correction_apply(p_request_id uuid, p_command jsonb, p_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  IF v_account.type IS DISTINCT FROM 'credit_card'
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
    WHERE user_id=v_owner AND id=v_account_id AND type='credit_card' AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_result := jsonb_build_object('operationId',v_operation,'transactionIds','[]'::jsonb,'replayed',false);
  UPDATE public.financial_operations SET completed_at=now(),result=v_result WHERE user_id=v_owner AND id=v_operation;
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.goal_finance_apply(p_request_id uuid, p_command jsonb, p_quote jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  IF v_kind='edit_transaction_description' THEN
    RETURN public.goal_transaction_description_apply(p_request_id,p_command,p_quote);
  END IF;
  IF v_kind='adopt_opening_debt' THEN
    RETURN public.goal_debt_adoption_apply(p_request_id,p_command,p_quote);
  END IF;
  IF v_kind='correct_debt_rows' THEN
    RETURN public.goal_debt_correction_apply(p_request_id,p_command,p_quote);
  END IF;
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
      IF v_src.is_active IS DISTINCT FROM true OR v_src.type='credit_card' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      SELECT coalesce(sum(reserved_delta),0) INTO v_reserved FROM public.goal_allocation_events WHERE user_id=v_owner AND account_id=v_src.id;
      IF coalesce(v_src.balance,0)-v_reserved<(v_value->>'amount')::numeric THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE'; END IF;
    END LOOP;
    FOR v_value IN SELECT value FROM jsonb_array_elements(v_spent_ids) LOOP
      SELECT * INTO v_tx FROM public.transactions WHERE user_id=v_owner AND id=(v_value#>>'{}')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
      SELECT * INTO v_src FROM public.accounts WHERE user_id=v_owner AND id=v_tx.account_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
      IF v_src.type='credit_card' OR v_src.is_active IS DISTINCT FROM true
        OR v_tx.amount<=0 OR EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE transaction_id=v_tx.id AND kind IN ('spend','legacy_spent')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
      IF v_tx.type='transfer' THEN
        SELECT * INTO v_dst FROM public.accounts WHERE user_id=v_owner AND id=v_tx.transfer_to_account_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
        IF v_goal.category IS DISTINCT FROM 'debt' OR v_dst.type<>'credit_card' OR v_dst.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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
    IF EXISTS(SELECT 1 FROM public.debt_settlement_events WHERE user_id=v_owner AND purchase_transaction_id=v_tx.id)
      OR EXISTS(SELECT 1 FROM public.debt_correction_events WHERE user_id=v_owner AND purchase_transaction_id=v_tx.id) THEN
      RAISE EXCEPTION 'INVALID_STATE';
    END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.goal_reservation_apply(p_request_id uuid, p_command jsonb, p_quote jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  IF v_wallet.type='credit_card' OR v_wallet.is_active IS DISTINCT FROM true THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.goal_transaction_quote(p_draft jsonb, p_releases jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_owner uuid := auth.uid(); v_draft jsonb; v_src public.accounts%ROWTYPE; v_dst public.accounts%ROWTYPE;
  v_goal public.goals%ROWTYPE; v_amount numeric; v_reserved numeric; v_shortfall numeric; v_remainder numeric;
  v_carried numeric := 0; v_spending numeric := 0; v_line jsonb; v_releases jsonb := '[]'::jsonb;
  v_funds numeric; v_metadata jsonb; v_fingerprint text; v_month record; v_debt_state jsonb; v_outstanding numeric;
BEGIN
  IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_owner) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  v_draft := public.goal_normalize_transaction(p_draft);
  v_amount := (v_draft->>'amount')::numeric;
  SELECT * INTO v_src FROM public.accounts WHERE id=(v_draft->>'accountId')::uuid AND user_id=v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF v_src.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF v_draft->>'categoryId' IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.categories WHERE id=(v_draft->>'categoryId')::uuid
      AND (user_id=v_owner OR is_default=true)) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  END IF;
  IF v_draft->>'type'='transfer' THEN
    IF v_draft->>'transferToAccountId' IS NULL OR v_draft->>'categoryId' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    SELECT * INTO v_dst FROM public.accounts WHERE id=(v_draft->>'transferToAccountId')::uuid AND user_id=v_owner;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF v_src.id=v_dst.id THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF v_dst.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
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
    v_debt_state := public.debt_account_state(v_owner,v_dst.id);
    v_outstanding := (v_debt_state->'account'->>'totalOutstanding')::numeric;
    IF v_amount>v_outstanding THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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
    'debtAccountState',CASE WHEN v_dst.type='credit_card' THEN v_debt_state ELSE 'null'::jsonb END,
    'debtTransactions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.transactions t WHERE t.user_id=v_owner AND v_dst.type='credit_card' AND (t.account_id=v_dst.id OR t.transfer_to_account_id=v_dst.id))) INTO v_metadata;
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object('draft',v_draft,'releases',v_releases,'state',v_metadata)::text,'UTF8')),'hex');
  RETURN jsonb_build_object('fingerprint',v_fingerprint,'actual',round(coalesce(v_src.balance,0),2)::text,'reserved',round(v_reserved,2)::text,
    'available',round(coalesce(v_src.balance,0)-v_reserved,2)::text,'releases',v_releases);
END $function$;

CREATE OR REPLACE FUNCTION public.guard_financial_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    IF (NEW.id,NEW.user_id,NEW.type,NEW.is_active) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.type,OLD.is_active)
      AND (EXISTS(SELECT 1 FROM public.goal_allocation_events WHERE account_id=OLD.id)
        OR EXISTS(SELECT 1 FROM public.debt_items WHERE account_id=OLD.id)
        OR EXISTS(SELECT 1 FROM public.debt_settlement_events WHERE account_id=OLD.id)
        OR EXISTS(SELECT 1 FROM public.debt_correction_events WHERE account_id=OLD.id)) THEN
      RAISE EXCEPTION 'Wallet identity with financial history cannot change' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_financial_opening()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF current_user='authenticated' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
    IF TG_TABLE_NAME='accounts' THEN
      IF NEW.balance IS NULL OR NEW.balance::text IN ('NaN','Infinity','-Infinity') OR NEW.balance<0 OR NEW.balance>=10000000000000
        OR NEW.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    ELSE
      IF NEW.current_amount IS DISTINCT FROM 0 OR NEW.is_completed IS DISTINCT FROM false OR NEW.status<>'active'
        OR NEW.review_state<>'confirmed' OR NEW.completed_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.spending_summary(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_totals record;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end) THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;
  IF p_start > p_end OR p_end - p_start > 365 THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  WITH qualifying AS (
    SELECT t.type, t.amount, c.id AS category_id, COALESCE(c.name,'Uncategorized') AS category_name
    FROM public.transactions t
    JOIN public.accounts source ON source.id=t.account_id AND source.user_id=v_owner
    LEFT JOIN public.accounts destination ON destination.id=t.transfer_to_account_id AND destination.user_id=v_owner
    LEFT JOIN public.categories c ON c.id=t.category_id AND (c.user_id=v_owner OR c.is_default=true)
    WHERE t.user_id=v_owner AND t.date >= p_start AND t.date <= p_end
      AND source.type <> 'credit_card'
      AND (t.type IN ('expense','income') OR (t.type='transfer' AND destination.type='credit_card'))
  ), totals AS (
    SELECT COALESCE(sum(amount) FILTER (WHERE type='expense'),0) AS expenses,
      COALESCE(sum(amount) FILTER (WHERE type='transfer'),0) AS debt_payments,
      COALESCE(sum(amount) FILTER (WHERE type='income'),0) AS income,
      count(*) AS transaction_count,
      COALESCE(bool_or(amount IS NULL OR amount::text IN ('NaN','Infinity','-Infinity') OR amount < 0),false) AS invalid_amount
    FROM qualifying
  ), category_totals AS (
    SELECT category_id, category_name, sum(amount) AS amount
    FROM qualifying WHERE type='expense'
    GROUP BY category_id, category_name
  )
  SELECT totals.*, COALESCE((
    SELECT jsonb_agg(jsonb_build_object('categoryId',category_id,'name',category_name,'amount',round(amount,2)::text)
      ORDER BY amount DESC, category_name, category_id)
    FROM category_totals
  ),'[]'::jsonb) AS categories
  INTO v_totals FROM totals;

  IF v_totals.invalid_amount THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  RETURN jsonb_build_object(
    'start',p_start,'end',p_end,
    'spent',round(v_totals.expenses+v_totals.debt_payments,2)::text,
    'expenses',round(v_totals.expenses,2)::text,
    'debtPayments',round(v_totals.debt_payments,2)::text,
    'income',round(v_totals.income,2)::text,
    'net',round(v_totals.income-v_totals.expenses-v_totals.debt_payments,2)::text,
    'categories',v_totals.categories,
    'transactionCount',v_totals.transaction_count
  );
END $function$;

CREATE OR REPLACE FUNCTION public.transaction_history_page(p_query jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_query jsonb;
  v_sort text;
  v_type text;
  v_search text;
  v_wallets uuid[];
  v_categories uuid[];
  v_uncategorized boolean;
  v_start date;
  v_end date;
  v_min numeric;
  v_max numeric;
  v_offset integer;
  v_amount_mode boolean;
  v_field text;
  v_text text;
  v_result jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  BEGIN
    IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN RAISE EXCEPTION 'invalid'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_query) k WHERE k <> ALL(ARRAY[
      'version','sort','type','search','walletIds','categoryIds','includeUncategorized','minAmount','maxAmount','start','end','offset'
    ])) THEN RAISE EXCEPTION 'invalid'; END IF;
    v_query := '{"version":1,"sort":"date_added_desc","type":"all","search":"","walletIds":[],"categoryIds":[],"includeUncategorized":false,"minAmount":null,"maxAmount":null,"start":null,"end":null,"offset":0}'::jsonb || p_query;
    IF v_query->'version' <> '1'::jsonb OR jsonb_typeof(v_query->'sort') <> 'string'
      OR jsonb_typeof(v_query->'type') <> 'string' OR jsonb_typeof(v_query->'search') <> 'string'
      OR jsonb_typeof(v_query->'includeUncategorized') <> 'boolean'
      OR jsonb_typeof(v_query->'offset') <> 'number' THEN RAISE EXCEPTION 'invalid'; END IF;
    v_sort := v_query->>'sort'; v_type := v_query->>'type';
    v_search := btrim(v_query->>'search', E' \t\n\r\f\v' || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279));
    v_uncategorized := (v_query->>'includeUncategorized')::boolean;
    IF v_sort <> ALL(ARRAY['transaction_date_desc','transaction_date_asc','date_added_desc','date_added_asc','amount_desc','amount_asc'])
      OR v_type <> ALL(ARRAY['all','expense','income','transfer']) OR length(v_search)>120
      OR (v_query->>'offset')::numeric <> trunc((v_query->>'offset')::numeric)
      OR (v_query->>'offset')::numeric NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'invalid'; END IF;
    v_offset := (v_query->>'offset')::integer;
    FOREACH v_field IN ARRAY ARRAY['walletIds','categoryIds'] LOOP
      IF jsonb_typeof(v_query->v_field) <> 'array' THEN RAISE EXCEPTION 'invalid'; END IF;
      IF jsonb_array_length(v_query->v_field)>100 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_query->v_field) x
        WHERE jsonb_typeof(x)<>'string' OR (x#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) THEN RAISE EXCEPTION 'invalid'; END IF;
    END LOOP;
    SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_wallets FROM jsonb_array_elements_text(v_query->'walletIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid),'{}'::uuid[]) INTO v_categories FROM jsonb_array_elements_text(v_query->'categoryIds') x;
    FOREACH v_field IN ARRAY ARRAY['minAmount','maxAmount'] LOOP
      IF jsonb_typeof(v_query->v_field) <> 'null' THEN
        IF jsonb_typeof(v_query->v_field) <> 'string' THEN RAISE EXCEPTION 'invalid'; END IF;
        v_text := btrim(v_query->>v_field, E' \t\n\r\f\v' || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279));
        IF v_text <> '' THEN
          IF v_text !~ '^[0-9]+([.][0-9]{1,2})?$' OR v_text::numeric>9999999999999.99 THEN RAISE EXCEPTION 'invalid'; END IF;
          IF v_field='minAmount' THEN v_min:=v_text::numeric; ELSE v_max:=v_text::numeric; END IF;
        END IF;
      END IF;
    END LOOP;
    IF v_min>v_max THEN RAISE EXCEPTION 'invalid'; END IF;
    IF v_query->'start' <> 'null'::jsonb OR v_query->'end' <> 'null'::jsonb THEN
      FOREACH v_field IN ARRAY ARRAY['start','end'] LOOP
        IF jsonb_typeof(v_query->v_field)<>'string' OR (v_query->>v_field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          OR left(v_query->>v_field,4)='0000' THEN RAISE EXCEPTION 'invalid'; END IF;
      END LOOP;
      v_start := (v_query->>'start')::date; v_end := (v_query->>'end')::date;
      IF v_start>v_end THEN RAISE EXCEPTION 'invalid'; END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'INVALID_HISTORY_QUERY' USING ERRCODE='22023';
  END;
  v_amount_mode := v_sort IN ('amount_desc','amount_asc') OR v_min IS NOT NULL OR v_max IS NOT NULL;

  WITH owner_rows AS MATERIALIZED (
    SELECT t.id, t.installment_group_id, t.amount, t.date, t.purchase_date, t.created_at,
      CASE WHEN t.installment_group_id IS NULL THEN 'transaction:' || t.id::text ELSE 'installment:' || t.installment_group_id::text END AS entry_key,
      t.type, (a.id IS NOT NULL AND (t.type<>'transfer' OR d.id IS NOT NULL)) AS owned_accounts,
      (v_type='all' OR t.type=v_type)
      AND (v_start IS NULL OR t.date BETWEEN v_start AND v_end)
      AND (cardinality(v_wallets)=0 OR a.id=ANY(v_wallets) OR (t.type='transfer' AND d.id=ANY(v_wallets)))
      AND ((cardinality(v_categories)=0 AND NOT v_uncategorized) OR (t.type<>'transfer' AND (c.id=ANY(v_categories) OR (v_uncategorized AND c.id IS NULL))))
      AND (v_search='' OR strpos(lower(concat_ws(' ',t.description,c.name,a.name,CASE WHEN t.type='transfer' THEN d.name END,t.amount::text,t.date::text,t.purchase_date::text,t.history_date::text)),lower(v_search))>0) AS matches
    FROM public.transactions t
    LEFT JOIN public.accounts a ON a.id=t.account_id AND a.user_id=v_owner
    LEFT JOIN public.accounts d ON d.id=t.transfer_to_account_id AND d.user_id=v_owner
    LEFT JOIN public.categories c ON c.id=t.category_id AND (c.user_id=v_owner OR (c.user_id IS NULL AND c.is_default=true))
    WHERE t.user_id=v_owner
  ), matching AS (
    SELECT entry_key, array_agg(id ORDER BY date,created_at,id) AS matching_ids
    FROM owner_rows WHERE matches GROUP BY entry_key
  ), candidates AS (
    SELECT r.entry_key, max(r.installment_group_id::text) AS group_id, m.matching_ids,
      bool_and(r.owned_accounts) AS owned_accounts,
      bool_and(r.amount IS NOT NULL AND r.amount::text NOT IN ('NaN','Infinity','-Infinity') AND r.amount>=0) AS valid_amount,
      sum(r.amount) AS recorded_amount,
      CASE WHEN bool_or(r.purchase_date IS NOT NULL AND (NOT isfinite(r.purchase_date) OR r.purchase_date NOT BETWEEN '0001-01-01'::date AND '9999-12-31'::date)) THEN NULL
        WHEN bool_and(r.purchase_date IS NOT NULL AND isfinite(r.purchase_date) AND r.purchase_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date) AND count(DISTINCT r.purchase_date)=1
        AND max(r.installment_group_id::text) IS NOT NULL THEN min(r.purchase_date)
        WHEN bool_and(r.date IS NOT NULL AND isfinite(r.date) AND r.date BETWEEN '0001-01-01'::date AND '9999-12-31'::date) THEN max(r.date) END AS transaction_date,
      max(r.created_at) AS created_at, (array_agg(r.id ORDER BY r.created_at DESC,r.id DESC))[1] AS sort_id
    FROM owner_rows r JOIN matching m USING(entry_key)
    GROUP BY r.entry_key,m.matching_ids
  ), eligible AS (
    SELECT * FROM candidates WHERE NOT v_amount_mode OR (owned_accounts AND valid_amount AND (v_min IS NULL OR recorded_amount>=v_min) AND (v_max IS NULL OR recorded_amount<=v_max))
  ), ordered AS (
    SELECT e.*, row_number() OVER (ORDER BY
      CASE WHEN v_sort='transaction_date_desc' THEN transaction_date END DESC NULLS LAST,
      CASE WHEN v_sort='transaction_date_asc' THEN transaction_date END ASC NULLS LAST,
      CASE WHEN v_sort='amount_desc' THEN recorded_amount END DESC NULLS LAST,
      CASE WHEN v_sort='amount_asc' THEN recorded_amount END ASC NULLS LAST,
      CASE WHEN v_sort IN ('transaction_date_desc','date_added_desc','amount_desc') THEN created_at END DESC NULLS LAST,
      CASE WHEN v_sort IN ('transaction_date_asc','date_added_asc','amount_asc') THEN created_at END ASC NULLS LAST,
      CASE WHEN v_sort IN ('transaction_date_desc','date_added_desc','amount_desc') THEN entry_key END DESC,
      CASE WHEN v_sort IN ('transaction_date_asc','date_added_asc','amount_asc') THEN entry_key END ASC
    ) AS position FROM eligible e
  ), page AS (
    SELECT * FROM ordered ORDER BY position LIMIT 50 OFFSET v_offset
  ), hydrated AS (
    SELECT p.position, jsonb_build_object(
      'key',p.entry_key,'kind',CASE WHEN p.group_id IS NULL THEN 'transaction' ELSE 'installment_group' END,
      'groupId',p.group_id,'matchingRowIds',to_jsonb(p.matching_ids),
      'recordedAmount',CASE WHEN p.valid_amount THEN round(p.recorded_amount,2)::text END,
      'transactionDate',p.transaction_date,'createdAt',p.created_at,'sortId',p.sort_id,
      'rows',children.rows
    ) AS entry
    FROM page p CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'id',t.id,'user_id',t.user_id,'account_id',t.account_id,'category_id',t.category_id,'goal_id',t.goal_id,
        'type',t.type,'amount',t.amount::text,'description',t.description,
        'date',CASE WHEN isfinite(t.date) AND t.date BETWEEN '0001-01-01'::date AND '9999-12-31'::date THEN t.date END,'created_at',t.created_at,
        'installment_group_id',t.installment_group_id,
        'purchase_date',CASE WHEN isfinite(t.purchase_date) AND t.purchase_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date THEN t.purchase_date END,
        'history_date',CASE WHEN isfinite(t.history_date) AND t.history_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date THEN t.history_date END,
        'transfer_to_account_id',t.transfer_to_account_id,
        'category',CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'name',c.name,'color',c.color) END,
        'account',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'name',a.name,'type',a.type) END,
        'transfer_to_account',CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('id',d.id,'name',d.name,'type',d.type) END
      ) ORDER BY t.date,t.created_at,t.id) AS rows
      FROM public.transactions t
      LEFT JOIN public.accounts a ON a.id=t.account_id AND a.user_id=v_owner
      LEFT JOIN public.accounts d ON d.id=t.transfer_to_account_id AND d.user_id=v_owner
      LEFT JOIN public.categories c ON c.id=t.category_id AND (c.user_id=v_owner OR (c.user_id IS NULL AND c.is_default=true))
      WHERE t.user_id=v_owner AND ((p.group_id IS NULL AND t.id=p.sort_id) OR (p.group_id IS NOT NULL AND t.installment_group_id=p.group_id::uuid))
    ) children
  )
  SELECT jsonb_build_object(
    'version',1,'entries',COALESCE((SELECT jsonb_agg(entry ORDER BY position) FROM hydrated),'[]'::jsonb),
    'totalMatchingEntries',(SELECT count(*) FROM eligible),
    'nextOffset',CASE WHEN (SELECT count(*) FROM eligible)>v_offset+50 THEN v_offset+50 END,
    'invalidAmountEntryCount',(SELECT count(*) FROM candidates WHERE v_amount_mode AND owned_accounts AND NOT valid_amount)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- Column-specific insert grants retain the original opening-balance boundary.
ALTER TABLE public.accounts DROP COLUMN IF EXISTS currency;
ALTER TABLE public.user_preferences DROP COLUMN IF EXISTS currency;
GRANT INSERT(user_id,name,type,balance,color,icon,is_active,is_savings,interest_rate,include_in_networth,display_order) ON public.accounts TO authenticated;
COMMIT;
