"use client";

import { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, isValidUuid } from "@/lib/utils";
import { setStoredAccountOrder, sortAccountsWithFallback } from "@/lib/account-order";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus, Wallet, Edit2, LayoutGrid, List } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { CardSkeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";
import { WalletTileCard } from "@/components/accounts/WalletTileCard";
import { WalletLedgerView } from "@/components/accounts/WalletLedgerView";
import { DebtScheduleSection } from "@/components/accounts/DebtScheduleSection";

const AddAccountModal = dynamic(() => import("@/components/accounts/AddAccountModal"), {
  ssr: false,
});

const AddTransactionModal = dynamic(() => import("@/components/transactions/AddTransactionModal"), {
  ssr: false,
});

export default function AccountsPage() {
  const supabase = createClient();
  const sb = supabase as any;
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [defaultTransactionAccountId, setDefaultTransactionAccountId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [interestRateDraft, setInterestRateDraft] = useState<Record<string, string>>({});

  const [isDebtLoading, setIsDebtLoading] = useState(false);
  const [debtByMonth, setDebtByMonth] = useState<Record<string, number>>({});
  const [expenseItemsByMonth, setExpenseItemsByMonth] = useState<Record<string, any[]>>({});
  const [selectedDebtMonths, setSelectedDebtMonths] = useState<string[]>([]);
  const [previewAfterPay, setPreviewAfterPay] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<string | null>(null);
  const [walletView, setWalletView] = useState<"tiles" | "details">("tiles");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingAccountName, setEditingAccountName] = useState("");
  const { toast } = useToast();

  const normalizeLogoFilename = (filename: string) => {
    const cleaned = filename.replace(/^\/?logos\//i, "").replace(/^\//, "");
    return cleaned.replace(/\.avif$/i, ".png");
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    setInterestRateDraft((prev) => {
      const next = { ...prev };
      for (const acc of accounts || []) {
        if (!acc?.id) continue;
        if (!acc?.is_savings) continue;
        if (next[acc.id] === undefined) {
          next[acc.id] = String(Number(acc?.interest_rate || 0));
        }
      }
      return next;
    });
  }, [accounts]);

  const saveInterestRate = async (accountId: string) => {
    if (!isValidUuid(accountId)) return;

    const raw = (interestRateDraft[accountId] ?? "").trim();
    const parsed = raw === "" ? 0 : Number(raw);
    const nextRate = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 100)) : 0;

    const currentAcc = accounts.find((a) => a?.id === accountId);
    const currentRate = Number(currentAcc?.interest_rate || 0);
    if (!currentAcc || !currentAcc?.is_savings) return;
    if (Math.abs(currentRate - nextRate) < 1e-9) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return;

    const { error } = await sb
      .from("accounts")
      .update({ interest_rate: nextRate })
      .eq("id", accountId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Failed to update interest rate", error);
      // Revert draft back to stored value
      setInterestRateDraft((prev) => ({ ...prev, [accountId]: String(currentRate) }));
      return;
    }

    setAccounts((prev) =>
      prev.map((a) => (a?.id === accountId ? { ...a, interest_rate: nextRate } : a))
    );
    setInterestRateDraft((prev) => ({ ...prev, [accountId]: String(nextRate) }));
  };

  const toggleIncludeInNetworth = async (accountId: string) => {
    if (!isValidUuid(accountId)) return;

    const currentAcc = accounts.find((a) => a?.id === accountId);
    if (!currentAcc) return;

    const newValue = !currentAcc.include_in_networth;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return;

    const { error } = await sb
      .from("accounts")
      .update({ include_in_networth: newValue })
      .eq("id", accountId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Failed to update include_in_networth", error);
      return;
    }

    setAccounts((prev) =>
      prev.map((a) => (a?.id === accountId ? { ...a, include_in_networth: newValue } : a))
    );
  };

  const deleteAccount = async (accountId: string) => {
    if (!isValidUuid(accountId)) {
      toast({ title: "Error", description: "Invalid wallet id", variant: "destructive" });
      return;
    }

    const ownedAccount = accounts.find((a) => a?.id === accountId);
    if (!ownedAccount) {
      toast({ title: "Error", description: "Wallet not found", variant: "destructive" });
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return;

    const { error } = await sb
      .from("accounts")
      .delete()
      .eq("id", accountId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Failed to delete wallet", error);
      toast({
        title: "Error",
        description: "Failed to delete wallet. It may have associated transactions.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Wallet deleted",
      description: "The wallet has been successfully deleted.",
    });

    setAccountToDelete(null);
    loadAccounts();
  };

  const startEditingAccount = (accountId: string, currentName: string) => {
    setEditingAccountId(accountId);
    setEditingAccountName(currentName);
  };

  const saveAccountName = async (accountId: string) => {
    if (!isValidUuid(accountId)) {
      toast({ title: "Error", description: "Invalid wallet id", variant: "destructive" });
      return;
    }

    const newName = editingAccountName.trim();
    if (!newName) {
      setEditingAccountId(null);
      return;
    }

    if (newName.length > 60) {
      toast({ title: "Error", description: "Wallet name must be 60 characters or fewer", variant: "destructive" });
      return;
    }

    const currentAcc = accounts.find((a) => a.id === accountId);
    if (currentAcc && currentAcc.name === newName) {
      setEditingAccountId(null);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;

    const { error } = await sb
      .from("accounts")
      .update({ name: newName })
      .eq("id", accountId)
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error", description: "Failed to rename wallet", variant: "destructive" });
      return;
    }

    toast({ title: "Wallet renamed", description: "The wallet has been successfully renamed." });
    setEditingAccountId(null);
    loadAccounts();
  };

  const isCustomAccount = (account: any) => !account.icon && account.name !== "Cash on Hand";

  const loadAccounts = async () => {
    setIsLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.id) {
      let accountsList: any[] = [];

      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("user_id", user.id)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        const { data: fallbackData, error: fallbackErr } = await supabase
          .from("accounts")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        if (fallbackErr) {
          console.error("Failed to load accounts", fallbackErr);
          accountsList = [];
        } else {
          accountsList = fallbackData || [];
        }
      } else {
        accountsList = data || [];
      }

      // Apply resilient fallback sorting using localStorage order if display_order is unpopulated
      accountsList = sortAccountsWithFallback(accountsList, user.id);
      setAccounts(accountsList);

      // Load credit-card (SpayLater) debt from transactions
      setIsDebtLoading(true);
      try {
        const creditIds = accountsList
          .filter((a: any) => a?.type === "credit_card")
          .map((a: any) => a.id)
          .filter(Boolean);

        if (creditIds.length === 0) {
          setDebtByMonth({});
          setExpenseItemsByMonth({});
          setSelectedDebtMonths([]);
        } else {
          const { data: txData, error: txErr } = await sb
            .from("transactions")
            .select(
              "id, account_id, type, amount, description, date, transfer_to_account_id, category:categories(id,name,color), account:accounts!account_id(id,name,type)"
            )
            .eq("user_id", user.id)
            .or(
              `account_id.in.(${creditIds.join(",")}),transfer_to_account_id.in.(${creditIds.join(",")})`
            )
            .order("date", { ascending: false })
            .limit(5000);

          if (txErr) {
            console.error("Failed to load debt transactions", txErr);
            setDebtByMonth({});
            setExpenseItemsByMonth({});
            setSelectedDebtMonths([]);
          } else {
            const byMonth: Record<string, number> = {};
            const itemsByMonth: Record<string, any[]> = {};
            const byCreditAccount: Record<string, number> = {};
            creditIds.forEach((id: string) => {
              byCreditAccount[id] = 0;
            });

            (txData || []).forEach((t: any) => {
              const monthKey = typeof t?.date === "string" ? t.date.slice(0, 7) : "unknown";
              if (!byMonth[monthKey]) byMonth[monthKey] = 0;
              if (!itemsByMonth[monthKey]) itemsByMonth[monthKey] = [];

              const amt = Number(t?.amount || 0);
              const isCreditSource = creditIds.includes(t?.account_id);
              const isCreditDestination = creditIds.includes(t?.transfer_to_account_id);

              // Debt math rules:
              // - expense on credit_card increases debt
              // - income on credit_card decreases debt
              // - transfer TO credit_card decreases debt (payment)
              // - transfer FROM credit_card increases debt (cash advance / movement)
              if (t.type === "expense" && isCreditSource) {
                byMonth[monthKey] += amt;
                byCreditAccount[t.account_id] = Number(byCreditAccount[t.account_id] || 0) + amt;
                itemsByMonth[monthKey].push(t);
              } else if (t.type === "income" && isCreditSource) {
                byMonth[monthKey] -= amt;
                byCreditAccount[t.account_id] = Number(byCreditAccount[t.account_id] || 0) - amt;
              } else if (t.type === "transfer") {
                if (isCreditDestination) byMonth[monthKey] -= amt;
                if (isCreditSource) byMonth[monthKey] += amt;
                if (isCreditDestination) {
                  byCreditAccount[t.transfer_to_account_id] = Number(byCreditAccount[t.transfer_to_account_id] || 0) - amt;
                }
                if (isCreditSource) {
                  byCreditAccount[t.account_id] = Number(byCreditAccount[t.account_id] || 0) + amt;
                }
              }
            });

            // Normalize month buckets so historical overpayments (negative month values)
            // roll forward to later months instead of inflating visible month totals.
            const normalizedByMonth: Record<string, number> = {};
            const ascMonths = Object.keys(byMonth)
              .filter((k) => k && k !== "unknown")
              .sort((a, b) => (a < b ? -1 : 1));
            let carry = 0;
            for (const m of ascMonths) {
              const raw = Number(byMonth[m] || 0);
              const next = raw + carry;
              if (next < 0) {
                normalizedByMonth[m] = 0;
                carry = next;
              } else {
                normalizedByMonth[m] = next;
                carry = 0;
              }
            }

            // Keep stored credit-card balances aligned with transaction-derived debt.
            const nextCreditBalanceById: Record<string, number> = {};
            creditIds.forEach((id: string) => {
              nextCreditBalanceById[id] = Math.max(0, Number(byCreditAccount[id] || 0));
            });

            const creditUpdates = accountsList
              .filter((a: any) => a?.type === "credit_card" && a?.id)
              .map((a: any) => {
                const nextBal = Number(nextCreditBalanceById[a.id] || 0);
                const currentBal = Number(a?.balance || 0);
                return { id: a.id, currentBal, nextBal };
              })
              .filter((u) => Math.abs(u.nextBal - u.currentBal) > 0.005);

            if (creditUpdates.length > 0) {
              const syncResults = await Promise.all(
                creditUpdates.map((u) =>
                  sb
                    .from("accounts")
                    .update({ balance: u.nextBal })
                    .eq("id", u.id)
                    .eq("user_id", user.id)
                )
              );

              const hasSyncError = syncResults.some((r: any) => !!r?.error);
              if (hasSyncError) {
                console.error("Failed to sync one or more credit-card balances from debt history", syncResults);
              } else {
                accountsList = accountsList.map((a: any) =>
                  a?.type === "credit_card" && a?.id
                    ? { ...a, balance: Number(nextCreditBalanceById[a.id] || 0) }
                    : a
                );
                setAccounts(accountsList);
              }
            }

            setDebtByMonth(normalizedByMonth);
            setExpenseItemsByMonth(itemsByMonth);
          }
        }
      } finally {
        setIsDebtLoading(false);
      }
    }
    setIsLoading(false);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newAccounts = [...accounts];
    const draggedItem = newAccounts[draggedIndex];
    newAccounts.splice(draggedIndex, 1);
    newAccounts.splice(index, 0, draggedItem);

    setAccounts(newAccounts);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const saveAccountOrder = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;

    const invalidAccount = accounts.some((acc) => !acc?.id || !isValidUuid(acc.id));
    if (invalidAccount) {
      toast({ title: "Error", description: "Invalid account ordering data", variant: "destructive" });
      return;
    }

    // 1. Immediately cache the user-ordered account IDs in localStorage for instant local persistence
    const orderedIds = accounts.map((acc) => acc.id);
    setStoredAccountOrder(user.id, orderedIds);

    // 2. Best-effort update display_order in Supabase accounts table
    try {
      const updates = accounts.map((acc, idx) =>
        sb.from("accounts")
          .update({ display_order: idx })
          .eq("id", acc.id)
          .eq("user_id", user.id)
      );

      await Promise.allSettled(updates);
    } catch (err) {
      console.warn("Could not sync display_order to remote database:", err);
    }

    toast({ title: "Order saved", description: "Your wallet order has been updated." });
    setIsEditingOrder(false);
  };

  const totalBalance = accounts.reduce((sum, acc) => sum + Number(acc.balance), 0);

  const currentMoney = useMemo(() => {
    return accounts
      .filter((a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false)
      .reduce((sum, acc) => sum + Number(acc.balance), 0);
  }, [accounts]);

  const sortedMonths = useMemo(() => {
    const keys = Object.keys(debtByMonth).filter((k) => {
      if (!k || k === "unknown") return false;
      const debt = Math.max(0, Number(debtByMonth[k] || 0));
      return debt > 0.005; // Only show months with meaningful outstanding debt
    });
    keys.sort((a, b) => (a < b ? 1 : -1));
    return keys;
  }, [debtByMonth]);

  useEffect(() => {
    setSelectedDebtMonths((prev) => {
      if (sortedMonths.length === 0) return [];
      if (!prev || prev.length === 0) return sortedMonths;

      const valid = prev.filter((m) => sortedMonths.includes(m));
      if (valid.length === 0) return sortedMonths;

      const validSet = new Set(valid);
      const ordered = sortedMonths.filter((m) => validSet.has(m));
      if (ordered.length === sortedMonths.length) return sortedMonths;
      return ordered;
    });
  }, [sortedMonths]);

  const isAllMonthsSelected = useMemo(() => {
    return sortedMonths.length > 0 && selectedDebtMonths.length === sortedMonths.length;
  }, [selectedDebtMonths.length, sortedMonths.length]);

  const selectedMonthsLabel = useMemo(() => {
    if (sortedMonths.length === 0) return "All";
    if (isAllMonthsSelected) return "All";
    if (selectedDebtMonths.length === 1) return selectedDebtMonths[0];
    return `${selectedDebtMonths.length} selected`;
  }, [isAllMonthsSelected, selectedDebtMonths, sortedMonths.length]);

  const selectedMonthsDetailLabel = useMemo(() => {
    if (sortedMonths.length === 0) return "All months";
    if (isAllMonthsSelected) return "All months";
    return selectedDebtMonths.join(", ");
  }, [isAllMonthsSelected, selectedDebtMonths, sortedMonths.length]);

  const selectedDebt = useMemo(() => {
    if (sortedMonths.length === 0) return 0;
    const months = isAllMonthsSelected ? sortedMonths : selectedDebtMonths;
    return months.reduce((sum, m) => sum + Math.max(0, Number(debtByMonth[m] || 0)), 0);
  }, [debtByMonth, isAllMonthsSelected, selectedDebtMonths, sortedMonths]);

  const previewMoney = useMemo(() => {
    if (!previewAfterPay) return currentMoney;
    return currentMoney - selectedDebt;
  }, [currentMoney, previewAfterPay, selectedDebt]);

  const defaultCreditAccountId = useMemo(() => {
    return accounts.find((a) => a?.type === "credit_card")?.id;
  }, [accounts]);

  const handlePayDebt = (accountId?: string) => {
    const targetId = accountId || defaultCreditAccountId;
    if (targetId) {
      setDefaultTransactionAccountId(targetId);
    }
    setIsAddTransactionOpen(true);
  };

  const handleSelectAccount = (accountId: string) => {
    setDefaultTransactionAccountId(accountId);
    setIsAddTransactionOpen(true);
  };

  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* Header - Redesigned for Mobile */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-3xl font-bold tracking-tight">Wallets</h2>
              <p className="text-muted-foreground">
                Manage your financial wallets and accounts
              </p>
            </div>
            {/* Button visible only on desktop */}
            <Button onClick={() => setIsModalOpen(true)} className="hidden sm:flex transition-all duration-200 hover:scale-105 hover:shadow-lg">
              <Plus className="mr-2 h-4 w-4" />
              Add Wallet
            </Button>
          </div>
          {/* Button visible only on mobile - below description */}
          <Button onClick={() => setIsModalOpen(true)} className="w-full sm:hidden transition-all duration-200 hover:scale-105 hover:shadow-lg">
            <Plus className="mr-2 h-4 w-4" />
            Add Wallet
          </Button>
        </div>

        {/* ─── Editorial Balance Masthead (No nested card-in-card) ─── */}
        <div className="rounded-2xl border border-border/70 bg-card/60 p-5 sm:p-7 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Liquid Assets & Net Worth
                </span>
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums tracking-tight text-foreground">
                  {formatCurrency(previewAfterPay ? previewMoney : currentMoney)}
                </p>
                {previewAfterPay && (
                  <span className="text-xs font-mono text-muted-foreground font-medium">
                    (reflecting -{formatCurrency(Math.abs(selectedDebt))} debt deduction)
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Aggregated balance across {accounts.filter((a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false).length} accounts (excluding credit card debt).
              </p>
            </div>

            {/* Inline Debt Deduction Bar */}
            <div className="flex flex-wrap items-center gap-2 pt-1 lg:pt-0">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground">Outstanding Debt:</span>
                <span className="font-mono tabular-nums font-bold text-rose-500">
                  {isDebtLoading ? "..." : `-${formatCurrency(Math.abs(selectedDebt))}`}
                </span>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 text-xs font-medium bg-background" disabled={isDebtLoading || sortedMonths.length === 0}>
                    {isAllMonthsSelected ? "All months" : selectedMonthsLabel}
                    <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Filter by Month</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={isAllMonthsSelected}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      if (next) {
                        setSelectedDebtMonths(sortedMonths);
                        return;
                      }
                      setSelectedDebtMonths(sortedMonths.length > 0 ? [sortedMonths[0]] : []);
                    }}
                    className="border-l-2 border-transparent data-[state=checked]:border-primary"
                  >
                    All months
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  {sortedMonths.map((m) => (
                    <DropdownMenuCheckboxItem
                      key={m}
                      checked={selectedDebtMonths.includes(m)}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={(checked) => {
                        const next = checked === true;
                        setSelectedDebtMonths((prev) => {
                          const prevSet = new Set(prev && prev.length > 0 ? prev : sortedMonths);

                          if (next) prevSet.add(m);
                          else prevSet.delete(m);

                          if (prevSet.size === 0) return sortedMonths;
                          if (prevSet.size === sortedMonths.length) return sortedMonths;

                          return sortedMonths.filter((x) => prevSet.has(x));
                        });
                      }}
                      className="border-l-2 border-transparent data-[state=checked]:border-primary"
                    >
                      {m}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                size="sm"
                variant={previewAfterPay ? "secondary" : "outline"}
                onClick={() => setPreviewAfterPay((v) => !v)}
                disabled={isDebtLoading}
                className="h-8 text-xs font-medium"
              >
                {previewAfterPay ? "Deduct Debt: Active" : "Deduct Debt: Off"}
              </Button>
            </div>
          </div>
        </div>

        {/* ─── Wallets & Accounts Section (No outer card, Dual-View: Tiles & Ledger) ─── */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/40">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <span>Wallets & Accounts</span>
                {accounts && accounts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-mono font-medium bg-muted text-muted-foreground">
                    {accounts.length}
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Liquid repositories, savings vaults, and active credit facilities
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* View Switcher: Details vs Tiles */}
              <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
                <button
                  type="button"
                  onClick={() => setWalletView("tiles")}
                  className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${
                    walletView === "tiles"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label="Tiles view"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Tiles</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWalletView("details")}
                  className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${
                    walletView === "details"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label="Details ledger view"
                >
                  <List className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Ledger</span>
                </button>
              </div>

              {!isEditingOrder ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditingOrder(true)}
                  disabled={!(accounts && accounts.length > 1)}
                  className="h-8 text-xs font-medium"
                  title={accounts && accounts.length > 1 ? "Reorder your accounts" : "Add at least two accounts to reorder"}
                >
                  <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                  Edit Order
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-medium"
                    onClick={() => {
                      setIsEditingOrder(false);
                      loadAccounts();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={saveAccountOrder}
                  >
                    Save Order
                  </Button>
                </div>
              )}

              <Button
                size="sm"
                onClick={() => setIsModalOpen(true)}
                className="h-8 text-xs font-semibold gap-1.5 shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Wallet
              </Button>
            </div>
          </div>

          {/* Wallets Content: Tiles, Ledger, Empty, or Loading */}
          {!isLoading && accounts && accounts.length > 0 ? (
            <AnimatePresence mode="wait">
              {walletView === "tiles" ? (
                <motion.div
                  key="tiles"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="grid grid-cols-2 gap-2.5 sm:gap-3.5 md:grid-cols-3 lg:grid-cols-4"
                >
                  {accounts.map((account, index) => (
                    <WalletTileCard
                      key={account.id}
                      account={account}
                      index={index}
                      isEditingOrder={isEditingOrder}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd}
                      onClick={() => handleSelectAccount(account.id)}
                      editingAccountId={editingAccountId}
                      editingAccountName={editingAccountName}
                      setEditingAccountName={setEditingAccountName}
                      startEditingAccount={startEditingAccount}
                      saveAccountName={saveAccountName}
                      setEditingAccountId={setEditingAccountId}
                      setAccountToDelete={setAccountToDelete}
                      toggleIncludeInNetworth={toggleIncludeInNetworth}
                      interestRateDraft={interestRateDraft}
                      setInterestRateDraft={setInterestRateDraft}
                      saveInterestRate={saveInterestRate}
                      onPayDebt={handlePayDebt}
                    />
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="ledger"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >
                  <WalletLedgerView
                    accounts={accounts}
                    isEditingOrder={isEditingOrder}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onSelectAccount={handleSelectAccount}
                    editingAccountId={editingAccountId}
                    editingAccountName={editingAccountName}
                    setEditingAccountName={setEditingAccountName}
                    startEditingAccount={startEditingAccount}
                    saveAccountName={saveAccountName}
                    setEditingAccountId={setEditingAccountId}
                    setAccountToDelete={setAccountToDelete}
                    toggleIncludeInNetworth={toggleIncludeInNetworth}
                    interestRateDraft={interestRateDraft}
                    setInterestRateDraft={setInterestRateDraft}
                    saveInterestRate={saveInterestRate}
                    onPayDebt={handlePayDebt}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          ) : !isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-border/60 bg-card/20 text-center">
              <Wallet className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-base font-semibold text-foreground">No wallets configured</p>
              <p className="text-xs text-muted-foreground max-w-sm mb-4 mt-1">
                Add your bank accounts, digital e-wallets, or cash on hand to track your net worth and expenses.
              </p>
              <Button onClick={() => setIsModalOpen(true)} size="sm" className="font-semibold gap-1.5">
                <Plus className="h-4 w-4" />
                Add Your First Wallet
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 md:grid-cols-3 lg:grid-cols-4">
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </div>
          )}
        </div>

        {/* ─── PayLater & Credit Schedule (No outer card, hairline statement ledger) ─── */}
        <DebtScheduleSection
          isDebtLoading={isDebtLoading}
          sortedMonths={sortedMonths}
          debtByMonth={debtByMonth}
          expenseItemsByMonth={expenseItemsByMonth}
          onPayDebt={handlePayDebt}
          defaultCreditAccountId={defaultCreditAccountId}
        />
      </div >

      {/* Add Wallet Modal */}
      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          loadAccounts();
        }}
        existingAccounts={accounts.map((acc) => ({ icon: acc.icon, is_savings: acc.is_savings }))}
      />

      <AddTransactionModal
        isOpen={isAddTransactionOpen}
        defaultAccountId={defaultTransactionAccountId}
        onClose={() => {
          setIsAddTransactionOpen(false);
          setDefaultTransactionAccountId(undefined);
          loadAccounts();
        }}
      />

      {/* Delete Account Confirmation Modal */}
      {
        accountToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAccountToDelete(null)}>
            <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-semibold mb-4 text-destructive">Delete Wallet</h3>
              <p className="text-muted-foreground mb-6">
                Are you sure you want to delete this wallet? This action cannot be undone.
                All transactions associated with this wallet will also be deleted.
              </p>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setAccountToDelete(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => deleteAccount(accountToDelete)}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )
      }
    </>
  );
}
