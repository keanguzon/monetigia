"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  groupTransactions,
  loadHistoryGroup,
  loadHistoryTransaction,
  type TransactionHistoryRow,
} from "@/lib/transactions/history";
import { normalizeTransactionDescription } from "@/lib/transactions/description";
import { useTransactionDescription } from "@/hooks/use-transaction-description";
import { formatCurrency } from "@/lib/utils";

type DescriptionTarget = { transactionId: string | null; groupId: string | null };

type Props = {
  target: DescriptionTarget;
  currentDescription: string | null;
  userId: string | null;
  refreshHistory: () => Promise<unknown>;
  onCancel: () => void;
  onSaved: () => void;
  transaction?: TransactionHistoryRow;
};

function historyGroupBase(rows: TransactionHistoryRow[], groupId: string): { found: boolean; description: string | null; consistent: boolean; proofNeedsReview: boolean } {
  const group = groupTransactions(rows).find(entry => entry.kind === "installment_group" && entry.groupId === groupId);
  if (!group || group.kind !== "installment_group") return { found: false, description: null, consistent: false, proofNeedsReview: false };
  return { found: true, description: group.baseDescription, consistent: group.descriptionState === "consistent", proofNeedsReview: group.descriptionProofState === "needs_review" };
}

export default function TransactionDescriptionEditor({ target, currentDescription, userId, refreshHistory, onCancel, onSaved, transaction: initialTransaction }: Props) {
  const write = useTransactionDescription(userId, refreshHistory);
  const currentOwner = useRef(userId);
  currentOwner.current = userId;
  const [openedTarget] = useState<DescriptionTarget>(() => write.pendingCommand
    ? { transactionId: write.pendingCommand.transactionId, groupId: write.pendingCommand.groupId }
    : { ...target });
  const [openedOwner] = useState<string | null>(() => userId);
  const [draft, setDraft] = useState(() => write.pendingCommand ? write.pendingCommand.description ?? "" : currentDescription ?? "");
  const [expectedDescription, setExpectedDescription] = useState(() => write.pendingCommand
    ? normalizeTransactionDescription(write.pendingCommand.expectedDescription)
    : normalizeTransactionDescription(currentDescription));
  const [reviewedLatest, setReviewedLatest] = useState<string | null | undefined>(undefined);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [transaction, setTransaction] = useState(initialTransaction);
  const [openedMetadata] = useState(write.pendingCommand?.metadata);
  const [editedDate, setEditedDate] = useState(openedMetadata?.date ?? (initialTransaction?.installment_group_id ? initialTransaction.purchase_date ?? "" : initialTransaction?.date ?? ""));
  const [categoryId, setCategoryId] = useState(openedMetadata?.categoryId ?? initialTransaction?.category_id ?? "");
  const [expectedMetadata, setExpectedMetadata] = useState(() => ({ date: openedMetadata?.expectedDate ?? (initialTransaction?.installment_group_id ? initialTransaction.purchase_date ?? null : initialTransaction?.date ?? null), categoryId: openedMetadata?.expectedCategoryId ?? initialTransaction?.category_id ?? null }));
  const [reviewedMetadata, setReviewedMetadata] = useState<{ date: string | null; categoryId: string | null } | null>(null);
  const editsMetadata = Boolean(initialTransaction || openedMetadata);
  useEffect(() => {
    if (!openedMetadata || initialTransaction || !openedOwner) return;
    let cancelled = false;
    void (async () => {
      try {
        const client = createClient() as any;
        const rows = openedTarget.groupId ? await loadHistoryGroup(client, openedOwner, openedTarget.groupId) : [];
        const row = openedTarget.groupId ? rows[0] : await loadHistoryTransaction(client, openedOwner, openedTarget.transactionId!);
        if (!row) throw new Error("Transaction is no longer available.");
        if (!cancelled && currentOwner.current === openedOwner) setTransaction(openedTarget.groupId ? { ...row, amount: rows.reduce((sum, item) => sum + Number(item.amount), 0) } : row);
      } catch { if (!cancelled) setCategoryError("Transaction details could not load. Close and try again."); }
    })();
    return () => { cancelled = true; };
  }, [openedOwner, openedTarget.groupId, openedTarget.transactionId]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(Boolean(transaction));
  useEffect(() => {
    if (!transaction || !userId) return;
    let cancelled = false;
    setCategoriesLoading(true);
    void (async () => {
      try {
        const { data, error } = await createClient().from("categories").select("id,name,type,user_id,is_default");
        if (error) throw error;
        if (!cancelled) setCategories((data ?? []).filter(category => category.type === transaction.type && (category.user_id === userId || category.user_id === null && category.is_default === true)));
      } catch { if (!cancelled) setCategoryError("Categories could not load. Close and try again."); }
      finally { if (!cancelled) setCategoriesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [transaction?.id, userId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handledSavedId = useRef<string | null>(write.saved?.operationId ?? null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (write.saved && !write.refreshError && !write.pendingCommand && !write.isSaving) write.reset();
  }, [write.isSaving, write.pendingCommand, write.refreshError, write.reset, write.saved]);

  useEffect(() => {
    if (!write.saved || write.refreshError || write.pendingCommand || write.isSaving) return;
    if (handledSavedId.current === write.saved.operationId) return;
    handledSavedId.current = write.saved.operationId;
    onSaved();
  }, [onSaved, write.isSaving, write.pendingCommand, write.refreshError, write.saved]);

  useEffect(() => {
    if (!write.pendingCommand && !write.refreshError) textareaRef.current?.focus();
  }, []);

  const pending = write.pendingCommand;
  const savedNeedsRefresh = Boolean(write.saved && write.refreshError && !pending);
  const hasOpenedTarget = Boolean(openedTarget.transactionId || openedTarget.groupId);
  if (!pending && !savedNeedsRefresh && !hasOpenedTarget) return null;

  const draftLength = Array.from(draft).length;
  const pendingLength = pending ? Array.from(pending.description ?? "").length : draftLength;
  const overLimit = pending ? pendingLength > 500 : draftLength > 500;
  const ownerChanged = userId !== openedOwner;
  const visibleDraft = pending ? pending.description ?? "" : draft;

  async function reviewLatestDescription() {
    if (!openedOwner || ownerChanged || isReviewing) return;
    setIsReviewing(true);
    setReviewError(null);
    setReviewedLatest(undefined);
    try {
      await refreshHistory();
      if (currentOwner.current !== openedOwner) throw new Error("The signed-in account changed before the latest description could be reviewed.");
      const client = createClient() as any;
      if (openedTarget.groupId) {
        const rows = await loadHistoryGroup(client, openedOwner, openedTarget.groupId);
        if (currentOwner.current !== openedOwner) throw new Error("The signed-in account changed before the latest description could be reviewed.");
        const latest = historyGroupBase(rows, openedTarget.groupId);
        if (!latest.found) throw new Error("This installment group is no longer available in your history.");
        if (!latest.consistent) throw new Error(latest.proofNeedsReview
          ? "This installment group could not be verified against its original transaction. Review history before editing it."
          : "The installment descriptions need review before this group can be edited.");
        setExpectedDescription(latest.description);
        setReviewedLatest(latest.description);
        if (editsMetadata && rows[0]) { const metadata = { date: rows[0].purchase_date ?? null, categoryId: rows[0].category_id ?? null }; setExpectedMetadata(metadata); setReviewedMetadata(metadata); }
      } else if (openedTarget.transactionId) {
        const latest = await loadHistoryTransaction(client, openedOwner, openedTarget.transactionId);
        if (currentOwner.current !== openedOwner) throw new Error("The signed-in account changed before the latest description could be reviewed.");
        if (!latest) throw new Error("This transaction is no longer available in your history.");
        if (latest.installment_group_id) throw new Error("This transaction now belongs to an installment group. Review the group entry before editing it.");
        const description = normalizeTransactionDescription(latest.description);
        setExpectedDescription(description);
        setReviewedLatest(description);
        if (editsMetadata) { const metadata = { date: latest.date, categoryId: latest.category_id ?? null }; setExpectedMetadata(metadata); setReviewedMetadata(metadata); }
      }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The latest description could not be loaded.");
    } finally {
      setIsReviewing(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ownerChanged || !userId || overLimit || pending || savedNeedsRefresh || editsMetadata && (!transaction || !editedDate || categoriesLoading || categoryError)) return;
    void write.submit({
      kind: "edit_transaction_description",
      ...openedTarget,
      description: draft,
      expectedDescription,
      ...(editsMetadata ? { metadata: { date: editedDate, categoryId: categoryId || null, expectedDate: expectedMetadata.date, expectedCategoryId: expectedMetadata.categoryId } } : {}),
    });
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (!pending && !savedNeedsRefresh && !write.isSaving) onCancel();
  }

  if (savedNeedsRefresh) {
    return (
      <section data-no-press-motion="" className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4" aria-label="Description refresh recovery">
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">Description saved, but some views could not refresh. Refresh views before starting another edit.</p>
        {write.error && <p className="text-sm text-muted-foreground">{write.error}</p>}
        <Button type="button" variant="outline" className="min-h-11" onClick={() => { void write.refresh(); }}>Refresh views</Button>
      </section>
    );
  }

  if (pending) {
    return (
      <section data-no-press-motion="" className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4" aria-label="Unconfirmed description edit">
        <p role={write.isSaving ? "status" : "alert"} className="text-sm text-amber-800 dark:text-amber-200">
          {write.isSaving ? "Saving this description edit…" : "This description edit is unconfirmed. Retry the same edit before starting another."}
        </p>
        {write.error && <p className="text-sm text-muted-foreground">{write.error}</p>}
        <label className="block space-y-1 text-sm font-medium" htmlFor="pending-transaction-description">
          Unconfirmed description
          <textarea id="pending-transaction-description" readOnly value={visibleDraft} rows={3} className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        </label>
        <p className="text-xs text-muted-foreground">{pendingLength}/500 code points</p>
        <Button type="button" variant="outline" className="min-h-11" disabled={write.isSaving || ownerChanged} onClick={() => { void write.retry(); }}>
          {write.isSaving ? "Saving description…" : "Retry same edit"}
        </Button>
      </section>
    );
  }

  return (
    <section data-no-press-motion="" className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4" aria-label="Edit transaction description">
      <form onSubmit={submit} onKeyDown={handleEditorKeyDown} className="space-y-3">
        {transaction && <>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm font-medium">Transaction Type<input disabled value={transaction.type} className="min-h-11 w-full rounded-lg border bg-muted px-3 capitalize text-muted-foreground opacity-70" /></label>
            <label className="space-y-1 text-sm font-medium">Amount<input disabled value={formatCurrency(Number(transaction.amount))} className="min-h-11 w-full rounded-lg border bg-muted px-3 text-muted-foreground opacity-70" /></label>
          </div>
          <label className="block space-y-1 text-sm font-medium">Account<input disabled value={transaction.account?.name ?? "Wallet"} className="min-h-11 w-full rounded-lg border bg-muted px-3 text-muted-foreground opacity-70" /></label>
          <label className="block space-y-1 text-sm font-medium">{transaction.installment_group_id ? "Purchase date" : "Date"}<input type="date" required value={editedDate} onChange={event => setEditedDate(event.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-background px-3" /></label>
          <label className="block space-y-1 text-sm font-medium">Category<select aria-label="Category" disabled={categoriesLoading || transaction.type === "transfer"} value={categoryId} onChange={event => setCategoryId(event.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-background px-3 disabled:bg-muted">
            <option value="">No category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></label>
          {categoryError && <p role="alert" className="text-sm text-destructive">{categoryError}</p>}
        </>}
        <label htmlFor="transaction-description-draft" className="block space-y-1 text-sm font-medium text-foreground">
          Description
          <textarea
            ref={textareaRef}
            id="transaction-description-draft"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            rows={3}
            aria-describedby="transaction-description-count"
            className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <div id="transaction-description-count" className={`text-xs ${overLimit ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
          {draftLength}/500 code points
        </div>
        {overLimit && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Descriptions must be 500 Unicode code points or fewer.</p>}
        {ownerChanged && <p role="alert" className="text-sm text-red-700 dark:text-red-300">The signed-in account changed. Close this editor and reopen it for the current account.</p>}
        {write.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{write.error}</p>}
        {write.errorCode === "STALE_QUOTE" && <div className="space-y-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={isReviewing || ownerChanged} onClick={() => { void reviewLatestDescription(); }}>
            {isReviewing ? "Loading latest description…" : "Review latest description"}
          </Button>
          {reviewedLatest !== undefined && <p role="status" className="break-words text-sm text-muted-foreground">Latest saved description: {reviewedLatest ?? "No description"}. Review it above, then save your draft if it still fits.</p>}
          {reviewedMetadata && <p role="status" className="text-sm text-muted-foreground">Latest saved date: {reviewedMetadata.date ?? "Not recorded"}. Category: {reviewedMetadata.categoryId ? categories.find(category => category.id === reviewedMetadata.categoryId)?.name ?? "Category unavailable" : "No category"}. Your date and category draft above will replace these values when saved.</p>}
          {reviewError && <p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{reviewError}</p>}
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="min-h-11" disabled={overLimit || !userId || ownerChanged || write.isSaving || Boolean(editsMetadata && (!transaction || categoriesLoading || categoryError))}>
            {write.isSaving ? "Saving…" : editsMetadata ? "Save changes" : "Save description"}
          </Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={write.isSaving} onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </section>
  );
}
