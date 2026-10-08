BEGIN;
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
COMMIT;
