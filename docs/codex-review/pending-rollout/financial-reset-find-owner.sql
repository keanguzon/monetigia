-- Read-only. Run in the intended production project's Supabase SQL Editor.
BEGIN READ ONLY;
SELECT u.id AS owner_uuid, u.email,
  (SELECT count(*) FROM public.accounts a WHERE a.user_id=u.id) AS wallets,
  (SELECT count(*) FROM public.transactions t WHERE t.user_id=u.id) AS transactions
FROM public.users u
WHERE EXISTS (SELECT 1 FROM public.accounts a WHERE a.user_id=u.id)
ORDER BY u.email;
ROLLBACK;
