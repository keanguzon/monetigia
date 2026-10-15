BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute owner_column ON owner_column.attrelid=i.indrelid AND owner_column.attname='user_id'
    JOIN pg_attribute date_column ON date_column.attrelid=i.indrelid AND date_column.attname='date'
    WHERE i.indrelid='public.transactions'::regclass
      AND i.indisvalid AND i.indpred IS NULL
      AND i.indkey[0]=owner_column.attnum AND i.indkey[1]=date_column.attnum
  ) THEN
    CREATE INDEX IF NOT EXISTS transactions_owner_date_idx ON public.transactions(user_id,date);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.spending_summary(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
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
    SELECT t.type, t.amount, c.id AS category_id, COALESCE(c.name,'Uncategorized') AS category_name,
      source.currency IS NOT DISTINCT FROM 'PHP'
        AND (t.type <> 'transfer' OR destination.currency IS NOT DISTINCT FROM 'PHP') AS included
    FROM public.transactions t
    JOIN public.accounts source ON source.id=t.account_id AND source.user_id=v_owner
    LEFT JOIN public.accounts destination ON destination.id=t.transfer_to_account_id AND destination.user_id=v_owner
    LEFT JOIN public.categories c ON c.id=t.category_id AND (c.user_id=v_owner OR c.is_default=true)
    WHERE t.user_id=v_owner AND t.date >= p_start AND t.date <= p_end
      AND source.type <> 'credit_card'
      AND (t.type IN ('expense','income') OR (t.type='transfer' AND destination.type='credit_card'))
  ), totals AS (
    SELECT COALESCE(sum(amount) FILTER (WHERE included AND type='expense'),0) AS expenses,
      COALESCE(sum(amount) FILTER (WHERE included AND type='transfer'),0) AS debt_payments,
      COALESCE(sum(amount) FILTER (WHERE included AND type='income'),0) AS income,
      count(*) FILTER (WHERE included) AS transaction_count,
      count(*) FILTER (WHERE NOT included) AS excluded_currency_count,
      COALESCE(bool_or(amount IS NULL OR amount::text IN ('NaN','Infinity','-Infinity') OR amount < 0) FILTER (WHERE included),false) AS invalid_amount
    FROM qualifying
  ), category_totals AS (
    SELECT category_id, category_name, sum(amount) AS amount
    FROM qualifying WHERE included AND type='expense'
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
    'transactionCount',v_totals.transaction_count,
    'excludedCurrencyTransactionCount',v_totals.excluded_currency_count
  );
END $$;

REVOKE ALL ON FUNCTION public.spending_summary(date,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.spending_summary(date,date) TO authenticated;

COMMIT;
