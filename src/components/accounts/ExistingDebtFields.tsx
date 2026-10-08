"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Money } from "@/lib/money/contracts";
import { MAX_OPENING_DEBT_AMOUNT, MAX_OPENING_DEBT_DUE_ROWS, MAX_OPENING_DEBT_ITEMS, OpeningDebtDraftSchema, type OpeningDebtDraft } from "@/lib/debt/contracts";
import { buildDebtSchedule, parseRemainingMonths } from "@/lib/debt/schedule";
import { fromMinorUnits, parseMoney, toMinorUnits } from "@/lib/goals/summary";

export type ExistingDebtFieldItem = {
  clientId: string; name: string; mode: "single" | "installments";
  amountText: string; firstDueDate: string; countText: string;
};
export type ExistingDebtFieldsValue = { enabled: boolean; items: ExistingDebtFieldItem[] };
function validateItem(item: ExistingDebtFieldItem): { draft?: OpeningDebtDraft; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  let amount: Money = "0.00";
  try { amount = parseMoney(item.amountText); }
  catch { errors[`${item.clientId}.amountText`] = "Enter a remaining debt with up to two decimal places."; }
  const count = item.mode === "single" ? 1 : parseRemainingMonths(item.countText);
  if (count === null) errors[`${item.clientId}.countText`] = "Enter a whole number from 1 to 600, without spaces or symbols.";
  const result = OpeningDebtDraftSchema.safeParse({ clientId: item.clientId, name: item.name, mode: item.mode, amount, firstDueDate: item.firstDueDate, count: count ?? 1 });
  if (!result.success) for (const issue of result.error.issues) {
    const field = issue.path[0];
    const key = field === "amount" ? `${item.clientId}.amountText` : field === "count" ? `${item.clientId}.countText` : field === "name" || field === "firstDueDate" ? `${item.clientId}.${field}` : "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return Object.keys(errors).length || !result.success ? { errors } : { draft: result.data, errors };
}

export function validateExistingDebtFields(value: ExistingDebtFieldsValue):
  | { success: true; openingDebts: OpeningDebtDraft[]; total: Money }
  | { success: false; errors: Record<string, string> } {
  if (!value.enabled) return { success: true, openingDebts: [], total: "0.00" };
  const errors: Record<string, string> = {};
  if (!value.items.length) errors.form = "Add at least one existing debt, or select None.";
  if (value.items.length > MAX_OPENING_DEBT_ITEMS) errors.form = "A wallet can start with up to 100 existing debts.";
  if (new Set(value.items.map(item => item.clientId)).size !== value.items.length) errors.form = "Existing debts must have distinct client IDs.";
  const openingDebts: OpeningDebtDraft[] = [];
  let totalCentavos = BigInt(0);
  let rowCount = 0;
  for (const item of value.items) {
    const validated = validateItem(item);
    Object.assign(errors, validated.errors);
    if (validated.draft) {
      openingDebts.push(validated.draft);
      totalCentavos += BigInt(toMinorUnits(validated.draft.amount));
      rowCount += validated.draft.count;
    }
  }
  if (rowCount > MAX_OPENING_DEBT_DUE_ROWS) errors.form = "Existing debts cannot exceed 6000 due rows in total.";
  if (totalCentavos > BigInt(toMinorUnits(MAX_OPENING_DEBT_AMOUNT))) errors.form = "Total existing debt cannot exceed PHP 9999999999999.99.";
  if (Object.keys(errors).length) return { success: false, errors };
  return { success: true, openingDebts, total: fromMinorUnits(Number(totalCentavos)) };
}

function emptyDebt(): ExistingDebtFieldItem {
  return { clientId: crypto.randomUUID(), name: "", mode: "single", amountText: "", firstDueDate: "", countText: "" };
}

function DebtPreview({ draft, disabled, id }: { draft: OpeningDebtDraft; disabled: boolean; id: string }) {
  const [expanded, setExpanded] = useState(false);
  const schedule = useMemo(() => buildDebtSchedule(draft.amount, draft.firstDueDate, draft.count), [draft.amount, draft.firstDueDate, draft.count]);
  return <div className="space-y-2 text-sm">
    <p className="font-medium">PHP {draft.amount} · {draft.count} {draft.count === 1 ? "due row" : "due rows"}</p>
    <div id={id} className={expanded ? "max-h-72 overflow-y-auto rounded-md border border-border" : ""}>
      <table className="w-full text-left text-xs sm:text-sm">
        <caption className="sr-only">Remaining schedule for {draft.name}</caption>
        <thead><tr><th scope="col" className="px-2 py-2">Row</th><th scope="col" className="px-2 py-2">Due date</th><th scope="col" className="px-2 py-2 text-right">Amount</th></tr></thead>
        <tbody>{(expanded ? schedule : schedule.slice(0, 3)).map(row => <tr key={row.ordinal}><td className="px-2 py-2">{row.ordinal}</td><td className="whitespace-nowrap px-2 py-2">{row.dueDate}</td><td className="break-all px-2 py-2 text-right tabular-nums">PHP {row.amount}</td></tr>)}</tbody>
      </table>
    </div>
    {draft.count > 3 && <Button type="button" variant="outline" disabled={disabled} className="min-h-11 whitespace-normal" aria-expanded={expanded} aria-controls={id} onClick={() => { if (!disabled) setExpanded(current => !current); }}>{expanded ? "Hide full schedule" : "View full schedule"}</Button>}
  </div>;
}

export function ExistingDebtFields({ value, onChange, disabled = false, errors = {} }: { value: ExistingDebtFieldsValue; onChange: (value: ExistingDebtFieldsValue) => void; disabled?: boolean; errors?: Record<string, string> }): JSX.Element {
  const prefix = useId();
  const validated = useMemo(() => validateExistingDebtFields(value), [value]);
  const rowCount = value.items.reduce((sum, item) => sum + (item.mode === "single" ? 1 : parseRemainingMonths(item.countText) ?? 0), 0);
  const capReason = value.items.length >= MAX_OPENING_DEBT_ITEMS ? "Maximum 100 existing debts reached." : rowCount >= MAX_OPENING_DEBT_DUE_ROWS ? "Maximum 6000 due rows reached." : undefined;
  function change(next: ExistingDebtFieldsValue) { if (!disabled) onChange(next); }
  function update(clientId: string, patch: Partial<Omit<ExistingDebtFieldItem, "clientId">>) {
    change({ ...value, items: value.items.map(item => item.clientId === clientId ? { ...item, ...patch } : item) });
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <legend className="text-sm font-semibold">Existing debt</legend>
    <div className="flex flex-wrap gap-x-6 gap-y-1">
      {[[false, "None"], [true, "Existing debt"]].map(([enabled, label]) => <label key={String(enabled)} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="radio" name={`${prefix}-enabled`} checked={value.enabled === enabled} className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={() => change({ enabled: Boolean(enabled), items: enabled && !value.items.length ? [emptyDebt()] : value.items })} />{label}</label>)}
    </div>
    {errors.form && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{errors.form}</p>}
    {value.enabled && <>
      <p className="text-xs text-muted-foreground">Enter only the balance and installments still owed. Due dates may be in the past.</p>
      <div className="space-y-6">{value.items.map((item, index) => {
        const itemId = `${prefix}-${item.clientId}`;
        const preview = validateItem(item).draft;
        function input(field: "name" | "amountText" | "firstDueDate" | "countText", label: string) {
          const error = errors[`${item.clientId}.${field}`];
          const id = `${itemId}-${field}`;
          return <div className="min-w-0 space-y-1.5"><label htmlFor={id} className="text-sm font-medium">{label}</label><Input id={id} type={field === "firstDueDate" ? "date" : "text"} className="min-h-11 min-w-0" inputMode={field === "countText" ? "numeric" : field === "amountText" ? "decimal" : undefined} maxLength={field === "name" ? 120 : undefined} value={item[field]} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : field === "name" ? `${id}-hint` : undefined} onChange={event => update(item.clientId, { [field]: event.target.value })} />{field === "name" && <p id={`${id}-hint`} className="text-xs text-muted-foreground">Up to 60 characters.</p>}{error && <p id={`${id}-error`} role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}</div>;
        }
        return <fieldset key={item.clientId} className="min-w-0 space-y-3 border-t border-border pt-4"><legend className="max-w-full break-words px-1 text-sm font-semibold">Debt {index + 1}{item.name.trim() ? `: ${item.name.trim()}` : ""}</legend>
          {input("name", "Debt name")}
          <div className="space-y-1.5"><label htmlFor={`${itemId}-mode`} className="text-sm font-medium">Repayment type</label><select id={`${itemId}-mode`} value={item.mode} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event => update(item.clientId, { mode: event.target.value as ExistingDebtFieldItem["mode"] })}><option value="single">Single balance</option><option value="installments">Remaining installments</option></select></div>
          {input("amountText", "Remaining debt (PHP)")}
          {item.mode === "installments" && <>{input("countText", "Remaining installments")}<p className="text-xs text-muted-foreground">1 to 600 installments.</p></>}
          {input("firstDueDate", item.mode === "single" ? "Due date" : "First remaining due date")}
          {preview && <DebtPreview draft={preview} disabled={disabled} id={`${itemId}-schedule`} />}
          <Button type="button" variant="outline" className="min-h-11 whitespace-normal" disabled={disabled} aria-label={`Remove ${item.name.trim() || `debt ${index + 1}`}`} onClick={() => change({ ...value, items: value.items.filter(entry => entry.clientId !== item.clientId) })}>Remove debt</Button>
        </fieldset>;
      })}</div>
      <Button type="button" variant="outline" disabled={disabled || Boolean(capReason)} aria-describedby={capReason ? `${prefix}-cap` : undefined} className="min-h-11 max-w-full whitespace-normal" onClick={() => { if (!capReason) change({ ...value, items: [...value.items, emptyDebt()] }); }}>Add another existing debt</Button>
      {capReason && <p id={`${prefix}-cap`} className="text-sm text-muted-foreground">{capReason}</p>}
      {validated.success && <p className="break-words text-sm font-semibold tabular-nums">Total existing debt: PHP {validated.total}</p>}
    </>}
  </fieldset>;
}
