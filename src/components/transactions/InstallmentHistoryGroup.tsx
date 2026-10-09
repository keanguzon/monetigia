"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { ChevronDown, ArrowUpRight, Trash2, Pencil } from "lucide-react";
import { InstallmentSelection } from "@/components/transactions/InstallmentSelection";
import { DebtCorrectionDialog } from "@/components/transactions/DebtCorrectionDialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { installmentPosition, type InstallmentHistoryEntry, type TransactionHistoryRow, type TransactionHistorySort } from "@/lib/transactions/history";
import type { DebtAccountSnapshot, DebtDueRow } from "@/lib/debt/contracts";
import { reconcileDebtSelection, toggleDebtSelection, type DebtSelectionState } from "@/lib/debt/selection";

type DebtState = { account: DebtAccountSnapshot; rows: DebtDueRow[] };

type Props = {
  group: InstallmentHistoryEntry;
  sortMode: TransactionHistorySort;
  debtState: DebtState | null;
  selectionResetKey: string;
  onSelectTransaction: (transaction: TransactionHistoryRow) => void;
  onRequestDelete: (transaction: TransactionHistoryRow) => void;
  onRequestEditDescription?: (group: InstallmentHistoryEntry) => void;
  onSaved?: () => Promise<unknown>;
};

const emptySelection: DebtSelectionState = { active: false, selectedIds: [], anchorId: null };
const knownNonCreditAccountTypes = new Set(["cash", "bank", "e_wallet", "investment"]);

function accountType(row: TransactionHistoryRow): string | null {
  const account = row.account as (typeof row.account & { type?: string | null }) | null | undefined;
  return account?.type ?? null;
}

function exactSnapshotRows(group: InstallmentHistoryEntry, debtState: DebtState | null): Map<string, DebtDueRow> | null {
  if (!debtState || group.children.length === 0) return null;
  const first = group.children[0];
  const childIds = group.children.map(row => row.id);
  if (new Set(childIds).size !== childIds.length || group.children.some(row =>
    row.account_id !== first.account_id || row.type !== "expense" || accountType(row) !== "credit_card")) return null;
  if (debtState.account.accountId !== first.account_id) return null;

  const rows = debtState.rows.filter(row => row.accountId === first.account_id && row.groupId === group.groupId && row.source === "purchase");
  if (rows.length !== childIds.length || rows.some(row => !row.transactionId)) return null;
  const mapped = new Map(rows.map(row => [row.transactionId as string, row]));
  if (mapped.size !== childIds.length || childIds.some(id => !mapped.has(id))) return null;
  return mapped;
}

function exactRemaining(rows: DebtDueRow[]): string {
  const values = rows.map(row => /^\d+\.\d{2}$/.test(row.remainingAmount) ? BigInt(row.remainingAmount.replace(".", "")) : null);
  if (values.some(value => value === null)) return "Unavailable";
  const total = (values as bigint[]).reduce((sum, value) => sum + value, BigInt(0));
  return `${(total / BigInt(100)).toString()}.${(total % BigInt(100)).toString().padStart(2, "0")}`;
}

