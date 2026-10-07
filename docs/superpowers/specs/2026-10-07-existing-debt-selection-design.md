# Existing debt and installment selection — agreed design

User-approved requirements, October 7, 2026. Planning only; implementation is a separate step.

## Intent

Let users bring remaining debt into Monetigia with meaningful due dates, without inventing purchases, past repayments or cash movements. Reconcile wallet totals and debt summaries. Make installment correction clear on mobile and desktop.

## Agreed behavior

- Add Wallet credit/PayLater flow defaults to no existing debt. Existing debt supports Single balance or Remaining installments, with multiple separately named debts in the same account.
- Enter remaining debt only, not original purchase amount or already-paid installments.
- Single balance requires a due date. Installments require first remaining due date and a typed positive integer remaining-month count; support 2 and 24 months. Reject decimals, letters, symbols, zero and negatives.
- Equal monthly amounts; final installment absorbs centavo remainder. Preserve original monthly day with end-of-month clamping.
- Show a compact schedule preview with View full schedule for longer terms.
- Add Wallet has a fixed header and Cancel/Create Wallet footer; only middle scrolls.
- Expanded installment groups offer Select, per-row checkboxes, Select all/deselect all, Shift-click range selection and Delete selected with count and total confirmation. No drag selection or global Ctrl+A/Delete interception.
- Highlight the whole installment row, including amount/action area.
- Deleting selected unpaid debt is a correction, not a repayment: decrease outstanding debt without reimbursing a cash wallet or deleting recorded repayments.
- Existing transaction purchase history, goal reservations and real payment transfers remain truthful.

## Accounting decisions for implementation

Use explicit opening-debt schedules separate from expense transactions. A paid installment cannot be deleted as unpaid; a partially paid row allows correction of its remaining unpaid portion only, retaining paid history. Payment transfers keep their existing cash/debt effect once; schedule allocation events only identify which obligations were settled. Unassigned legacy opening debt remains in total outstanding debt with a Needs due-date review label until confirmed; migration must not invent a January date or manufacture expenses.

Total debt is authoritative account debt, while selected-month debt is a schedule projection and must be labeled separately. New entries require dates; legacy missing dates remain truthful.

## Pending verification limits

The existing implementation was manually observed to pass installment dates, centavo split, due-date retention, grouping, single deletion, sorting, payment creation and payment reversal. These are user reports. Opening debt omission is a confirmed source-level summary bug and remains unfixed. Physical iOS/PWA acceptance remains separate.

## Transaction title/description editing (additional user request)

Existing transaction display titles/descriptions can be edited after saving. Use the existing description field as display title; no separate unrequested notes field. For installment purchases, edit the common group description and preserve each installment's ordinal labels and stable group IDs. Editing text must not change money, wallet, goal, purchase/due dates, category or recorded payments. Empty text uses the existing category fallback.
