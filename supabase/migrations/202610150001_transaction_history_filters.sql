BEGIN;

CREATE OR REPLACE FUNCTION public.transaction_history_page(p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
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
      a.currency AS source_currency, d.currency AS destination_currency, t.type,
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
      bool_and(r.source_currency IS NOT DISTINCT FROM 'PHP' AND (r.type<>'transfer' OR r.destination_currency IS NOT DISTINCT FROM 'PHP')) AS php,
      bool_and(r.amount IS NOT NULL AND r.amount::text NOT IN ('NaN','Infinity','-Infinity') AND r.amount>=0) AS valid_amount,
      sum(r.amount) AS recorded_amount,
      CASE WHEN count(DISTINCT r.source_currency)=1 AND bool_and(r.source_currency IS NOT NULL)
        AND bool_and(r.type<>'transfer' OR r.destination_currency IS NOT DISTINCT FROM r.source_currency)
        THEN min(r.source_currency) END AS currency,
      CASE WHEN bool_or(r.purchase_date IS NOT NULL AND (NOT isfinite(r.purchase_date) OR r.purchase_date NOT BETWEEN '0001-01-01'::date AND '9999-12-31'::date)) THEN NULL
        WHEN bool_and(r.purchase_date IS NOT NULL AND isfinite(r.purchase_date) AND r.purchase_date BETWEEN '0001-01-01'::date AND '9999-12-31'::date) AND count(DISTINCT r.purchase_date)=1
        AND max(r.installment_group_id::text) IS NOT NULL THEN min(r.purchase_date)
        WHEN bool_and(r.date IS NOT NULL AND isfinite(r.date) AND r.date BETWEEN '0001-01-01'::date AND '9999-12-31'::date) THEN max(r.date) END AS transaction_date,
      max(r.created_at) AS created_at, (array_agg(r.id ORDER BY r.created_at DESC,r.id DESC))[1] AS sort_id
    FROM owner_rows r JOIN matching m USING(entry_key)
    GROUP BY r.entry_key,m.matching_ids
  ), eligible AS (
    SELECT * FROM candidates WHERE NOT v_amount_mode OR (php AND valid_amount AND (v_min IS NULL OR recorded_amount>=v_min) AND (v_max IS NULL OR recorded_amount<=v_max))
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
      'currency',p.currency,'transactionDate',p.transaction_date,'createdAt',p.created_at,'sortId',p.sort_id,
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
    'excludedCurrencyEntryCount',(SELECT count(*) FROM candidates WHERE v_amount_mode AND NOT php),
    'invalidAmountEntryCount',(SELECT count(*) FROM candidates WHERE v_amount_mode AND php AND NOT valid_amount)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.transaction_history_page(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transaction_history_page(jsonb) TO authenticated;

COMMIT;
