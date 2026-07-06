"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import Link from "next/link";
import { StatCardSkeleton } from "@/components/ui/skeleton";
import { CountUpNumber } from "@/components/ui/count-up";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function DashboardPage() {
  const supabase = createClient();
  const sb = supabase as any;
  const [accounts, setAccounts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState(0);
  const [lastMonthIncome, setLastMonthIncome] = useState(0);
  const [lastMonthExpenses, setLastMonthExpenses] = useState(0);
  const [lastMonthBalance, setLastMonthBalance] = useState(0);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {

        // Get accounts
        const { data: accountsData } = await supabase
          .from("accounts")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        setAccounts(accountsData ?? []);

        // Get recent transactions (newest first)
        const { data: transactionsData, error: txErr } = await sb
          .from("transactions")
          .select(
            "id, user_id, account_id, category_id, type, amount, description, date, transfer_to_account_id, created_at, category:categories(id,name,color), account:accounts!account_id(id,name,type)"
          )
          .eq("user_id", user.id)
          .order("date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(3);

        if (txErr) {
          console.error("Failed to load recent transactions", txErr);
          setTransactions([]);
        } else {
          setTransactions(transactionsData ?? []);
        }

        const { currentStart, currentEnd, previousStart, previousEnd } = getDateRange(dateRange);

        const { data: monthTransactionsData } = await supabase
          .from("transactions")
          .select("type, amount, account_id, transfer_to_account_id")
          .eq("user_id", user.id)
          .gte("date", currentStart)
          .lte("date", currentEnd);

        const { data: lastMonthTransactionsData } = await supabase
          .from("transactions")
          .select("type, amount, account_id, transfer_to_account_id")
          .eq("user_id", user.id)
          .gte("date", previousStart)
          .lte("date", previousEnd);

        const monthTransactions = (monthTransactionsData ?? []) as any[];
        const lastMonthTransactions = (lastMonthTransactionsData ?? []) as any[];
        const accountTypeById = new Map<string, string>();
        (accountsData || []).forEach((a: any) => {
          if (a?.id) accountTypeById.set(a.id, a.type);
        });
        const isCredit = (accountId?: string | null) => {
          if (!accountId) return false;
          return accountTypeById.get(accountId) === "credit_card";
        };

        // Match Reports "cashflow" logic:
        // - Income counts only when it hits non-credit accounts.
        // - Expenses are spending from non-credit accounts.
        // - Debt payments are transfers from non-credit -> credit_card.
        const income = monthTransactions
          .filter((t) => t.type === "income" && !isCredit(t.account_id))
          .reduce((sum, t) => sum + Number(t.amount), 0);

        const expenses = monthTransactions
          .filter((t) => t.type === "expense" && !isCredit(t.account_id))
          .reduce((sum, t) => sum + Number(t.amount), 0);

        const debtPayments = monthTransactions
          .filter(
            (t) =>
              t.type === "transfer" &&
              !isCredit(t.account_id) &&
              isCredit(t.transfer_to_account_id)
          )
          .reduce((sum, t) => sum + Number(t.amount), 0);

        const lastIncome = lastMonthTransactions
          .filter((t) => t.type === "income" && !isCredit(t.account_id))
          .reduce((sum, t) => sum + Number(t.amount), 0);

        const lastExpenses = lastMonthTransactions
          .filter((t) => t.type === "expense" && !isCredit(t.account_id))
          .reduce((sum, t) => sum + Number(t.amount), 0);

        const lastDebtPayments = lastMonthTransactions
          .filter(
            (t) =>
              t.type === "transfer" &&
              !isCredit(t.account_id) &&
              isCredit(t.transfer_to_account_id)
          )
          .reduce((sum, t) => sum + Number(t.amount), 0);

        setMonthlyIncome(income || 0);
        setMonthlyExpenses((expenses + debtPayments) || 0);
        setLastMonthIncome(lastIncome || 0);
        setLastMonthExpenses((lastExpenses + lastDebtPayments) || 0);
        
        // Calculate last month's balance (current balance minus this month's net change)
        const thisMonthNet = income - (expenses + debtPayments);
        setLastMonthBalance(currentMoney - thisMonthNet);
      }
      setLoading(false);
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  const networthAccounts = accounts.filter(
    (a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false
  );
  const currentMoney = networthAccounts.reduce((sum, acc) => sum + Number(acc.balance), 0) || 0;
  
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
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Your financial overview at a glance.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Your financial overview at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Range</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="w-[140px] justify-between">
                {rangeLabel}
                <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
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

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat, index) => (
          <Card 
            key={stat.title} 
            className="card-lift"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold data-transition ${stat.color}`}>
                {stat.value}
              </div>
              <p className={`text-xs font-medium mt-1 ${
                stat.change >= 0 ? 'text-green-500' : 'text-red-500'
              }`}>
                {stat.change >= 0 ? '+' : ''}{stat.change.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Recent Transactions */}
        <Card className="col-span-7">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ArrowLeftRight className="h-5 w-5" />
                  Recent Transactions
                </CardTitle>
                <CardDescription>Your latest financial activity</CardDescription>
              </div>
              {/* View More Button */}
              {transactions && transactions.length > 0 && (
                <Link href="/transactions">
                  <Button variant="outline" size="sm">
                    View All
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {transactions && transactions.length > 0 ? (
              <div className="space-y-4">
                {transactions.map((transaction, index) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between hover:bg-secondary/50 p-2 rounded-lg transition-all duration-200 hover:scale-[1.01] cursor-pointer data-transition"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-center space-x-4">
                      <div
                        className={`p-2 rounded-full transition-transform hover:scale-110 ${transaction.type === "income"
                            ? "bg-green-500/10"
                            : transaction.type === "expense"
                              ? "bg-red-500/10"
                              : "bg-blue-500/10"
                          }`}
                      >
                        {transaction.type === "income" ? (
                          <ArrowDownLeft className="h-4 w-4 text-green-500" />
                        ) : transaction.type === "expense" ? (
                          <ArrowUpRight className="h-4 w-4 text-red-500" />
                        ) : (
                          <ArrowLeftRight className="h-4 w-4 text-blue-500" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {transaction.description || transaction.category?.name || "Transaction"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {transaction.account?.name} • {new Date(transaction.date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-sm font-medium ${transaction.type === "income"
                          ? "text-green-500"
                          : transaction.type === "expense"
                            ? "text-red-500"
                            : "text-blue-500"
                        }`}
                    >
                      {transaction.type === "income" ? "+" : transaction.type === "expense" ? "-" : ""}
                      {formatCurrency(Number(transaction.amount))}
                    </span>
                  </div>
                ))}
                {/* View More Link at Bottom */}
                <Link href="/transactions">
                  <Button variant="ghost" className="w-full">
                    See All Transactions
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ArrowLeftRight className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No transactions yet</p>
                <p className="text-sm text-muted-foreground">
                  Start by adding your first transaction
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
