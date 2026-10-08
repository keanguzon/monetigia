BEGIN;

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

NOTIFY pgrst, 'reload schema';
COMMIT;
