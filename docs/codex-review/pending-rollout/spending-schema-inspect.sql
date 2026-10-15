-- Read-only catalog inspection. Run as postgres in the intended project's SQL Editor.
-- No financial rows are read or changed. Keep the output with the release QA record.
SELECT name, to_regclass('public.' || name) IS NOT NULL AS installed,
       c.relrowsecurity AS rls_enabled
FROM (VALUES ('debt_items'), ('debt_due_rows'), ('debt_settlement_events'),
             ('debt_correction_events'), ('spending_limits')) AS expected(name)
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || name)
ORDER BY name;

SELECT table_name, column_name, data_type, udt_name, is_nullable,
       numeric_precision, numeric_scale, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name = 'spending_limits'
       OR (table_name = 'transactions' AND column_name IN
           ('date', 'purchase_date', 'category_id', 'installment_group_id')))
ORDER BY table_name, ordinal_position;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = to_regclass('public.spending_limits')
ORDER BY conname;

SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'spending_limits'
ORDER BY policyname;

SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'spending_limits'
ORDER BY grantee, privilege_type;

SELECT tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = to_regclass('public.spending_limits') AND NOT tgisinternal;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'transactions'
ORDER BY indexname;
