BEGIN;
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
COMMIT;
