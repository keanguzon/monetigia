-- Read-only release check. Generated from all ordered migrations on disposable PostgreSQL.
-- Run as postgres in the target project's SQL Editor; NO application data is read or changed.
-- Before new migrations: spending_summary and set_spending_limit_updated_at may be MISSING.
-- Every other row must be MATCH. After installation every row must be MATCH.
-- BODY_MISMATCH includes metadata and dispatcher drift; do not repair by rerunning stale schema.sql.
WITH expected(identity,body_hash,security_definer,volatility,settings,authenticated_execute,anon_execute,service_execute) AS (VALUES
  ('public.check_allocation_transaction_owner()','517b6f76a50d213813dad9b54e0c9b30',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.debt_account_create(uuid, jsonb, jsonb)','eca1982ddadb0c64c5f565b6c212e516',true,'v','{"search_path=pg_catalog, public"}',true,false,false),
  ('public.debt_account_state(uuid, uuid)','fae92f52b8b2c931e9c9dc805d2ff9b7',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.debt_opening_item_proven(uuid, uuid)','9792255cffab87d22037b5b698081c78',true,'s','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.debt_snapshot()','2cf475f118db25ac3cc7e4dd9af1dc30',true,'v','{"search_path=pg_catalog, public"}',true,false,false),
  ('public.debt_trim_name(text)','83a666338f281eabce5f0d55daf7edbd',false,'i','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.debt_validate_opening_items(jsonb)','796ad96fdadb6f4a23d8f99a394125dc',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.goal_debt_adoption_apply(uuid, jsonb, jsonb)','c8b305f4ad6953a640cb8a2b5730dadc',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.goal_debt_correction_apply(uuid, jsonb, jsonb)','d38f8f3c069d92123485a0443f934a3d',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.goal_finance_apply(uuid, jsonb, jsonb)','b2aa78a8c5afe7bfc4f1a4c64a133074',true,'v','{"search_path=pg_catalog, public"}',true,false,true),
  ('public.goal_finance_snapshot()','50f5b00dda9279d40340482c35c5a945',true,'v','{"search_path=pg_catalog, public"}',true,false,true),
  ('public.goal_normalize_transaction(jsonb)','35e4d00b39fb6e94a8840a8c284a7f2b',false,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.goal_restore_archived(uuid, uuid)','b54da83c365f50fee840e97e231248a4',true,'v','{"search_path=pg_catalog, public"}',true,false,false),
  ('public.goal_transaction_apply(uuid, jsonb, jsonb)','3cf3702fe8e81792faa8e0185d3dbbbf',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.goal_transaction_description_apply(uuid, jsonb, jsonb)','881753bf38b09ac7524a9c9d8ebe3744',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.goal_transaction_description_core(uuid, jsonb, jsonb)','86384ec35d1a85158b1deeb065d789ae',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.goal_transaction_quote(jsonb, jsonb)','7e9962fd68670663073ba1773909691f',true,'v','{"search_path=pg_catalog, public"}',true,false,true),
  ('public.guard_financial_identity()','a3836f96f42c20df4aa98b960410f8cd',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.guard_financial_opening()','a0be7bfcfa4df88da6247a28b3c12808',false,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.guard_goal_money()','4286f559d96841a1a82b26debbd5547f',false,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.handle_new_user()','62c66d8b7fb603db1b4651e3d4ea92c9',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.prevent_allocation_history_change()','4df3032d0c90c74d08bd2b8ce7e40167',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.prevent_debt_history_change()','c62559454f4fc2772b0651cd8f3489e8',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.reverse_debt_settlements_before_transaction_delete()','6b8727cf073615826e1e95f725e97a4e',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.set_spending_limit_updated_at()','a3f7b451ded31cc96c977ff172329ecb',false,'v','{search_path=pg_catalog}',false,false,false),
  ('public.spending_summary(date, date)','aa525b197b4d7f55b3b95e21c5c3f63f',false,'s','{"search_path=pg_catalog, public"}',true,false,false),
  ('public.validate_debt_correction_event()','39671c7d5f6be3ea3b755cdf816918d5',true,'v','{"search_path=pg_catalog, public"}',false,false,false),
  ('public.validate_debt_settlement_event()','d4847470fe0ede282cd85484cd11c9a1',true,'v','{"search_path=pg_catalog, public"}',false,false,false)
), actual AS (
 SELECT e.*,to_regprocedure(e.identity) AS actual_oid FROM expected e
)
SELECT a.identity,
 CASE WHEN p.oid IS NULL THEN 'MISSING'
 WHEN md5(replace(p.prosrc,chr(13),''))<>a.body_hash THEN 'BODY_MISMATCH'
 WHEN p.prosecdef IS DISTINCT FROM a.security_definer OR p.provolatile::text IS DISTINCT FROM a.volatility OR p.proconfig::text IS DISTINCT FROM a.settings THEN 'CONFIG_MISMATCH'
 WHEN has_function_privilege('authenticated',p.oid,'EXECUTE') IS DISTINCT FROM a.authenticated_execute OR has_function_privilege('anon',p.oid,'EXECUTE') IS DISTINCT FROM a.anon_execute OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM a.service_execute THEN 'GRANT_MISMATCH'
 ELSE 'MATCH' END AS status
FROM actual a LEFT JOIN pg_proc p ON p.oid=a.actual_oid ORDER BY a.identity;
