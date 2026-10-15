"use client";

import { useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTransactionDelete } from "@/hooks/use-transaction-submit";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { isValidUuid } from "@/lib/utils";
import { Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Trash2, Search, Pencil, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { DebtCorrectionDialog } from "@/components/transactions/DebtCorrectionDialog";
import { debtCorrectionRecovery } from "@/components/accounts/DebtHistoryGroup";
import { useGoals } from "@/hooks/use-goals";
import { useDebt, useDebtCommand } from "@/hooks/use-debt";
import type { DebtAccountSnapshot, DebtDueRow, DebtSnapshot } from "@/lib/debt/contracts";
import InstallmentHistoryGroup from "@/components/transactions/InstallmentHistoryGroup";
import TransactionDescriptionEditor from "@/components/transactions/TransactionDescriptionEditor";
import { useTransactionDescription } from "@/hooks/use-transaction-description";
import { useLocalToday } from "@/hooks/use-local-today";
import { PeriodBar } from "@/components/transactions/PeriodBar";
import { SpendingSummaryPanel } from "@/components/transactions/SpendingSummaryPanel";
import { type SpendingPeriod } from "@/lib/spending/periods";
import {
  groupTransactions,
  loadHistoryGroup,
  loadHistoryTransaction,
  type InstallmentHistoryEntry,
  type TransactionHistoryRow,
} from "@/lib/transactions/history";

import { useTransactionHistory } from "@/hooks/use-transaction-history";
import { TransactionFilterDialog } from "@/components/transactions/TransactionFilterDialog";
import { TransactionFilterChips } from "@/components/transactions/TransactionFilterChips";
import { TransactionSortControl } from "@/components/transactions/TransactionSortControl";
import { defaultHistoryQuery, historyDateBounds, type HistoryDateSelection, type HistoryFilters } from "@/lib/transactions/history-query";
import { formatHistoryDate, formatHistoryMoney } from "@/lib/transactions/history-format";

const AddTransactionModal = dynamic(() => import("@/components/transactions/AddTransactionModal"), {
  ssr: false,
});

const TransactionDetailModal = dynamic(() => import("@/components/transactions/TransactionDetailModal"), {
  ssr: false,
});

type DebtState = { account: DebtAccountSnapshot; rows: DebtDueRow[] };
type CorrectionTarget = { accountId: string; groupId: string; groupName: string; selectedIds: string[] };
type CorrectionRoute = { kind: "ordinary" } | { kind: "blocked"; reason: string } | { kind: "correction"; target: CorrectionTarget };
type DescriptionEditorSession = { key: number; target: { transactionId: string | null; groupId: string | null }; currentDescription: string | null; transaction?: TransactionHistoryRow };
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [appliedQuery, setAppliedQuery] = useState(defaultHistoryQuery);
  const [dateSelection, setDateSelection] = useState<HistoryDateSelection>({ kind: "all" });
  const history = useTransactionHistory({ ...appliedQuery, ...historyDateBounds(dateSelection) });
  const period = dateSelection.kind === "preset" ? dateSelection.period : null;
  const sortMode = appliedQuery.sort;
  const filter = appliedQuery.type;
  const searchQuery = appliedQuery.search;
  const historyEntries = history.entries;
  const { isLoading, isLoadingMore, nextOffset } = history;
  const loadError = history.error ? historyEntries.length ? "History couldn't refresh." : "History couldn't load." : null;
  const ownerReady = Boolean(goals.userId && goals.userId === history.userId && history.ownerStatus === "authenticated");
  const selectionResetKey = history.queryKey;
  const listFiltersActive = Boolean(filter !== "all" || searchQuery.trim() || appliedQuery.walletIds.length || appliedQuery.categoryIds.length || appliedQuery.includeUncategorized || appliedQuery.minAmount !== null || appliedQuery.maxAmount !== null);
  const amountMode = sortMode.startsWith("amount_") || appliedQuery.minAmount !== null || appliedQuery.maxAmount !== null;
  const today = useLocalToday();
  const [deleteConfirm, setDeleteConfirm] = useState<TransactionHistoryRow | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionHistoryRow | null>(null);
  const [savedDeleteKind, setSavedDeleteKind] = useState<"transaction" | "installment">("transaction");
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const [descriptionEditor, setDescriptionEditor] = useState<DescriptionEditorSession | null>(null);
  const [descriptionReviewError, setDescriptionReviewError] = useState<string | null>(null);
  const [historyRefreshPending, setHistoryRefreshPending] = useState(() => Boolean(goals.userId && debtCorrectionRecovery.refreshOwners.has(goals.userId)));
  const [refreshingDebtViews, setRefreshingDebtViews] = useState(false);
  const requestGeneration = useRef(0);
  const currentOwner = useRef(goals.userId);
  currentOwner.current = goals.userId;
  const currentQueryKey = useRef(history.queryKey);
  currentQueryKey.current = history.queryKey;
  const currentHistoryOwner = useRef(history.userId);
  currentHistoryOwner.current = history.userId;
  const retryingCorrection = useRef(false);
  const descriptionReadGeneration = useRef(0);
  const descriptionEditorSequence = useRef(0);
  const descriptionEditorFocus = useRef<HTMLElement | null>(null);
  const lastSelectedTransaction = useRef<TransactionHistoryRow | null>(null);
  const previousOwner = useRef(goals.userId);
  const deletion = useTransactionDelete(loadTransactions);
  const isDeleting = deletion.isDeleting;

  useEffect(() => {
    if (previousOwner.current === goals.userId) return;
    previousOwner.current = goals.userId;
    descriptionReadGeneration.current += 1;
    descriptionEditorFocus.current = null;
    lastSelectedTransaction.current = null;
    setDescriptionEditor(null);
    setDescriptionReviewError(null);
    setSelectedTransaction(null);
    setDeleteConfirm(null);
    setCorrectionTarget(null);
    setIsModalOpen(false);
    retryingCorrection.current = false;
    setHistoryRefreshPending(Boolean(goals.userId && debtCorrectionRecovery.refreshOwners.has(goals.userId)));
    setRefreshingDebtViews(false);
  }, [goals.userId]);

  function isCurrentHistoryRequest(generation: number, ownerId: string | null, queryKey: string): boolean {
    return generation === requestGeneration.current && currentOwner.current === ownerId && currentHistoryOwner.current === ownerId && currentQueryKey.current === queryKey;
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

  function requestOrdinaryEdit(transaction: TransactionHistoryRow) {
    if (!ownerReady || descriptionCommand.pendingCommand || descriptionCommand.isSaving || descriptionCommand.refreshError) return;
    if (document.activeElement instanceof HTMLElement) descriptionEditorFocus.current = document.activeElement;
    setDescriptionEditor({ key: ++descriptionEditorSequence.current, target: { transactionId: transaction.id, groupId: null }, currentDescription: transaction.description, transaction });
  }

  function requestEditDescription(group: InstallmentHistoryEntry) {
    const ownerId = goals.userId;
    if (!ownerId) {
      setDescriptionReviewError("Sign in again before editing this installment description.");
      return;
    }
    if (!ownerReady || descriptionCommand.pendingCommand || descriptionCommand.isSaving || descriptionCommand.refreshError) return;
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      descriptionEditorFocus.current = document.activeElement;
    }
    const generation = ++descriptionReadGeneration.current;
    const listGeneration = requestGeneration.current;
    const requestedQueryKey = history.queryKey;
    setDescriptionReviewError(null);
    void loadHistoryGroup(sb, ownerId, group.groupId)
      .then(rows => {
        if (generation !== descriptionReadGeneration.current || !isCurrentHistoryRequest(listGeneration, ownerId, requestedQueryKey)) return;
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
          transaction: { ...latestGroup.children[0], amount: latestGroup.children.reduce((sum, row) => sum + Number(row.amount), 0) },
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
    if (deletion.savedTransactionId) setDeleteConfirm(null);
  }, [deletion.savedTransactionId]);

  const deleteTransaction = async (transaction: TransactionHistoryRow | null) => {
    if (!ownerReady) return;
    if (!transaction?.id || !isValidUuid(transaction.id)) {
      toast({ title: "Cannot delete transaction", description: "This transaction could not be identified.", variant: "destructive" });
      return;
    }
    setSavedDeleteKind(transaction.installment_group_id ? "installment" : "transaction");
    await deletion.remove(transaction.id);
  };

  async function loadTransactions() { await history.refresh(); }

  async function loadMoreTransactions() { await history.loadMore().catch(() => undefined); }

  async function refreshLoadedHistory(): Promise<boolean> {
    const ownerId = goals.userId;
    if (!ownerReady || !ownerId) throw new Error("Sign in to refresh transaction history.");
    const requestedQueryKey = history.queryKey;
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
    if (!isCurrentHistoryRequest(generation, ownerId, requestedQueryKey)) throw new Error("Account changed before history refresh.");
    await history.refresh();
    if (!isCurrentHistoryRequest(generation, ownerId, requestedQueryKey)) return false;
    try {
      let refreshedDetail: TransactionHistoryRow | null | undefined;
      if (selectedTransactionId) {
        refreshedDetail = await loadHistoryTransaction(sb, ownerId, selectedTransactionId);
        if (!isCurrentHistoryRequest(generation, ownerId, requestedQueryKey)) return false;
      }
      let refreshedGroup: TransactionHistoryRow[] | undefined;
      if (selectedGroupId) {
        refreshedGroup = await loadHistoryGroup(sb, ownerId, selectedGroupId);
        if (!isCurrentHistoryRequest(generation, ownerId, requestedQueryKey)) return false;
      }

      if (!isCurrentHistoryRequest(generation, ownerId, requestedQueryKey)) return false;
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
      if (isCurrentHistoryRequest(generation, ownerId, requestedQueryKey)) {
        console.error("Failed to refresh debt transaction history", error);
      }
      throw error;
    }
  }

  async function refreshDescriptionHistory(): Promise<void> {
    const refreshed = await refreshLoadedHistory();
    if (!refreshed) throw new Error("History refresh was superseded by a newer request.");
  }

  async function refreshCorrectionViews() {
    const ownerId = goals.userId;
    if (!ownerReady || !ownerId || currentOwner.current !== ownerId || currentHistoryOwner.current !== ownerId) throw new Error("Sign in to refresh debt views.");
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
      if (currentOwner.current === ownerId && currentHistoryOwner.current === ownerId) setHistoryRefreshPending(true);
      throw error;
    } finally {
      if (currentOwner.current === ownerId && currentHistoryOwner.current === ownerId) setRefreshingDebtViews(false);
    }
  }

  useEffect(() => {
    if (!retryingCorrection.current || debtCommand.isSaving) return;
    retryingCorrection.current = false;
    if (!pendingCorrection && debtCommand.saved) void refreshCorrectionViews().catch(() => undefined);
  });

  function handlePeriodChange(nextPeriod: SpendingPeriod | null): void {
    setDateSelection(nextPeriod ? { kind: "preset", period: nextPeriod } : { kind: "all" });
  }

  function applyFilters(filters: HistoryFilters, nextDate: HistoryDateSelection) {
    setAppliedQuery(current => ({ ...current, ...filters, offset: 0 }));
    setDateSelection(nextDate);
  }

  function clearFilters() {
    setAppliedQuery(current => ({ ...defaultHistoryQuery(), sort: current.sort }));
    setDateSelection({ kind: "all" });
  }

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
    if (!ownerReady) return { kind: "blocked", reason: "Account details are refreshing." };
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
    if (!ownerReady || !pendingCorrection || debtCommand.isSaving || retryingCorrection.current) return;
    retryingCorrection.current = true;
    void debtCommand.retry();
  }

  const deleteConfirmIsInstallment = !!deleteConfirm?.installment_group_id;

  return (
    <>
      {ownerReady && pendingCorrection && <div data-no-press-motion="" role="alert" className="mb-4 space-y-2 text-sm text-red-700 dark:text-red-300">
        <p>This debt correction is unconfirmed. Retry the original saved request before starting another correction.</p>
        {debtCommand.error && <p>{debtCommand.error}</p>}
        <Button variant="outline" className="min-h-11" disabled={debtCommand.isSaving} onClick={retryPendingCorrection}>{debtCommand.isSaving ? "Retrying correction…" : "Retry same correction"}</Button>
      </div>}
      {ownerReady && correctionRefreshNeedsRecovery && <div data-no-press-motion="" role="alert" className="mb-4 space-y-2 text-sm text-red-700 dark:text-red-300">
        <p>A debt correction saved, but some views could not refresh. Refresh the debt schedule and transaction history before continuing.</p>
        <Button variant="outline" className="min-h-11" disabled={refreshingDebtViews} onClick={() => { void refreshCorrectionViews().catch(() => undefined); }}>{refreshingDebtViews ? "Refreshing views…" : "Refresh views"}</Button>
      </div>}
      {ownerReady && descriptionReviewError && <p data-no-press-motion="" role="alert" className="mb-4 text-sm text-amber-800 dark:text-amber-200">{descriptionReviewError}</p>}
      {ownerReady && showPageDescriptionEditor && <Dialog.Root open onOpenChange={open => { if (!open && !descriptionCommand.pendingCommand && !descriptionCommand.refreshError) closeDescriptionEditor(); }}>
        <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" /><Dialog.Content data-mobile-nav-blocking="" aria-describedby={undefined} onEscapeKeyDown={event => { if (descriptionCommand.pendingCommand || descriptionCommand.refreshError) event.preventDefault(); }} onPointerDownOutside={event => { if (descriptionCommand.pendingCommand || descriptionCommand.refreshError) event.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-card p-5 text-card-foreground shadow-xl">
        <div className="mb-4 flex items-center justify-between"><Dialog.Title className="text-xl font-semibold">Edit transaction</Dialog.Title><button type="button" aria-label="Close edit transaction" disabled={Boolean(descriptionCommand.pendingCommand || descriptionCommand.refreshError)} onClick={closeDescriptionEditor} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button></div>
        <TransactionDescriptionEditor
          key={descriptionEditor?.key ?? `description-recovery-${goals.userId ?? "signed-out"}`}
          target={descriptionEditor?.target ?? { transactionId: null, groupId: null }}
          currentDescription={descriptionEditor?.currentDescription ?? null}
          transaction={descriptionEditor?.transaction}
          userId={goals.userId}
          refreshHistory={refreshDescriptionHistory}
          onCancel={closeDescriptionEditor}
          onSaved={closeDescriptionEditor}
        />
      </Dialog.Content></Dialog.Portal></Dialog.Root>}
      {ownerReady && deletion.error && <div data-no-press-motion="" role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300 space-y-2"><p>{deletion.error}</p>{deletion.pendingTransactionId && <button type="button" disabled={isDeleting} onClick={() => { void deletion.remove(deletion.pendingTransactionId!); }} className="min-h-11 px-4 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Retry same deletion</button>}</div>}
      {ownerReady && deletion.savedTransactionId && <p role="status" className="mb-4 text-sm">{savedDeleteKind === "installment" ? deletion.refreshError ? "Installment deleted, but some views could not refresh. Refresh the page to check the remaining schedule." : "Installment deleted. Its siblings remain and the remaining scheduled amount has been updated." : deletion.refreshError ? "Transaction deleted. Some views could not refresh. Refresh the page; do not delete it again." : "Transaction deleted and wallet balances updated."}</p>}
      {loadError && <div data-no-press-motion="" role="alert" className="mb-4 flex flex-col items-start gap-2 text-sm text-red-700 dark:text-red-300"><p>{historyEntries.length && nextOffset !== null ? "Older history could not be loaded. Try again." : loadError}</p><button type="button" aria-label={historyEntries.length && nextOffset !== null ? "Retry loading more" : "Retry loading transactions"} onClick={() => { void history.retry().catch(() => {}); }} className="min-h-11 rounded-lg border px-4 focus-visible:ring-2 focus-visible:ring-primary">Retry</button></div>}
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
              disabled={!ownerReady}
              onClick={() => setIsModalOpen(true)}
              className="h-11 text-sm font-semibold gap-1.5 w-full sm:w-auto text-primary-foreground"
            >
              <Plus className="h-4 w-4" />
              <span>Add Transaction</span>
            </Button>
          </div>

          <PeriodBar period={period} today={today} customDateRange={dateSelection.kind === "custom" ? dateSelection : null} onChange={handlePeriodChange} />
          {dateSelection.kind !== "custom" && <SpendingSummaryPanel period={period} today={today} listFiltersActive={listFiltersActive} onAddTransaction={() => setIsModalOpen(true)} />}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 lg:flex-none lg:gap-2">
                {(["all", "expense", "income", "transfer"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAppliedQuery(current => ({ ...current, type }))}
                    className={`min-h-11 min-w-11 px-1 rounded-lg text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:px-3 lg:text-sm ${
                      filter === type
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <TransactionFilterDialog query={history.query} dateSelection={dateSelection} options={history.options} onApply={applyFilters} onClearAll={clearFilters} />
              <TransactionSortControl sort={sortMode} onChange={sort => setAppliedQuery(current => ({ ...current, sort }))} />
            </div>

            <div className="grid grid-cols-1 gap-2 lg:flex-1 lg:max-w-xs">
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  aria-label="Search transactions"
                  placeholder="Search transactions..."
                  className="min-h-11 bg-card/60 pl-10 text-sm"
                  maxLength={120}
                  value={searchQuery}
                  onChange={(e) => setAppliedQuery(current => ({ ...current, search: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>

        <TransactionFilterChips query={history.query} dateSelection={dateSelection} options={history.options} onChange={(query, date) => { setAppliedQuery(query); setDateSelection(date); }} onClearAll={clearFilters} />
        <div className="space-y-2">
          {amountMode && Boolean(history.excludedCurrencyEntryCount) && <p className="text-xs text-muted-foreground">{history.excludedCurrencyEntryCount} non-PHP entries excluded</p>}
          {amountMode && Boolean(history.invalidAmountEntryCount) && <p className="text-xs text-muted-foreground">{history.invalidAmountEntryCount} unavailable amounts excluded</p>}
          {!isLoading && !loadError && history.totalMatchingEntries !== null && <div className="flex flex-col gap-1 px-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Showing {historyEntries.length} of {history.totalMatchingEntries} matches</span>
          </div>}

          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/60">
            {!isLoading && historyEntries.length > 0 ? (
              <div className="divide-y divide-border/30">
                {historyEntries.map((entry) => {
                  if (entry.kind === "installment_group") {
                    const debtState = !ownerReady || debt.isLoading || debt.error ? null : completeCreditGroup(entry, debt.snapshot);
                    return <InstallmentHistoryGroup key={entry.key} group={entry} sortMode={sortMode} debtState={debtState} selectionResetKey={selectionResetKey} matchingRowIds={entry.matchingRowIds} recordedAmount={entry.recordedAmount} currency={entry.currency} transactionDate={entry.transactionDate} showRecordedAmount={amountMode} writesEnabled={ownerReady} periodRange={history.query.start && history.query.end ? { start: history.query.start, end: history.query.end } : null} onSelectTransaction={selectTransaction} onRequestDelete={requestDelete} onRequestEditDescription={requestEditDescription} onSaved={refreshCorrectionViews} />;
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
                            <span>{formatHistoryDate(entry.transactionDate)}</span>
                          </span>
                        </span>
                      </button>

                      <div className="flex items-center justify-between gap-3 pl-[3.25rem] sm:justify-end sm:pl-0">
                        <span className={`whitespace-nowrap text-sm font-semibold tabular-nums sm:text-base ${
                          transaction.type === "income" ? "text-green-700 dark:text-primary" : transaction.type === "expense" ? "text-red-700 dark:text-red-400" : "text-blue-700 dark:text-blue-400"
                        }`}>
                          {entry.recordedAmount === null ? "Unavailable" : `${transaction.type === "income" ? "+" : transaction.type === "expense" ? "−" : ""}${formatHistoryMoney(entry.recordedAmount, entry.currency)}`}
                        </span>
                        <button type="button" aria-label={`Edit transaction for ${description}`} disabled={!ownerReady} onClick={() => requestOrdinaryEdit(transaction)} className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                        <button
                          type="button"
                          onClick={() => requestDelete(transaction)}
                          aria-label="Delete transaction"
                          disabled={Boolean(blockedReason)}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          data-tooltip={blockedReason ?? "Delete transaction"}
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
                  Try adjusting your filters.
                </p>
                <Button size="sm" disabled={!ownerReady} onClick={() => setIsModalOpen(true)} className="h-11 text-sm font-semibold gap-1.5 text-primary-foreground">
                  <Plus className="h-4 w-4" />
                  Add Transaction
                </Button>
              </div>
            ) : (
              <TableSkeleton rows={8} />
            )}
          </div>

          {nextOffset !== null && !isLoading && (
            <div className="flex flex-col items-center gap-2 pt-2">
              {!history.error && <button type="button" disabled={isLoadingMore} onClick={() => { void loadMoreTransactions(); }} className="min-h-11 min-w-36 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {isLoadingMore ? "Loading more..." : "Load more"}
              </button>}
            </div>
          )}
        </div>
      </div>

      <Dialog.Root open={ownerReady && !!deleteConfirm} onOpenChange={open => { if (!open && !isDeleting) setDeleteConfirm(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content data-no-press-motion="" onEscapeKeyDown={event => { if (isDeleting) event.preventDefault(); }} onPointerDownOutside={event => { if (isDeleting) event.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-card text-card-foreground p-6 shadow-xl">
            <Dialog.Title className="text-xl font-semibold mb-2">{deleteConfirmIsInstallment ? "Delete this installment?" : "Delete transaction?"}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground mb-6">{deleteConfirmIsInstallment ? "This deletes only this installment and reverses its wallet effects. The other installments in this schedule will remain, and the remaining scheduled amount will update." : "This removes the transaction and reverses its wallet balances and goal effects. The deletion may be refused if the money or carried reservation has already been used."}</Dialog.Description>
            {deleteConfirm && <p className="mb-6 text-sm">{deleteConfirm.description || "Transaction"} · {formatHistoryMoney(deleteConfirm.amount, historyEntries.find(entry => entry.kind === "transaction" ? entry.transaction.id === deleteConfirm.id : entry.children.some(row => row.id === deleteConfirm.id))?.currency)}</p>}
            <div className="flex gap-3">
              <button type="button" disabled={isDeleting} onClick={() => setDeleteConfirm(null)} className="min-h-11 flex-1 px-4 border rounded-lg focus-visible:ring-2 focus-visible:ring-primary">Cancel</button>
              <button type="button" onClick={() => { void deleteTransaction(deleteConfirm); }} disabled={isDeleting || !!deletion.pendingTransactionId && deletion.pendingTransactionId !== deleteConfirm?.id} className="min-h-11 flex-1 px-4 bg-red-700 text-white dark:bg-red-400 dark:text-slate-950 rounded-lg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary">{isDeleting ? "Deleting..." : deleteConfirmIsInstallment ? "Delete installment" : "Delete"}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Add Transaction Modal */}
      <AddTransactionModal
        isOpen={ownerReady && isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          void history.refresh().catch(() => undefined);
        }}
      />

      {/* Transaction Detail Preview Modal */}
      <TransactionDetailModal
        isOpen={ownerReady && !!selectedTransaction}
        transaction={ownerReady ? selectedTransaction : null}
        onClose={() => setSelectedTransaction(null)}
        onRequestDelete={requestDelete}
        deleteDisabledReason={deleteDisabledReason}
        onDescriptionSaved={refreshDescriptionHistory}
      />
      <DebtCorrectionDialog
        open={ownerReady && correctionTarget !== null}
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
