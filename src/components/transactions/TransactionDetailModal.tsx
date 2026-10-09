"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGoals } from "@/hooks/use-goals";
import { useGoalHistory } from "@/hooks/use-goal-finance";
import type { GoalFinanceGoal } from "@/lib/goals/contracts";

import { Button } from "@/components/ui/button";
import TransactionDescriptionEditor from "@/components/transactions/TransactionDescriptionEditor";
import Tooltip from "@/components/ui/tooltip";
import { formatCurrency, formatDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { groupTransactions, loadHistoryGroup, type TransactionHistoryRow } from "@/lib/transactions/history";
import { 
  X, 
  ArrowDownLeft, 
  ArrowUpRight, 
  ArrowLeftRight, 
  Calendar, 
  Tag, 
  Wallet, 
  FileText,
  Clock
} from "lucide-react";

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: any;
  onRequestDelete?: (tx: any) => void;
  deleteDisabledReason?: string | null;
  onDescriptionSaved?: () => Promise<unknown>;
}

type DescriptionEditorSession = {
  key: number;
  target: { transactionId: string | null; groupId: string | null };
  currentDescription: string | null;
};

function GoalTransactionHistory({ goal, userId, transactionId }: { goal: GoalFinanceGoal; userId: string | null; transactionId: string }) {
  const history = useGoalHistory(userId, goal.id);
  if (history.error) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{goal.name} history could not be loaded.</p>;
  const effects = (history.data ?? []).filter(event => event.transaction_id === transactionId || event.linkedTransactionIds?.includes(transactionId));
  return <>{effects.map(event => {
    if (event.kind === "spend" || event.kind === "legacy_spent") return <p key={event.id} className="text-sm">Spent from {goal.name}: {formatCurrency(Number(event.spent_delta))}</p>;
    if (event.kind === "move_out") return <p key={event.id} className="text-sm">Carried {goal.name} reservation: {formatCurrency(-Number(event.reserved_delta))} from {event.accountName}</p>;
    if (event.kind === "release" && event.operationKind === "transaction") return <p key={event.id} className="text-sm">Automatic release from {goal.name}: {formatCurrency(-Number(event.reserved_delta))}. This is not goal spending.</p>;
    return null;
  })}</>;
}

