# Transaction filters QA — October 15, 2026

All six tasks complete locally on beta-1.1. No production SQL, push or deployment performed. The user's PHP-only amendment supersedes original foreign-currency display/exclusion rules.

| Task | Evidence | Review |
| --- | --- | --- |
| 1 Query contracts | 0f49aad; 28 normalization tests | Sol low approved |
| 2 History RPC | 69d7669; 10 native tests; 12,000-row plans at 22/80 ms | Sol medium approved |
| 3 Controller | c6b3a9e, f0d792c; 62 focused tests, canonical metadata repair | Sol medium approved |
| 4 Controls | ba4e55a, b485e7e; 14 UI tests | Luna max implementation, Sol low approved |
| 5 Integration | 12d99ab, f59d181; 108 focused tests; adjacent mobile actions | Astra low reviewed; sole currency finding superseded by PHP cleanup |
| PHP amendment | 593d435, 37eceeb; eleven functions, removed fields, static pesos | DB Sol low and final Sol low approved |
| 6 Full QA | 615 Vitest passed, 4 existing conditional skips; 8 Node checks; 171 DB passed, no skips; typecheck/build passed | Final review approved |

Database coverage is explicit: 163 preserved historical contracts run on the pre-retirement schema; eight native contracts run on a fresh final PHP-only database. Final-runtime cases include rollback/reapply, unchanged balances/signup/old operations, grants/ownership, reserve/expense/transfer, debt creation/payment/adoption/correction, summary and history. These are not 171 tests against a single schema version.

Browser QA used only synthetic local data:

- Search beyond 1,000 records; combined wallet/category/amount/custom dates; complete siblings marked Outside filters.
- Amount sort; clear-all preserves sort; 50 to 100 logical entries, no duplicates.
- Preset total remains ₱5,930.00 after wallet filtering; custom dates hide preset summary/limits.
- Injected 503 shows error/Retry and recovers; Escape restores filter-trigger focus.
- Real description save removes the old search match, preserving wallet ₱5,000.00, amount ₱5.25, date and category.
- No horizontal overflow at 320/375/768/1280 in both themes. Ordinary/group action pairs: 4px gap, 44x44 targets at 320/375. Final group alignment: 22 focused tests passed.
- Local catalog: eleven MATCH results, both denomination columns REMOVED.

Production build exits 0 with existing font override, Supabase Edge API, Browserslist and hook dependency warnings. No dependencies or global theme rules changed. Physical iPhone/PWA and production migration installation remain unverified.

[Reports, logs and screenshots](transaction-filters-2026-10-15/) · [Rollout](pending-rollout/transaction-filters-rollout.md)
