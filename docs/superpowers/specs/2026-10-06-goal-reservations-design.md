# Goal reservations and spending lifecycle

Date: 2026-10-06. Planning baseline: local `beta`, commit `6f17870`.
Status: approved for local implementation on 2026-10-06. No remote push or live migration is authorized.

## Purpose and scope

Goals represent money with a purpose inside real wallets. Setting money aside must keep Monetigia's actual wallet balance aligned with the banking app. Spending must count once, and completing a purchase or event must preserve its achievement even when its reservation is exhausted.

Build this for one-time goals and sinking funds. Preserve monthly/kinsenas estimates, goal metadata, the current summary design, and existing financial reporting rules. Recurring automatic resets, bank synchronization, multi-currency conversion, and automatic repair of historical transactions are outside this release.

## Requirements carried into every task

- Target the existing Next.js 14.1.0, React 18, TypeScript, Supabase PostgreSQL, SWR, Tailwind, and Radix Dialog stack.
- Use PostgreSQL exact decimal arithmetic and decimal strings at new money API boundaries; PHP amounts have two decimal places.
- No new runtime dependency is needed for the reservation model.
- Preserve actual wallet balances and net worth when reserving, releasing, or moving reservations within a wallet.
- Record actual expenses and transfers once; goal allocation events must never become duplicate financial transactions.
- Persist financial mutations atomically and authorize them with `auth.uid()` in the database.
- Require confirmation before an ordinary expense or outgoing transfer releases any goal reservation.
- Preserve existing wallet tiles, ordering, ledger toggle, debt filters, and preview calculations.
- Keep Manrope/Bricolage, restrained emerald emphasis, and Goals summary presentation; ENERGY 1 / RHYTHM 2 / MOTION 1.
- Support light/dark themes, keyboard use, reduced motion, and 375px, 768px, and 1280px layouts.
- Preserve existing history; never automatically reinterpret legacy goal tags as reservations or spending.
- Merging and deployment are separate from implementing and verifying this plan.

## Product decisions

Confirmed by the user: overspending available funds uses a warning and confirmed automatic release, provided the actual wallet balance covers the expense. Example: GCash actual balance PHP 30,000; Laptop reservation PHP 5,000; ordinary expense PHP 28,000. Confirmation releases PHP 3,000 from Laptop and records the expense in one operation. Afterwards actual balance is PHP 2,000, Laptop reservation PHP 2,000, and available money PHP 0. Cancellation changes nothing.

Confirmed by the user on 2026-10-06: active goal progress measures money still reserved plus money actually spent toward that goal. With a PHP 3,000 Date goal, PHP 2,000 goal spending and PHP 1,000 reserved produce 100% progress. Display the two amounts separately so 100% never implies PHP 3,000 is still in the wallet. The implementation plan uses this confirmed combined progress model.

## Amounts and status

For each eligible wallet:

`available = actual balance - sum(current goal reservations in this wallet)`.

For each goal:

`reserved = sum(reserved_delta)`; `spent = sum(spent_delta)`; `progress amount = reserved + spent`; `remaining = max(0, target - progress amount)`.

Clamp only the displayed progress percentage to 0..100. Keep true amounts visible when above target. Releasing funds reduces reserved, not spent. Unrelated spending that releases a reservation does not become spending toward that goal.

Persist `active`, `completed`, or `cancelled`. Derive `Saving` versus `Funded` only for active goals from the progress amount. A fetched goal must never write completion to the database. Funding is not completion. Explicit completion is allowed below target.

Completed cards show `Completed` and the actual spent amount rather than a newly empty savings bar. No automatic claim that an item was purchased: an event or savings goal can also be completed. Reopening retains history and recomputes active progress; it does not recreate released reservations. Projections use remaining and the existing monthly/kinsenas cadence; estimates do not allocate money.

## Reservation actions

- **Set aside:** choose an active goal, an eligible wallet, and an amount not exceeding available funds. Change its reservation only.
- **Release funds:** decrease an existing reservation; increase available money without changing actual balance.
- **Move to another goal:** move reservation between two active goals in the same wallet. Preserve total reservation and actual balance.
- **Spend from goal:** open the existing transaction dialog with the goal preselected. For an expense from a cash wallet, consume an equal reservation in that wallet and add equal goal spending. If that reservation is insufficient, explain the amount to set aside or move first; never silently consume a different goal as goal spending.
- **Move to another wallet:** record a real transfer with explicit per-goal reservation amounts to carry to the destination. Those reservations follow the money; they do not count as new funding. A reservation-only action cannot change its wallet.
- **Complete or cancel:** handle every leftover reservation in the same operation. Choose release to available money or move all leftovers to one other active goal, preserving the wallet breakdown. Zero leftovers need no extra choice. Cancel does not erase already recorded spending.
- **Archive:** replace hard deletion of goals with archival after closure and zero reservations. Keep history readable. Wallet deletion with allocation history is rejected to retain ledger references; other existing wallet deletion behavior stays outside this change.

