-- Additive runtime baseline. Requires Supabase auth.users/auth.uid() and its roles.
-- Existing functions, grants, policies, financial values, and auth users are retained.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL, username text UNIQUE NOT NULL,
  name text, avatar_url text, is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('cash','bank','credit_card','e_wallet','investment')),
  balance numeric(15,2) DEFAULT 0, currency text DEFAULT 'PHP', color text, icon text,
  is_active boolean DEFAULT true, is_savings boolean DEFAULT false,
  interest_rate numeric(5,2) DEFAULT 0, include_in_networth boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL, type text NOT NULL CHECK (type IN ('income','expense')),
  color text, icon text, is_default boolean DEFAULT false, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL, target_amount numeric(15,2) NOT NULL,
  current_amount numeric(15,2) DEFAULT 0, target_date date, color text, icon text,
  is_completed boolean DEFAULT false, is_priority boolean DEFAULT false,
  category text DEFAULT 'lifestyle', allocation_per_cycle numeric(15,2) DEFAULT 0,
  allocation_frequency text DEFAULT 'monthly',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount numeric(15,2) NOT NULL, description text, date date NOT NULL,
  transfer_to_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL,
  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly','monthly','yearly')),
  start_date date NOT NULL, end_date date,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  currency text DEFAULT 'PHP', theme text DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  language text DEFAULT 'en', notifications_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_savings boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS interest_rate numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS include_in_networth boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS is_priority boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'lifestyle',
  ADD COLUMN IF NOT EXISTS allocation_per_cycle numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocation_frequency text DEFAULT 'monthly';
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON public.categories(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_goal_id ON public.transactions(goal_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON public.budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals(user_id);

-- Only fresh tables without policies receive the compatibility policies.
-- A deployed project's policies need a separate read-only audit before cutover.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','accounts','categories','goals','transactions','budgets','user_preferences'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name) THEN
      IF table_name='users' THEN
        EXECUTE 'CREATE POLICY baseline_owner_read ON public.users FOR SELECT TO authenticated USING (auth.uid()=id)';
        EXECUTE 'CREATE POLICY baseline_owner_update ON public.users FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id)';
      ELSIF table_name='categories' THEN
        EXECUTE 'CREATE POLICY baseline_category_read ON public.categories FOR SELECT TO authenticated USING (auth.uid()=user_id OR is_default=true)';
        EXECUTE 'CREATE POLICY baseline_category_write ON public.categories FOR ALL TO authenticated USING (auth.uid()=user_id AND is_default=false) WITH CHECK (auth.uid()=user_id AND is_default=false)';
      ELSE
        EXECUTE format('CREATE POLICY baseline_owner_access ON public.%I FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id)', table_name);
      END IF;
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
    END IF;
  END LOOP;
END $$;

-- Create the registration trigger only when absent; never replace a deployed body.
DO $setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created') THEN
    IF to_regprocedure('public.handle_new_user()') IS NULL THEN
      EXECUTE $function$
        CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, public AS $body$
        BEGIN
          INSERT INTO public.users(id,email,username,name,avatar_url,is_verified)
          VALUES (NEW.id,NEW.email,COALESCE(NEW.raw_user_meta_data->>'username',lower(split_part(NEW.email,'@',1))),
            COALESCE(NEW.raw_user_meta_data->>'name',NEW.raw_user_meta_data->>'full_name'),
            NEW.raw_user_meta_data->>'avatar_url',NEW.email_confirmed_at IS NOT NULL);
          INSERT INTO public.user_preferences(user_id) VALUES(NEW.id);
          INSERT INTO public.categories(user_id,name,type,icon,color,is_default) VALUES
            (NEW.id,'Salary','income','Banknote','#22c55e',false),
            (NEW.id,'Freelance','income','Laptop','#3b82f6',false),
            (NEW.id,'Other Income','income','Plus','#6b7280',false),
            (NEW.id,'Food & Dining','expense','UtensilsCrossed','#f97316',false),
            (NEW.id,'Transportation','expense','Car','#eab308',false),
            (NEW.id,'Shopping','expense','ShoppingBag','#ec4899',false),
            (NEW.id,'Bills & Utilities','expense','Receipt','#ef4444',false),
            (NEW.id,'Entertainment','expense','Film','#8b5cf6',false),
            (NEW.id,'Other Expense','expense','Minus','#6b7280',false);
          RETURN NEW;
        END $body$
      $function$;
    END IF;
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
  END IF;
END $setup$;
COMMIT;
