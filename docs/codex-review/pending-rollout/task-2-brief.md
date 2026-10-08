# Task 2 brief: Overspend confirmation popup

**Implementation:** Sol 6.1 medium. **Review:** Sol medium. **Planning:** Sol medium/high. User authorized this pending feature; no repeated design or execution approval is needed. Follow current AGENTS.md and antislop during, already resolved in this session.

## Outcome and scope

When a transaction requires goal-reservation releases, show a separate confirmation popup above the Add Transaction form with **Keep reservations** and **Release funds and save**. Preserve the existing exact quote, customization, request UUID, stale re-quote, unknown-outcome recovery, fixed form footer and successful-refresh auto-close. No backend, contract, accounting, request-controller or database edits.

Read [rollout plan](../../superpowers/plans/2026-10-08-pending-rollout.md), [AGENTS.md](../../../AGENTS.md), and the explicitly invoked [antislop core](../../../.agents/skills/antislop/SKILL.md), [UI](../../../.agents/skills/antislop-ui/SKILL.md), [human](../../../.agents/skills/antislop-human/SKILL.md), [mobile](../../../.agents/skills/antislop-layoutmobile/SKILL.md), [copy](../../../.agents/skills/antislop-copywriting/SKILL.md), [comment hygiene](../../../.agents/skills/antislop-code/SKILL.md). Comment hygiene alone modifies comments only; user authorization covers this feature. Preserve green, Manrope/Bricolage, solid dialog surfaces, ENERGY 1 / RHYTHM 2 / MOTION 1, 44px targets, focus rings and reduced motion. No new assets, dependencies, decorative motion or financial writes during visual QA.

## Exact files

Create `src/components/transactions/GoalReleaseDialog.tsx`: presentation wrapper using existing `@radix-ui/react-dialog`, not a new shared modal abstraction.

Modify `src/components/transactions/GoalReleaseNotice.tsx`: reuse quote/custom-input content; adapt its outer inline-only margin/surface and heading so it fits the popup without a duplicated title. Move confirmation actions to a fixed popup footer if needed. Keep exact amount parsing, eligible-goal filtering, custom sum validation and behavior.

Modify `src/components/transactions/AddTransactionModal.tsx`: replace the inline notice with controlled popup integration, presentation-only review latch and underlying dialog focus suspension. Keep its form fields mounted, all draft state and existing fixed form footer/recovery feedback.

Modify `tests/transaction-release.test.tsx`: add popup/focus tests and adapt form-edit tests to first dismiss the popup through Keep reservations. Retain hook regression tests unchanged. Other files are out of scope unless the root separately authorizes a demonstrated integration fix.

Read without modifying `src/hooks/use-transaction-submit.ts`, `src/lib/goals/contracts.ts`, `src/lib/refresh-financial-data.ts`. Their existing behavior is authoritative.

## Interfaces and controller facts

Existing `useTransactionSubmit()` returns:

```ts
{
  phase: 'editing'|'quoting'|'review'|'saving'|'saved';
  error: string|null; saved: FinancialResult|null; refreshError: unknown|null;
  transactionQuote: TransactionQuote|null; draft: TransactionDraft|null;
  unresolved: boolean;
  quote(draft: TransactionDraft, releases?: ReleaseLine[], requireConfirmation?: boolean): Promise<void>;
  confirm(): Promise<void>; reset(): void;
}
```

- `quote` clears the current quote while loading. Ordinary zero-release quotes save directly; stale rejection calls `quote(draft, undefined, true)`, so even a fresh zero-release quote must receive explicit renewed confirmation.
- `confirm` freezes request UUID, command and quote. Concurrent confirms are guarded by phase. Unknown outcomes return to review with `unresolved=true`; reset cannot discard their pending attempt. Reopening must retry the same UUID/command/quote.
- Saved with refresh error is already committed and must not offer another save. Saved with successful refresh already auto-closes through the parent's effect.

Use this wrapper contract:

```ts
type GoalReleaseDialogProps = {
  open: boolean;
  quote: TransactionQuote; draft: TransactionDraft;
  snapshot?: GoalFinanceSnapshot;
  busy: boolean; error: string|null;
  onChange: (releases: ReleaseLine[]) => void;
  onConfirm: () => void; onCancel: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
};
export function GoalReleaseDialog(props: GoalReleaseDialogProps): JSX.Element;
```

No new controller, request ID or financial operation lives in this component. `onChange` calls `submit.quote(submit.draft!, releases)`, `onConfirm` calls `submit.confirm()`, `onCancel` calls `submit.reset()` without closing the transaction form.

## Dialog/focus decision

Use a nested Radix confirmation dialog with its own portal and higher stacking level. The transaction form stays mounted and visually behind the popup, preserving draft and scroll position. A single-root replacement would turn the existing form into a review step and require restructuring its fixed footer/recovery body; the requested separate popup is better served by a bounded wrapper.

There must be only one active modal trap: set the parent `Dialog.Root modal={!reviewOpen}` while the child modal is open, and mark the parent `Dialog.Content` inert/aria-hidden during review. The child portal is a body sibling, outside the inert parent's DOM. Remove parent inert/aria-hidden before restoring focus. Do not remove the parent form or reset its draft to show the popup. Keep parent Escape/outside dismissal blocked while review is open or an operation is busy; child Keep/Escape dismisses only review. Use ref-driven `inert` attribute toggling as the repo already does in Sidebar if React typings lack inert.

