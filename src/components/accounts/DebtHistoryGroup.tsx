"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstallmentSelection } from "@/components/transactions/InstallmentSelection";
import { DebtCorrectionDialog } from "@/components/transactions/DebtCorrectionDialog";
import type { DebtAccountSnapshot, DebtDueRow } from "@/lib/debt/contracts";
import { reconcileDebtSelection, toggleDebtSelection, type DebtSelectionState } from "@/lib/debt/selection";

type Props = {
  account: DebtAccountSnapshot;
  rows: DebtDueRow[];
  onSaved: () => Promise<unknown>;
};

const emptySelection: DebtSelectionState = { active: false, selectedIds: [], anchorId: null };

export const debtCorrectionRecovery = {
  pendingOwners: new Set<string>(),
  refreshOwners: new Set<string>(),
};

function cents(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)\.\d{2}$/.test(value)) return null;
  return BigInt(value.replace(".", ""));
}

function moneyLabel(rows: DebtDueRow[]): string {
  const values = rows.map(row => cents(row.remainingAmount));
  if (values.some(value => value === null)) return "Unavailable";
  const total = (values as bigint[]).reduce((sum, value) => sum + value, BigInt(0));
  return `PHP ${(total / BigInt(100)).toString()}.${(total % BigInt(100)).toString().padStart(2, "0")}`;
}

export function DebtHistoryGroup({ account, rows, onSaved }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<DebtSelectionState>(emptySelection);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const regionId = useId();
  const orderedRows = useMemo(() => [...rows].sort((left, right) =>
    (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31") || left.ordinal - right.ordinal || left.id.localeCompare(right.id)), [rows]);
  const eligibleIds = useMemo(() => account.reconciliation === "balanced"
    ? orderedRows.filter(row => row.remainingAmount !== "0.00").map(row => row.id)
    : [], [account.reconciliation, orderedRows]);
  const eligibleSignature = eligibleIds.join("\u001f");
  const groupId = rows[0]?.groupId ?? "";
  const source = rows[0]?.source;
  const groupName = rows[0]?.name || (source === "opening" ? "Existing debt" : "Credit purchase");
  const listRemaining = moneyLabel(orderedRows);

  useEffect(() => {
    setSelection(current => reconcileDebtSelection(current, eligibleIds));
  }, [eligibleSignature]);

  function exitSelection() {
    setSelection(emptySelection);
  }

  function toggleExpanded() {
    if (expanded) {
      setExpanded(false);
      exitSelection();
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

  async function handleSaved() {
    setSelection(emptySelection);
    await onSaved();
  }

  return (
    <div className="group min-w-0">
      <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
        <button
          type="button"
          aria-label={`${expanded ? "Hide" : "Show"} debt history for ${groupName}`}
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={toggleExpanded}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold text-foreground">{groupName}</span>
            <span className="mt-0.5 block break-words text-xs text-muted-foreground">
              Wallet {account.accountId} · {orderedRows.length} {orderedRows.length === 1 ? "installment" : "installments"}
            </span>
          </span>
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums">Remaining {listRemaining}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {expanded && <div className="sm:ml-auto">
          <InstallmentSelection
            active={selection.active}
            selectedCount={selection.selectedIds.length}
            eligibleCount={eligibleIds.length}
            disabled={account.reconciliation !== "balanced"}
            onActivate={() => setSelection({ active: true, selectedIds: [], anchorId: null })}
            onExit={exitSelection}
            onSelectAll={() => setSelection({ active: true, selectedIds: [...eligibleIds], anchorId: eligibleIds[eligibleIds.length - 1] ?? null })}
            onDeselectAll={() => setSelection(current => ({ ...current, selectedIds: [], anchorId: null }))}
            onRequestCorrection={() => setCorrectionOpen(true)}
          />
        </div>}
      </div>

      <div
        id={regionId}
        aria-hidden={!expanded}
        ref={element => { if (element) element.toggleAttribute("inert", !expanded); }}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`${expanded ? "border-t border-border/40 py-2" : "border-t-0 py-0"}`}>
            <ul
              aria-label={`Installments for ${groupName}`}
              tabIndex={expanded ? 0 : -1}
              onKeyDown={handleListKeyDown}
              className="divide-y divide-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              {orderedRows.map(row => {
                const eligible = eligibleIds.includes(row.id);
                const checked = selection.selectedIds.includes(row.id);
                const unavailableReason = account.reconciliation !== "balanced"
                  ? "Debt reconciliation needs review before this installment can be corrected."
                  : row.remainingAmount === "0.00"
                    ? row.paidAmount !== "0.00" ? "This installment is fully paid." : "This installment has already been corrected."
                    : null;
                return (
                  <li
                    key={row.id}
                    className={`flex min-w-0 flex-col gap-2 px-3 py-3 transition-colors hover:bg-muted/30 focus-within:bg-muted/30 sm:flex-row sm:items-start sm:gap-4 sm:px-4 ${checked ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {selection.active && <input
                        type="checkbox"
                        aria-label={`Select installment ${row.ordinal}`}
                        checked={checked}
                        disabled={!eligible}
                        onClick={event => {
                          event.preventDefault();
                          setSelection(current => toggleDebtSelection(current, eligibleIds, row.id, event.shiftKey));
                        }}
                        onChange={() => undefined}
                        className="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />}
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium text-foreground">Installment {row.ordinal}</p>
                        <p className="mt-0.5 break-words text-xs text-muted-foreground">{row.dueDate ? `Due ${row.dueDate}` : "Due date unknown"}</p>
                        <p className="mt-0.5 break-words text-xs text-muted-foreground">Paid PHP {row.paidAmount} · Corrected PHP {row.correctedAmount}</p>
                        {unavailableReason && <p className="mt-1 break-words text-xs text-muted-foreground">{unavailableReason}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs tabular-nums sm:justify-end">
                      <span className="whitespace-nowrap font-semibold">Remaining PHP {row.remainingAmount}</span>
                      {row.remainingAmount !== "0.00" && <span className="whitespace-nowrap">Original PHP {row.originalAmount}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {account.reconciliation !== "balanced" && <p className="px-3 py-2 text-sm text-red-700 dark:text-red-300">This wallet needs reconciliation review. Installments cannot be corrected until the debt snapshot is balanced.</p>}
            {eligibleIds.length > 600 && <p role="status" className="px-3 py-2 text-sm">Select up to 600 installments per correction.</p>}
          </div>
        </div>
      </div>

      <DebtCorrectionDialog
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        accountId={account.accountId}
        groupId={groupId}
        groupName={groupName}
        selectedIds={selection.selectedIds}
        onSaved={handleSaved}
      />
    </div>
  );
}
