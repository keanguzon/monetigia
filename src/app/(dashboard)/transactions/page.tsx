"use client";

import { useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTransactionDelete } from "@/hooks/use-transaction-submit";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, isValidUuid } from "@/lib/utils";
import { Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Trash2, Search } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import InstallmentHistoryGroup from "@/components/transactions/InstallmentHistoryGroup";
import {
  filterHistoryEntries,
  groupTransactions,
  loadHistoryPage,
  mergeHistoryRows,
  sortHistoryEntries,
  type TransactionHistoryRow,
  type TransactionHistorySort,
} from "@/lib/transactions/history";

const AddTransactionModal = dynamic(() => import("@/components/transactions/AddTransactionModal"), {
  ssr: false,
});

const TransactionDetailModal = dynamic(() => import("@/components/transactions/TransactionDetailModal"), {
  ssr: false,
});


export default function TransactionsPage() {
  const supabase = createClient();
  const sb = supabase as any;
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<TransactionHistoryRow[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "expense" | "income" | "transfer">("all");
  const [sortMode, setSortMode] = useState<TransactionHistorySort>("date_added");
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<TransactionHistoryRow | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionHistoryRow | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [savedDeleteKind, setSavedDeleteKind] = useState<"transaction" | "installment">("transaction");
  const requestGeneration = useRef(0);
  const loadMoreLock = useRef(false);
  const deletion = useTransactionDelete(loadTransactions);
  const isDeleting = deletion.isDeleting;
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    void loadTransactions().catch(() => {});
  }, [refreshKey, sortMode]);

  useEffect(() => {
    if (!deletion.savedTransactionId) return;
    setDeleteConfirm(null);
    setTransactions(current => current.filter(transaction => transaction.id !== deletion.savedTransactionId));
  }, [deletion.savedTransactionId]);

  const deleteTransaction = async (transaction: TransactionHistoryRow | null) => {
    if (!transaction?.id || !isValidUuid(transaction.id)) {
      toast({ title: "Cannot delete transaction", description: "This transaction could not be identified.", variant: "destructive" });
      return;
    }
    setSavedDeleteKind(transaction.installment_group_id ? "installment" : "transaction");
    await deletion.remove(transaction.id);
  };

  async function loadTransactions() {
    const generation = ++requestGeneration.current;
    loadMoreLock.current = false;
    setIsLoading(true);
    setIsLoadingMore(false);
    setLoadError(null);
    setLoadMoreError(null);
    setNextOffset(null);
    setTransactions([]);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;
      const page = await loadHistoryPage(sb, user.id, sortMode);
      if (generation !== requestGeneration.current) return;
      setTransactions(page.rows);
      setNextOffset(page.nextOffset);
    } catch (error) {
      if (generation === requestGeneration.current) {
        console.error("Failed to load transactions", error);
        setLoadError("The transaction list could not refresh. Try again.");
        toast({
          title: "Failed to load transactions",
          description: "The transaction list could not refresh. Try again.",
          variant: "destructive",
        });
      }
      throw new Error("The transaction list could not refresh.");
    } finally {
      if (generation === requestGeneration.current) setIsLoading(false);
    }
  }

  async function loadMoreTransactions() {
    if (nextOffset === null || isLoading || isLoadingMore || loadMoreLock.current) return;
    const offset = nextOffset;
    const generation = requestGeneration.current;
    loadMoreLock.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error("Sign in to load older transactions.");
      const page = await loadHistoryPage(sb, user.id, sortMode, offset);
      if (generation !== requestGeneration.current) return;
      setTransactions(current => mergeHistoryRows(current, page.rows));
      setNextOffset(page.nextOffset);
    } catch (error) {
      if (generation === requestGeneration.current) {
        console.error("Failed to load more transactions", error);
        setLoadMoreError("Older history could not be loaded. Your current entries are still here.");
        toast({
          title: "Failed to load more transactions",
          description: "Older history could not be loaded. Try again.",
          variant: "destructive",
        });
      }
    } finally {
      if (generation === requestGeneration.current) {
        loadMoreLock.current = false;
        setIsLoadingMore(false);
      }
    }
  }

  const historyEntries = sortHistoryEntries(groupTransactions(transactions), sortMode);

  const filterLabel =
    filter === "all"
      ? "All"
      : filter === "expense"
        ? "Expense"
        : filter === "income"
          ? "Income"
          : "Transfer";

  const searchFilteredTransactions = filterHistoryEntries(historyEntries, searchQuery, filter);
  const deleteConfirmIsInstallment = !!deleteConfirm?.installment_group_id;

  return (
    <>
      {deletion.error && <div data-no-press-motion="" role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300 space-y-2"><p>{deletion.error}</p>{deletion.pendingTransactionId && <button type="button" disabled={isDeleting} onClick={() => { void deletion.remove(deletion.pendingTransactionId!); }} className="min-h-11 px-4 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Retry same deletion</button>}</div>}
      {deletion.savedTransactionId && <p role="status" className="mb-4 text-sm">{savedDeleteKind === "installment" ? deletion.refreshError ? "Installment deleted, but some views could not refresh. Refresh the page to check the remaining schedule." : "Installment deleted. Its siblings remain and the remaining scheduled amount has been updated." : deletion.refreshError ? "Transaction deleted. Some views could not refresh. Refresh the page; do not delete it again." : "Transaction deleted and wallet balances updated."}</p>}
      {loadError && <div data-no-press-motion="" role="alert" className="mb-4 flex flex-col items-start gap-2 text-sm text-red-700 dark:text-red-300"><p>{loadError}</p><button type="button" onClick={() => { void loadTransactions().catch(() => {}); }} className="min-h-11 rounded-lg border px-4 focus-visible:ring-2 focus-visible:ring-primary">Retry loading transactions</button></div>}
      <div data-no-press-motion="" className="space-y-6">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Transactions</h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                View and manage your complete financial history
              </p>
            </div>
            <Button
              onClick={() => setIsModalOpen(true)}
              className="h-11 text-sm font-semibold gap-1.5 w-full sm:w-auto text-slate-950"
            >
              <Plus className="h-4 w-4" />
              <span>Add Transaction</span>
            </Button>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {(["all", "expense", "income", "transfer"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilter(type)}
                  className={`min-h-11 px-3 rounded-lg text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    filter === type
                      ? "bg-primary text-slate-950"
                      : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto] lg:w-[min(100%,34rem)]">
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  aria-label="Search transactions"
                  placeholder="Search transactions..."
                  className="min-h-11 bg-card/60 pl-10 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="transaction-sort" className="sr-only">Sort transactions</label>
                <select
                  id="transaction-sort"
                  aria-label="Sort transactions"
                  value={sortMode}
                  onChange={event => {
                    const nextSort = event.target.value as TransactionHistorySort;
                    if (nextSort === sortMode) return;
                    requestGeneration.current += 1;
                    loadMoreLock.current = false;
                    setTransactions([]);
                    setNextOffset(null);
                    setIsLoadingMore(false);
                    setLoadError(null);
                    setLoadMoreError(null);
                    setIsLoading(true);
                    setSortMode(nextSort);
                  }}
                  className="min-h-11 w-full rounded-md border border-input bg-card/60 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
                >
                  <option value="date_added">Date added (newest first)</option>
                  <option value="transaction_date">Transaction date (newest first)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {!isLoading && !loadError && <div className="flex flex-col gap-1 px-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Showing {searchFilteredTransactions.length} {filterLabel.toLowerCase()} {searchFilteredTransactions.length === 1 ? "entry" : "entries"} in loaded history</span>
            {nextOffset !== null && <span>Older records are available below.</span>}
          </div>}

          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/60">
            {!isLoading && !loadError && searchFilteredTransactions.length > 0 ? (
              <div className="divide-y divide-border/30">
                {searchFilteredTransactions.map((entry) => {
                  if (entry.kind === "installment_group") {
                    return <InstallmentHistoryGroup key={entry.key} group={entry} sortMode={sortMode} onSelectTransaction={setSelectedTransaction} onRequestDelete={setDeleteConfirm} />;
                  }

                  const transaction = entry.transaction;
                  const description = transaction.description || transaction.category?.name || (transaction.type === "transfer" ? "Transfer" : "Transaction");
                  return (
                    <div key={entry.key} className="flex flex-col gap-2 px-3 py-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
                      <button
                        type="button"
                        aria-label={`View details for ${description}`}
                        onClick={() => setSelectedTransaction(transaction)}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                          transaction.type === "income"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : transaction.type === "expense"
                              ? "bg-rose-500/10 text-rose-500"
                              : "bg-blue-500/10 text-blue-500"
                        }`} aria-hidden="true">
                          {transaction.type === "income" ? <ArrowDownLeft className="h-5 w-5" /> : transaction.type === "expense" ? <ArrowUpRight className="h-5 w-5" /> : <ArrowLeftRight className="h-5 w-5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold tracking-tight text-foreground sm:text-base">{description}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">{transaction.account?.name || "Unknown wallet"}</span>
                            {transaction.category?.name && <span>{transaction.category.name}</span>}
                            {transaction.type === "transfer" && <span>Transfer</span>}
                            <span>{formatDate(transaction.date)}</span>
                          </span>
                        </span>
                      </button>

                      <div className="flex items-center justify-between gap-3 pl-[3.25rem] sm:justify-end sm:pl-0">
                        <span className={`whitespace-nowrap font-mono text-sm font-bold tabular-nums tracking-tight sm:text-base ${
                          transaction.type === "income" ? "text-green-700 dark:text-primary" : transaction.type === "expense" ? "text-red-700 dark:text-red-400" : "text-blue-700 dark:text-blue-400"
                        }`}>
                          {transaction.type === "income" ? "+" : transaction.type === "expense" ? "−" : ""}{formatCurrency(Number(transaction.amount))}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(transaction)}
                          aria-label="Delete transaction"
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          title="Delete transaction"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : !isLoading && loadError ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">Transaction history could not be loaded.</p>
            ) : !isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ArrowLeftRight className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-foreground">No transactions found</p>
                <p className="text-xs text-muted-foreground mt-0.5 mb-4">
                  {searchQuery.trim() && nextOffset !== null ? "Search covers loaded history. Load more to include older records." : "Try adjusting your filter or search query."}
                </p>
                <Button size="sm" onClick={() => setIsModalOpen(true)} className="h-11 text-sm font-semibold gap-1.5 text-slate-950">
                  <Plus className="h-4 w-4" />
                  Add Transaction
                </Button>
              </div>
            ) : (
              <TableSkeleton rows={8} />
            )}
          </div>

          {searchQuery.trim() && nextOffset !== null && <p className="text-xs text-muted-foreground">Search covers loaded history. Load more to search older records.</p>}
          {nextOffset !== null && !isLoading && (
            <div className="flex flex-col items-center gap-2 pt-2">
              {loadMoreError ? (
                <div className="flex flex-col items-center gap-2 text-center">
                  <p role="alert" className="text-sm text-red-700 dark:text-red-300">{loadMoreError}</p>
                  <button type="button" onClick={() => { void loadMoreTransactions(); }} className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Retry loading more</button>
                </div>
              ) : (
                <button type="button" disabled={isLoadingMore} onClick={() => { void loadMoreTransactions(); }} className="min-h-11 min-w-36 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  {isLoadingMore ? "Loading more..." : "Load more"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog.Root open={!!deleteConfirm} onOpenChange={open => { if (!open && !isDeleting) setDeleteConfirm(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content data-no-press-motion="" onEscapeKeyDown={event => { if (isDeleting) event.preventDefault(); }} onPointerDownOutside={event => { if (isDeleting) event.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-card text-card-foreground p-6 shadow-xl">
            <Dialog.Title className="text-xl font-semibold mb-2">{deleteConfirmIsInstallment ? "Delete this installment?" : "Delete transaction?"}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground mb-6">{deleteConfirmIsInstallment ? "This deletes only this installment and reverses its wallet effects. The other installments in this schedule will remain, and the remaining scheduled amount will update." : "This removes the transaction and reverses its wallet balances and goal effects. The deletion may be refused if the money or carried reservation has already been used."}</Dialog.Description>
            {deleteConfirm && <p className="mb-6 text-sm">{deleteConfirm.description || "Transaction"} · {formatCurrency(Number(deleteConfirm.amount))}</p>}
            <div className="flex gap-3">
              <button type="button" disabled={isDeleting} onClick={() => setDeleteConfirm(null)} className="min-h-11 flex-1 px-4 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Cancel</button>
              <button type="button" onClick={() => { void deleteTransaction(deleteConfirm); }} disabled={isDeleting || !!deletion.pendingTransactionId && deletion.pendingTransactionId !== deleteConfirm?.id} className="min-h-11 flex-1 px-4 bg-red-700 text-white dark:bg-red-400 dark:text-slate-950 rounded-lg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary">{isDeleting ? "Deleting..." : deleteConfirmIsInstallment ? "Delete installment" : "Delete"}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Add Transaction Modal */}
      <AddTransactionModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          requestGeneration.current += 1;
          loadMoreLock.current = false;
          setRefreshKey(prev => prev + 1);
        }}
      />

      {/* Transaction Detail Preview Modal */}
      <TransactionDetailModal
        isOpen={!!selectedTransaction}
        transaction={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        onRequestDelete={(tx) => setDeleteConfirm(tx)}
      />
    </>
  );
}
