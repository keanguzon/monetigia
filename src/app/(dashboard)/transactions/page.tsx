"use client";

import { useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTransactionDelete } from "@/hooks/use-transaction-submit";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, isValidUuid } from "@/lib/utils";
import { Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Trash2, Search, ListFilter } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { DebtCorrectionDialog } from "@/components/transactions/DebtCorrectionDialog";
import { debtCorrectionRecovery } from "@/components/accounts/DebtHistoryGroup";
import { useGoals } from "@/hooks/use-goals";
import { useDebt, useDebtCommand } from "@/hooks/use-debt";
import type { DebtAccountSnapshot, DebtDueRow, DebtSnapshot } from "@/lib/debt/contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import InstallmentHistoryGroup from "@/components/transactions/InstallmentHistoryGroup";
import TransactionDescriptionEditor from "@/components/transactions/TransactionDescriptionEditor";
import { useTransactionDescription } from "@/hooks/use-transaction-description";
import {
  HISTORY_PAGE_SIZE,
  filterHistoryEntries,
  groupTransactions,
  loadHistoryGroup,
  loadHistoryPage,
  loadHistoryTransaction,
  mergeHistoryRows,
  sortHistoryEntries,
  type InstallmentHistoryEntry,
  type TransactionHistoryRow,
  type TransactionHistorySort,
} from "@/lib/transactions/history";

const AddTransactionModal = dynamic(() => import("@/components/transactions/AddTransactionModal"), {
  ssr: false,
});

const TransactionDetailModal = dynamic(() => import("@/components/transactions/TransactionDetailModal"), {
  ssr: false,
});

type DebtState = { account: DebtAccountSnapshot; rows: DebtDueRow[] };
type CorrectionTarget = { accountId: string; groupId: string; groupName: string; selectedIds: string[] };
type CorrectionRoute = { kind: "ordinary" } | { kind: "blocked"; reason: string } | { kind: "correction"; target: CorrectionTarget };
type DescriptionEditorSession = { key: number; target: { transactionId: string | null; groupId: string | null }; currentDescription: string | null };
const knownNonCreditAccountTypes = new Set(["cash", "bank", "e_wallet", "investment"]);

function historyAccountType(row: TransactionHistoryRow): string | null {
  const account = row.account as (typeof row.account & { type?: string | null }) | null | undefined;
  return account?.type ?? null;
}

function completeCreditGroup(group: InstallmentHistoryEntry, snapshot: DebtSnapshot | undefined): DebtState | null {
  if (!snapshot || group.children.length === 0) return null;
  const first = group.children[0];
  const childIds = group.children.map(row => row.id);
  if (new Set(childIds).size !== childIds.length || group.children.some(row =>
    row.account_id !== first.account_id || row.type !== "expense" || historyAccountType(row) !== "credit_card")) return null;
  const account = snapshot.accounts.find(row => row.accountId === first.account_id);
  if (!account) return null;
  const rows = snapshot.rows.filter(row => row.accountId === first.account_id && row.groupId === group.groupId && row.source === "purchase");
  if (rows.length !== childIds.length || rows.some(row => !row.transactionId)) return null;
  const rowIds = new Set(rows.map(row => row.transactionId as string));
  if (rowIds.size !== childIds.length || childIds.some(id => !rowIds.has(id))) return null;
  return { account, rows };
}

function completeStandaloneCredit(row: TransactionHistoryRow, snapshot: DebtSnapshot | undefined): { account: DebtAccountSnapshot; row: DebtDueRow } | null {
  if (!snapshot || row.installment_group_id || row.type !== "expense" || historyAccountType(row) !== "credit_card") return null;
  const matches = snapshot.rows.filter(candidate => candidate.accountId === row.account_id && candidate.transactionId === row.id && candidate.source === "purchase");
  if (matches.length !== 1) return null;
  const debtRow = matches[0];
  const groupRows = snapshot.rows.filter(candidate => candidate.accountId === row.account_id && candidate.groupId === debtRow.groupId && candidate.source === "purchase");
  if (groupRows.length !== 1 || groupRows[0].id !== debtRow.id || groupRows[0].transactionId !== row.id) return null;
  const account = snapshot.accounts.find(candidate => candidate.accountId === row.account_id);
  return account ? { account, row: debtRow } : null;
}


