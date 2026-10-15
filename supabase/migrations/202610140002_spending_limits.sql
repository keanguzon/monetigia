BEGIN;

CREATE TABLE IF NOT EXISTS public.spending_limits (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL CHECK (amount > 0 AND amount <= 9999999999999.99),
  cadence text NOT NULL CHECK (cadence IN ('month', 'cutoff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spending_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_spending_limit_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_spending_limit_updated_at() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS spending_limits_set_updated_at ON public.spending_limits;
CREATE TRIGGER spending_limits_set_updated_at
BEFORE UPDATE ON public.spending_limits
FOR EACH ROW EXECUTE FUNCTION public.set_spending_limit_updated_at();

DROP POLICY IF EXISTS spending_limits_owner_select ON public.spending_limits;
DROP POLICY IF EXISTS spending_limits_owner_insert ON public.spending_limits;
DROP POLICY IF EXISTS spending_limits_owner_update ON public.spending_limits;
DROP POLICY IF EXISTS spending_limits_owner_delete ON public.spending_limits;

CREATE POLICY spending_limits_owner_select ON public.spending_limits
FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY spending_limits_owner_insert ON public.spending_limits
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY spending_limits_owner_update ON public.spending_limits
FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY spending_limits_owner_delete ON public.spending_limits
FOR DELETE TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.spending_limits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spending_limits TO authenticated;

COMMIT;