The child uses `Dialog.Title` "Review goal releases", descriptive text and an opaque surface. Its initial focus is Keep reservations. Tab/Shift+Tab stays inside it. Escape and outside dismissal call cancellation only when not busy; neither writes. Prevent child close-autofocus from forcing focus to a stale/unmounted element. On an explicit decline restore focus to the parent's Add Transaction button after its trap/visibility is restored. On unknown outcome move focus to Retry same transaction in the parent; on rejected save move to the parent's alert or usable form. Do not restore focus into the form while a successful save is closing the whole modal. Avoid two audible copies of the same error.

## Presentation state and transitions

Add only a presentation latch in the parent: retain the most recent `{quote,draft}` for rendering while the already opened review is requoting or saving. This retained quote is never an authority for confirming. `busy` blocks both action buttons, custom inputs and dismissal whenever `phase` is quoting/saving. The controller still supplies every callback target.

| Controller state | Popup behavior |
| --- | --- |
| Initial quoting, no previous review | Form shows existing checking state; no popup yet |
| Review, quote/draft present, unresolved false | Open popup, replace displayed quote when fingerprint/release data changes |
| Quoting/saving after popup opened | Keep popup mounted; show checking/saving feedback and disable actions; preserve last display only |
| Stale rejection then fresh review | Display fresh amounts/error and require a new explicit confirmation, including a fresh zero-release quote |
| Custom quote failure, editing state | Close popup; retain transaction form/draft and visible existing error; do not save |
| Unknown outcome, unresolved true | Close popup; show the existing parent alert and Retry same transaction; disable new form entry; do not call reset/requote |
| Known rejection, editing state | Close popup; existing human error is reachable above fixed form footer |
| Saved, refresh failed | Close popup; parent Saved/Close state remains, no further save |
| Saved, refresh succeeded | Existing parent auto-close runs; no second onClose call from child |
| Parent isOpen false/unmount | Clear presentation latch only; no financial controller mutation beyond existing parent behavior |

Reset custom UI when the authoritative quote changes using the existing keyed-notice approach. A customization requiring a quote must not allow confirmation while local inputs are unreviewed. On custom requote retain the popup, then show the returned server breakdown. Do not briefly expose actionable old confirmation during effect-driven state transitions: derive busy/eligibility directly from current controller phase, not solely the latch.

## Implementation and tests

- [ ] Add failing tests that required release appears in a separately named dialog, Laptop PHP 3,000 and actual/reserved/available reflect the fixture, initial focus is Keep, and the underlying form is inaccessible/inert while review is open. Test Tab/Shift+Tab and Escape with user-event; one Escape leaves Add Transaction open with entered amount retained and focus on its submit button.
- [ ] Add tests that Keep and outside cancellation cause zero writes; confirmation double-click writes once; popup remains mounted/non-dismissable while a deferred confirm is pending; parent auto-close fires once only after success plus refresh. Existing zero-release direct-save remains unchanged.
- [ ] Extend stale UI regression: rejected first confirmation, deferred requote, old action disabled, new PHP 4,000 release/fingerprint displayed, error visible inside popup, one write attempt until second explicit confirmation. Also test a stale fresh quote with zero releases still waits for explicit confirmation.
- [ ] Retain/customize existing multi-goal test: unreviewed custom values disable confirm; exact chosen releases reach quote; no write during quoting; accepted returned breakdown is used by confirm. Failed custom quote returns to editable form with a human error and no write.
- [ ] Preserve existing unknown-outcome, closure/reopening, session-mismatch, rejected-save and saved-refresh-failure tests. Assert unknown closes popup and leaves one reachable alert/Retry, same request UUID/command/quote on retry, and no discarded recovery state. Adapt tests that previously programmatically edited fields behind an inline review: Keep first, then edit and request a fresh quote.
- [ ] Run `npx vitest run tests/transaction-release.test.tsx` and observe failures for popup behavior before implementation. Implement only scoped presentation changes; run that command again plus `npx tsc --noEmit`. Do not change hooks/SQL to make presentation tests pass.
- [ ] Root browser checks at 375/768/1280px, light/dark, keyboard and reduced motion: separate popup, fixed popup actions with long goal names/multiple custom rows, cancel returns to preserved form, original form footer remains fixed, errors/recovery visible, mobile navigation stays suppressed throughout review and form modal. Check narrow popup height with safe area and virtual keyboard; physical Safari acceptance remains device-dependent.
- [ ] Sol medium reviews phase mapping, focus ownership, stale zero-release handling, idempotent recovery and diff scope. Fix findings and report focused results. Root runs integrated tests/lint/build and antislop gates before authorized commit/release; executor does not commit/push unless instructed.

## Material risks

Radix parent/child focus ordering needs real browser checking; jsdom alone cannot prove that a background trap is suspended. A retained presentation quote must never become a save authority. Stale requotes can require confirmation with an empty release list. Unknown outcomes must leave the same-user recovery lane intact. Popup controls and long custom content must remain reachable without moving transaction-footer recovery back into the scroll body.
