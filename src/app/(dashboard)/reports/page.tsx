"use client";

import { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, TrendingDown, DollarSign, ChevronDown } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

const PieChart = dynamic(() => import("react-chartjs-2").then((mod) => mod.Pie), { ssr: false });
const LineChart = dynamic(() => import("react-chartjs-2").then((mod) => mod.Line), { ssr: false });
const RadarChart = dynamic(() => import("react-chartjs-2").then((mod) => mod.Radar), { ssr: false });

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function ReportsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [previousTransactions, setPreviousTransactions] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<"purchases" | "cashflow">("purchases");
  const [currency, setCurrency] = useState("PHP");
  const [isDark, setIsDark] = useState(false);
  const [dateRange, setDateRange] = useState<"last7" | "last30" | "thisMonth">("last30");

  useEffect(() => {
    loadReports();
  }, [dateRange]);

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => setIsDark(root.classList.contains("dark"));
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const chartColors = useMemo(
    () => ({
      text: isDark ? "#e2e8f0" : "#334155",
      grid: isDark ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.25)",
      tooltipBg: isDark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.95)",
      tooltipBorder: isDark ? "rgba(148, 163, 184, 0.4)" : "rgba(100, 116, 139, 0.3)",
    }),
    [isDark]
  );

  const rangeLabel = useMemo(() => {
    if (dateRange === "last7") return "Last 7 days";
    if (dateRange === "thisMonth") return "This month";
    return "Last 30 days";
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

  const loadReports = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    let userCurrency = "PHP";
    if (user?.id) {
      const { data: pref } = await supabase
        .from("user_preferences")
        .select("currency")
        .eq("user_id", user.id)
        .single();
      if (pref && (pref as any).currency) userCurrency = (pref as any).currency;
      setCurrency(userCurrency);

      const { data: accountsData } = await (supabase as any)
        .from("accounts")
        .select("id,name,type")
        .eq("user_id", user.id);
      setAccounts(accountsData || []);

      const { currentStart, currentEnd, previousStart, previousEnd } = getDateRange(dateRange);

      const { data } = await (supabase as any)
        .from("transactions")
        .select("*, category:categories(*)")
        .eq("user_id", user.id)
        .gte("date", currentStart)
        .lte("date", currentEnd);

      setTransactions(data || []);

      const { data: prevData } = await (supabase as any)
        .from("transactions")
        .select("*, category:categories(*)")
        .eq("user_id", user.id)
        .gte("date", previousStart)
        .lte("date", previousEnd);

      setPreviousTransactions(prevData || []);
    }
    setLoading(false);
  };

  const accountById = useMemo(() => {
    const map = new Map<string, any>();
    (accounts || []).forEach((a: any) => {
      if (a?.id) map.set(a.id, a);
    });
    return map;
  }, [accounts]);

  const computed = useMemo(() => {
    const txs = transactions || [];
    const prevTxs = previousTransactions || [];

    const isCredit = (accountId?: string | null) => {
      if (!accountId) return false;
      return accountById.get(accountId)?.type === "credit_card";
    };

    const calculatePeriod = (periodTransactions: any[]) => {
      // Debt metrics
      const debtAdded = periodTransactions
        .filter((t: any) => t.type === "expense" && isCredit(t.account_id))
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

      const debtPaid = periodTransactions
        .filter(
          (t: any) =>
            t.type === "transfer" &&
            !isCredit(t.account_id) &&
            isCredit(t.transfer_to_account_id)
        )
        .reduce((sum: number, t: any) => sum + Number(t.amount), 0);

      let totalIn = 0;
      let totalOut = 0;
      let txCount = 0;

      if (viewMode === "purchases") {
        const incomeTx = periodTransactions.filter((t: any) => t.type === "income" && !isCredit(t.account_id));
        const expenseTx = periodTransactions.filter((t: any) => t.type === "expense");

        totalIn = incomeTx.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
        totalOut = expenseTx.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
        txCount = incomeTx.length + expenseTx.length;
      } else {
        const incomeTx = periodTransactions.filter((t: any) => t.type === "income" && !isCredit(t.account_id));
        const expenseTx = periodTransactions.filter((t: any) => t.type === "expense" && !isCredit(t.account_id));
        const debtPayTx = periodTransactions.filter(
          (t: any) =>
            t.type === "transfer" &&
            !isCredit(t.account_id) &&
            isCredit(t.transfer_to_account_id)
        );

        totalIn = incomeTx.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
        totalOut =
          expenseTx.reduce((sum: number, t: any) => sum + Number(t.amount), 0) +
          debtPayTx.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
        txCount = incomeTx.length + expenseTx.length + debtPayTx.length;
      }

      return {
        totalIn,
        totalOut,
        net: totalIn - totalOut,
        txCount,
        debtAdded,
        debtPaid,
      };
    };

    const current = calculatePeriod(txs);
    const previous = calculatePeriod(prevTxs);

    // Calculate percentage changes
    const calculatePercentChange = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return ((curr - prev) / Math.abs(prev)) * 100;
    };

    const endingDebt = (accounts || [])
      .filter((a: any) => a?.type === "credit_card")
      .reduce((sum: number, a: any) => sum + Number(a?.balance || 0), 0);

    // Category aggregation (current period only)
    const categoryMap: Record<string, any> = {};
    const addCategory = (key: string, row: { name: string; color: string | null; total: number }) => {
      if (!categoryMap[key]) {
        categoryMap[key] = { name: row.name, color: row.color, total: 0, count: 0 };
      }
      categoryMap[key].total += row.total;
      categoryMap[key].count += 1;
    };

    if (viewMode === "purchases") {
      const expenseTx = txs.filter((t: any) => t.type === "expense");
      expenseTx.forEach((t: any) => {
        const cat = t.category;
        if (cat) {
          addCategory(cat.id, { name: cat.name, color: cat.color || null, total: Number(t.amount) });
        } else {
          addCategory("uncategorized", { name: "Uncategorized", color: null, total: Number(t.amount) });
        }
      });
    } else {
      const expenseTx = txs.filter((t: any) => t.type === "expense" && !isCredit(t.account_id));
      const debtPayTx = txs.filter(
        (t: any) =>
          t.type === "transfer" &&
          !isCredit(t.account_id) &&
          isCredit(t.transfer_to_account_id)
      );
      expenseTx.forEach((t: any) => {
        const cat = t.category;
        if (cat) {
          addCategory(cat.id, { name: cat.name, color: cat.color || null, total: Number(t.amount) });
        } else {
          addCategory("uncategorized", { name: "Uncategorized", color: null, total: Number(t.amount) });
        }
      });
      debtPayTx.forEach((t: any) => {
        addCategory("debt_payment", { name: "Debt payments", color: null, total: Number(t.amount) });
      });
    }

    const net = current.totalIn - current.totalOut;
    const topCategories = Object.values(categoryMap)
      .sort((a: any, b: any) => b.total - a.total)
      .slice(0, 10);

    // Prepare data for daily trend chart (line chart)
    const dailyData: Record<string, { income: number; expense: number }> = {};
    txs.forEach((t: any) => {
      if (!t.date) return;
      const dateKey = t.date.split('T')[0];
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = { income: 0, expense: 0 };
      }
      if (t.type === 'income' && !isCredit(t.account_id)) {
        dailyData[dateKey].income += Number(t.amount);
      } else if (t.type === 'expense' || (t.type === 'transfer' && !isCredit(t.account_id) && isCredit(t.transfer_to_account_id))) {
        dailyData[dateKey].expense += Number(t.amount);
      }
    });

    const sortedDates = Object.keys(dailyData).sort();
    const dailyLabels = sortedDates.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const dailyIncome = sortedDates.map(d => dailyData[d].income);
    const dailyExpense = sortedDates.map(d => dailyData[d].expense);

    return {
      summary: {
        totalIn: current.totalIn,
        totalOut: current.totalOut,
        net: current.net,
        transactionCount: current.txCount,
        totalInChange: calculatePercentChange(current.totalIn, previous.totalIn),
        totalOutChange: calculatePercentChange(current.totalOut, previous.totalOut),
        netChange: calculatePercentChange(current.net, previous.net),
      },
      debt: {
        added: current.debtAdded,
        paid: current.debtPaid,
        ending: endingDebt,
      },
      topCategories,
      chartData: {
        categories: topCategories,
        dailyLabels,
        dailyIncome,
        dailyExpense,
      },
    };
  }, [transactions, previousTransactions, accounts, accountById, viewMode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-green-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Reports</h2>
        <p className="text-muted-foreground">
          Analyze your financial data ({rangeLabel})
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={viewMode === "purchases" ? "default" : "outline"}
          onClick={() => setViewMode("purchases")}
        >
          Spending (Purchases)
        </Button>
        <Button
          size="sm"
          variant={viewMode === "cashflow" ? "default" : "outline"}
          onClick={() => setViewMode("cashflow")}
        >
          Cashflow (Paid)
        </Button>
        <div className="flex items-center gap-2 ml-auto">
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

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total In</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {formatCurrency(computed.summary.totalIn || 0, currency)}
            </div>
            <p className={`text-xs font-medium mt-1 ${
              (computed.summary.totalInChange || 0) >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {(computed.summary.totalInChange || 0) >= 0 ? '+' : ''}{(computed.summary.totalInChange || 0).toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Out</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {formatCurrency(computed.summary.totalOut || 0, currency)}
            </div>
            <p className={`text-xs font-medium mt-1 ${
              (computed.summary.totalOutChange || 0) >= 0 ? 'text-red-500' : 'text-green-500'
            }`}>
              {(computed.summary.totalOutChange || 0) >= 0 ? '+' : ''}{(computed.summary.totalOutChange || 0).toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                (computed.summary.net || 0) >= 0 ? "text-green-500" : "text-red-500"
              }`}
            >
              {formatCurrency(computed.summary.net || 0, currency)}
            </div>
            <p className={`text-xs font-medium mt-1 ${
              (computed.summary.netChange || 0) >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {(computed.summary.netChange || 0) >= 0 ? '+' : ''}{(computed.summary.netChange || 0).toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Transactions</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{computed.summary.transactionCount || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Debt Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Debt Added</CardTitle>
            <CardDescription>New PayLater purchases</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              -{formatCurrency(Math.abs(computed.debt.added || 0), currency)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Debt Paid</CardTitle>
            <CardDescription>Cash → PayLater payments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              -{formatCurrency(Math.abs(computed.debt.paid || 0), currency)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ending Debt</CardTitle>
            <CardDescription>Current outstanding balance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              -{formatCurrency(Math.abs(computed.debt.ending || 0), currency)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Categories */}
      <Card>
        <CardHeader>
          <CardTitle>Top Categories</CardTitle>
          <CardDescription>
            {viewMode === "purchases" ? "Your purchases breakdown" : "Your cash outflow breakdown"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {computed.topCategories.length > 0 ? (
            <div className="space-y-4">
              {computed.topCategories.map((cat: any, idx: number) => {
                const maxTotal = computed.topCategories[0]?.total || 1;
                const percentage = (cat.total / maxTotal) * 100;
                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: cat.color || "#6b7280" }}
                        />
                        <span className="font-medium">{cat.name}</span>
                        <span className="text-sm text-muted-foreground">({cat.count})</span>
                      </div>
                      <span className="font-semibold">{formatCurrency(cat.total, currency)}</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: cat.color || "#6b7280",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <BarChart3 className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No transactions in the last 30 days</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts Section */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Pie Chart - Category Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Spending Distribution</CardTitle>
            <CardDescription>Breakdown by category</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center">
            {computed.chartData.categories.length > 0 ? (
              <PieChart
                data={{
                  labels: computed.chartData.categories.map((c: any) => c.name),
                  datasets: [{
                    data: computed.chartData.categories.map((c: any) => c.total),
                    backgroundColor: computed.chartData.categories.map((c: any) => c.color || '#6b7280'),
                    borderColor: 'rgba(255, 255, 255, 0.8)',
                    borderWidth: 2,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        boxWidth: 12,
                        padding: 10,
                        color: chartColors.text,
                      }
                    },
                    tooltip: {
                      backgroundColor: chartColors.tooltipBg,
                      borderColor: chartColors.tooltipBorder,
                      borderWidth: 1,
                      titleColor: chartColors.text,
                      bodyColor: chartColors.text,
                    },
                  },
                }}
              />
            ) : (
              <p className="text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>

        {/* Radar Chart - Spending Patterns */}
        <Card>
          <CardHeader>
            <CardTitle>Spending Patterns</CardTitle>
            <CardDescription>Category comparison</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center">
            {computed.chartData.categories.length > 0 ? (
              <RadarChart
                data={{
                  labels: computed.chartData.categories.slice(0, 6).map((c: any) => c.name),
                  datasets: [{
                    label: 'Spending',
                    data: computed.chartData.categories.slice(0, 6).map((c: any) => c.total),
                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                    borderColor: 'rgb(34, 197, 94)',
                    borderWidth: 2,
                    pointBackgroundColor: 'rgb(34, 197, 94)',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: 'rgb(34, 197, 94)',
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: false,
                    },
                    tooltip: {
                      backgroundColor: chartColors.tooltipBg,
                      borderColor: chartColors.tooltipBorder,
                      borderWidth: 1,
                      titleColor: chartColors.text,
                      bodyColor: chartColors.text,
                    },
                  },
                  scales: {
                    r: {
                      beginAtZero: true,
                      grid: {
                        color: chartColors.grid,
                      },
                      angleLines: {
                        color: chartColors.grid,
                      },
                      pointLabels: {
                        color: chartColors.text,
                      },
                      ticks: {
                        color: chartColors.text,
                        backdropColor: "transparent",
                        display: false,
                      },
                    },
                  },
                }}
              />
            ) : (
              <p className="text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Line Chart - Daily Trends (Full Width) */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Trends</CardTitle>
          <CardDescription>Income vs Expenses over time</CardDescription>
        </CardHeader>
        <CardContent className="h-[400px]">
          {computed.chartData.dailyLabels.length > 0 ? (
            <LineChart
              data={{
                labels: computed.chartData.dailyLabels,
                datasets: [
                  {
                    label: 'Income',
                    data: computed.chartData.dailyIncome,
                    borderColor: 'rgb(34, 197, 94)',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    tension: 0.4,
                    fill: true,
                  },
                  {
                    label: 'Expenses',
                    data: computed.chartData.dailyExpense,
                    borderColor: 'rgb(239, 68, 68)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4,
                    fill: true,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                  mode: 'index',
                  intersect: false,
                },
                plugins: {
                  legend: {
                    position: 'top',
                    labels: {
                      color: chartColors.text,
                    },
                  },
                  tooltip: {
                    backgroundColor: chartColors.tooltipBg,
                    borderColor: chartColors.tooltipBorder,
                    borderWidth: 1,
                    titleColor: chartColors.text,
                    bodyColor: chartColors.text,
                    callbacks: {
                      label: function(context: any) {
                        let label = context.dataset.label || '';
                        if (label) {
                          label += ': ';
                        }
                        label += formatCurrency(context.parsed.y, currency);
                        return label;
                      }
                    }
                  }
                },
                scales: {
                  x: {
                    ticks: {
                      color: chartColors.text,
                    },
                    grid: {
                      color: chartColors.grid,
                    },
                  },
                  y: {
                    beginAtZero: true,
                    ticks: {
                      color: chartColors.text,
                      callback: function(value: any) {
                        return formatCurrency(value, currency);
                      }
                    },
                    grid: {
                      color: chartColors.grid,
                    },
                  }
                }
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-muted-foreground">No data available</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