export default function TransactionDetailModal({
  isOpen,
  onClose,
  transaction,
  onRequestDelete,
  deleteDisabledReason,
  onDescriptionSaved,
}: TransactionDetailModalProps) {
  const { financeSnapshot, userId } = useGoals();
  const [descriptionEditor, setDescriptionEditor] = useState<DescriptionEditorSession | null>(null);
  const [descriptionIssue, setDescriptionIssue] = useState<string | null>(null);
  const [loadingGroupDescription, setLoadingGroupDescription] = useState(false);
  const descriptionReadGeneration = useRef(0);
  const editDescriptionButton = useRef<HTMLButtonElement>(null);
  const refreshDescriptionHistory = useCallback(async () => {
    await onDescriptionSaved?.();
  }, [onDescriptionSaved]);

  useEffect(() => {
    descriptionReadGeneration.current += 1;
    setDescriptionEditor(null);
    setDescriptionIssue(null);
    setLoadingGroupDescription(false);
  }, [isOpen, transaction?.id]);

  if (!isOpen || !transaction) return null;

  function focusEditDescription() {
    const focus = () => editDescriptionButton.current?.focus();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
    else setTimeout(focus, 0);
  }

  function closeDescriptionEditor() {
    setDescriptionEditor(null);
    focusEditDescription();
  }

  function requestDescriptionEdit() {
    if (!transaction?.id) return;
    setDescriptionIssue(null);
    if (!transaction.installment_group_id) {
      descriptionReadGeneration.current += 1;
      setDescriptionEditor({
        key: descriptionReadGeneration.current,
        target: { transactionId: transaction.id, groupId: null },
        currentDescription: transaction.description ?? null,
      });
      return;
    }

    if (!userId) {
      setDescriptionIssue("Sign in again before editing this installment description.");
      return;
    }
    const generation = ++descriptionReadGeneration.current;
    const groupId = transaction.installment_group_id as string;
    setLoadingGroupDescription(true);
    void loadHistoryGroup(createClient() as any, userId, groupId)
      .then(rows => {
        if (generation !== descriptionReadGeneration.current || !isOpen) return;
        const group = groupTransactions(rows).find(entry => entry.kind === "installment_group" && entry.groupId === groupId);
        if (!group || group.kind !== "installment_group") {
          setDescriptionIssue("This installment group is no longer available in your history.");
          return;
        }
        if (group.descriptionState !== "consistent") {
          setDescriptionIssue("The installment descriptions need review before this group can be edited.");
          return;
        }
        setDescriptionEditor({
          key: generation,
          target: { transactionId: null, groupId },
          currentDescription: group.baseDescription,
        });
      })
      .catch(() => {
        if (generation === descriptionReadGeneration.current) setDescriptionIssue("The installment descriptions could not be loaded. Try again.");
      })
      .finally(() => {
        if (generation === descriptionReadGeneration.current) setLoadingGroupDescription(false);
      });
  }

  const getTypeColor = () => {
    switch (transaction.type) {
      case "income": return "text-green-500 bg-green-500/10";
      case "expense": return "text-red-500 bg-red-500/10";
      case "transfer": return "text-blue-500 bg-blue-500/10";
      default: return "text-slate-500 bg-slate-500/10";
    }
  };

  const getIcon = () => {
    switch (transaction.type) {
      case "income": return <ArrowDownLeft className="h-6 w-6" />;
      case "expense": return <ArrowUpRight className="h-6 w-6" />;
      case "transfer": return <ArrowLeftRight className="h-6 w-6" />;
      default: return <FileText className="h-6 w-6" />;
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content data-no-press-motion="" aria-describedby={undefined} onEscapeKeyDown={event => { if (descriptionEditor || loadingGroupDescription) event.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground rounded-2xl w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto shadow-xl">
        {/* Header/Banner */}
        <div className={`p-8 flex flex-col items-center justify-center text-center ${getTypeColor()}`}>
          <div className="p-4 rounded-full bg-white dark:bg-slate-800 shadow-sm mb-4">
            {getIcon()}
          </div>
          <Dialog.Title className="text-xl font-bold capitalize mb-1">{transaction.type} Details</Dialog.Title>
          <p className="text-2xl font-black tracking-tight">
            {formatCurrency(Number(transaction.amount))}
          </p>
        </div>

        <button 
          onClick={onClose}
          aria-label="Close transaction details"
          className="absolute top-4 right-4 min-h-11 min-w-11 p-2 rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6 space-y-6">
          {transaction.goal_id && transaction.account?.type === "credit_card" && <p className="text-sm">Informational purchase for {financeSnapshot?.goals.find(goal => goal.id === transaction.goal_id)?.name ?? "a goal"}. This credit purchase does not fund the goal or use its reservation.</p>}
          {financeSnapshot?.goals.map(goal => <GoalTransactionHistory key={goal.id} goal={goal} userId={userId} transactionId={transaction.id} />)}
          <div className="grid gap-4">
            {/* Description */}
            <div className="flex items-start gap-4">
              <div className="mt-1 p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                <FileText className="h-4 w-4 text-slate-500" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Description</p>
                {!descriptionEditor ? <>
                  <p className="break-words whitespace-pre-wrap font-medium text-slate-900 dark:text-slate-100">
                    {transaction.description || "No description provided"}
                  </p>
                  <Button ref={editDescriptionButton} type="button" variant="outline" className="min-h-11" onClick={requestDescriptionEdit} disabled={loadingGroupDescription}>
                    {loadingGroupDescription ? "Loading installment descriptions…" : "Edit description"}
                  </Button>
                </> : <TransactionDescriptionEditor
                  key={descriptionEditor.key}
                  target={descriptionEditor.target}
                  currentDescription={descriptionEditor.currentDescription}
                  transaction={transaction}
                  userId={userId}
                  refreshHistory={refreshDescriptionHistory}
                  onCancel={closeDescriptionEditor}
                  onSaved={closeDescriptionEditor}
                />}
                {descriptionIssue && <p role="status" className="break-words text-sm text-amber-800 dark:text-amber-200">{descriptionIssue}</p>}
              </div>
            </div>

            {/* Date */}
            <div className="flex items-start gap-4">
              <div className="mt-1 p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                <Calendar className="h-4 w-4 text-slate-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Date</p>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {formatDate(transaction.date)}
                </p>
              </div>
            </div>

            {/* Wallet */}
            <div className="flex items-start gap-4">
              <div className="mt-1 p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                <Wallet className="h-4 w-4 text-slate-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                  {transaction.type === "transfer" ? "Source Wallet" : "Wallet"}
                </p>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {transaction.account?.name || "Unknown Wallet"}
                </p>
              </div>
            </div>

            {/* Transfer To Wallet */}
            {transaction.type === "transfer" && (
              <div className="flex items-start gap-4">
                <div className="mt-1 p-2 rounded-lg bg-blue-500/10">
                  <ArrowLeftRight className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Destination Wallet</p>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {transaction.transfer_to_account?.name || "Unknown Wallet"}
                  </p>
                </div>
              </div>
            )}

            {/* Category */}
            {transaction.type !== "transfer" && (
              <div className="flex items-start gap-4">
                <div 
                  className="mt-1 p-2 rounded-lg" 
                  style={{ backgroundColor: transaction.category?.color ? `${transaction.category.color}15` : undefined }}
                >
                  <Tag 
                    className="h-4 w-4" 
                    style={{ color: transaction.category?.color || "currentColor" }} 
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Category</p>
                  <div className="flex items-center gap-2">
                    {transaction.category?.color && (
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ backgroundColor: transaction.category.color }} 
                      />
                    )}
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {transaction.category?.name || "No category"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Created At */}
            <div className="flex items-start gap-4 text-muted-foreground">
              <div className="mt-1 p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                <Clock className="h-4 w-4 text-slate-400" />
              </div>
              <div className="text-xs">
                <p className="uppercase tracking-wider font-semibold opacity-70">Added On</p>
                <p>{new Date(transaction.created_at).toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="pt-6">
            <div className="flex justify-center gap-6 items-center">
              <Button 
                variant="outline" 
                onClick={onClose}
                className="min-w-[100px] h-12 text-base font-semibold"
              >
                Close
              </Button>
              <Tooltip content={deleteDisabledReason || (transaction?.id ? "Delete transaction\nRevert balances" : "Cannot delete this transaction")}>
                <button
                  onClick={() => {
                    if (deleteDisabledReason) return;
                    if (onRequestDelete) onRequestDelete(transaction);
                    onClose();
                  }}
                  disabled={!transaction?.id || Boolean(deleteDisabledReason)}
                  className={`min-h-11 min-w-[100px] rounded-lg px-4 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${transaction?.id && !deleteDisabledReason ? "bg-red-700 text-white hover:bg-red-800 dark:bg-red-400 dark:text-slate-950 dark:hover:bg-red-300" : "bg-red-500/30 text-white/60"}`}
                  title={deleteDisabledReason ?? (transaction?.id ? "Delete transaction" : "")}
                >
                  {deleteDisabledReason ? "Delete unavailable" : "Delete"}
                </button>
              </Tooltip>
            </div>
            {deleteDisabledReason && <p role="status" className="mt-3 break-words text-center text-sm text-muted-foreground">{deleteDisabledReason}</p>}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  );
}
