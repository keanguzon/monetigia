# PHP-only frontend and integration checkpoint

Commit 37eceeb; mobile action alignment separately f59d181. User explicitly retired denomination support including database columns, overriding the earlier filter plan's native-currency display/exclusion rules. All history money now uses a static peso prefix with exact integer/string arithmetic. No conversion, balances, amounts or persisted financial history changed.

Removed currency fields from generated types, wallet creation contracts/payloads, metadata selects/options, wallet/goal eligibility, debt summary filtering and spending/history exclusion counters. Account ownership, active status, type, numeric validity, proof and recovery checks remain. Missing debt wallet metadata still produces Unavailable. Shared formatter has one argument and preserves centavos beyond Number safe cents. Primary tokens/global themes unchanged.

Unit fixtures now model the final PHP-only contracts. Former denomination exclusion tests now verify all valid wallet debts are included without metadata and missing wallet metadata still blocks totals; active/inactive/unknown wallet eligibility remains tested. Historical database tests retain their original denomination assertions in a separate pre-retirement phase.

RED: new static peso formatter test failed with `0.00 (currency unavailable)` versus `₱0.00`. GREEN: full npm test exit0, eight Node checks passed, 615 Vitest tests passed with four pre-existing conditional skips across52files. Typecheck exit0. Full native database run pending in full-db-php.log. Final build/browser QA pending. Accidental CRLF noise in two files was normalized before final local commit; no behavior change.

Mobile pencil now shares a right-aligned action container with delete: 375px DOM proof same y,4px gap, both44x44 targets, scrollWidth375. Root performed this inline as requested. Focused page/group/formatter regression49 passed before the PHP amendment; final615 suite includes those paths.

Production migration is prepared only, not installed; no push/deployment. Ordered migration files and immutable legacy operation payloads retain historical currency references deliberately, while live frontend has only static Intl PHP options. Do not rewrite that history or silently convert any legacy foreign/null denomination; migration preflight rejects it.