export default function TransactionsPage() {
  const supabase = createClient();
  const sb = supabase as any;
  const { toast } = useToast();
  const goals = useGoals();
  const debt = useDebt(goals.userId);
  const debtCommand = useDebtCommand(goals.userId);
  const descriptionCommand = useTransactionDescription(goals.userId, refreshDescriptionHistory);
  const pendingCorrection = debtCommand.pendingCommand?.kind === "correct_debt_rows" ? debtCommand.pendingCommand : null;
  const pendingAdoption = debtCommand.pendingCommand?.kind === "adopt_opening_debt" ? debtCommand.pendingCommand : null;
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
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const [descriptionEditor, setDescriptionEditor] = useState<DescriptionEditorSession | null>(null);
  const [descriptionReviewError, setDescriptionReviewError] = useState<string | null>(null);
  const [historyRefreshPending, setHistoryRefreshPending] = useState(() => Boolean(goals.userId && debtCorrectionRecovery.refreshOwners.has(goals.userId)));
  const [refreshingDebtViews, setRefreshingDebtViews] = useState(false);
  const requestGeneration = useRef(0);
  const loadedHistoryPageCount = useRef(0);
  const currentOwner = useRef(goals.userId);
  const currentSort = useRef(sortMode);
  currentOwner.current = goals.userId;
  currentSort.current = sortMode;
  const loadMoreLock = useRef(false);
  const retryingCorrection = useRef(false);
  const descriptionReadGeneration = useRef(0);
  const descriptionEditorSequence = useRef(0);
  const descriptionEditorFocus = useRef<HTMLElement | null>(null);
  const lastSelectedTransaction = useRef<TransactionHistoryRow | null>(null);
  const previousOwner = useRef(goals.userId);
  const deletion = useTransactionDelete(loadTransactions);
  const isDeleting = deletion.isDeleting;
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (previousOwner.current === goals.userId) return;
    previousOwner.current = goals.userId;
    descriptionReadGeneration.current += 1;
    descriptionEditorFocus.current = null;
    lastSelectedTransaction.current = null;
    setDescriptionEditor(null);
    setDescriptionReviewError(null);
  }, [goals.userId]);

  function isCurrentHistoryRequest(generation: number, ownerId: string | null, requestedSort: TransactionHistorySort): boolean {
    return generation === requestGeneration.current && currentOwner.current === ownerId && currentSort.current === requestedSort;
  }

  function closeDescriptionEditor() {
    setDescriptionEditor(null);
    if (descriptionCommand.errorCode === "STALE_QUOTE" && !descriptionCommand.pendingCommand && !descriptionCommand.saved) descriptionCommand.reset();
    const focus = () => {
      if (descriptionEditorFocus.current?.isConnected) descriptionEditorFocus.current.focus();
      descriptionEditorFocus.current = null;
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
    else setTimeout(focus, 0);
  }

  function selectTransaction(transaction: TransactionHistoryRow) {
    lastSelectedTransaction.current = transaction;
    setSelectedTransaction(transaction);
  }

  function requestEditDescription(group: InstallmentHistoryEntry) {
    const ownerId = goals.userId;
    if (!ownerId) {
      setDescriptionReviewError("Sign in again before editing this installment description.");
      return;
    }
    if (descriptionCommand.pendingCommand || descriptionCommand.isSaving || descriptionCommand.refreshError) return;
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      descriptionEditorFocus.current = document.activeElement;
    }
    const generation = ++descriptionReadGeneration.current;
    const listGeneration = requestGeneration.current;
    const requestedSort = sortMode;
    setDescriptionReviewError(null);
    void loadHistoryGroup(sb, ownerId, group.groupId)
      .then(rows => {
        if (generation !== descriptionReadGeneration.current || !isCurrentHistoryRequest(listGeneration, ownerId, requestedSort)) return;
        const latestGroup = groupTransactions(rows).find(entry => entry.kind === "installment_group" && entry.groupId === group.groupId);
        if (!latestGroup || latestGroup.kind !== "installment_group") {
          setDescriptionReviewError("This installment group is no longer available in your history.");
          return;
        }
        if (latestGroup.descriptionState !== "consistent") {
          setDescriptionReviewError(latestGroup.descriptionProofState === "needs_review"
            ? "This installment group could not be verified against its original transaction, so its description cannot be edited."
            : "The installment descriptions need review before this group can be edited.");
          return;
        }
        setDescriptionEditor({
          key: ++descriptionEditorSequence.current,
          target: { transactionId: null, groupId: latestGroup.groupId },
          currentDescription: latestGroup.baseDescription,
        });
      })
      .catch(() => {
        if (generation === descriptionReadGeneration.current) setDescriptionReviewError("The installment descriptions could not be loaded. Try again.");
      });
  }

  useEffect(() => {
    if (goals.userId && pendingCorrection) debtCorrectionRecovery.pendingOwners.add(goals.userId);
    setHistoryRefreshPending(Boolean(goals.userId && debtCorrectionRecovery.refreshOwners.has(goals.userId)));
  }, [goals.userId, pendingCorrection]);

  useEffect(() => {
    void loadTransactions().catch(() => {});
  }, [refreshKey, sortMode, goals.userId]);

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
    const ownerId = goals.userId;
    const requestedSort = sortMode;
    loadMoreLock.current = false;
    loadedHistoryPageCount.current = 0;
    setIsLoading(true);
    setIsLoadingMore(false);
    setLoadError(null);
    setLoadMoreError(null);
    setNextOffset(null);
    setTransactions([]);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id || user.id !== ownerId) return;
      const page = await loadHistoryPage(sb, ownerId, requestedSort);
      if (!isCurrentHistoryRequest(generation, ownerId, requestedSort)) return;
      setTransactions(page.rows);
      setNextOffset(page.nextOffset);
      loadedHistoryPageCount.current = 1;
    } catch (error) {
      if (isCurrentHistoryRequest(generation, ownerId, requestedSort)) {
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
      if (isCurrentHistoryRequest(generation, ownerId, requestedSort)) setIsLoading(false);
    }
  }

  async function loadMoreTransactions() {
    if (nextOffset === null || isLoading || isLoadingMore || loadMoreLock.current) return;
    const ownerId = goals.userId;
    const requestedSort = sortMode;
    if (!ownerId) return;
    const offset = nextOffset;
    const generation = requestGeneration.current;
    loadMoreLock.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id || user.id !== ownerId) throw new Error("The signed-in account changed while history was loading.");
      const page = await loadHistoryPage(sb, ownerId, requestedSort, offset);
      if (!isCurrentHistoryRequest(generation, ownerId, requestedSort)) return;
      setTransactions(current => mergeHistoryRows(current, page.rows));
      setNextOffset(page.nextOffset);
      loadedHistoryPageCount.current = Math.max(loadedHistoryPageCount.current, Math.floor(offset / HISTORY_PAGE_SIZE) + 1);
    } catch (error) {
      if (isCurrentHistoryRequest(generation, ownerId, requestedSort)) {
        console.error("Failed to load more transactions", error);
        setLoadMoreError("Older history could not be loaded. Your current entries are still here.");
        toast({
          title: "Failed to load more transactions",
          description: "Older history could not be loaded. Try again.",
          variant: "destructive",
        });
      }
    } finally {
      if (isCurrentHistoryRequest(generation, ownerId, requestedSort)) {
        loadMoreLock.current = false;
        setIsLoadingMore(false);
      }
    }
  }

  async function refreshLoadedHistory(): Promise<boolean> {
    const ownerId = goals.userId;
    if (!ownerId) throw new Error("Sign in to refresh transaction history.");
    const requestedSort = sortMode;
    const targetPageCount = Math.max(1, loadedHistoryPageCount.current);
    const selectedTransactionId = selectedTransaction?.id ?? null;
    const savedTarget = lastSelectedTransaction.current && descriptionCommand.saved?.transactionIds.includes(lastSelectedTransaction.current.id)
      ? lastSelectedTransaction.current
      : null;
    const selectedGroupId = descriptionEditor?.target.groupId
      ?? selectedTransaction?.installment_group_id
      ?? descriptionCommand.pendingCommand?.groupId
      ?? savedTarget?.installment_group_id
      ?? null;
    const generation = ++requestGeneration.current;
    loadMoreLock.current = false;
    setIsLoading(true);
    setIsLoadingMore(false);
    setLoadError(null);
    setLoadMoreError(null);

    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || user?.id !== ownerId) throw new Error("The signed-in account changed while history was refreshing.");
      const refreshedRows: TransactionHistoryRow[] = [];
      let next: number | null = null;
      let pagesRead = 0;
      for (let pageIndex = 0; pageIndex < targetPageCount; pageIndex += 1) {
        const offset = pageIndex * HISTORY_PAGE_SIZE;
        const page = await loadHistoryPage(sb, ownerId, requestedSort, offset);
        if (!isCurrentHistoryRequest(generation, ownerId, requestedSort)) return false;
        refreshedRows.splice(0, refreshedRows.length, ...mergeHistoryRows(refreshedRows, page.rows));
        pagesRead += 1;
        next = page.nextOffset;
        if (next === null) break;
      }

      let refreshedDetail: TransactionHistoryRow | null | undefined;
      if (selectedTransactionId) {
        refreshedDetail = await loadHistoryTransaction(sb, ownerId, selectedTransactionId);
        if (!isCurrentHistoryRequest(generation, ownerId, requestedSort)) return false;
      }
      let refreshedGroup: TransactionHistoryRow[] | undefined;
      if (selectedGroupId) {
        refreshedGroup = await loadHistoryGroup(sb, ownerId, selectedGroupId);
        if (!isCurrentHistoryRequest(generation, ownerId, requestedSort)) return false;
      }

      if (!isCurrentHistoryRequest(generation, ownerId, requestedSort)) return false;
      loadedHistoryPageCount.current = pagesRead;
      setTransactions(refreshedRows);
      setNextOffset(next);
      if (selectedTransactionId) {
        lastSelectedTransaction.current = refreshedDetail ?? null;
        setSelectedTransaction(current => current?.id === selectedTransactionId ? refreshedDetail ?? null : current);
      }
      if (selectedGroupId && refreshedGroup) {
        const latestGroup = groupTransactions(refreshedGroup).find(entry => entry.kind === "installment_group" && entry.groupId === selectedGroupId);
        setDescriptionEditor(current => current?.target.groupId === selectedGroupId
          ? { ...current, currentDescription: latestGroup?.kind === "installment_group" && latestGroup.descriptionState === "consistent" ? latestGroup.baseDescription : null }
          : current);
      }
      setDeleteConfirm(null);
      return true;
    } catch (error) {
      if (isCurrentHistoryRequest(generation, ownerId, requestedSort)) {
        setLoadError("The transaction list could not refresh. Try again.");
        console.error("Failed to refresh debt transaction history", error);
      }
      throw error;
    } finally {
      if (isCurrentHistoryRequest(generation, ownerId, requestedSort)) setIsLoading(false);
    }
  }

  async function refreshDescriptionHistory(): Promise<void> {
    const refreshed = await refreshLoadedHistory();
    if (!refreshed) throw new Error("History refresh was superseded by a newer request.");
  }

  async function refreshCorrectionViews() {
    const ownerId = goals.userId;
    if (!ownerId) throw new Error("Sign in to refresh debt views.");
    debtCorrectionRecovery.pendingOwners.add(ownerId);
    debtCorrectionRecovery.refreshOwners.add(ownerId);
    setHistoryRefreshPending(true);
    setRefreshingDebtViews(true);
    try {
      await debt.refresh();
      const refreshed = await refreshLoadedHistory();
      if (!refreshed) throw new Error("History refresh was superseded by a newer request.");
      debtCorrectionRecovery.refreshOwners.delete(ownerId);
      debtCorrectionRecovery.pendingOwners.delete(ownerId);
      setHistoryRefreshPending(false);
      if (!debtCommand.pendingCommand && !debtCommand.isSaving && !debtCommand.refreshError) debtCommand.reset();
    } catch (error) {
      setHistoryRefreshPending(true);
      throw error;
    } finally {
      setRefreshingDebtViews(false);
    }
  }

  useEffect(() => {
    if (!retryingCorrection.current || debtCommand.isSaving) return;
    retryingCorrection.current = false;
    if (!pendingCorrection && debtCommand.saved) void refreshCorrectionViews().catch(() => undefined);
  }, [pendingCorrection, debtCommand.isSaving, debtCommand.saved]);

  function handleSortChange(nextSort: TransactionHistorySort): void {
    if (nextSort === sortMode) return;
    requestGeneration.current += 1;
    loadMoreLock.current = false;
    loadedHistoryPageCount.current = 0;
    setTransactions([]);
    setNextOffset(null);
    setIsLoadingMore(false);
    setLoadError(null);
    setLoadMoreError(null);
    setIsLoading(true);
    setSortMode(nextSort);
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
  const selectionResetKey = JSON.stringify([goals.userId, sortMode, filter, searchQuery]);
  const correctionRefreshNeedsRecovery = historyRefreshPending || Boolean(goals.userId && debtCorrectionRecovery.refreshOwners.has(goals.userId));
  const pendingDescription = descriptionCommand.pendingCommand;
  const descriptionRecovery = Boolean(pendingDescription || descriptionCommand.errorCode === "STALE_QUOTE" || descriptionCommand.saved && descriptionCommand.refreshError);
  const detailOwnsDescriptionRecovery = Boolean(selectedTransaction && (
    pendingDescription?.groupId && selectedTransaction.installment_group_id === pendingDescription.groupId
    || pendingDescription?.transactionId && selectedTransaction.id === pendingDescription.transactionId
    || descriptionCommand.saved?.transactionIds.includes(selectedTransaction.id)
  ));
  const showPageDescriptionEditor = Boolean(descriptionEditor || descriptionRecovery && !detailOwnsDescriptionRecovery);

  function correctionRoute(transaction: TransactionHistoryRow): CorrectionRoute {
    if (transaction.type !== "expense") return { kind: "ordinary" };
    const accountType = historyAccountType(transaction);
    if (accountType === null) return { kind: "blocked", reason: "The wallet type for this expense is unavailable. Refresh wallet details before deleting it." };
    if (accountType !== "credit_card") {
      if (!knownNonCreditAccountTypes.has(accountType)) return { kind: "blocked", reason: "The wallet type for this expense is unavailable. Refresh wallet details before deleting it." };
      if (transaction.installment_group_id) {
        const group = historyEntries.find(entry => entry.kind === "installment_group" && entry.groupId === transaction.installment_group_id);
        if (!group || group.kind !== "installment_group" || group.children.some(child =>
          child.type !== "expense" || child.account_id !== transaction.account_id || !knownNonCreditAccountTypes.has(historyAccountType(child) ?? ""))) {
          return { kind: "blocked", reason: "This installment group has incomplete wallet details. Refresh history before deleting it." };
        }
      }
      return { kind: "ordinary" };
    }
    if (pendingCorrection || pendingAdoption) return { kind: "blocked", reason: "Resolve the saved debt request before starting another correction." };
    if (debt.isLoading || debt.error || !debt.snapshot) return { kind: "blocked", reason: "Debt details are unavailable. Refresh the debt views before correcting this credit purchase." };

    let account: DebtAccountSnapshot | undefined;
    let groupId = "";
    let selectedRow: DebtDueRow | undefined;
    let groupName = "";
    if (transaction.installment_group_id) {
      const group = historyEntries.find(entry => entry.kind === "installment_group" && entry.groupId === transaction.installment_group_id);
      if (!group || group.kind !== "installment_group") return { kind: "blocked", reason: "This installment group is incomplete in the loaded history. Refresh history before correcting it." };
      const matched = completeCreditGroup(group, debt.snapshot);
      if (!matched) return { kind: "blocked", reason: "This credit purchase does not match a complete debt snapshot. Refresh debt details before correcting it." };
      account = matched.account;
      groupId = group.groupId;
      selectedRow = matched.rows.find(row => row.transactionId === transaction.id);
      groupName = group.description || transaction.description || "Credit purchase";
    } else {
      const matched = completeStandaloneCredit(transaction, debt.snapshot);
      if (!matched) return { kind: "blocked", reason: "This credit purchase does not match a complete debt snapshot. Refresh debt details before correcting it." };
      account = matched.account;
      groupId = matched.row.groupId;
      selectedRow = matched.row;
      groupName = transaction.description || transaction.category?.name || "Credit purchase";
    }

    if (!account || !selectedRow) return { kind: "blocked", reason: "This credit purchase has no matching debt row. Refresh debt details before correcting it." };
    if (account.reconciliation !== "balanced") return { kind: "blocked", reason: "This wallet needs debt reconciliation review before the purchase can be corrected." };
    if (selectedRow.remainingAmount === "0.00") return { kind: "blocked", reason: "This purchase has no remaining unpaid amount. Paid or corrected credit purchases cannot be deleted here." };
    return { kind: "correction", target: { accountId: account.accountId, groupId, groupName, selectedIds: [selectedRow.id] } };
  }

  function requestDelete(transaction: TransactionHistoryRow) {
    const route = correctionRoute(transaction);
    if (route.kind === "correction") {
      setCorrectionTarget(route.target);
      return;
    }
    if (route.kind === "blocked") {
      toast({ title: "Credit purchase cannot be corrected", description: route.reason, variant: "destructive" });
      return;
    }
    setDeleteConfirm(transaction);
  }

  const deleteDisabledReason = selectedTransaction ? (() => {
    const route = correctionRoute(selectedTransaction);
    return route.kind === "blocked" ? route.reason : null;
  })() : null;

  function retryPendingCorrection() {
    if (!pendingCorrection || debtCommand.isSaving || retryingCorrection.current) return;
    retryingCorrection.current = true;
    void debtCommand.retry();
  }

  const deleteConfirmIsInstallment = !!deleteConfirm?.installment_group_id;

  return (
    <>
      {pendingCorrection && <div data-no-press-motion="" role="alert" className="mb-4 space-y-2 text-sm text-red-700 dark:text-red-300">
        <p>This debt correction is unconfirmed. Retry the original saved request before starting another correction.</p>
        {debtCommand.error && <p>{debtCommand.error}</p>}
        <Button variant="outline" className="min-h-11" disabled={debtCommand.isSaving} onClick={retryPendingCorrection}>{debtCommand.isSaving ? "Retrying correction…" : "Retry same correction"}</Button>
      </div>}
      {correctionRefreshNeedsRecovery && <div data-no-press-motion="" role="alert" className="mb-4 space-y-2 text-sm text-red-700 dark:text-red-300">
        <p>A debt correction saved, but some views could not refresh. Refresh the debt schedule and transaction history before continuing.</p>
        <Button variant="outline" className="min-h-11" disabled={refreshingDebtViews} onClick={() => { void refreshCorrectionViews().catch(() => undefined); }}>{refreshingDebtViews ? "Refreshing views…" : "Refresh views"}</Button>
      </div>}
      {descriptionReviewError && <p data-no-press-motion="" role="alert" className="mb-4 text-sm text-amber-800 dark:text-amber-200">{descriptionReviewError}</p>}
      {showPageDescriptionEditor && <div className="mb-4">
        <TransactionDescriptionEditor
          key={descriptionEditor?.key ?? `description-recovery-${goals.userId ?? "signed-out"}`}
          target={descriptionEditor?.target ?? { transactionId: null, groupId: null }}
          currentDescription={descriptionEditor?.currentDescription ?? null}
          userId={goals.userId}
          refreshHistory={refreshDescriptionHistory}
          onCancel={closeDescriptionEditor}
          onSaved={closeDescriptionEditor}
        />
      </div>}
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
            <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 lg:flex-none lg:gap-2">
                {(["all", "expense", "income", "transfer"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFilter(type)}
                    className={`min-h-11 min-w-11 px-1 rounded-lg text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:px-3 lg:text-sm ${
                      filter === type
                        ? "bg-primary text-slate-950"
                        : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <div className="ml-auto shrink-0 lg:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Sort transactions"
                      className="h-11 w-11 min-h-11 min-w-11 shrink-0 bg-card/60 p-0 hover:!transform-none hover:!shadow-none motion-reduce:transition-none"
                    >
                      <ListFilter className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="bottom"
                    align="end"
                    sideOffset={4}
                    collisionPadding={8}
                    className="w-[min(18rem,calc(100vw-2rem))] min-w-0 max-w-[calc(100vw-2rem)] bg-popover motion-reduce:animate-none motion-reduce:transition-none"
                  >
                    <DropdownMenuRadioGroup
                      value={sortMode}
                      onValueChange={value => {
                        if (value === "date_added" || value === "transaction_date") {
                          handleSortChange(value);
                        }
                      }}
                    >
                      <DropdownMenuRadioItem value="date_added" className="min-h-11 items-start py-2">
                        <span className="min-w-0 flex-1 whitespace-normal break-words">Date added (newest first)</span>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="transaction_date" className="min-h-11 items-start py-2">
                        <span className="min-w-0 flex-1 whitespace-normal break-words">Transaction date (newest first)</span>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(12rem,1fr)_auto] lg:w-[min(100%,34rem)]">
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
              <div className="hidden lg:block">
                <label htmlFor="transaction-sort" className="sr-only">Sort transactions</label>
                <select
                  id="transaction-sort"
                  aria-label="Sort transactions"
                  value={sortMode}
                  onChange={event => {
                    const nextSort = event.target.value;
                    if (nextSort === "date_added" || nextSort === "transaction_date") {
                      handleSortChange(nextSort);
                    }
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
                    const debtState = debt.isLoading || debt.error ? null : completeCreditGroup(entry, debt.snapshot);
                    return <InstallmentHistoryGroup key={entry.key} group={entry} sortMode={sortMode} debtState={debtState} selectionResetKey={selectionResetKey} onSelectTransaction={selectTransaction} onRequestDelete={requestDelete} onRequestEditDescription={requestEditDescription} onSaved={refreshCorrectionViews} />;
                  }

                  const transaction = entry.transaction;
                  const description = transaction.description || transaction.category?.name || (transaction.type === "transfer" ? "Transfer" : "Transaction");
                  const route = correctionRoute(transaction);
                  const blockedReason = route.kind === "blocked" ? route.reason : null;
                  return (
                    <div key={entry.key} className="flex flex-col gap-2 px-3 py-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
                      <button
                        type="button"
                        aria-label={`View details for ${description}`}
                        onClick={() => selectTransaction(transaction)}
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
                          onClick={() => requestDelete(transaction)}
                          aria-label="Delete transaction"
                          disabled={Boolean(blockedReason)}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          title={blockedReason ?? "Delete transaction"}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      {blockedReason && <p className="break-words pl-[3.25rem] text-xs text-muted-foreground sm:text-right">{blockedReason}</p>}
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
        onRequestDelete={requestDelete}
        deleteDisabledReason={deleteDisabledReason}
        onDescriptionSaved={refreshDescriptionHistory}
      />
      <DebtCorrectionDialog
        open={correctionTarget !== null}
        onClose={() => setCorrectionTarget(null)}
        accountId={correctionTarget?.accountId ?? ""}
        groupId={correctionTarget?.groupId ?? ""}
        groupName={correctionTarget?.groupName ?? "Credit purchase"}
        selectedIds={correctionTarget?.selectedIds ?? []}
        onSaved={refreshCorrectionViews}
      />
    </>
  );
}
