-- Monetigia Money Tracker - Full Reset Script
-- Usage (Supabase Dashboard): SQL Editor -> paste & run this file
-- After this runs, re-run: supabase/schema.sql to recreate tables, policies, trigger, defaults.

-- 1) Drop trigger/function (optional but keeps things clean)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'on_auth_user_created'
      AND n.nspname = 'auth'
      AND c.relname = 'users'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    -- Ignore if you don't have permission to drop trigger; dropping public tables is still OK.
    NULL;
END;
$$;

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 2) Drop app tables (CASCADE removes RLS policies, FKs, etc.)
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.budgets CASCADE;
DROP TABLE IF EXISTS public.goals CASCADE;
DROP TABLE IF EXISTS public.accounts CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.user_preferences CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- 3) Delete ALL auth users (removes accounts from Supabase Auth)
-- NOTE: This is destructive and cannot be undone.
DELETE FROM auth.users;

-- Done.
-- Next: Run supabase/schema.sql to recreate everything.
