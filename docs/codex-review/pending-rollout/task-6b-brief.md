# Task 6b brief: Shared existing-debt fields and fixed Add Wallet footer

**Executor:** Luna max. **Review:** Sol low. **Scope:** Rollout Task 6 presentation portion, detailed-plan Task 6. Start after 4a/4b creation and 6a.1/6a.2 contracts/client are reviewed; required SQL must be installed before frontend release. Two bounded UI units: shared fields first, then both creation entry points/fixed footer. No SQL, financial controllers, selection, correction/adoption implementation, product redesign, installs, subagents, commits or pushes.

Read [master](../../superpowers/plans/2026-10-08-pending-rollout.md), [approved design](../../superpowers/specs/2026-10-07-existing-debt-selection-design.md), [4a](task-4a-brief.md), [4b](task-4b-brief.md), [6a](task-6a-brief.md), actual reviewed contracts/hooks, AGENTS.md and antislop core/UI/copy/human/mobile skills. Antislop during is resolved. Preserve Monetigia green, Manrope/Bricolage, ENERGY1/RHYTHM2/MOTION1 and existing Goals form surfaces. Design read: remaining debt entry is a compact financial form; the total/schedule is the focal point, whitespace separates independent debts, primary green marks Create Wallet, existing labels/dividers identify hierarchy. No decorative icons/cards added to fill space.

## Files and consumed contract

Create `src/components/accounts/ExistingDebtFields.tsx`, `tests/existing-debt.test.tsx`; modify `src/components/accounts/AddAccountModal.tsx`, `src/components/forms/AddAccountForm.tsx`; create `tests/debt-account-create-ui.test.tsx`. Existing modal props remain `{ isOpen:boolean; onClose:()=>void; existingAccounts:Array<{icon:string;is_savings:boolean}> }`; standalone default export remains `AddAccountForm()`.

Consume actual reviewed 4a `OpeningDebtDraft`, `parseRemainingMonths(string):number|null`, `buildDebtSchedule(Money,string,number)`; 4b `OpeningDebtDraftSchema`, `DebtAccountCreateInputSchema`; 6a `useDebtAccountCreate(userId)` with create/retry/reset/saved/refreshError and `useDebt(userId).refresh`. Do not invent a direct client account-creation RPC wrapper or make money using `Number(rawAmount)`/`toFixed` arithmetic. Use existing `parseMoney`, `toMinorUnits`/`fromMinorUnits` and checked totals. Re-read the actual implementation before imports; report any incompatible export back to root, do not silently add another controller.

Shared field API **new in this task**:

```ts
export type ExistingDebtFieldItem = {
  clientId: string; name: string; mode: 'single'|'installments';
  amountText: string; firstDueDate: string; countText: string;
};
export type ExistingDebtFieldsValue = { enabled: boolean; items: ExistingDebtFieldItem[] };
export function validateExistingDebtFields(value: ExistingDebtFieldsValue):
  | { success: true; openingDebts: OpeningDebtDraft[]; total: Money }
  | { success: false; errors: Record<string,string> };
export function ExistingDebtFields(props: {
  value: ExistingDebtFieldsValue; onChange: (value: ExistingDebtFieldsValue)=>void;
  disabled?: boolean; errors?: Record<string,string>;
}): JSX.Element;
```

Errors use `clientId.field` keys for each named input (`name`, `amountText`, `firstDueDate`, `countText`) and `form` for aggregate errors. Stable client IDs are generated on adding an item, never each render or by index. Disabled draft controls remain frozen during saving/unresolved/saved-refresh-failed state. Validation returns no partial valid array on any error; enabled false yields `openingDebts:[]`, `total:'0.00'`. Enabled true requires at least one fully valid debt. Single draft always sends count1; installments parses raw text with the strict parser and exact schema.

Honour 4b limits visibly: 60-character names, count1..600, max100 debts/max6000 due rows, positive canonical remaining amount and total <=`9999999999999.99`. Do not change shared Money maximum. At the cap, disable Add another existing debt with a readable reason. A 24 term is supported, never labeled maximum24. Amount below count centavos rejects. Due dates are required and may be overdue; no min=today, original purchase date or already-paid installment fields.

## Unit 6b.1: Shared fields and preview