export default function InstallmentHistoryGroup({ group, sortMode, debtState, selectionResetKey, onSelectTransaction, onRequestDelete, onRequestEditDescription, onSaved }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<DebtSelectionState>(emptySelection);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const scheduleId = useId();
  const snapshotRows = useMemo(() => exactSnapshotRows(group, debtState), [group, debtState]);
  const hasCreditPurchase = group.children.some(row => row.type === "expense" && accountType(row) === "credit_card");
  const hasUnidentifiedExpense = group.children.some(row => {
    const type = accountType(row);
    return row.type === "expense" && type !== "credit_card" && !knownNonCreditAccountTypes.has(type ?? "");
  });
  const protectedExpenseHistory = hasCreditPurchase || hasUnidentifiedExpense;
  const creditSnapshotMissing = protectedExpenseHistory && snapshotRows === null;
  const rowsByTransaction = snapshotRows ?? new Map<string, DebtDueRow>();
  const orderedEligibleRows = group.children.flatMap(child => {
    const debtRow = rowsByTransaction.get(child.id);
    return debtRow && debtState?.account.reconciliation === "balanced" && debtRow.remainingAmount !== "0.00" ? [debtRow] : [];
  }).sort((left, right) => left.ordinal - right.ordinal);
  const renderedChildren = hasCreditPurchase && snapshotRows
    ? [...group.children].sort((left, right) => (rowsByTransaction.get(left.id)?.ordinal ?? Number.MAX_SAFE_INTEGER) - (rowsByTransaction.get(right.id)?.ordinal ?? Number.MAX_SAFE_INTEGER))
    : group.children;
  const eligibleIds = orderedEligibleRows.map(row => row.id);
  const eligibleSignature = eligibleIds.join("\u001f");
  const groupRemaining = snapshotRows ? exactRemaining(Array.from(snapshotRows.values())) : null;

  useEffect(() => {
    setSelection(emptySelection);
    setExpanded(false);
  }, [selectionResetKey]);

  useEffect(() => {
    setExpanded(false);
    setSelection(emptySelection);
  }, [group.children.length]);

  useEffect(() => {
    setSelection(current => reconcileDebtSelection(current, eligibleIds));
  }, [eligibleSignature]);

  function toggleExpanded() {
    if (expanded) {
      setExpanded(false);
      setSelection(emptySelection);
    } else {
      setExpanded(true);
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const key = event.key.toLowerCase();
    if (event.key === "Escape" && selection.active) {
      event.preventDefault();
      setSelection(emptySelection);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "a" && eligibleIds.length > 0 && eligibleIds.length <= 600) {
      event.preventDefault();
      setSelection({ active: true, selectedIds: [...eligibleIds], anchorId: eligibleIds[eligibleIds.length - 1] ?? null });
      return;
    }
    if (event.key === "Delete" && selection.active && selection.selectedIds.some(id => eligibleIds.includes(id))) {
      event.preventDefault();
      setCorrectionOpen(true);
    }
  }

  function requestCorrection() {
    if (snapshotRows && debtState?.account.reconciliation === "balanced" && selection.selectedIds.some(id => eligibleIds.includes(id))) {
      setCorrectionOpen(true);
    }
  }

  const groupLabel = group.description || "Installment purchase";
  const childCountLabel = hasCreditPurchase
    ? creditSnapshotMissing ? "Debt snapshot unavailable" : `${eligibleIds.length} remaining ${eligibleIds.length === 1 ? "installment" : "installments"}`
    : hasUnidentifiedExpense ? "Wallet type unavailable" : `${group.children.length} remaining ${group.children.length === 1 ? "payment" : "payments"}`;

  const formattedRemaining = groupRemaining === null
    ? (protectedExpenseHistory ? "Unavailable" : group.remainingAmount === null ? "Unavailable" : formatCurrency(group.remainingAmount))
    : groupRemaining === "Unavailable" ? groupRemaining : formatCurrency(Number(groupRemaining));

  return (
    <div className="group">
      <div className="flex flex-col gap-2 px-3 py-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
        <button
          type="button"
          aria-label={`${expanded ? "Hide" : "Show"} payment schedule for ${groupLabel}`}
          aria-expanded={expanded}
          aria-controls={scheduleId}
          onClick={toggleExpanded}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500" aria-hidden="true">
            <ArrowUpRight className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold tracking-tight text-foreground sm:text-base">
              {groupLabel}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">{group.children[0]?.account?.name || "Unknown wallet"}</span>
              {group.children[0]?.category?.name && <span>{group.children[0].category.name}</span>}
              <span>{childCountLabel}</span>
            </span>
          </span>
        </button>

        <div className="flex items-center justify-between gap-3 pl-[3.25rem] sm:justify-end sm:pl-0">
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-red-700 dark:text-red-400 sm:text-base">
            {formattedRemaining === "Unavailable" ? formattedRemaining : `−${formattedRemaining}`}
          </span>
          {onRequestEditDescription && (
            <button
              type="button"
              aria-label={`Edit description for ${groupLabel}`}
              disabled={group.descriptionState === "needs_review"}
              onClick={() => onRequestEditDescription(group)}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} installments for ${groupLabel}`}
            aria-expanded={expanded}
            aria-controls={scheduleId}
            onClick={toggleExpanded}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronDown className={`h-4 w-4 text-primary transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>
      {group.descriptionState === "needs_review" && <p role="status" className="px-3 pb-2 text-sm text-amber-800 dark:text-amber-200 sm:px-5">This installment description needs review before the group can be edited.</p>}

      <div
        id={scheduleId}
        ref={element => { if (element) element.toggleAttribute("inert", !expanded); }}
        aria-hidden={!expanded}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`bg-muted/10 px-3 sm:pl-[4.5rem] sm:pr-5 ${expanded ? "border-t border-border/40 py-2" : "border-t-0 py-0"}`}>
            {expanded && <div className="mb-3 text-xs text-muted-foreground">
              <p>Purchase date: {group.purchaseDate ? formatDate(group.purchaseDate) : "Not recorded"}</p>
              {!group.purchaseDate && group.firstDueDate && <p className="mt-0.5">First due {formatDate(group.firstDueDate)}</p>}
              {!group.purchaseDate && sortMode === "transaction_date" && <p className="mt-0.5">Sorted by latest due date</p>}
            </div>}
            {expanded && hasCreditPurchase && snapshotRows && debtState?.account.reconciliation === "balanced" && <div className="mb-2">
              <InstallmentSelection
                active={selection.active}
                selectedCount={selection.selectedIds.length}
                eligibleCount={eligibleIds.length}
                disabled={eligibleIds.length > 600}
                onActivate={() => setSelection({ active: true, selectedIds: [], anchorId: null })}
                onExit={() => setSelection(emptySelection)}
                onSelectAll={() => setSelection({ active: true, selectedIds: [...eligibleIds], anchorId: eligibleIds[eligibleIds.length - 1] ?? null })}
                onDeselectAll={() => setSelection(current => ({ ...current, selectedIds: [], anchorId: null }))}
                onRequestCorrection={requestCorrection}
              />
            </div>}
            {creditSnapshotMissing && <p role="alert" className="mb-2 break-words text-sm text-red-700 dark:text-red-300">{hasUnidentifiedExpense && !hasCreditPurchase ? "The wallet type for this expense is unavailable. Refresh wallet details before correcting or deleting it." : "This credit purchase does not match a complete debt snapshot. Refresh debt details before correcting or deleting it."}</p>}
            {hasCreditPurchase && debtState?.account.reconciliation === "needs_review" && <p role="alert" className="mb-2 break-words text-sm text-red-700 dark:text-red-300">This wallet needs debt reconciliation review. Credit purchase correction and deletion are unavailable.</p>}
            <ul
              aria-label={`Installments for ${groupLabel}`}
              tabIndex={expanded ? 0 : -1}
              onKeyDown={handleListKeyDown}
              className="divide-y divide-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              {renderedChildren.map((child, index) => {
                const debtRow = rowsByTransaction.get(child.id) ?? null;
                const creditRow = protectedExpenseHistory;
                const position = !creditRow ? installmentPosition(child, index, group.children.length) : null;
                const rowLabel = debtRow ? `Installment ${debtRow.ordinal}` : creditRow ? "Installment details unavailable" : `Installment ${position?.number} of ${position?.count}`;
                const reason = creditRow
                  ? hasUnidentifiedExpense && !hasCreditPurchase ? "The wallet type for this expense is unavailable."
                    : creditSnapshotMissing ? "This credit purchase does not match a complete debt snapshot."
                    : debtState?.account.reconciliation !== "balanced" ? "Debt reconciliation needs review before this purchase can be corrected."
                      : debtRow?.remainingAmount === "0.00" ? debtRow.paidAmount !== "0.00" ? "This installment is fully paid." : "This installment has already been corrected."
                        : null
                  : null;
                const eligible = !!debtRow && debtState?.account.reconciliation === "balanced" && debtRow.remainingAmount !== "0.00";
                const checked = !!debtRow && selection.selectedIds.includes(debtRow.id);
                return (
                  <li key={child.id} className={`flex min-w-0 flex-col gap-2 py-2 transition-colors hover:bg-muted/30 focus-within:bg-muted/30 sm:flex-row sm:items-center sm:gap-4 ${checked ? "bg-primary/5" : ""}`}>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {selection.active && creditRow && <input
                        type="checkbox"
                        aria-label={`Select installment ${debtRow?.ordinal ?? "unavailable"}`}
                        checked={checked}
                        disabled={!eligible}
                        onClick={event => {
                          if (debtRow) setSelection(current => toggleDebtSelection(current, eligibleIds, debtRow.id, event.shiftKey));
                        }}
                        onChange={() => undefined}
                        className="ml-2 h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />}
                      <button
                        type="button"
                        aria-label={`View installment ${debtRow?.ordinal ?? position?.number ?? "details"} details`}
                        onClick={() => onSelectTransaction(child)}
                        className="min-h-11 min-w-0 flex-1 rounded-md px-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="block break-words text-sm font-medium text-foreground">{rowLabel}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">Due {formatDate(child.date, "long")}</span>
                        {debtRow && <span className="mt-0.5 block break-words text-xs text-muted-foreground">Remaining {formatCurrency(Number(debtRow.remainingAmount))} · Paid {formatCurrency(Number(debtRow.paidAmount))} · Corrected {formatCurrency(Number(debtRow.correctedAmount))}</span>}
                        {reason && <span className="mt-0.5 block break-words text-xs text-muted-foreground">{reason}</span>}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-3 pl-2 sm:justify-end sm:pl-0">
                      <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-red-700 dark:text-red-400 sm:text-base">
                        −{formatCurrency(Number(child.amount))}
                      </span>
                      <button
                        type="button"
                        aria-label={creditRow ? `Delete installment ${debtRow?.ordinal ?? "unavailable"}` : `Delete installment ${position?.number}`}
                        title={reason ?? undefined}
                        disabled={creditRow && !eligible}
                        onClick={() => onRequestDelete(child)}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {hasCreditPurchase && snapshotRows && debtState && <DebtCorrectionDialog
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        accountId={debtState.account.accountId}
        groupId={group.groupId}
        groupName={groupLabel}
        selectedIds={selection.selectedIds}
        onSaved={async () => {
          setSelection(emptySelection);
          await onSaved?.();
        }}
      />}
    </div>
  );
}
