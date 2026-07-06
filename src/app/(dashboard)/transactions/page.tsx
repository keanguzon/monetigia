"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, isValidUuid } from "@/lib/utils";
import { Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Trash2, Search } from "lucide-react";
import Tooltip from "@/components/ui/tooltip";
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadTransactions();
  }, [refreshKey]);

  const deleteTransaction = async (transaction: any) => {
    setIsDeleting(true);
    try {
      if (!transaction?.id || !isValidUuid(transaction.id)) {
        toast({ title: "Error", description: "Invalid transaction id", variant: "destructive" });
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast({ title: "Not signed in", description: "You must be signed in to delete transactions", variant: "destructive" });
        return;
      }

      const { error: deleteError } = await sb.rpc('delete_transaction_atomic', {
        p_transaction_id: transaction.id,
        p_user_id: user.id
      });

      if (deleteError) {
        toast({ title: "Error", description: deleteError.message, variant: "destructive" });
        return;
      }

      toast({ title: "Transaction deleted", description: "Transaction and balance have been reverted." });
      setDeleteConfirm(null);
      setRefreshKey(prev => prev + 1);
    } catch (err) {
      toast({ title: "Error", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const loadTransactions = async () => {
    setIsLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.id) {

      const { data, error } = await sb
        .from("transactions")
        .select(
          "id, user_id, account_id, category_id, type, amount, description, date, transfer_to_account_id, created_at, category:categories(id,name,color), account:accounts!account_id(id,name,type), transfer_to_account:accounts!transfer_to_account_id(id,name,type)"
        )
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Failed to load transactions", error);
        toast({
          title: "Failed to load transactions",
          description: error.message,
          variant: "destructive",
        });
        setTransactions([]);
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
      <div className="space-y-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Transactions</h2>
            <p className="text-muted-foreground">
              View and manage your transactions
            </p>
          </div>

          {/* Filter and Add buttons - stacked on mobile, inline on desktop */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={filter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("all")}
              >
                All
              </Button>
              <Button
                variant={filter === "expense" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("expense")}
              >
                Expense
              </Button>
              <Button
                variant={filter === "income" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("income")}
              >
                Income
              </Button>
              <Button
                variant={filter === "transfer" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter("transfer")}
              >
                Transfer
              </Button>
            </div>
            <div className="flex flex-1 items-center space-x-2 sm:max-w-xs ml-auto w-full sm:w-auto">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search transactions..."
                  className="pl-8 h-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <Button onClick={() => setIsModalOpen(true)} className="w-full sm:w-auto mt-2 sm:mt-0">
              <Plus className="mr-2 h-4 w-4" />
              Add Transaction
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>Your complete transaction history</CardDescription>
            <div className="pt-2 text-sm text-muted-foreground">
              Showing: <span className="font-medium text-foreground">{filterLabel}</span>
            </div>
          </CardHeader>
          <CardContent>
            {!isLoading && searchFilteredTransactions && searchFilteredTransactions.length > 0 ? (
              <div className="space-y-4">
                {searchFilteredTransactions.map((transaction, index) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-4 rounded-lg border gap-3 transition-all duration-200 hover:scale-[1.01] hover:shadow-md"
                  >
                    <div
                      onClick={() => setSelectedTransaction(transaction)}
                      className="flex items-center space-x-4 flex-1 min-w-0 cursor-pointer hover:bg-accent/50 transition-colors rounded-lg -m-2 p-2"
                    >
                      <div
                        className={`p-3 rounded-full transition-all duration-200 flex-shrink-0 ${transaction.type === "income"
                            ? "bg-green-500/10"
                            : transaction.type === "expense"
                              ? "bg-red-500/10"
                              : "bg-blue-500/10"
                          }`}
                      >
                        {transaction.type === "income" ? (
                          <ArrowDownLeft className="h-5 w-5 text-green-500" />
                        ) : transaction.type === "expense" ? (
                          <ArrowUpRight className="h-5 w-5 text-red-500" />
                        ) : (
                          <ArrowLeftRight className="h-5 w-5 text-blue-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {transaction.description || transaction.category?.name || (transaction.type === "transfer" ? "Transfer" : "Transaction")}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground truncate">
                          <span>{transaction.account?.name}</span>
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
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-semibold text-sm sm:text-base whitespace-nowrap ${transaction.type === "income"
                              ? "text-green-500"
                              : transaction.type === "expense"
                                ? "text-red-500"
                                : "text-blue-500"
                            }`}
                        >
                          {transaction.type === "income" ? "+" : transaction.type === "expense" ? "-" : ""}
                          {formatCurrency(Number(transaction.amount))}
                        </p>
                        <p className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(transaction.date)}
                        </p>
                      </div>
                    </div>
                    <Tooltip content={transaction?.id ? "Delete transaction\nRevert balances" : "Cannot delete this transaction"}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(transaction);
                        }}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-950 rounded-lg transition-colors text-red-500 hover:text-red-700 flex-shrink-0"
                        title={transaction?.id ? "Delete transaction" : ""}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            ) : !isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <ArrowLeftRight className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-lg font-medium">No transactions found</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Try changing the filter or add a transaction
                </p>
                <Button onClick={() => setIsModalOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Transaction
                </Button>
              </div>
            ) : (
              <TableSkeleton rows={8} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl animate-in slide-in-from-bottom-4 duration-300 m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-2 text-red-500">Delete Transaction?</h3>
              <p className="text-muted-foreground mb-6">
                This will remove the transaction and revert the balance. This action cannot be undone.
              </p>
              <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg mb-6 text-sm">
                <p className="font-medium">{deleteConfirm.description || deleteConfirm.category?.name || "Transaction"}</p>
                <p className="text-muted-foreground">{formatCurrency(Number(deleteConfirm.amount), currency)} • {formatDate(deleteConfirm.date)}</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2 border rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteTransaction(deleteConfirm)}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
