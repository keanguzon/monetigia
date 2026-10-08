export type DebtSelectionState = {
  active: boolean;
  selectedIds: string[];
  anchorId: string | null;
};

export function reconcileDebtSelection(
  state: DebtSelectionState,
  eligibleIds: string[],
): DebtSelectionState {
  const eligible = Array.from(new Set(eligibleIds));
  const selected = new Set(state.selectedIds);

  return {
    active: state.active,
    selectedIds: eligible.filter((id) => selected.has(id)),
    anchorId: state.anchorId && eligible.includes(state.anchorId) ? state.anchorId : null,
  };
}

export function toggleDebtSelection(
  state: DebtSelectionState,
  orderedEligibleIds: string[],
  rowId: string,
  shift: boolean,
): DebtSelectionState {
  const eligible = Array.from(new Set(orderedEligibleIds));
  const current = reconcileDebtSelection(state, eligible);
  if (!current.active || !eligible.includes(rowId)) return current;

  const selected = new Set(current.selectedIds);
  if (shift && current.anchorId) {
    const start = eligible.indexOf(current.anchorId);
    const end = eligible.indexOf(rowId);
    eligible.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((id) => selected.add(id));
  } else if (shift) {
    selected.add(rowId);
    current.anchorId = rowId;
  } else {
    if (selected.has(rowId)) selected.delete(rowId);
    else selected.add(rowId);
    current.anchorId = rowId;
  }

  return { ...current, selectedIds: eligible.filter((id) => selected.has(id)) };
}
