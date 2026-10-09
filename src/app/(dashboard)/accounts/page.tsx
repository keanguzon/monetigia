"use client";

import { useMemo, useState, useEffect, useRef } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { summaryPanelClass, summaryAmountClass, pageTitleClass, summarizeWalletFunds, WalletFundsBreakdown } from "@/components/ui/financial-summary";
import { motion, AnimatePresence } from "framer-motion";
import { WalletTileCard } from "@/components/accounts/WalletTileCard";
import { WalletLedgerView } from "@/components/accounts/WalletLedgerView";
import { DebtScheduleSection } from "@/components/accounts/DebtScheduleSection";
import { debtCorrectionRecovery } from "@/components/accounts/DebtHistoryGroup";
import { useAccounts } from "@/hooks/use-data";
import { useGoals } from "@/hooks/use-goals";
import { useDebt, useDebtCommand } from "@/hooks/use-debt";
import { summarizeDebt } from "@/lib/debt/summary";
import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";
import { LegacyDebtReviewDialog } from "@/components/accounts/LegacyDebtReviewDialog";

const AddAccountModal = dynamic(() => import("@/components/accounts/AddAccountModal"), {
  ssr: false,
});

const AddTransactionModal = dynamic(() => import("@/components/transactions/AddTransactionModal"), {
  ssr: false,
});

