"use client";

import { Check, ListChecks, ListX, CheckSquare, Trash2 } from "lucide-react";
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
        <Button variant="outline" className="h-11 w-11 shrink-0 p-0" aria-label="Select" title="Select" disabled={props.disabled || props.eligibleCount === 0} onClick={props.onActivate}>
          <CheckSquare className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : (
        <>
          <Button variant="outline" className="h-11 w-11 shrink-0 p-0" aria-label="Done selecting" title="Done selecting" disabled={props.disabled} onClick={props.onExit}>
            <Check className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" className="h-11 w-11 shrink-0 p-0" aria-label="Select all" title="Select all" disabled={props.disabled || props.eligibleCount === 0 || props.eligibleCount > 600} onClick={props.onSelectAll}>
            <ListChecks className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" className="h-11 w-11 shrink-0 p-0" aria-label="Deselect all" title="Deselect all" disabled={props.disabled || props.selectedCount === 0} onClick={props.onDeselectAll}>
            <ListX className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" className="h-11 w-11 shrink-0 p-0" aria-label="Delete selected" title="Delete selected" disabled={props.disabled || props.selectedCount === 0 || props.selectedCount > 600} onClick={props.onRequestCorrection}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
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
