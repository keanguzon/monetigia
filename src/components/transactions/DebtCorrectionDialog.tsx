"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useGoals } from "@/hooks/use-goals";
import { useDebt, useDebtCommand } from "@/hooks/use-debt";
import type { DebtDueRow, DebtSnapshot } from "@/lib/debt/contracts";
import { toMinorUnits } from "@/lib/goals/summary";

type DebtCorrectionDialogProps = {
  open: boolean;
  onClose: () => void;
  accountId: string;
  groupId: string;
  groupName: string;
  selectedIds: string[];
  onSaved: () => Promise<unknown>;
};

type Review = {
  accountId: string;
  groupId: string;
  rowIds: string[];
  fingerprint: string;
  remainingCents: bigint;
  source: DebtDueRow["source"];
};

type OpenSession = {
  ownerId: string | null;
  accountId: string;
  groupId: string;
  groupName: string;
  selectedIds: string[];
  review: Review | null;
  needsReview: boolean;
};

type ReviewResult = { review: Review } | { error: string };

const pendingHistoryRefreshOwners = new Set<string>();

function totalLabel(cents: bigint): string {
  const absolute = cents < BigInt(0) ? -cents : cents;
  const whole = absolute / BigInt(100);
  const fraction = (absolute % BigInt(100)).toString().padStart(2, "0");
  return `${cents < BigInt(0) ? "-" : ""}${whole}.${fraction}`;
}

function makeReview(snapshot: DebtSnapshot | undefined, accountId: string, groupId: string, rowIds: string[]): ReviewResult {
  if (!snapshot) return { error: "Debt details are not available yet." };
  if (rowIds.length === 0) return { error: "Select at least one installment to correct." };
  if (rowIds.length > 600) return { error: "Select no more than 600 installments per correction." };
  if (new Set(rowIds).size !== rowIds.length) return { error: "The selection contains duplicate installments. Review the selection again." };

  const account = snapshot.accounts.find((entry) => entry.accountId === accountId);
  if (!account) return { error: "This account is no longer in the debt snapshot. Refresh debt details." };
  if (account.reconciliation !== "balanced") return { error: "This account needs debt review before a correction can be confirmed." };

  const rows = rowIds.map((id) => snapshot.rows.find((row) => row.id === id));
  if (rows.some((row) => !row)) return { error: "One or more installments changed or disappeared. Review the updated debt." };
  const selected = rows as DebtDueRow[];
  if (selected.some((row) => row.accountId !== accountId || row.groupId !== groupId)) {
    return { error: "Select installments from one debt group." };
  }
  const source = selected[0].source;
  if (selected.some((row) => row.source !== source)) return { error: "Select installments from one debt source." };

  try {
    const amounts = selected.map((row) => toMinorUnits(row.remainingAmount));
    if (amounts.some((amount) => amount <= 0)) return { error: "Only installments with a positive remaining balance can be corrected." };
    const remainingCents = amounts.reduce((sum, amount) => sum + BigInt(amount), BigInt(0));
    return { review: { accountId, groupId, rowIds: [...rowIds], fingerprint: account.fingerprint, remainingCents, source } };
  } catch {
    return { error: "The remaining amount could not be verified. Refresh debt details." };
  }
}

function sameReview(snapshot: DebtSnapshot | undefined, review: Review): boolean {
  const current = makeReview(snapshot, review.accountId, review.groupId, review.rowIds);
  return "review" in current && current.review.fingerprint === review.fingerprint &&
    current.review.remainingCents === review.remainingCents && current.review.source === review.source;
}

