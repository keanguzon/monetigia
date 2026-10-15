"use client";

import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { SummarySkeleton, summaryAmountClass, summaryPanelClass } from "@/components/ui/financial-summary";
import { useSpendingSummary, useSpendingLimit } from "@/hooks/use-spending";
import { SpendingLimitDialog } from "./SpendingLimitDialog";
import { comparisonRange, formatPeriodLabel, isCurrentPeriod, spentToDateEnd, type SpendingPeriod } from "@/lib/spending/periods";

const cents = (value: string) => BigInt(value.replace(".", ""));
function money(value: bigint): string {
  const magnitude = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "−" : ""}₱${(magnitude / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(magnitude % BigInt(100)).toString().padStart(2, "0")}`;
}
function rangeLabel(start: string, end: string) {
  return `${format(parseISO(start), "MMM d")}–${format(parseISO(end), start.slice(0, 7) === end.slice(0, 7) ? "d, yyyy" : "MMM d, yyyy")}`;
}

export function SpendingSummaryPanel({ period, today, onAddTransaction, listFiltersActive = false }: { listFiltersActive?: boolean; period: SpendingPeriod | null; today: Date; onAddTransaction: () => void }) {
  const result = useSpendingSummary(period, today);
  const limitResult = useSpendingLimit();
  if (!period) return null;
  if (result.isLoading) return <SummarySkeleton aria-label="Loading spending summary" />;
  if (result.error || !result.data) return <section className={summaryPanelClass} role="alert"><p>Spending totals couldn&apos;t load. Your transactions below are unaffected.</p><Button className="mt-3 min-h-11" variant="outline" onClick={() => void result.retry()}>Retry</Button></section>;
  const data = result.data;
  const spent = cents(data.spent);
  const label = formatPeriodLabel(period);
  const current = isCurrentPeriod(period, today);
  const limit = limitResult.limit;
  const matchingLimit = limit && (limit.cadence === "month" ? period.kind === "month" : period.kind !== "month");
  const limitCents = limit ? cents(limit.amount) : BigInt(0);
  const over = spent > limitCents;
  const previous = comparisonRange(period, today);
  const difference = result.comparison ? spent - cents(result.comparison.spent) : BigInt(0);
  const categories = [...data.categories].sort((a, b) => cents(a.amount) > cents(b.amount) ? -1 : cents(a.amount) < cents(b.amount) ? 1 : a.name.localeCompare(b.name));
  const rows = categories.slice(0, 5).map(row => ({ name: row.name, amount: cents(row.amount) }));
  const rest = categories.slice(5).reduce((sum, row) => sum + cents(row.amount), BigInt(0));
  if (rest > BigInt(0)) rows.push({ name: "Other categories", amount: rest });
  if (cents(data.debtPayments) > BigInt(0)) rows.push({ name: "Debt payments", amount: cents(data.debtPayments) });
  return <section aria-label="Spending summary" className={`${summaryPanelClass} min-w-0 space-y-4`}>
    {listFiltersActive && <p className="text-xs text-muted-foreground">List filters only</p>}
    <div><h3 className="font-heading text-lg font-semibold">{label}</h3><p className="mt-1 text-sm text-muted-foreground">Expenses + card payments</p></div>
    <div><p className="text-sm text-muted-foreground">{current ? "Spent so far" : "Spent"}</p><p className={`${summaryAmountClass} break-words`}>{money(spent)}</p>
      {result.comparisonError ? <div className="mt-2 text-sm"><p role="status">Comparison couldn&apos;t load</p><Button variant="outline" className="mt-2 min-h-11" aria-label="Retry comparison" onClick={() => void result.retry()}>Retry</Button></div>
        : result.comparison && result.comparison.transactionCount > 0 ? <p className="mt-1 text-sm text-muted-foreground">{difference === BigInt(0) ? "Same as" : `${money(difference < BigInt(0) ? -difference : difference)} ${difference < BigInt(0) ? "less" : "more"} than`} {rangeLabel(previous.start, previous.end)}</p>
          : result.isComparisonLoading ? <p role="status" className="mt-1 text-sm text-muted-foreground">Loading comparison…</p> : null}
    </div>
    {spent === BigInt(0) && <div className="space-y-2"><p>No spending recorded for {label}.</p><Button className="min-h-11" onClick={onAddTransaction}>Add Transaction</Button></div>}
    <div className="space-y-2 [--destructive:0_72%_42%] dark:[--destructive:0_84%_60%]">
      {limitResult.isLoading ? <p role="status">Loading spending limit…</p> : limitResult.error ? <div><p role="status">Spending limit couldn&apos;t load.</p><Button variant="outline" className="min-h-11" onClick={() => void limitResult.retry().catch(() => undefined)}>Retry limit</Button></div> : limit !== undefined && <>
        {matchingLimit && current && <div className="space-y-2"><p>{money(spent)} of {money(limitCents)} used</p><div role="progressbar" aria-label="Spending limit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(spent >= limitCents ? BigInt(100) : spent * BigInt(100) / limitCents)} className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Number(spent >= limitCents ? BigInt(100) : spent * BigInt(100) / limitCents)}%` }} /></div><p className={over ? "text-destructive" : "text-muted-foreground"}>{money(over ? spent - limitCents : limitCents - spent)} {over ? "over your limit" : "left"}</p></div>}
        {matchingLimit && !current && <p className="text-sm text-muted-foreground">Limit applies to the current period only</p>}
      </>}
      <SpendingLimitDialog limit={limit} retry={limitResult.retry} available={!limitResult.isLoading && !limitResult.error && limit !== undefined} />
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border/30 pt-4 text-sm"><p>Income {money(cents(data.income))}</p><p>Net {money(cents(data.net))}</p></div>
    {rows.length > 0 && <ul aria-label="Spending by category" className="space-y-2 border-t border-border/30 pt-4">{rows.map(row => <li key={row.name} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm"><span className="min-w-0 break-words">{row.name}</span><span className="tabular-nums">{money(row.amount)} <span className="text-muted-foreground">({spent > BigInt(0) ? `${Number((row.amount * BigInt(1000) + spent / BigInt(2)) / spent) / 10}%` : "0%"})</span></span></li>)}</ul>}
    {data.excludedCurrencyTransactionCount > 0 && <p className="text-sm text-muted-foreground">{data.excludedCurrencyTransactionCount} transactions in other currencies aren&apos;t included.</p>}
    <div className="border-t border-border/30 pt-3 text-xs text-muted-foreground">
      <p>Totals: {rangeLabel(period.start, spentToDateEnd(period, today))}</p>
      <details className="mt-1">
        <summary className="min-h-11 cursor-pointer rounded-sm py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">How totals work</summary>
        <div className="space-y-2 pb-2 leading-relaxed">
          <p>Wallet transfers are excluded.</p>
          <p>Search and type filters only change the list.</p>
          <p>The list covers the full period, including future-dated entries and complete installment schedules outside it.</p>
          <p>Full group amounts are not period spending.</p>
        </div>
      </details>
    </div>
  </section>;
}
