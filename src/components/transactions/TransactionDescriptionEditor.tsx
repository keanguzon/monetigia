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

type DescriptionTarget = { transactionId: string | null; groupId: string | null };

type Props = {
  target: DescriptionTarget;
  currentDescription: string | null;
  userId: string | null;
  refreshHistory: () => Promise<unknown>;
  onCancel: () => void;
  onSaved: () => void;
};

function historyGroupBase(rows: TransactionHistoryRow[], groupId: string): { found: boolean; description: string | null; consistent: boolean } {
  const group = groupTransactions(rows).find(entry => entry.kind === "installment_group" && entry.groupId === groupId);
  if (!group || group.kind !== "installment_group") return { found: false, description: null, consistent: false };
  return { found: true, description: group.baseDescription, consistent: group.descriptionState === "consistent" };
}

export default function TransactionDescriptionEditor({ target, currentDescription, userId, refreshHistory, onCancel, onSaved }: Props) {
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
        if (!latest.consistent) throw new Error("The installment descriptions need review before this group can be edited.");
        setExpectedDescription(latest.description);
        setReviewedLatest(latest.description);
      } else if (openedTarget.transactionId) {
        const latest = await loadHistoryTransaction(client, openedOwner, openedTarget.transactionId);
        if (currentOwner.current !== openedOwner) throw new Error("The signed-in account changed before the latest description could be reviewed.");
        if (!latest) throw new Error("This transaction is no longer available in your history.");
        if (latest.installment_group_id) throw new Error("This transaction now belongs to an installment group. Review the group entry before editing it.");
        const description = normalizeTransactionDescription(latest.description);
        setExpectedDescription(description);
        setReviewedLatest(description);
      }
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The latest description could not be loaded.");
    } finally {
      setIsReviewing(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ownerChanged || !userId || overLimit || pending || savedNeedsRefresh) return;
    void write.submit({
      kind: "edit_transaction_description",
      ...openedTarget,
      description: draft,
      expectedDescription,
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
          {reviewError && <p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{reviewError}</p>}
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="min-h-11" disabled={overLimit || !userId || ownerChanged || write.isSaving}>
            {write.isSaving ? "Saving description…" : "Save description"}
          </Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={write.isSaving} onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </section>
  );
}
