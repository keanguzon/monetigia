"use client";

import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { SummarySkeleton, summaryAmountClass, summaryPanelClass } from "@/components/ui/financial-summary";
import { useSpendingSummary } from "@/hooks/use-spending";
import { comparisonRange, formatPeriodLabel, isCurrentPeriod, spentToDateEnd, type SpendingPeriod } from "@/lib/spending/periods";

const cents = (value: string) => BigInt(value.replace(".", ""));
function money(value: bigint): string {
  const magnitude = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "−" : ""}₱${(magnitude / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(magnitude % BigInt(100)).toString().padStart(2, "0")}`;
}
function rangeLabel(start: string, end: string) {
  return `${format(parseISO(start), "MMM d")}–${format(parseISO(end), start.slice(0, 7) === end.slice(0, 7) ? "d, yyyy" : "MMM d, yyyy")}`;
}

export function SpendingSummaryPanel({ period, today, onAddTransaction }: { period: SpendingPeriod | null; today: Date; onAddTransaction: () => void }) {
  const result = useSpendingSummary(period, today);
  if (!period) return null;
  if (result.isLoading) return <SummarySkeleton aria-label="Loading spending summary" />;
  if (result.error || !result.data) return <section className={summaryPanelClass} role="alert"><p>Spending totals couldn't load. Your transactions below are unaffected.</p><Button className="mt-3 min-h-11" variant="outline" onClick={() => void result.retry()}>Retry</Button></section>;
  const data = result.data;
  const spent = cents(data.spent);
  const label = formatPeriodLabel(period);
  const current = isCurrentPeriod(period, today);
  const previous = comparisonRange(period, today);
  const difference = result.comparison ? spent - cents(result.comparison.spent) : BigInt(0);
  const categories = [...data.categories].sort((a, b) => cents(a.amount) > cents(b.amount) ? -1 : cents(a.amount) < cents(b.amount) ? 1 : a.name.localeCompare(b.name));
  const rows = categories.slice(0, 5).map(row => ({ name: row.name, amount: cents(row.amount) }));
  const rest = categories.slice(5).reduce((sum, row) => sum + cents(row.amount), BigInt(0));
  if (rest > BigInt(0)) rows.push({ name: "Other categories", amount: rest });
  if (cents(data.debtPayments) > BigInt(0)) rows.push({ name: "Debt payments", amount: cents(data.debtPayments) });
  return <section aria-label="Spending summary" className={`${summaryPanelClass} min-w-0 space-y-4`}>
    <div><h3 className="font-heading text-lg font-semibold">{label}</h3><p className="mt-1 text-sm text-muted-foreground">Counts expenses and card payments from your wallets. Transfers between wallets aren't counted.</p><p className="mt-1 text-xs text-muted-foreground">Search and type filters only change the list, not these totals.</p></div>
    <div><p className="text-sm text-muted-foreground">{current ? "Spent so far" : "Spent"}</p><p className={`${summaryAmountClass} break-words`}>{money(spent)}</p>
      {result.comparisonError ? <div className="mt-2 text-sm"><p role="status">Comparison couldn't load</p><Button variant="outline" className="mt-2 min-h-11" aria-label="Retry comparison" onClick={() => void result.retry()}>Retry</Button></div>
        : result.comparison && result.comparison.transactionCount > 0 ? <p className="mt-1 text-sm text-muted-foreground">{difference === BigInt(0) ? "Same as" : `${money(difference < BigInt(0) ? -difference : difference)} ${difference < BigInt(0) ? "less" : "more"} than`} {rangeLabel(previous.start, previous.end)}</p>
          : result.isComparisonLoading ? <p role="status" className="mt-1 text-sm text-muted-foreground">Loading comparison…</p> : null}
    </div>
    {spent === BigInt(0) && <div className="space-y-2"><p>No spending recorded for {label}.</p><Button className="min-h-11" onClick={onAddTransaction}>Add Transaction</Button></div>}
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border/30 pt-4 text-sm"><p>Income {money(cents(data.income))}</p><p>Net {money(cents(data.net))}</p></div>
    {rows.length > 0 && <ul aria-label="Spending by category" className="space-y-2 border-t border-border/30 pt-4">{rows.map(row => <li key={row.name} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm"><span className="min-w-0 break-words">{row.name}</span><span className="tabular-nums">{money(row.amount)} <span className="text-muted-foreground">({spent > BigInt(0) ? `${Number((row.amount * BigInt(1000) + spent / BigInt(2)) / spent) / 10}%` : "0%"})</span></span></li>)}</ul>}
    {data.excludedCurrencyTransactionCount > 0 && <p className="text-sm text-muted-foreground">{data.excludedCurrencyTransactionCount} transactions in other currencies aren't included.</p>}
    <p className="border-t border-border/30 pt-4 text-xs text-muted-foreground">Totals cover {rangeLabel(period.start, spentToDateEnd(period, today))}. The list covers the full selected period and may include future-dated entries and complete installment schedules outside it. Full group amounts are not period spending.</p>
  </section>;
}
