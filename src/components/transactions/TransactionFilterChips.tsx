"use client";

import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import Tooltip from "@/components/ui/tooltip";
import { normalizeHistoryQuery, type HistoryDateSelection, type HistoryQuery } from "@/lib/transactions/history-query";
import type { HistoryFilterOptions } from "@/lib/transactions/history-filtered";

type TransactionFilterChipsProps = {
  query: HistoryQuery;
  dateSelection: HistoryDateSelection;
  options: Pick<HistoryFilterOptions, "wallets" | "categories">;
  onChange: (query: HistoryQuery, dateSelection: HistoryDateSelection) => void;
  onClearAll: () => void;
};

function formatDateRange(start: string, end: string): string {
  const first = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  const month = new Intl.DateTimeFormat("en", { month: "short" });
  const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    return `${month.format(first)} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`;
  }
  if (first.getFullYear() === last.getFullYear()) return `${shortDate.format(first)}–${shortDate.format(last)}, ${last.getFullYear()}`;
  const fullDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
  return `${fullDate.format(first)}–${fullDate.format(last)}`;
}

export function TransactionFilterChips({ query, dateSelection, options, onChange, onClearAll }: TransactionFilterChipsProps) {
  const chips: Array<{ key: string; label: string; ariaName: string; nextQuery: Partial<HistoryQuery>; nextDateSelection?: HistoryDateSelection }> = [];
  if (query.search) chips.push({ key: "search", label: `Search: “${query.search}”`, ariaName: "Remove search filter", nextQuery: { search: "" } });
  if (query.type !== "all") chips.push({ key: "type", label: query.type[0].toUpperCase() + query.type.slice(1), ariaName: `Remove ${query.type} filter`, nextQuery: { type: "all" } });
  for (const id of query.walletIds) {
    const name = options.wallets.find(option => option.id === id)?.name ?? `Unavailable wallet (${id.slice(0, 8)})`;
    chips.push({ key: `wallet-${id}`, label: name, ariaName: `Remove ${name} filter`, nextQuery: { walletIds: query.walletIds.filter(value => value !== id) } });
  }
  for (const id of query.categoryIds) {
    const name = options.categories.find(option => option.id === id)?.name ?? `Unavailable category (${id.slice(0, 8)})`;
    chips.push({ key: `category-${id}`, label: name, ariaName: `Remove ${name} filter`, nextQuery: { categoryIds: query.categoryIds.filter(value => value !== id) } });
  }
  if (query.includeUncategorized) chips.push({ key: "uncategorized", label: "Uncategorized", ariaName: "Remove Uncategorized filter", nextQuery: { includeUncategorized: false } });
  if (query.minAmount !== null || query.maxAmount !== null) {
    const label = query.minAmount !== null && query.maxAmount !== null ? `₱${query.minAmount}–₱${query.maxAmount}`
      : query.minAmount !== null ? `At least ₱${query.minAmount}` : `Up to ₱${query.maxAmount}`;
    chips.push({ key: "amount", label, ariaName: "Remove amount filter", nextQuery: { minAmount: null, maxAmount: null } });
  }
  if (dateSelection.kind === "custom") chips.push({
    key: "dates", label: formatDateRange(dateSelection.start, dateSelection.end), ariaName: "Remove date range filter",
    nextQuery: { start: null, end: null }, nextDateSelection: { kind: "all" },
  });

  if (chips.length === 0) return null;

  return <div role="group" aria-label="Active filters" className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
    {chips.map(chip => <span key={chip.key} className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-muted/40">
      <span className="min-w-0 max-w-[calc(100vw-7rem)] break-words px-3 py-2 text-sm sm:max-w-sm">{chip.label}</span>
      <Tooltip content={chip.ariaName}>
        <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={chip.ariaName} title={chip.ariaName} onClick={() => onChange(normalizeHistoryQuery({ ...query, ...chip.nextQuery, offset: 0 }), chip.nextDateSelection ?? dateSelection)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Tooltip>
    </span>)}
    <Tooltip content="Clear all filters">
      <Button type="button" variant="outline" className="min-h-11 shrink-0 gap-2" aria-label="Clear all" title="Clear all" onClick={onClearAll}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />Clear all
      </Button>
    </Tooltip>
  </div>;
}
