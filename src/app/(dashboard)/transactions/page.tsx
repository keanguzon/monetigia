"use client";

import { useState, useEffect } from "react";
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
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "expense" | "income" | "transfer">("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const deletion = useTransactionDelete(loadTransactions);
  const isDeleting = deletion.isDeleting;
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    void loadTransactions().catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (!deletion.savedTransactionId) return;
    setDeleteConfirm(null);
    setTransactions(current => current.filter(transaction => transaction.id !== deletion.savedTransactionId));
  }, [deletion.savedTransactionId]);

  const deleteTransaction = async (transaction: any) => {
    if (!transaction?.id || !isValidUuid(transaction.id)) {
      toast({ title: "Cannot delete transaction", description: "This transaction could not be identified.", variant: "destructive" });
      return;
    }
    await deletion.remove(transaction.id);
  };

  async function loadTransactions() {
    setIsLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.id) {

      const { data, error } = await sb
        .from("transactions")
        .select(
          "id, user_id, account_id, category_id, goal_id, type, amount, description, date, transfer_to_account_id, created_at, category:categories(id,name,color), account:accounts!account_id(id,name,type), transfer_to_account:accounts!transfer_to_account_id(id,name,type)"
        )
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Failed to load transactions", error);
        toast({
          title: "Failed to load transactions",
          description: "The transaction list could not refresh. Try refreshing the page.",
          variant: "destructive",
        });
        setIsLoading(false);
        throw new Error("The transaction list could not refresh.");
      } else {
        setTransactions(data || []);
      }
    }
    setIsLoading(false);
  };

  const filteredTransactions =
    filter === "all" ? transactions : transactions.filter((t) => t.type === filter);

  const filterLabel =
    filter === "all"
      ? "All"
      : filter === "expense"
        ? "Expense"
        : filter === "income"
          ? "Income"
          : "Transfer";

  const searchFilteredTransactions = filteredTransactions.filter((t) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      (t.description?.toLowerCase().includes(query)) ||
      (t.category?.name?.toLowerCase().includes(query)) ||
      (t.amount?.toString().includes(query)) ||
      (t.account?.name?.toLowerCase().includes(query)) ||
      (t.transfer_to_account?.name?.toLowerCase().includes(query))
    );
  });

  return (
    <>
      {deletion.error && <div role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300 space-y-2"><p>{deletion.error}</p>{deletion.pendingTransactionId && <button type="button" disabled={isDeleting} onClick={() => { void deletion.remove(deletion.pendingTransactionId!); }} className="min-h-11 px-4 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Retry same deletion</button>}</div>}
      {deletion.savedTransactionId && <p role="status" className="mb-4 text-sm">{deletion.refreshError ? "Transaction deleted. Some views could not refresh. Refresh the page; do not delete it again." : "Transaction deleted and wallet balances updated."}</p>}
      <div className="space-y-6">
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
              className="h-8 text-xs font-semibold gap-1.5 w-full sm:w-auto shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Transaction</span>
            </Button>
          </div>

          {/* Filter Chips & Search Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              {(["all", "expense", "income", "transfer"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilter(type)}
                  className={`h-7 px-3 rounded-lg text-xs font-medium capitalize transition-all ${
                    filter === type
                      ? "bg-emerald-700 text-white dark:bg-emerald-400 dark:text-slate-950 shadow-xs"
                      : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search transactions..."
                className="pl-8 h-8 text-xs bg-card/60"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Hallmark F3 Tabular Spec Sheet Ledger */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span>
              Showing {searchFilteredTransactions.length} {filterLabel.toLowerCase()}{" "}
              {searchFilteredTransactions.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden">
            {!isLoading && searchFilteredTransactions && searchFilteredTransactions.length > 0 ? (
              <div className="divide-y divide-border/30">
                {searchFilteredTransactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    onClick={() => setSelectedTransaction(transaction)}
                    className="flex items-center justify-between px-4 py-3.5 sm:px-5 sm:py-4 hover:bg-muted/30 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 pr-3">
                      <div
                        className={`p-2.5 rounded-lg shrink-0 ${
                          transaction.type === "income"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : transaction.type === "expense"
                              ? "bg-rose-500/10 text-rose-500"
                              : "bg-blue-500/10 text-blue-500"
                        }`}
                      >
                        {transaction.type === "income" ? (
                          <ArrowDownLeft className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
                        ) : transaction.type === "expense" ? (
                          <ArrowUpRight className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
                        ) : (
                          <ArrowLeftRight className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm sm:text-base font-semibold text-foreground truncate tracking-tight">
                          {transaction.description || transaction.category?.name || (transaction.type === "transfer" ? "Transfer" : "Transaction")}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground truncate mt-0.5">
                          <span className="font-medium text-foreground/80">{transaction.account?.name}</span>
                          {transaction.category?.name && (
                            <>
                              <span>•</span>
                              <span>{transaction.category.name}</span>
                            </>
                          )}
                          {transaction.type === "transfer" && (
                            <>
                              <span>•</span>
                              <span>Transfer</span>
                            </>
                          )}
                          <span>•</span>
                          <span className="font-mono">{formatDate(transaction.date)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      <div className="text-right">
                        <span
                          className={`text-sm sm:text-base font-bold font-mono tabular-nums tracking-tight ${
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(transaction);
                        }}
                        aria-label="Delete transaction"
                        className="min-h-11 min-w-11 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary transition-opacity p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
                        title={transaction?.id ? "Delete transaction" : ""}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : !isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ArrowLeftRight className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-foreground">No transactions found</p>
                <p className="text-xs text-muted-foreground mt-0.5 mb-4">
                  Try adjusting your filter or search query.
                </p>
                <Button size="sm" onClick={() => setIsModalOpen(true)} className="h-8 text-xs font-semibold gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add Transaction
                </Button>
              </div>
            ) : (
              <TableSkeleton rows={8} />
            )}
          </div>
        </div>
      </div>

      <Dialog.Root open={!!deleteConfirm} onOpenChange={open => { if (!open && !isDeleting) setDeleteConfirm(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content onEscapeKeyDown={event => { if (isDeleting) event.preventDefault(); }} onPointerDownOutside={event => { if (isDeleting) event.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-card text-card-foreground p-6 shadow-xl">
            <Dialog.Title className="text-xl font-semibold mb-2">Delete transaction?</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground mb-6">This removes the transaction and reverses its wallet balances and goal effects. The deletion may be refused if the money or carried reservation has already been used.</Dialog.Description>
            {deleteConfirm && <p className="mb-6 text-sm">{deleteConfirm.description || "Transaction"} · {formatCurrency(Number(deleteConfirm.amount))}</p>}
            <div className="flex gap-3">
              <button type="button" disabled={isDeleting} onClick={() => setDeleteConfirm(null)} className="min-h-11 flex-1 px-4 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Cancel</button>
              <button type="button" onClick={() => { void deleteTransaction(deleteConfirm); }} disabled={isDeleting || !!deletion.pendingTransactionId && deletion.pendingTransactionId !== deleteConfirm?.id} className="min-h-11 flex-1 px-4 bg-red-700 text-white dark:bg-red-400 dark:text-slate-950 rounded-lg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary">{isDeleting ? "Deleting..." : "Delete"}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Add Transaction Modal */}
      <AddTransactionModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
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