Eligible reservation wallets are owned, active, non-credit accounts in PHP with nonnegative spendable balances. Existing credit cards track debt, not owned cash. Do not create reservations on them.

## Spending beyond available money

Quote the transaction using authoritative balances. If actual money is insufficient, retain the existing insufficient-balance error. If money is sufficient but available money is insufficient, prepare an exact release breakdown for the shortfall.

Default release order: non-priority goals before priority goals; within that group, furthest target date first, with no date treated as furthest; then newest creation time, then goal UUID. Take only reservations in the paying wallet, and only the amount required. This ordering is a proposed implementation default, not a user-selected priority policy. Show the breakdown and allow users to adjust the affected goals and amounts before confirming. Priority goals remain usable only with explicit confirmation.

Example notice: `You have PHP 25,000 available. This expense will release PHP 3,000 from Laptop.` List each affected goal when more than one is involved. Actions: `Review transaction` and `Release funds and save`. The ordinary expense retains no goal-spending link even if its funding required a release.

Apply the same confirmation to the unreserved portion of an outgoing transfer, including a debt payment. Explicit reservation amounts carried to another cash wallet are moves, not releases. Never release more than the shortfall or release from a different wallet.

Quote preview writes nothing. Confirmation references a fingerprint of the normalized transaction, affected balances, reservations, and ordering metadata. Under locks, recompute it. On a mismatch, return `STALE_QUOTE`, write nothing, and ask the user to review the updated breakdown. A network retry uses the original request UUID; it cannot record another expense.

An unknown network outcome is not cancellation. Retain the unresolved request even if the dialog closes; recover its result with the same UUID before permitting a replacement save.

## Credit and installments

Preserve current credit balance signs and installment debt booking: credit expenses increase debt, debt payments decrease it, and existing cash-advance transfer behavior remains covered. Port existing debt-payment validation to the database rather than trusting a stale dialog.

An installment purchase is not saved cash and cannot consume a cash reservation through a credit-account expense. Keep optional goal association for informational purchase history; it adds neither reservation nor spending progress. Debt-payment transfers from a real cash wallet may consume a reservation when the selected goal is a debt goal. Record goal spending on the payment only, never also on the borrowed purchase or its scheduled installment rows.

Split installment amounts in integer centavos, assigning remainder centavos to the earliest rows so they sum exactly to the total. Book the total debt once. Do not change current reporting rules or the existing installment dates. Remove the Wallets fetch-time balance write; fetching data must not overwrite an atomic debt update. Before cutover, audit any legacy debt discrepancy and report it for a separate confirmed correction instead of guessing opening balances.

## Storage and authoritative operations

Add an append-only `goal_allocation_events` table, owned by a user and linked to a goal and wallet. Each event has exact signed `reserved_delta` and `spent_delta`, an operation reference, a kind, timestamp, optional transaction reference, and optional reversal reference. Spending contributes `(-amount, +amount)`; release contributes `(-amount, 0)`; reserve contributes `(+amount, 0)`; reservation moves use paired events. Closed goals cannot receive new reservations.

Use a `financial_operations` table for idempotent request UUIDs, normalized command hashes, and operation results. Deleted transactions leave operation/event history intact. Add goal lifecycle, completion time, archive time, and legacy-review state. Retain legacy `current_amount` and `is_completed` for compatibility, but they cease to be funding sources; mirror completion only inside authoritative lifecycle operations.

All new mutations enter authenticated PostgreSQL RPCs. Lock the user's finance row before goal/wallet rows, then lock affected rows in deterministic UUID order. Serializing mutations per user keeps quotes, sums, lifecycle changes, and reversals coherent. Different users remain independent. Use explicit schema references, a pinned search path, and owner checks on every referenced row. The caller cannot supply authoritative user identity.

Prevent authenticated clients from directly inserting/updating/deleting allocation events or transactions, changing balances, or writing goal lifecycle fields once all writers are upgraded. Retain owner-scoped reads, account creation with opening balance, and safe metadata edits. Prevent account ownership/currency/type changes that invalidate existing allocations. Old RPC grants must not provide a bypass.

## Reversal and edit behavior

Transaction deletion uses the same atomic operation lane. Undo actual balances and linked spending once. For active goals, reversing goal spending or a confirmed automatic release restores the original reservation. For closed or archived goals, return that money to available funds and reverse spending where applicable; do not reopen the goal automatically.

