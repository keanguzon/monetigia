"use client";

import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatPeriodLabel, periodContaining, shiftPeriod, toLocalDateString, type PeriodKind, type SpendingPeriod } from "@/lib/spending/periods";

export function PeriodBar({ period, today, onChange }: { period: SpendingPeriod | null; today: Date; onChange: (period: SpendingPeriod | null) => void }) {
  const date = toLocalDateString(today);
  const next = period ? shiftPeriod(period, 1) : null;
  function choose(value: string) {
    if (value === "all") { onChange(null); return; }
    if (!["month", "first_half", "second_half"].includes(value)) return;
    let chosen = periodContaining(today, value as PeriodKind);
    if (chosen.start > date) chosen = periodContaining(new Date(today.getFullYear(), today.getMonth() - 1, 1), value as PeriodKind);
    onChange(chosen);
  }
  return <div role="group" aria-label="Transaction period" className="flex min-w-0 items-center gap-1 sm:gap-2">
    <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Previous period" disabled={!period} onClick={() => period && onChange(shiftPeriod(period, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
    <span aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-semibold">{period ? formatPeriodLabel(period) : "All time"}</span>
    <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Next period" disabled={!next || next.start > date} onClick={() => next && next.start <= date && onChange(next)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Choose period" className="h-11 w-11 shrink-0"><CalendarDays className="h-4 w-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8}><DropdownMenuRadioGroup value={period?.kind ?? "all"} onValueChange={choose}>
        <DropdownMenuRadioItem className="min-h-11" value="month">Month</DropdownMenuRadioItem>
        <DropdownMenuRadioItem className="min-h-11" value="first_half">1st–15th</DropdownMenuRadioItem>
        <DropdownMenuRadioItem className="min-h-11" value="second_half">16th–end</DropdownMenuRadioItem>
        <DropdownMenuRadioItem className="min-h-11" value="all">All time</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup></DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
