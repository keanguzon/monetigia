"use client";

import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Tooltip from "@/components/ui/tooltip";
import { HISTORY_SORTS, type HistorySort } from "@/lib/transactions/history-query";

const labels: Record<HistorySort, string> = {
  transaction_date_desc: "Transaction date: newest",
  transaction_date_asc: "Transaction date: oldest",
  date_added_desc: "Date added: newest",
  date_added_asc: "Date added: oldest",
  amount_desc: "Amount: highest",
  amount_asc: "Amount: lowest",
};

type TransactionSortControlProps = {
  sort: HistorySort;
  onChange: (sort: HistorySort) => void;
};

export function TransactionSortControl({ sort, onChange }: TransactionSortControlProps) {
  const selectedLabel = labels[sort];

  return <div className="min-w-0">
    <label className="sr-only" htmlFor="transaction-history-sort">Sort transactions</label>
    <select id="transaction-history-sort" aria-label="Sort transactions" value={sort} onChange={event => onChange(event.target.value as HistorySort)} className="hidden h-11 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:block">
      {HISTORY_SORTS.map(value => <option key={value} value={value}>{labels[value]}</option>)}
    </select>

    <div className="md:hidden">
      <Tooltip content={`Sort: ${selectedLabel}`}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label={`Sort transactions: ${selectedLabel}`}>
              <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={8} className="w-[min(20rem,calc(100vw-1rem))]">
            <DropdownMenuRadioGroup value={sort} onValueChange={value => { if ((HISTORY_SORTS as readonly string[]).includes(value)) onChange(value as HistorySort); }}>
              {HISTORY_SORTS.map(value => <DropdownMenuRadioItem key={value} className="min-h-11" value={value}>{labels[value]}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </div>
  </div>;
}