Reversing a transfer must also reverse its carried reservations. If the destination no longer holds sufficient balance/reservations, or undoing income would overdraw available funds, reject without partial changes and explain the required release or corrective transaction. Do not invent funds to make deletion succeed. No new transaction editing UI is introduced; future edit support must use reversal plus replacement atomically.

Target edits recompute derived progress without changing cash. Block destructive goal/wallet metadata changes that would violate ledger ownership. Read archived goal names in historical transaction details.

## Migration and rollout

The repository's SQL schema is behind runtime types, and the existing deletion RPC definition is absent. Obtain the actual deployment schema and RPC definition during execution before preparing deployment SQL; never treat the stale schema as a reliable production baseline.

Create reproducible migrations and a disposable test database. Add narrow Git ignore exceptions because `supabase/` and most `docs/` are currently ignored. Do not expose environment files. Do not run these migrations on the user's live project during plan writing or local implementation without separate deployment authorization.

Mark pre-existing goals `needs_review`. Preserve their tags, status, and old funded amount as explicitly labeled legacy history, not as money currently reserved. Block new allocation actions for an unreconciled goal while allowing ordinary transactions and new goals. Review asks the user to choose lifecycle status and confirm current reservation amounts by wallet. Check current available balances atomically.

Optionally let users explicitly import selected historical cash expenses/debt payments as already-spent goal history, at most once per transaction. That produces spent-only events and never changes wallet balances again. Cash-to-cash transfers and credit installment purchases are not importable goal spending. Selecting no historical spending is valid. A fictitious historical expense used to represent saving must first be corrected through the normal transaction reversal; review must not silently repair it.

Reversing imported historical spending reverses its original spent-only event. It does not create a reservation that never existed.

Deploy additively, update every financial writer, run integration checks, then activate restricted permissions as a coordinated cutover. Do not roll back to the legacy writer after reservations exist; preserve the ledger and use a forward fix or temporarily disable writes if a cutover fails.

## UI and refresh behavior

Goals cards show reserved, spent, and target distinctly, plus a wallet breakdown in the action dialog/history. Use `Set aside`, `Spend from goal`, `Release funds`, and explicit completion actions. Keep primary action and secondary menu compact on mobile. Reset every dialog when changing goals or reopening. Preserve Radix focus management and show inline loading/error states.

Wallet summary exposes actual, reserved, and available with the same account inclusion scope as its current headline total. Credit debt remains separate. Dashboard net worth, income, and expense reporting stay based on real financial transactions; reservation changes never add income or expenses.

Refresh goals, wallet reservation summaries, allocation history, accounts, transactions, and dashboard aggregates after every successful operation or successful idempotent replay. A committed operation whose cache refresh fails is still saved; show a refresh error with retry instead of allowing another financial submission. No optimistic wallet/reservation changes after cancellation or failure. Loading summaries use skeletons; failed data never appears as zero.

## Acceptance examples

1. Reserve PHP 5,000 inside PHP 30,000 GCash: actual 30,000; reserved 5,000; available 25,000; unchanged net worth.
2. Confirm PHP 28,000 ordinary expense: actual 2,000; reserved 2,000; available 0; Laptop spending remains 0. Cancel or fail: all original amounts remain.
3. Date goal: reserve 3,000; spend 2,000; reserved 1,000 and spent 2,000. Complete and release leftover: reserved 0; completed card shows spent 2,000; available increases by 1,000 without a wallet transaction.
4. Laptop: reserve 30,000; spend 30,000; complete. One expense, spent 30,000, no doubled funding and no misleading empty achievement bar.
5. Emergency: reserve 27,000 toward target 30,000; release 15,000 for unrelated needs. Goal reserved 12,000, spent 0, progress 40%.
6. Internal transfer carrying a 5,000 reservation changes the backing wallet, not the goal's total funding or net worth.
7. Concurrent or repeated requests cannot over-reserve, double-book installments, or bypass confirmed release amounts.

## Planning delivery checks

Hard gate PASS for this planning artifact: no invented metrics, testimonials, assets, or implemented UI claims; supplied amounts are labeled examples. Live layout/contrast/click-through checks belong to the implementation acceptance task.

Purpose gate PASS: ledger separation protects actual balance accuracy; exact release preview makes reductions visible; completed history preserves the real achievement; existing summary and typography retain the user's chosen visual direction.

Liveliness PASS at specification level: ENERGY 1 / RHYTHM 2 / MOTION 1 are explicit; amount hierarchy, structural spacing, and restrained emerald feedback are specified. Rendered conformance must be verified during implementation.

Craftsmanship PASS for this planning artifact: named actions, loading/error/empty states, keyboard/theme/mobile checks, and truthful completion reporting are bound to implementation tasks. This is a plan, not a claim that the product passes those checks today.

