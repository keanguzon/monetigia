-- Read-only final verification after BOTH October 15 migrations.
-- Does not replace the deployment-specific signup function.
WITH expected(identity,body_hash,authenticated,anon,service) AS (VALUES
('public.debt_account_create(uuid, jsonb, jsonb)','53dd0dfb9c50d603c520afa4d3b98be0',true,false,false),
('public.debt_account_state(uuid, uuid)','b7f10fa09bd319464b5cf9b187c74c60',false,false,false),
('public.goal_debt_adoption_apply(uuid, jsonb, jsonb)','afc6c463cdd30f3643b804bdd1ea7f73',false,false,false),
('public.goal_debt_correction_apply(uuid, jsonb, jsonb)','ed488768a8e8c172ea6e321035ee7f52',false,false,false),
('public.goal_finance_apply(uuid, jsonb, jsonb)','dade58d260ad1093f6a4053a7067775c',true,false,true),
('public.goal_reservation_apply(uuid, jsonb, jsonb)','d4efeee63fa27f1638e09ebe35bc3d04',false,false,false),
('public.goal_transaction_quote(jsonb, jsonb)','b763bb0f43e5bacf4fcef3b18060e882',true,false,true),
('public.guard_financial_identity()','e72dfa5897b29cf60265c56d74f53909',false,false,false),
('public.guard_financial_opening()','95a858fa74391ec37b5841966b58927c',false,false,false),
('public.spending_summary(date, date)','27aa1969a3cb0f89cf22feeba0e7f9d3',true,false,false),
('public.transaction_history_page(jsonb)','2b60fed5c0d4c22f1d4503b27ba1ddd9',true,false,false)
)
SELECT e.identity,
CASE WHEN p.oid IS NULL THEN 'MISSING'
WHEN md5(replace(pg_get_functiondef(p.oid),chr(13),''))=e.body_hash
AND has_function_privilege('authenticated',p.oid,'EXECUTE')=e.authenticated
AND has_function_privilege('anon',p.oid,'EXECUTE')=e.anon
AND has_function_privilege('service_role',p.oid,'EXECUTE')=e.service
THEN 'MATCH' ELSE 'MISMATCH' END AS status
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.identity)
UNION ALL
SELECT 'accounts/user_preferences currency columns',
CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
AND table_name IN ('accounts','user_preferences') AND column_name='currency') THEN 'STILL_PRESENT' ELSE 'REMOVED' END;
