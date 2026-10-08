"use client";

import { Button } from "@/components/ui/button";

type InstallmentSelectionProps = {
  active: boolean;
  selectedCount: number;
  eligibleCount: number;
  disabled: boolean;
  onActivate: () => void;
  onExit: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRequestCorrection: () => void;
};

export function InstallmentSelection(props: InstallmentSelectionProps) {
  return (
    <div role="group" aria-label="Installment selection" className="flex flex-wrap items-center gap-2">
      {!props.active ? (
        <Button variant="outline" className="min-h-11" disabled={props.disabled || props.eligibleCount === 0} onClick={props.onActivate}>
          Select
        </Button>
      ) : (
        <>
          <Button variant="outline" className="min-h-11" disabled={props.disabled} onClick={props.onExit}>
            Done selecting
          </Button>
          <Button variant="outline" className="min-h-11" disabled={props.disabled || props.eligibleCount === 0 || props.eligibleCount > 600} onClick={props.onSelectAll}>
            Select all
          </Button>
          <Button variant="outline" className="min-h-11" disabled={props.disabled || props.selectedCount === 0} onClick={props.onDeselectAll}>
            Deselect all
          </Button>
          <Button variant="outline" className="min-h-11" disabled={props.disabled || props.selectedCount === 0 || props.selectedCount > 600} onClick={props.onRequestCorrection}>
            Delete selected
          </Button>
          <span className="text-sm tabular-nums">{props.selectedCount} selected</span>
          {(props.eligibleCount > 600 || props.selectedCount > 600) && (
            <p role="status" className="w-full text-sm">Select up to 600 installments per correction.</p>
          )}
        </>
      )}
    </div>
  );
}
