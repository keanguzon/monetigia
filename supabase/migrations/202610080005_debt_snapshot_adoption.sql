BEGIN;

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
  v_before constant text := $validator$  IF jsonb_array_length(p_opening_debts)>100 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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
$validator$;
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
  v_before constant text := $branch$
  v_kind := p_command->>'kind';
  IF v_kind='correct_debt_rows' THEN
$branch$;
  v_after constant text := $branch_with_adoption$
  v_kind := p_command->>'kind';
  IF v_kind='adopt_opening_debt' THEN
    RETURN public.goal_debt_adoption_apply(p_request_id,p_command,p_quote);
  END IF;
  IF v_kind='correct_debt_rows' THEN
$branch_with_adoption$;
BEGIN
  v_definition := replace(pg_get_functiondef('public.goal_finance_apply(uuid,jsonb,jsonb)'::regprocedure),chr(13),'');
  IF strpos(v_definition,'public.goal_debt_adoption_apply')=0 THEN
    IF strpos(v_definition,v_before)=0 THEN RAISE EXCEPTION 'Current correction dispatcher source did not match'; END IF;
    EXECUTE replace(v_definition,v_before,v_after);
  ELSIF strpos(v_definition,v_after)=0 THEN RAISE EXCEPTION 'Existing adoption dispatcher sentinel did not match'; END IF;
END $adoption_dispatch$;

NOTIFY pgrst, 'reload schema';
COMMIT;
