BEGIN;

DO $debt_source_claims$
DECLARE
  v_definition text;
  v_before constant text := $predicate$
      WHERE candidate.user_id=tx.user_id AND candidate.result->'transactionIds' ? tx.id::text
$predicate$;
  v_after constant text := $predicate_with_kind$
      WHERE candidate.user_id=tx.user_id AND candidate.command->>'kind'='transaction'
        AND candidate.result->'transactionIds' ? tx.id::text
$predicate_with_kind$;
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
  v_before constant text := $branch$
  v_kind := p_command->>'kind';
  IF v_kind='adopt_opening_debt' THEN
    RETURN public.goal_debt_adoption_apply(p_request_id,p_command,p_quote);
  END IF;
$branch$;
  v_after constant text := $branch_with_description$
  v_kind := p_command->>'kind';
  IF v_kind='edit_transaction_description' THEN
    RETURN public.goal_transaction_description_apply(p_request_id,p_command,p_quote);
  END IF;
  IF v_kind='adopt_opening_debt' THEN
    RETURN public.goal_debt_adoption_apply(p_request_id,p_command,p_quote);
  END IF;
$branch_with_description$;
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
COMMIT;
