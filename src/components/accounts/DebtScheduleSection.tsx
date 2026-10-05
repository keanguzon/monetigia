"use client";

import React from "react";
import { formatCurrency } from "@/lib/utils";
import { Calendar, CreditCard, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DebtScheduleSectionProps {
  isDebtLoading: boolean;
  sortedMonths: string[];
  debtByMonth: Record<string, number>;
  expenseItemsByMonth: Record<string, any[]>;
  onPayDebt?: (accountId?: string) => void;
  defaultCreditAccountId?: string;
}

export function DebtScheduleSection({
  isDebtLoading,
  sortedMonths,
  debtByMonth,
  expenseItemsByMonth,
  onPayDebt,
  defaultCreditAccountId,
}: DebtScheduleSectionProps) {
  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-border/40">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span>PayLater & Credit Schedule</span>
            {sortedMonths.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-mono font-medium bg-rose-500/10 text-rose-500">
                {sortedMonths.length} {sortedMonths.length === 1 ? "statement" : "statements"}
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Installments and purchases under credit facilities. Cash remains unchanged until settlements are recorded.
          </p>
        </div>
      </div>

      {/* Body */}
      {isDebtLoading ? (
        <div className="flex items-center justify-center py-10">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-primary border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]" />
        </div>
      ) : sortedMonths.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center bg-card/20">
          <CreditCard className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm font-medium text-foreground">No active credit statements</p>
          <p className="text-xs text-muted-foreground mt-1">
            Installments recorded under PayLater or Credit Card wallets will appear here chronologically.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {sortedMonths.map((m) => {
            const monthDebt = Math.max(0, Number(debtByMonth[m] || 0));
            const purchases = (expenseItemsByMonth[m] || []).filter(
              (t: any) => t?.type === "expense"
            );

            // Format month display (e.g. "2026-10" -> "October 2026")
            let formattedMonth = m;
            try {
              const [year, month] = m.split("-");
              if (year && month) {
                const date = new Date(Number(year), Number(month) - 1, 1);
                formattedMonth = date.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                });
              }
            } catch {
              formattedMonth = m;
            }

            return (
              <div
                key={m}
                className="flex flex-col justify-between rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-4 sm:p-5 transition-all duration-200 hover:border-border hover:bg-card/80"
              >
                <div>
                  {/* Statement Header */}
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-semibold text-sm tracking-tight text-foreground truncate block">
                          {formattedMonth}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {purchases.length} {purchases.length === 1 ? "charge" : "charges"}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                        Statement Due
                      </div>
                      <div className="font-mono tabular-nums text-base sm:text-lg font-bold text-rose-500">
                        -{formatCurrency(Math.abs(monthDebt))}
                      </div>
                    </div>
                  </div>

                  {/* Purchases Spec Sheet List (Hairline rules, zero cards-inside-cards) */}
                  {purchases.length > 0 ? (
                    <div className="divide-y divide-border/30 my-2">
                      {purchases.slice(0, 6).map((t: any) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between py-2 px-1 text-xs hover:bg-muted/20 rounded transition-colors"
                        >
                          <div className="min-w-0 pr-3">
                            <p className="font-medium text-foreground truncate">
                              {t.description || t.category?.name || "Credit Expense"}
                            </p>
                            {t.date && (
                              <p className="text-[10px] text-muted-foreground font-mono">
                                {t.date}
                              </p>
                            )}
                          </div>
                          <span className="font-mono tabular-nums font-semibold text-foreground shrink-0">
                            {formatCurrency(Number(t.amount || 0))}
                          </span>
                        </div>
                      ))}
                      {purchases.length > 6 && (
                        <p className="pt-2 text-[11px] text-muted-foreground font-medium text-center">
                          +{purchases.length - 6} more charges this cycle
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="py-4 text-xs text-muted-foreground text-center">
                      No itemized expenses recorded
                    </p>
                  )}
                </div>

                {/* Footer Statement Total & Quick Action */}
                <div className="pt-3 border-t border-border/40 flex items-center justify-between gap-3 text-xs mt-2">
                  <span className="font-medium text-muted-foreground text-[11px] uppercase tracking-wider">
                    Total Cycle
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums font-bold text-rose-500">
                      -{formatCurrency(Math.abs(monthDebt))}
                    </span>
                    {onPayDebt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] px-2 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 font-semibold"
                        onClick={() => onPayDebt(defaultCreditAccountId)}
                      >
                        Settle <ArrowRight className="ml-1 h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
