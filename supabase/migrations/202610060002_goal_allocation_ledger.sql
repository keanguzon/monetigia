BEGIN;
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS review_state text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- Only previously uninitialized rows are migrated; reapplication keeps review decisions.
UPDATE public.goals SET status=CASE WHEN is_completed THEN 'completed' ELSE 'active' END WHERE status IS NULL;
UPDATE public.goals SET review_state='needs_review' WHERE review_state IS NULL;
ALTER TABLE public.goals
  ALTER COLUMN status SET DEFAULT 'active', ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN review_state SET DEFAULT 'confirmed', ALTER COLUMN review_state SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goals'::regclass AND conname='goals_status_check') THEN
    ALTER TABLE public.goals ADD CONSTRAINT goals_status_check CHECK(status IN ('active','completed','cancelled'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.goals'::regclass AND conname='goals_review_state_check') THEN
    ALTER TABLE public.goals ADD CONSTRAINT goals_review_state_check CHECK(review_state IN ('needs_review','confirmed'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS goals_owner_id_key ON public.goals(user_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_owner_id_key ON public.accounts(user_id,id);

CREATE TABLE IF NOT EXISTS public.financial_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  command_hash text NOT NULL CHECK(command_hash ~ '^[0-9a-f]{64}$'),
  command jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(user_id,request_id), UNIQUE(user_id,id)
);
CREATE TABLE IF NOT EXISTS public.goal_allocation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL, account_id uuid NOT NULL, operation_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('reserve','release','spend','move_in','move_out','legacy_spent','reversal')),
  -- Unconstrained numeric rejects excess scale before any numeric(15,2) rounding.
  reserved_delta numeric NOT NULL DEFAULT 0
    CHECK(abs(reserved_delta)<10000000000000 AND scale(reserved_delta)<=2),
  spent_delta numeric NOT NULL DEFAULT 0
    CHECK(abs(spent_delta)<10000000000000 AND scale(spent_delta)<=2),
  transaction_id uuid,
  reversal_of uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(reserved_delta<>0 OR spent_delta<>0),
  CHECK((kind='reversal')=(reversal_of IS NOT NULL)),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,goal_id) REFERENCES public.goals(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,account_id) REFERENCES public.accounts(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,operation_id) REFERENCES public.financial_operations(user_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,reversal_of) REFERENCES public.goal_allocation_events(user_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS allocation_owner_history_idx ON public.goal_allocation_events(user_id,created_at,id);
CREATE INDEX IF NOT EXISTS allocation_goal_history_idx ON public.goal_allocation_events(user_id,goal_id,created_at,id);
CREATE INDEX IF NOT EXISTS allocation_account_history_idx ON public.goal_allocation_events(user_id,account_id,created_at,id);
CREATE INDEX IF NOT EXISTS allocation_operation_idx ON public.goal_allocation_events(operation_id);
CREATE INDEX IF NOT EXISTS allocation_transaction_idx ON public.goal_allocation_events(user_id,transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operations_owner_history_idx ON public.financial_operations(user_id,created_at,id);

CREATE OR REPLACE FUNCTION public.check_allocation_transaction_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.transaction_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.transactions WHERE id=NEW.transaction_id AND user_id=NEW.user_id) THEN
      RETURN NEW;
    END IF;
    -- Reversals retain a deleted transaction UUID only through its same-owner source.
    IF NEW.kind='reversal' AND EXISTS(
      SELECT 1 FROM public.goal_allocation_events
      WHERE id=NEW.reversal_of AND user_id=NEW.user_id AND transaction_id=NEW.transaction_id
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Allocation transaction must belong to the event owner' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.prevent_allocation_history_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  -- Whole-user erasure cascades after the profile disappears; standalone deletion is forbidden.
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Allocation history is append-only' USING ERRCODE='55000';
END $$;
REVOKE ALL ON FUNCTION public.check_allocation_transaction_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_allocation_history_change() FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.goal_allocation_events'::regclass AND tgname='allocation_transaction_owner') THEN
    CREATE TRIGGER allocation_transaction_owner BEFORE INSERT ON public.goal_allocation_events
      FOR EACH ROW EXECUTE FUNCTION public.check_allocation_transaction_owner();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.goal_allocation_events'::regclass AND tgname='allocation_history_immutable') THEN
    CREATE TRIGGER allocation_history_immutable BEFORE UPDATE OR DELETE ON public.goal_allocation_events
      FOR EACH ROW EXECUTE FUNCTION public.prevent_allocation_history_change();
  END IF;
END $$;
ALTER TABLE public.goal_allocation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_operations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='goal_allocation_events' AND policyname='allocation_owner_read') THEN
    CREATE POLICY allocation_owner_read ON public.goal_allocation_events FOR SELECT TO authenticated USING(auth.uid()=user_id);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='financial_operations' AND policyname='operation_owner_read') THEN
    CREATE POLICY operation_owner_read ON public.financial_operations FOR SELECT TO authenticated USING(auth.uid()=user_id);
  END IF;
END $$;
REVOKE ALL ON public.goal_allocation_events,public.financial_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.goal_allocation_events,public.financial_operations TO authenticated;
GRANT ALL ON public.goal_allocation_events,public.financial_operations TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
