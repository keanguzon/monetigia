"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Filter, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Tooltip from "@/components/ui/tooltip";
import { historyDateBounds, isHistoryCivilDate, normalizeHistoryAmount, normalizeHistoryQuery, type HistoryDateSelection, type HistoryFilters, type HistoryQuery } from "@/lib/transactions/history-query";
import type { HistoryFilterOptions } from "@/lib/transactions/history-filtered";

export type TransactionFilterOptionsState = HistoryFilterOptions & {
  isLoading: boolean;
  error: unknown | null;
  retry: () => void | Promise<void>;
};

type TransactionFilterDialogProps = {
  query: HistoryQuery;
  dateSelection: HistoryDateSelection;
  options: TransactionFilterOptionsState;
  onApply: (filters: HistoryFilters, dateSelection: HistoryDateSelection) => void;
  onClearAll: () => void;
};

function copyFilters(query: HistoryQuery, dateSelection: HistoryDateSelection): HistoryFilters {
  const dates = historyDateBounds(dateSelection);
  return {
    type: query.type,
    search: query.search,
    walletIds: [...query.walletIds],
    categoryIds: [...query.categoryIds],
    includeUncategorized: query.includeUncategorized,
    minAmount: query.minAmount,
    maxAmount: query.maxAmount,
    ...dates,
  };
}

function activeFilterCount(query: HistoryQuery, dateSelection: HistoryDateSelection): number {
  return query.walletIds.length + query.categoryIds.length + Number(query.includeUncategorized)
    + Number(query.minAmount !== null) + Number(query.maxAmount !== null)
    + Number(dateSelection.kind === "custom");
}

function checkboxLabel(optionName: string, archived = false) {
  return <>{optionName}{archived && <span aria-hidden="true" className="ml-2 text-xs text-muted-foreground">Archived</span>}</>;
}

