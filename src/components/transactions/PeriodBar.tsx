"use client";

import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Tooltip from "@/components/ui/tooltip";
import { formatPeriodLabel, periodContaining, shiftPeriod, toLocalDateString, type PeriodKind, type SpendingPeriod } from "@/lib/spending/periods";

function formatCustomDateRange(start: string, end: string): string {
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

export function PeriodBar({ period, today, onChange, customDateRange }: { period: SpendingPeriod | null; today: Date; onChange: (period: SpendingPeriod | null) => void; customDateRange?: { start: string; end: string } | null }) {
  const date = toLocalDateString(today);
  const next = period ? shiftPeriod(period, 1) : null;
  const isCustom = customDateRange !== undefined && customDateRange !== null;
  const label = isCustom ? formatCustomDateRange(customDateRange.start, customDateRange.end) : period ? formatPeriodLabel(period) : "All time";
  function choose(value: string) {
    if (value === "all") { onChange(null); return; }
    if (!["month", "first_half", "second_half"].includes(value)) return;
    let chosen = periodContaining(today, value as PeriodKind);
    if (chosen.start > date) chosen = periodContaining(new Date(today.getFullYear(), today.getMonth() - 1, 1), value as PeriodKind);
    onChange(chosen);
  }
  return <div role="group" aria-label="Transaction period" className="flex min-w-0 items-center gap-1 sm:gap-2">
    <Tooltip content="Previous period"><Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Previous period" title="Previous period" disabled={!period || isCustom} onClick={() => period && !isCustom && onChange(shiftPeriod(period, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
    <span aria-live="polite" aria-label={isCustom ? `Custom date range ${label}` : undefined} className="min-w-0 flex-1 truncate text-center text-sm font-semibold">{label}</span>
    <Tooltip content="Next period"><Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Next period" title="Next period" disabled={!next || isCustom || next.start > date} onClick={() => next && !isCustom && next.start <= date && onChange(next)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button></Tooltip>
    <DropdownMenu><Tooltip content="Choose period"><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Choose period" title="Choose period" className="h-11 w-11 shrink-0"><CalendarDays className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger></Tooltip>
      <DropdownMenuContent align="end" collisionPadding={8}><DropdownMenuRadioGroup value={isCustom ? "custom" : period?.kind ?? "all"} onValueChange={choose}>
        {isCustom && <DropdownMenuRadioItem className="min-h-11" value="custom" disabled>Custom range</DropdownMenuRadioItem>}
        <DropdownMenuRadioItem className="min-h-11" value="month">Month</DropdownMenuRadioItem>
        <DropdownMenuRadioItem className="min-h-11" value="first_half">1st–15th</DropdownMenuRadioItem>
        <DropdownMenuRadioItem className="min-h-11" value="second_half">16th–end</DropdownMenuRadioItem>
        <DropdownMenuRadioItem className="min-h-11" value="all">All time</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup></DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