- [ ] Write failing field/validation tests; run `npx vitest run tests/existing-debt.test.tsx` before code and record RED.
- [ ] Default is None. Enable existing debt to enter separately named items with Single balance or Remaining installments. Label amount Remaining debt; button Add another existing debt. Each item has remove action and stable accessible labels. Disabling None sends no debts; retain an editing draft locally if toggled back, but never transmit hidden values. Fresh ordinary open resets the draft; unresolved reopen restores its frozen attempt instead.
- [ ] Count is text input with `inputMode="numeric"`, no HTML number coercion. Preserve raw invalid typed/pasted values so validation can reject decimals, `e`, signs, letters, spaces and zero; do not silently strip text into a different valid number. `02` is valid2; `2`/`24`/`600` accepted, `601` rejected. First due date is the first remaining row.
- [ ] Generate preview from approved helper only after complete item validation. Show exact total/count and first3 due rows, with View full schedule when count>3. Expanded list renders on demand, remains readable/scrollable for600 rows, and closes without creating a second modal focus trap. Sum all items exactly; final row absorbs remainder and Jan31 returns Mar31 after February. No invented payment history.
- [ ] Tests assert None zero/default, required name/amount/date, single count1, 2/24/600, invalid raw count/paste, 1000/3 =>333.33/333.33/333.34, multiple16000+3000=>19000, aggregate/range limits, dates/centavo errors, stable IDs after removal and on-demand full preview. Run focused tests/typecheck; Sol low reviews before unit6b.2. This reviewed shared component also enables 6a.3 legacy review dialog without duplicate inputs.

## Unit 6b.2: Creation entry points and footer

- [ ] Write failing tests mounting actual modal and standalone form with the reviewed hook mocked at its real boundary. Run `npx vitest run tests/debt-account-create-ui.test.tsx tests/existing-debt.test.tsx`; record RED.
- [ ] In both preset/custom modal credit wallet paths and standalone type=`credit_card`, replace raw Initial Debt input with shared fields and use only `useDebtAccountCreate.create({account,openingDebts})`. Both empty-debt and scheduled-debt credit creation use the atomic RPC. Supply exact 4b account fields: name/type credit_card/currency PHP/color nullable/icon nullable/is_savings false/interest_rate0/include_in_networth boolean/display_order nonnegative int32. Existing custom no-icon `''` maps to null; do not send user ID, balance, active flag, request ID or unknown fields. Hook owns request UUID. Maintain current include-in-networth default false for credit unless reviewed user choice supplies it. Use display_order0 unless existing ordering metadata supplies a valid nonnegative order.
- [ ] Ordinary cash/bank/e-wallet/investment creation keeps its established behavior; do not reroute it through credit creation or alter financial semantics. Changing wallet type before save cannot carry hidden credit debts into an ordinary insert. An unresolved credit attempt freezes type/account/debt inputs and offers only same-attempt retry; switching/closing UI cannot manufacture a new request.
- [ ] Modal is one bounded flex column: fixed header, `min-h-0 overflow-y-auto` middle, nonshrinking Cancel/Create Wallet footer with safe-area padding. Native form encloses middle/footer or footer submit button targets its form ID; Enter triggers the same validation/save once. Header/footer do not scroll with long form/preview. All validation and save/recovery feedback lives in reachable middle. Preserve the modal's `data-mobile-nav-blocking` marker and use existing Radix dialog primitive/focus management for a real labeled modal with Escape, focus trap/return and inert background. Do not remove nav modal blocking. Cancel/Escape during ordinary editing writes nothing; during unknown outcome it closes presentation while retaining owner recovery in the hook. A successful refresh closes/resets once; saving/unresolved cannot reset the attempt.
- [ ] Known rejected save preserves editable draft and visible error. Unknown outcome displays same-request Retry, no success toast. `saved` plus `refreshError` displays wallet saved/refresh failed and Refresh views using `useDebt.refresh`; no second create call. Standalone routes to `/accounts` only after confirmed successful save and successful refresh; refresh-only recovery remains reachable. Modal close never treats an unconfirmed response as success.
- [ ] Tests assert exact credit payload for both entry points/preset/custom/None/multiple debts, no direct accounts insert for credit, ordinary wallet path preserved, request recovery after unmount/reopen, duplicate submit blocked, Enter once, error draft preserved, cancel no-write, stale-auth feedback, unknown Retry only, saved-refresh-failed refresh-only and focus/escape/footer form linkage. Run `npx vitest run tests/existing-debt.test.tsx tests/debt-account-create-ui.test.tsx tests/debt-hooks.test.tsx tests/transaction-release.test.tsx tests/wallet-reservations.test.tsx`, `npx tsc --noEmit`, then Sol low review.

## Root visual verification and handoff

Root records real rendered browser evidence at320/375/768/1280 and light/dark: long named debts, 24/600 preview, safe-area footer, 44px touch targets, no horizontal overflow, last field/error reachable, fixed header/footer, Tab/Space/Enter/Escape, visible focus and200% zoom/reduced motion. Check simulated keyboard viewport behavior; physical iOS keyboard/safe-area acceptance is separately pending until observed. Run antislop delivery gates against actual UI, not a plan-based PASS. A browser build is not proof the financial migration is installed.

Return changed files, RED/GREEN/typecheck output, review findings and browser evidence/limitations. Root confirms final creation/snapshot/adoption/settlement/correction SQL and archived-restore permissions in chronological installed state before dependent frontend release. Task5 global FIFO payment allocation is unchanged; this UI makes no claim that a selected month restricts payment. Task6 is complete only after 6a.3 summary/legacy review consumer also passes.