export function DebtCorrectionDialog({ open, onClose, accountId, groupId, groupName, selectedIds, onSaved }: DebtCorrectionDialogProps) {
  const { userId } = useGoals();
  const debt = useDebt(userId);
  const write = useDebtCommand(userId);
  const [session, setSession] = useState<OpenSession | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [onSavedFailed, setOnSavedFailed] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const opening = useRef(false);
  const submittedThisSession = useRef(false);
  const successHandled = useRef(false);
  const submitLocked = useRef(false);
  const retryLocked = useRef(false);

  useEffect(() => {
    if (open && !opening.current) {
      opening.current = true;
      submittedThisSession.current = false;
      successHandled.current = false;
      submitLocked.current = false;
      retryLocked.current = false;
      setRefreshFailed(false);
      setOnSavedFailed(false);
      setRefreshed(false);
      setSession({
        ownerId: userId,
        accountId,
        groupId,
        groupName,
        selectedIds: [...selectedIds],
        review: null,
        needsReview: false,
      });

      if (userId && !pendingHistoryRefreshOwners.has(userId) && write.saved && !write.isSaving && !write.unresolved && !write.pendingCommand && !write.refreshError) {
        write.reset();
      }
    } else if (!open && opening.current) {
      opening.current = false;
      setSession(null);
    }
  }, [open, userId, accountId, groupId, groupName, selectedIds, write.saved, write.isSaving, write.unresolved, write.pendingCommand, write.refreshError, write.reset]);

  const sameOwner = session !== null && session.ownerId !== null && session.ownerId === userId;
  const historyRefreshPending = Boolean(userId && pendingHistoryRefreshOwners.has(userId));
  useEffect(() => {
    if (open && session && session.ownerId !== userId) {
      setSession((current) => current ? { ...current, review: null, needsReview: true } : current);
    }
  }, [open, userId, session?.ownerId]);

  const currentCandidate = useMemo(
    () => session ? makeReview(debt.snapshot, session.accountId, session.groupId, session.selectedIds) : null,
    [debt.snapshot, session],
  );

  useEffect(() => {
    if (!open || !sameOwner || !session || session.review || session.needsReview || !debt.snapshot) return;
    if (currentCandidate && "review" in currentCandidate) {
      setSession((current) => current && !current.review && !current.needsReview ? { ...current, review: currentCandidate.review } : current);
    }
  }, [open, sameOwner, session, debt.snapshot, currentCandidate]);

  const pending = sameOwner ? write.pendingCommand : null;
  const pendingCorrection = pending?.kind === "correct_debt_rows" ? pending : null;
  const pendingAdoption = pending?.kind === "adopt_opening_debt" ? pending : null;
  const stale = Boolean(session?.review && debt.snapshot && !sameReview(debt.snapshot, session.review));
  const localSaved = sameOwner && submittedThisSession.current && write.saved !== null;
  const savedNeedsRecovery = sameOwner && (historyRefreshPending || (write.saved !== null && (Boolean(write.refreshError) || onSavedFailed || refreshFailed)));
  const savedReceiptNeedsRecovery = sameOwner && write.saved !== null && Boolean(write.refreshError);
  const reviewError = currentCandidate && "error" in currentCandidate ? currentCandidate.error : null;
  const busy = refreshing || write.isSaving;

  useEffect(() => {
    if (!open || !sameOwner || !submittedThisSession.current || !write.saved || write.isSaving || successHandled.current) return;
    successHandled.current = true;
    void (async () => {
      try {
        await onSaved();
      } catch {
        if (userId) pendingHistoryRefreshOwners.add(userId);
        setOnSavedFailed(true);
        return;
      }
      if (userId) pendingHistoryRefreshOwners.delete(userId);
      setOnSavedFailed(false);
      if (!write.refreshError) onClose();
    })();
  }, [open, sameOwner, write.saved, write.isSaving, write.refreshError, onSaved, onClose]);

  useEffect(() => {
    if (!open || !sameOwner || !submittedThisSession.current || write.isSaving || write.unresolved || write.saved || !write.error) return;
    setSession((current) => current ? { ...current, review: null, needsReview: true } : current);
    submitLocked.current = false;
  }, [open, sameOwner, write.error, write.isSaving, write.unresolved, write.saved]);

  function close() {
    onClose();
  }

  function renewReview() {
    if (!sameOwner || !session || !currentCandidate || !("review" in currentCandidate) || busy || pending) return;
    setSession((current) => current ? { ...current, review: currentCandidate.review, needsReview: false } : current);
    setRefreshFailed(false);
  }

  async function confirmCorrection() {
    if (submitLocked.current || !sameOwner || !session?.review || !debt.snapshot || debt.isLoading || debt.error || stale || busy || pending || write.unresolved || write.refreshError || savedNeedsRecovery) return;
    if (write.saved && !submittedThisSession.current) return;
    submitLocked.current = true;
    submittedThisSession.current = true;
    successHandled.current = false;
    setRefreshFailed(false);
    setOnSavedFailed(false);
    setRefreshed(false);
    await write.submit({
      kind: "correct_debt_rows",
      accountId: session.review.accountId,
      rowIds: [...session.review.rowIds],
      fingerprint: session.review.fingerprint,
    });
  }

  async function retrySameCorrection() {
    if (retryLocked.current || !sameOwner || !pendingCorrection || write.isSaving || refreshing) return;
    retryLocked.current = true;
    submittedThisSession.current = true;
    successHandled.current = false;
    try {
      await write.retry();
    } finally {
      retryLocked.current = false;
    }
  }

  async function refreshViews() {
    if (!sameOwner || refreshing) return;
    const ownerId = userId;
    setRefreshing(true);
    setRefreshFailed(false);
    setOnSavedFailed(false);
    setRefreshed(false);
    try {
      await debt.refresh();
    } catch {
      setRefreshFailed(true);
      setRefreshing(false);
      return;
    }
    try {
      await onSaved();
      if (ownerId) pendingHistoryRefreshOwners.delete(ownerId);
      write.reset();
      setRefreshed(true);
    } catch {
      if (ownerId) pendingHistoryRefreshOwners.add(ownerId);
      setOnSavedFailed(true);
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }

  const canRenew = Boolean(currentCandidate && "review" in currentCandidate && sameOwner && !busy && !pending && !write.unresolved && !savedNeedsRecovery);
  const canConfirm = Boolean(session?.review && sameOwner && debt.snapshot && !debt.isLoading && !debt.error && !busy && !pending && !write.unresolved && !write.refreshError && !stale && !savedNeedsRecovery);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          data-mobile-nav-blocking=""
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl"
        >
          <header className="border-b border-border p-5">
            <Dialog.Title className="font-heading text-lg font-semibold">Correct remaining debt</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              Remove selected unpaid installments from {session?.groupName ?? groupName}. Recorded payments and cash wallets stay unchanged.
            </Dialog.Description>
          </header>

          <div className="min-h-0 space-y-3 overflow-y-auto p-5">
            {!sameOwner && <p role="alert" className="text-sm">The signed-in account changed. Close this review and reopen it for the current account.</p>}
            {sameOwner && pendingCorrection && (
              <>
                <p role="status" className="text-sm">This correction is unconfirmed. Retry the original correction before starting another review.</p>
                <p className="text-sm tabular-nums">{pendingCorrection.rowIds.length} installments in the saved request.</p>
              </>
            )}
            {sameOwner && pendingAdoption && (
              <p role="status" className="text-sm">Resolve the existing debt save before starting a correction. Close this dialog and return to the debt review.</p>
            )}
            {sameOwner && !pending && write.unresolved && (
              <p role="status" className="text-sm">This debt save is unconfirmed. Resolve the original request before starting another correction.</p>
            )}
            {sameOwner && (debt.isLoading || !debt.snapshot) && !pending && !write.unresolved && (
              <p role="status" className="text-sm">Loading debt details…</p>
            )}
            {sameOwner && debt.error && <p role="alert" className="text-sm">Debt details could not load. Refresh the debt views before reviewing a correction.</p>}
            {sameOwner && session && !session.review && !session.needsReview && !pending && !write.unresolved && !write.saved && reviewError && debt.snapshot && (
              <p role="alert" className="text-sm">{reviewError}</p>
            )}
            {sameOwner && stale && !pending && (
              <p role="alert" className="text-sm">The debt changed after this review. Review the updated amount before confirming.</p>
            )}
            {sameOwner && session?.needsReview && !pending && (
              <p role="alert" className="text-sm">The previous correction was rejected. Review the current debt before confirming again.</p>
            )}
            {sameOwner && session?.review && !stale && !session.needsReview && !pending && !localSaved && !savedNeedsRecovery && (
              <p className="break-words text-sm tabular-nums">
                {session.review.rowIds.length} installments · PHP {totalLabel(session.review.remainingCents)} remaining
              </p>
            )}
            {sameOwner && write.error && !write.unresolved && !localSaved && <p role="alert" className="text-sm">{write.error}</p>}
            {localSaved && (
              <p role="status" className="text-sm">Correction saved. Recorded payments and cash wallets stay unchanged.</p>
            )}
            {savedNeedsRecovery && (
              <p role="alert" className="text-sm">A debt save completed, but some views could not refresh. Refresh views before starting another correction.</p>
            )}
            {refreshed && <p role="status" className="text-sm">Debt views refreshed.</p>}
            {refreshFailed && <p role="alert" className="text-sm">Some debt views could not refresh. Retry refresh before continuing.</p>}
            {sameOwner && !pending && !write.unresolved && write.saved && !write.refreshError && !localSaved && (
              <p role="status" className="text-sm">A previous debt save is ready to clear when you begin a new correction review.</p>
            )}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-border p-5 sm:flex-row sm:justify-end">
            <Button variant="outline" className="min-h-11" onClick={close}>Cancel</Button>
            {pendingCorrection ? (
              <Button className="min-h-11 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-green-950" disabled={write.isSaving || refreshing} onClick={() => void retrySameCorrection()}>
                {write.isSaving ? "Retrying correction…" : "Retry same correction"}
              </Button>
            ) : savedNeedsRecovery || savedReceiptNeedsRecovery ? (
              <Button className="min-h-11 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-green-950" disabled={refreshing} onClick={() => void refreshViews()}>
                {refreshing ? "Refreshing views…" : "Refresh views"}
              </Button>
            ) : sameOwner && (stale || session?.needsReview || (!session?.review && Boolean(session) && Boolean(debt.snapshot) && !reviewError)) ? (
              <Button className="min-h-11 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-green-950" disabled={!canRenew} onClick={renewReview}>Review updated debt</Button>
            ) : sameOwner && session?.review && !localSaved ? (
              <Button className="min-h-11 bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-green-950" disabled={!canConfirm} onClick={() => void confirmCorrection()}>
                {write.isSaving ? "Saving correction…" : "Confirm correction"}
              </Button>
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
