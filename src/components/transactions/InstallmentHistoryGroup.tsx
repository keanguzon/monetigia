"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, ArrowUpRight, Trash2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { installmentPosition, type InstallmentHistoryEntry, type TransactionHistoryRow, type TransactionHistorySort } from "@/lib/transactions/history";

type Props = {
  group: InstallmentHistoryEntry;
  sortMode: TransactionHistorySort;
  onSelectTransaction: (transaction: TransactionHistoryRow) => void;
  onRequestDelete: (transaction: TransactionHistoryRow) => void;
};

export default function InstallmentHistoryGroup({ group, sortMode, onSelectTransaction, onRequestDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const scheduleId = useId();

  useEffect(() => {
    setExpanded(false);
  }, [group.children.length]);

  return (
    <div className="group">
      <button
        type="button"
        aria-label={`${expanded ? "Hide" : "Show"} payment schedule for ${group.description}`}
        aria-expanded={expanded}
        aria-controls={scheduleId}
        onClick={() => setExpanded(value => !value)}
        className="flex min-h-11 w-full flex-col gap-3 px-3 py-3.5 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500" aria-hidden="true">
            <ArrowUpRight className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground sm:text-base">
              {group.description || "Installment purchase"}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">{group.children[0]?.account?.name || "Unknown wallet"}</span>
              {group.children[0]?.category?.name && <span>{group.children[0].category.name}</span>}
              <span>{group.children.length} remaining {group.children.length === 1 ? "payment" : "payments"}</span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 items-end justify-between gap-3 sm:ml-auto sm:items-center sm:justify-end sm:gap-4">
          <div className="flex min-w-0 flex-1 items-end justify-between gap-3 sm:flex-initial sm:gap-4">
            <div className="min-w-0 flex-1 sm:flex-initial">
              <p className="text-[11px] font-medium text-muted-foreground">Purchase date</p>
              <p className="text-sm text-foreground">
                {group.purchaseDate ? formatDate(group.purchaseDate) : "Not recorded"}
              </p>
              {!group.purchaseDate && group.firstDueDate && (
                <p className="text-xs text-muted-foreground">First due {formatDate(group.firstDueDate)}</p>
              )}
              {!group.purchaseDate && sortMode === "transaction_date" && (
                <p className="text-xs text-muted-foreground">Sorted by latest due date</p>
              )}
            </div>
            <div className="min-w-0 flex-1 text-right sm:flex-initial">
              <p className="text-[11px] font-medium text-muted-foreground">Remaining scheduled amount</p>
              <p className="whitespace-nowrap font-mono text-sm font-bold tabular-nums tracking-tight text-red-700 dark:text-red-400 sm:text-base">
                {group.remainingAmount === null ? "Unavailable" : formatCurrency(group.remainingAmount)}
              </p>
            </div>
          </div>
          <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center" aria-hidden="true">
            <ChevronDown className={`h-4 w-4 text-primary ${expanded ? "rotate-180" : ""}`} />
          </span>
        </div>
      </button>

      <div
        id={scheduleId}
        ref={element => {
          if (element) element.toggleAttribute("inert", !expanded);
        }}
        aria-hidden={!expanded}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`bg-muted/10 px-3 sm:pl-[4.5rem] sm:pr-5 ${
            expanded ? "border-t border-border/40 py-2" : "border-t-0 py-0"
          }`}>
            <ul className="divide-y divide-border/40">
              {group.children.map((child, index) => {
                const position = installmentPosition(child, index, group.children.length);
                return (
                  <li key={child.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-4">
                    <button
                      type="button"
                      aria-label={`View installment ${position.number} details`}
                      onClick={() => onSelectTransaction(child)}
                      className="min-h-11 min-w-0 flex-1 rounded-md px-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="block text-sm font-medium text-foreground">
                        Installment {position.number} of {position.count}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Due {formatDate(child.date, "long")}
                      </span>
                    </button>
                    <div className="flex items-center justify-between gap-3 pl-2 sm:justify-end sm:pl-0">
                      <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">
                        −{formatCurrency(Number(child.amount))}
                      </span>
                      <button
                        type="button"
                        aria-label={`Delete installment ${position.number}`}
                        onClick={() => onRequestDelete(child)}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
    </div>
  );
}
