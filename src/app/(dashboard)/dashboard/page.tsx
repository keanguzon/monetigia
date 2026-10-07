"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  Wallet,
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { NavigationLink as Link } from "@/components/layout/navigation-link";
import { SummarySkeleton, summaryPanelClass, summaryAmountClass, pageTitleClass } from "@/components/ui/financial-summary";
import { CountUpNumber } from "@/components/ui/count-up";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccounts, useRecentTransactions, useDashboardStats } from "@/hooks/use-data";

export default function DashboardPage() {
  const [dateRange, setDateRange] = useState<"last7" | "last30" | "thisMonth">("thisMonth");

  const rangeLabel = useMemo(() => {
    if (dateRange === "last7") return "Last 7 days";
    if (dateRange === "last30") return "Last 30 days";
    return "This month";
  }, [dateRange]);

  const getDateRange = (range: "last7" | "last30" | "thisMonth") => {
    const toDateString = (date: Date) => date.toISOString().split("T")[0];
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (range === "thisMonth") {
      const currentStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const previousEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        currentStart: toDateString(currentStart),
        currentEnd: toDateString(end),
        previousStart: toDateString(previousStart),
        previousEnd: toDateString(previousEnd),
      };
    }

    const days = range === "last7" ? 7 : 30;
    const currentStart = new Date(end);
    currentStart.setDate(currentStart.getDate() - (days - 1));

    const previousEnd = new Date(currentStart);
    previousEnd.setDate(previousEnd.getDate() - 1);

    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - (days - 1));

    return {
      currentStart: toDateString(currentStart),
      currentEnd: toDateString(end),
      previousStart: toDateString(previousStart),
      previousEnd: toDateString(previousEnd),
    };
  };

  const { currentStart, currentEnd, previousStart, previousEnd } = getDateRange(dateRange);

  const { data: accounts = [], isLoading: isLoadingAccounts, error: accountsError } = useAccounts();
  const { data: transactions = [], isLoading: isLoadingTx, error: transactionsError } = useRecentTransactions();
  const { data: stats, isLoading: isLoadingStats, error: statsError } = useDashboardStats(currentStart, currentEnd, previousStart, previousEnd);

  const loading = isLoadingAccounts || isLoadingTx || isLoadingStats;
  const dataError = accountsError || transactionsError || statsError;
  const monthlyIncome = stats?.monthlyIncome || 0;
  const monthlyExpenses = stats?.monthlyExpenses || 0;
  const lastMonthIncome = stats?.lastMonthIncome || 0;
  const lastMonthExpenses = stats?.lastMonthExpenses || 0;

  const networthAccounts = accounts.filter(
    (a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false
  );
  const currentMoney = networthAccounts.reduce((sum, acc) => sum + Number(acc.balance), 0) || 0;
  
  const thisMonthNet = monthlyIncome - monthlyExpenses;
  const lastMonthBalance = currentMoney - thisMonthNet;
  
  // Calculate percentage changes
  const calculatePercentChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
  };

  const balanceChange = calculatePercentChange(currentMoney, lastMonthBalance);
  const incomeChange = calculatePercentChange(monthlyIncome, lastMonthIncome);
  const expenseChange = calculatePercentChange(monthlyExpenses, lastMonthExpenses);
  const savingsChange = calculatePercentChange(
    monthlyIncome - monthlyExpenses,
    lastMonthIncome - lastMonthExpenses
  );

  const statCards = [
    {
      title: "Total Balance",
      value: formatCurrency(currentMoney),
      icon: Wallet,
      description: `Across ${networthAccounts.length || 0} accounts (excluding debt)`,
      color: "text-primary",
      change: balanceChange,
    },
    {
      title: "Income",
      value: formatCurrency(monthlyIncome),
      icon: ArrowDownLeft,
      description: rangeLabel,
      color: "text-green-500",
      change: incomeChange,
    },
    {
      title: "Expenses",
      value: formatCurrency(monthlyExpenses),
      icon: ArrowUpRight,
      description: rangeLabel,
      color: "text-red-500",
      change: expenseChange,
    },
    {
      title: "Net Savings",
      value: formatCurrency(monthlyIncome - monthlyExpenses),
      icon: TrendingUp,
      description: rangeLabel,
      color: monthlyIncome - monthlyExpenses >= 0 ? "text-green-500" : "text-red-500",
      change: savingsChange,
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h2 className={pageTitleClass}>Dashboard</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Your financial overview at a glance.
          </p>
        </div>
        <SummarySkeleton columns={4} />
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className={pageTitleClass}>Dashboard</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Your financial overview at a glance.
          </p>
        </div>
        <p role="alert" className={summaryPanelClass + " text-sm text-muted-foreground"}>
          Your financial overview could not be loaded. Refresh the page to try again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={pageTitleClass}>Dashboard</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Your financial overview at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Range:</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs font-medium justify-between min-w-[120px]">
                {rangeLabel}
                <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setDateRange("last7")}>Last 7 days</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDateRange("last30")}>Last 30 days</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDateRange("thisMonth")}>This month</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats Grid: 2-Columns on mobile, 4-columns on desktop */}
      <div className={summaryPanelClass}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
        {statCards.map((stat) => (
          <div
            key={stat.title}
            className="min-w-0 flex flex-col justify-between border-t border-border/30 pt-5 first:border-0 first:pt-0 sm:border-t-0 sm:pt-0 sm:even:border-l sm:even:pl-8 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-8"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">
                {stat.title}
              </span>
              <stat.icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 ${stat.color}`} />
            </div>

            <div className="my-2">
              <div className={`${summaryAmountClass} break-words ${stat.color}`}>
                {stat.value}
              </div>
              <p
                className={`text-xs tabular-nums font-medium mt-0.5 ${
                  stat.change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"
                }`}
              >
                {stat.change >= 0 ? "+" : ""}
                {stat.change.toFixed(1)}%
              </p>
            </div>

            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{stat.description}</p>
          </div>
        ))}
      </div>

      </div>
      {/* Recent Transactions: Clean Open Hairline Register (No outer card) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-border/40">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-primary" />
              <span>Recent Transactions</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Latest financial activity and movements
            </p>
          </div>
          {transactions && transactions.length > 0 && (
            <Link href="/transactions">
              <Button variant="outline" size="sm" className="h-7 text-xs font-medium gap-1">
                <span>View All</span>
                <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>

        <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden">
          {transactions && transactions.length > 0 ? (
            <div className="divide-y divide-border/30">
              {transactions.slice(0, 10).map((transaction: any) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-3 sm:p-3.5 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-center space-x-3 min-w-0 pr-3">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        transaction.type === "income"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : transaction.type === "expense"
                            ? "bg-rose-500/10 text-rose-500"
                            : "bg-blue-500/10 text-blue-500"
                      }`}
                    >
                      {transaction.type === "income" ? (
                        <ArrowDownLeft className="h-4 w-4" />
                      ) : transaction.type === "expense" ? (
                        <ArrowUpRight className="h-4 w-4" />
                      ) : (
                        <ArrowLeftRight className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-semibold text-foreground truncate">
                        {transaction.description || transaction.category?.name || "Transaction"}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {transaction.account?.name} • {new Date(transaction.date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-xs sm:text-sm font-semibold font-mono tabular-nums shrink-0 ${
                      transaction.type === "income"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : transaction.type === "expense"
                          ? "text-rose-500"
                          : "text-blue-500"
                    }`}
                  >
                    {transaction.type === "income" ? "+" : transaction.type === "expense" ? "-" : ""}
                    {formatCurrency(Number(transaction.amount))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <ArrowLeftRight className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-semibold text-foreground">No transactions yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Start by recording your first transaction or transfer
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
