BEGIN;

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
COMMIT;