export function TransactionFilterDialog({ query, dateSelection, options, onApply, onClearAll }: TransactionFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<HistoryFilters>(() => copyFilters(query, dateSelection));
  const [draftStart, setDraftStart] = useState(() => historyDateBounds(dateSelection).start ?? "");
  const [draftEnd, setDraftEnd] = useState(() => historyDateBounds(dateSelection).end ?? "");
  const [dateTouched, setDateTouched] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const count = activeFilterCount(query, dateSelection);
  const triggerLabel = count ? `Filters, ${count} active` : "Filters";
  const canClearAll = count > 0 || query.search.length > 0 || query.type !== "all" || dateSelection.kind !== "all";

  function beginDraft() {
    const dates = historyDateBounds(dateSelection);
    setDraft(copyFilters(query, dateSelection));
    setDraftStart(dates.start ?? "");
    setDraftEnd(dates.end ?? "");
    setDateTouched(false);
    setValidationError(null);
    setOpen(true);
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) beginDraft();
    else setOpen(false);
  }

  function toggleId(field: "walletIds" | "categoryIds", id: string, checked: boolean) {
    setDraft(current => {
      const selected = new Set(current[field]);
      if (checked) selected.add(id);
      else selected.delete(id);
      return { ...current, [field]: Array.from(selected).sort() };
    });
    setValidationError(null);
  }

  function resetDraft() {
    setDraft(current => ({ ...current, walletIds: [], categoryIds: [], includeUncategorized: false, minAmount: null, maxAmount: null, start: null, end: null }));
    setDraftStart("");
    setDraftEnd("");
    setDateTouched(true);
    setValidationError(null);
  }

  function applyDraft() {
    let minAmount: string | null;
    let maxAmount: string | null;
    try {
      minAmount = normalizeHistoryAmount(draft.minAmount ?? "", "minAmount");
      maxAmount = normalizeHistoryAmount(draft.maxAmount ?? "", "maxAmount");
    } catch {
      setValidationError("Enter a valid amount.");
      return;
    }
    if (minAmount !== null && maxAmount !== null && BigInt(minAmount.replace(".", "")) > BigInt(maxAmount.replace(".", ""))) {
      setValidationError("Minimum must not exceed maximum.");
      return;
    }

    let nextDateSelection = dateSelection;
    if (dateTouched) {
      if (!draftStart && !draftEnd) nextDateSelection = { kind: "all" };
      else if (!draftStart || !draftEnd || !isHistoryCivilDate(draftStart) || !isHistoryCivilDate(draftEnd)) {
        setValidationError("Enter both dates.");
        return;
      } else if (draftEnd < draftStart) {
        setValidationError("End date must be on or after start date.");
        return;
      } else nextDateSelection = { kind: "custom", start: draftStart, end: draftEnd };
    }

    const dates = historyDateBounds(nextDateSelection);
    try {
      const normalized = normalizeHistoryQuery({ ...query, ...draft, minAmount, maxAmount, ...dates, offset: 0 });
      const { version: _version, sort: _sort, offset: _offset, ...filters } = normalized;
      onApply(filters, nextDateSelection);
      setValidationError(null);
      setOpen(false);
    } catch {
      setValidationError("Check the filter values.");
    }
  }

  function clearAll() {
    onClearAll();
    setOpen(false);
  }

  const walletChoices = [
    ...options.wallets.map(option => ({ ...option, isUnavailable: false })),
    ...draft.walletIds.filter(id => !options.wallets.some(option => option.id === id)).map(id => ({ id, name: `Unavailable wallet (${id.slice(0, 8)})`, type: "unknown", currency: "", isActive: false, isUnavailable: true })),
  ];
  const categoryChoices = [
    ...options.categories,
    ...draft.categoryIds.filter(id => !options.categories.some(option => option.id === id)).map(id => ({ id, name: `Unavailable category (${id.slice(0, 8)})`, type: "expense" as const, color: null })),
  ];

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Tooltip content={triggerLabel}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label={triggerLabel}>
          <span className="relative inline-flex" aria-hidden="true">
            <Filter className="h-4 w-4" />
            {count > 0 && <span className="absolute -right-3 -top-3 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground">{count}</span>}
          </span>
        </Button>
      </Dialog.Trigger>
    </Tooltip>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 top-auto z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full translate-y-0 flex-col overflow-hidden rounded-t-2xl border border-border bg-card pb-[env(safe-area-inset-bottom)] text-card-foreground shadow-xl outline-none md:bottom-auto md:left-1/2 md:right-auto md:top-1/2 md:max-h-[min(88dvh,52rem)] md:w-[min(38rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:pb-0">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
          <Dialog.Title className="text-base font-semibold">Filters</Dialog.Title>
          <Tooltip content="Close filters">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Close filters"><X className="h-4 w-4" aria-hidden="true" /></Button>
            </Dialog.Close>
          </Tooltip>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">
          {options.isLoading && <p role="status" aria-label="Loading filter options" className="text-sm text-muted-foreground">Loading options…</p>}
          {Boolean(options.error) && <div className="flex flex-wrap items-center gap-2" role="alert">
            <span className="text-sm">Options couldn&apos;t load.</span>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { void Promise.resolve().then(options.retry).catch(() => undefined); }}>Retry options</Button>
          </div>}

          <fieldset className="min-w-0 space-y-1">
            <legend className="mb-1 text-sm font-semibold">Wallets</legend>
            {!options.isLoading && !options.error && walletChoices.length === 0 && <p className="py-2 text-sm text-muted-foreground">No wallets.</p>}
            {walletChoices.map(option => <label key={option.id} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring">
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" checked={draft.walletIds.includes(option.id)} onChange={event => toggleId("walletIds", option.id, event.target.checked)} />
              <span className="min-w-0 break-words">{checkboxLabel(option.name, !option.isActive && !option.isUnavailable)}</span>
            </label>)}
          </fieldset>

          <fieldset className="min-w-0 space-y-1">
            <legend className="mb-1 text-sm font-semibold">Categories</legend>
            {!options.isLoading && !options.error && categoryChoices.length === 0 && <p className="py-2 text-sm text-muted-foreground">No categories.</p>}
            {categoryChoices.map(option => <label key={option.id} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring">
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" checked={draft.categoryIds.includes(option.id)} onChange={event => toggleId("categoryIds", option.id, event.target.checked)} />
              <span className="min-w-0 break-words">{option.name}</span>
            </label>)}
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring">
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" checked={draft.includeUncategorized} onChange={event => setDraft(current => ({ ...current, includeUncategorized: event.target.checked }))} />
              <span>Uncategorized</span>
            </label>
          </fieldset>

          <fieldset className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="col-span-full mb-1 text-sm font-semibold">Amount (₱)</legend>
            <label className="grid min-w-0 gap-1 text-sm font-medium">Minimum amount
              <Input className="h-11" type="text" inputMode="decimal" autoComplete="off" value={draft.minAmount ?? ""} onChange={event => { setDraft(current => ({ ...current, minAmount: event.target.value || null })); setValidationError(null); }} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-medium">Maximum amount
              <Input className="h-11" type="text" inputMode="decimal" autoComplete="off" value={draft.maxAmount ?? ""} onChange={event => { setDraft(current => ({ ...current, maxAmount: event.target.value || null })); setValidationError(null); }} />
            </label>
          </fieldset>

          <fieldset className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="col-span-full mb-1 text-sm font-semibold">Transaction / installment date</legend>
            <label className="grid min-w-0 gap-1 text-sm font-medium">Start date
              <Input className="h-11 min-w-0" type="date" value={draftStart} onChange={event => { setDraftStart(event.target.value); setDateTouched(true); setValidationError(null); }} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-medium">End date
              <Input className="h-11 min-w-0" type="date" value={draftEnd} onChange={event => { setDraftEnd(event.target.value); setDateTouched(true); setValidationError(null); }} />
            </label>
          </fieldset>

          {validationError && <p role="alert" className="text-sm font-medium text-destructive">{validationError}</p>}
        </div>

        <footer className="grid shrink-0 gap-2 border-t border-border px-4 py-3 md:px-6">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={resetDraft}><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Reset</Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={clearAll} disabled={!canClearAll}>Clear all</Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:justify-self-end">
            <Dialog.Close asChild><Button type="button" variant="outline" className="min-h-11">Cancel</Button></Dialog.Close>
            <Button type="button" variant="default" className="min-h-11" onClick={applyDraft}>Apply</Button>
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