export default function AccountsPage() {
  const supabase = createClient();
  const sb = supabase as any;
  const accountsQuery = useAccounts();
  const loadRevision = useRef(0);
  const goals = useGoals();
  const debt = useDebt(goals.userId);
  const debtCommand = useDebtCommand(goals.userId);
  const pendingAdoption = debtCommand.pendingCommand?.kind === "adopt_opening_debt" ? debtCommand.pendingCommand : null;
  const pendingCorrection = debtCommand.pendingCommand?.kind === "correct_debt_rows" ? debtCommand.pendingCommand : null;
  const [correctionRefreshPending, setCorrectionRefreshPending] = useState(() => Boolean(goals.userId && debtCorrectionRecovery.refreshOwners.has(goals.userId)));
  const [refreshingCorrectionViews, setRefreshingCorrectionViews] = useState(false);
  const retryingCorrection = useRef(false);
  const [reviewAccountId, setReviewAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [defaultTransactionAccountId, setDefaultTransactionAccountId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [interestRateDraft, setInterestRateDraft] = useState<Record<string, string>>({});



  const [accountLoadError, setAccountLoadError] = useState<unknown>(null);


  const [selectedDebtMonths, setSelectedDebtMonths] = useState<string[]>([]);
  const [previewAfterPay, setPreviewAfterPay] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<string | null>(null);
  const [walletView, setWalletView] = useState<"tiles" | "details">("tiles");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingAccountName, setEditingAccountName] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    const ownerId = goals.userId;
    if (ownerId && pendingCorrection) debtCorrectionRecovery.pendingOwners.add(ownerId);
    if (ownerId && debtCorrectionRecovery.pendingOwners.has(ownerId) && !debtCommand.pendingCommand && debtCommand.saved && debtCommand.refreshError) {
      debtCorrectionRecovery.refreshOwners.add(ownerId);
    }
    setCorrectionRefreshPending(Boolean(ownerId && debtCorrectionRecovery.refreshOwners.has(ownerId)));
  }, [goals.userId, pendingCorrection, debtCommand.saved, debtCommand.refreshError]);

  async function refreshCorrectionViews() {
    const ownerId = goals.userId;
    if (!ownerId) throw new Error("Sign in to refresh debt views.");
    debtCorrectionRecovery.pendingOwners.add(ownerId);
    debtCorrectionRecovery.refreshOwners.add(ownerId);
    setCorrectionRefreshPending(true);
    setRefreshingCorrectionViews(true);
    try {
      await debt.refresh();
      await goals.refresh();
      debtCorrectionRecovery.pendingOwners.delete(ownerId);
      debtCorrectionRecovery.refreshOwners.delete(ownerId);
      setCorrectionRefreshPending(false);
      if (!debtCommand.pendingCommand && !debtCommand.isSaving && !debtCommand.refreshError) debtCommand.reset();
    } catch (error) {
      setCorrectionRefreshPending(true);
      throw error;
    } finally {
      setRefreshingCorrectionViews(false);
    }
  }

  function retryPendingCorrection() {
    if (!pendingCorrection || debtCommand.isSaving || retryingCorrection.current) return;
    retryingCorrection.current = true;
    void debtCommand.retry();
  }

  useEffect(() => {
    if (!retryingCorrection.current || debtCommand.isSaving) return;
    retryingCorrection.current = false;
    if (!pendingCorrection && debtCommand.saved) void refreshCorrectionViews().catch(() => undefined);
  }, [pendingCorrection, debtCommand.isSaving, debtCommand.saved]);

  const normalizeLogoFilename = (filename: string) => {
    const cleaned = filename.replace(/^\/?logos\//i, "").replace(/^\//, "");
    return cleaned.replace(/\.avif$/i, ".png");
  };

  useEffect(() => {
    loadRevision.current += 1;
    if (accountsQuery.error) {
      setAccountLoadError(accountsQuery.error);

      setAccounts([]);
      setIsLoading(false);

    } else if (accountsQuery.data !== undefined) {
      void loadAccounts(accountsQuery.data);
    }
    return () => { loadRevision.current += 1; };
  }, [accountsQuery.data, accountsQuery.error]);

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

  const loadAccounts = async (providedAccounts?: any[]) => {
    const revision = ++loadRevision.current;
    const isCurrentLoad = () => revision === loadRevision.current;
    setIsLoading(true);
    setAccountLoadError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!isCurrentLoad()) return;
      if (!user?.id) throw new Error("Not authenticated");

      let accountsList: any[];
      if (providedAccounts !== undefined) {
        accountsList = providedAccounts;
      } else {
        const { data, error } = await supabase
          .from("accounts")
          .select("*")
          .eq("user_id", user.id)
          .order("display_order", { ascending: true })
          .order("created_at", { ascending: true });

        if (!isCurrentLoad()) return;

        if (error) {
          const { data: fallbackData, error: fallbackError } = await supabase
            .from("accounts")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: true });
          if (!isCurrentLoad()) return;
          if (fallbackError) throw fallbackError;
          accountsList = fallbackData || [];
        } else {
          accountsList = data || [];
        }
      }

      // Apply resilient fallback sorting using localStorage order if display_order is unpopulated.
      accountsList = sortAccountsWithFallback(accountsList, user.id);
      setAccounts(accountsList);
      if (providedAccounts === undefined) {
        await accountsQuery.mutate(accountsList, { revalidate: false });
        if (!isCurrentLoad()) return;
      }


    } catch (error) {
      if (!isCurrentLoad()) return;
      setAccountLoadError(error);

    } finally {
      if (isCurrentLoad()) {
        setIsLoading(false);

      }
    }
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

  const summaryAccounts = useMemo(() => {
    const localInclusion = new Map(accounts.map(account => [account.id, account.include_in_networth]));
    return (accountsQuery.data ?? accounts).map(account =>
      localInclusion.has(account.id)
        ? { ...account, include_in_networth: localInclusion.get(account.id) }
        : account
    );
  }, [accounts, accountsQuery.data]);

  const debtSnapshotResult = useMemo(() => {
    if (!debt.snapshot) return { snapshot: undefined, unsupported: [] as any[], error: null as unknown };
    const metadata = new Map(summaryAccounts.map(account => [account.id, account]));
    const missing = debt.snapshot.accounts.some(account => !metadata.get(account.accountId)?.currency);
    const unsupported = debt.snapshot.accounts.flatMap(account => {
      const wallet = metadata.get(account.accountId);
      return wallet?.currency && wallet.currency !== "PHP" ? [{ ...account, name: wallet.name, currency: wallet.currency }] : [];
    });
    const supportedIds = new Set(debt.snapshot.accounts.filter(account => metadata.get(account.accountId)?.currency === "PHP").map(account => account.accountId));
    return { snapshot: { accounts: debt.snapshot.accounts.filter(account => supportedIds.has(account.accountId)), rows: debt.snapshot.rows.filter(row => supportedIds.has(row.accountId)) }, unsupported,
      error: missing ? new Error("Debt currency metadata is unavailable") : null };
  }, [debt.snapshot, summaryAccounts]);
  const walletSummaryResult = useMemo(() => {
    if (!goals.financeSnapshot) return { summary: null, error: null as unknown };
    try {
      return {
        summary: summarizeWalletFunds(summaryAccounts, goals.financeSnapshot.wallets),
        error: null as unknown,
      };
    } catch (error) {
      return { summary: null, error };
    }
  }, [summaryAccounts, goals.financeSnapshot]);
  const walletSummaryError = accountsQuery.error || accountLoadError || goals.isError || walletSummaryResult.error ||
    (!goals.isLoading && !goals.financeSnapshot ? new Error("Finance snapshot is unavailable") : null);
  const walletSummaryLoading = isLoading || accountsQuery.isLoading || accountsQuery.isValidating || goals.isLoading;
  const debtSummaryLoading = debt.isLoading || isLoading || accountsQuery.isLoading || accountsQuery.isValidating;
  const debtSummaryError = debt.error || accountLoadError || accountsQuery.error || debtSnapshotResult.error;

  const currentMoney = walletSummaryResult.summary ? Number(walletSummaryResult.summary.netWorth) : 0;

  const sortedMonths = useMemo(() => Array.from(new Set(debtSnapshotResult.snapshot?.rows.flatMap(row => row.dueDate && row.remainingAmount !== "0.00" ? [row.dueDate.slice(0, 7)] : []) ?? [])).sort().reverse(), [debtSnapshotResult.snapshot]);
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
    return sortedMonths.length === 0 || selectedDebtMonths.length === 0 || selectedDebtMonths.length === sortedMonths.length;
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

  const exactDebtResult = useMemo(() => {
    if (!debtSnapshotResult.snapshot) return { summary: null, error: null as unknown };
    try { return { summary: summarizeDebt(debtSnapshotResult.snapshot, isAllMonthsSelected ? null : selectedDebtMonths), error: null as unknown }; }
    catch (error) { return { summary: null, error }; }
  }, [debtSnapshotResult.snapshot, isAllMonthsSelected, selectedDebtMonths]);
  const selectedDebtMoney = exactDebtResult.summary ? (isAllMonthsSelected ? exactDebtResult.summary.totalOutstanding : exactDebtResult.summary.scheduledDebt) : null;
  const selectedDebt = Number(selectedDebtMoney ?? "0.00");
  const debtUnavailable = Boolean(debtSummaryError || exactDebtResult.error || selectedDebtMoney === null);
  const deductionUnavailable = debtUnavailable || Boolean(exactDebtResult.summary?.needsReviewAccountIds.length);
  const previewMoneyText = useMemo(() => {
    if (!previewAfterPay || debtSummaryLoading || deductionUnavailable || !walletSummaryResult.summary || selectedDebtMoney === null) return walletSummaryResult.summary?.netWorth ?? "0.00";
    const cents = BigInt(toMinorUnits(walletSummaryResult.summary.netWorth)) - BigInt(toMinorUnits(selectedDebtMoney));
    return fromMinorUnits(Number(cents));
  }, [previewAfterPay, debtSummaryLoading, deductionUnavailable, walletSummaryResult.summary, selectedDebtMoney]);
  const previewMoney = Number(previewMoneyText);
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
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className={pageTitleClass}>Wallets</h1>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {walletSummaryLoading ? <Skeleton className="h-4 w-14" /> : accountLoadError ? "Unavailable" : `${accounts.length} Total`}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage your financial wallets and accounts
            </p>
          </div>
        </div>

        {/* ─── Editorial Balance Masthead (No nested card-in-card) ─── */}
        <div className={summaryPanelClass} aria-busy={walletSummaryLoading}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Liquid Assets & Net Worth
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <div className={`${summaryAmountClass} text-foreground`}>
                  {walletSummaryLoading ? <Skeleton className="h-9 w-48" /> : walletSummaryError || !walletSummaryResult.summary ? (
                    <span>Unavailable</span>
                  ) : (
                    <output aria-label="Net worth balance" data-money={previewAfterPay && !debtSummaryLoading && !deductionUnavailable ? previewMoneyText : walletSummaryResult.summary.netWorth}>
                      {formatCurrency(previewAfterPay && !debtSummaryLoading && !deductionUnavailable ? previewMoney : currentMoney)}
                    </output>
                  )}
                </div>
                {previewAfterPay && !debtSummaryLoading && !walletSummaryLoading && !deductionUnavailable && !walletSummaryError && (
                  <span className="text-xs tabular-nums text-muted-foreground font-medium">
                    (reflecting -{formatCurrency(Math.abs(selectedDebt))} debt deduction)
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {walletSummaryLoading ? <Skeleton className="h-4 w-64 max-w-full" /> : walletSummaryError ? "Wallet balance details are unavailable." : <>Aggregated balance across {summaryAccounts.filter((a: any) => a?.type !== "credit_card" && a?.include_in_networth !== false).length} accounts (excluding credit card debt).</>}
              </div>
            </div>

            {/* Inline Debt Deduction Bar */}
            <div className="flex flex-wrap items-center gap-2 pt-1 lg:pt-0">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground">{isAllMonthsSelected ? "Outstanding Debt:" : "Scheduled Debt:"}</span>
                <output aria-label={isAllMonthsSelected ? "Outstanding debt" : "Scheduled debt"} data-money={!debtSummaryLoading && !debtUnavailable ? selectedDebtMoney ?? undefined : undefined} className="font-heading tabular-nums font-bold text-rose-600 dark:text-rose-400">
                  {debtSummaryLoading ? "..." : debtUnavailable ? "Unavailable" : `-${formatCurrency(Math.abs(selectedDebt))}`}
                </output>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 text-xs font-medium bg-background" disabled={debtSummaryLoading || !!debtUnavailable || sortedMonths.length === 0}>
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
                disabled={debtSummaryLoading || !!deductionUnavailable}
                className="h-8 text-xs font-medium"
              >
                {previewAfterPay ? "Deduct Debt: Active" : "Deduct Debt: Off"}
              </Button>
            </div>
          </div>
          <WalletFundsBreakdown
            summary={walletSummaryResult.summary}
            isLoading={walletSummaryLoading}
            error={walletSummaryError}
          />
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
          ) : !isLoading && accountLoadError ? (
            <p role="alert" className="rounded-xl border border-border/60 bg-card/20 px-4 py-6 text-center text-sm text-muted-foreground">
              Wallets could not be loaded. Refresh the page to try again.
            </p>
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
        {Boolean(debtSnapshotResult.error) && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Debt currency metadata is unavailable. The PHP debt total cannot be confirmed.</p>}
        {debtSnapshotResult.unsupported.map(account => <p key={account.accountId} role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{account.name} ({account.currency}) is excluded from PHP debt totals. Its debt requires separate review; PHP payments and due-date adoption are unavailable.</p>)}
        {pendingCorrection && <div data-no-press-motion="" role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>This debt correction is unconfirmed. Retry the original saved request before starting another correction.</p>
          {debtCommand.error && <p>{debtCommand.error}</p>}
          <Button variant="outline" className="min-h-11" disabled={debtCommand.isSaving} onClick={retryPendingCorrection}>{debtCommand.isSaving ? "Retrying correction…" : "Retry same correction"}</Button>
        </div>}
        {correctionRefreshPending && <div data-no-press-motion="" role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>A debt correction saved, but the debt views could not refresh. Refresh them before starting another correction.</p>
          <Button variant="outline" className="min-h-11" disabled={refreshingCorrectionViews} onClick={() => { void refreshCorrectionViews().catch(() => undefined); }}>{refreshingCorrectionViews ? "Refreshing views…" : "Refresh views"}</Button>
        </div>}
        <DebtScheduleSection snapshot={debtSnapshotResult.snapshot} isLoading={debtSummaryLoading} error={debtSummaryError || exactDebtResult.error} onPayDebt={handlePayDebt} onCorrectionSaved={refreshCorrectionViews} canReviewLegacy={accountId => summaryAccounts.some(account => account.id === accountId && account.currency === "PHP" && account.is_active === true)} onReviewLegacy={accountId => {
          const wallet = summaryAccounts.find(account => account.id === accountId);
          if (wallet?.currency === "PHP" && wallet.is_active === true) setReviewAccountId(accountId);
        }} />
        {pendingAdoption && <div role="status" className="space-y-2 border-t border-border pt-4"><p className="text-sm">A due-date save is unconfirmed. Recover its original request before starting another review.</p><Button variant="outline" className="min-h-11" onClick={() => setReviewAccountId(pendingAdoption.accountId)}>Recover due-date save</Button></div>}
        <LegacyDebtReviewDialog isOpen={reviewAccountId !== null} onClose={() => setReviewAccountId(null)} account={debtSnapshotResult.snapshot?.accounts.find(account => account.accountId === reviewAccountId) ?? null} />      </div >

      {/* Add Wallet Modal */}
      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          void goals.refresh().catch(() => undefined);
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
          <div data-mobile-nav-blocking="" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAccountToDelete(null)}>
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
