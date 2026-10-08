"use client";

import { useLayoutEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { GoalFinanceSnapshot, ReleaseLine, TransactionDraft, TransactionQuote } from "@/lib/goals/contracts";
import { GoalReleaseNotice } from "./GoalReleaseNotice";

type GoalReleaseDialogProps = {
  open: boolean;
  quote: TransactionQuote;
  draft: TransactionDraft;
  snapshot?: GoalFinanceSnapshot;
  busy: boolean;
  error: string | null;
  onChange: (releases: ReleaseLine[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
};

export function GoalReleaseDialog({ open, quote, draft, snapshot, busy, error, onChange, onConfirm, onCancel, returnFocusRef }: GoalReleaseDialogProps): JSX.Element {
  const keepRef = useRef<HTMLButtonElement>(null);
  const declined = useRef(false);
  const wasBusy = useRef(busy);
  const [reviewRevision, setReviewRevision] = useState(0);
  useLayoutEffect(() => {
    // A completed requote can return the same fingerprint and release amounts.
    if (wasBusy.current && !busy) setReviewRevision(revision => revision + 1);
    wasBusy.current = busy;
  }, [busy]);
  const cancel = () => {
    if (busy) return;
    declined.current = true;
    onCancel();
  };

  return <Dialog.Root open={open} onOpenChange={next => { if (!next) cancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60" />
      <Dialog.Content data-mobile-nav-blocking="" data-no-press-motion="" className="fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-xl"
        onOpenAutoFocus={event => { event.preventDefault(); keepRef.current?.focus(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (declined.current) {
            declined.current = false;
            setTimeout(() => { if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus(); }, 0);
          }
        }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <div className="shrink-0 border-b border-border p-4 sm:p-6">
          <Dialog.Title className="text-xl font-semibold">Review goal releases</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">Review the wallet funds and goal reservations before saving this transaction.</Dialog.Description>
        </div>
        <GoalReleaseNotice key={`${reviewRevision}:${JSON.stringify(quote)}`} quote={quote} draft={draft} snapshot={snapshot} disabled={busy} errorMessage={error} keepRef={keepRef} onChange={onChange} onConfirm={onConfirm} onCancel={cancel} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
