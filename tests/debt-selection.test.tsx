import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InstallmentSelection } from "@/components/transactions/InstallmentSelection";
import { reconcileDebtSelection, toggleDebtSelection } from "@/lib/debt/selection";

afterEach(cleanup);

test("reconciliation keeps canonical eligible order, removes duplicates, and clears a missing anchor", () => {
  expect(reconcileDebtSelection(
    { active: true, selectedIds: ["row-c", "row-a", "row-gone", "row-a"], anchorId: "row-gone" },
    ["row-a", "row-b", "row-c"],
  )).toEqual({ active: true, selectedIds: ["row-a", "row-c"], anchorId: null });
});

test("Shift adds the inclusive eligible range across ineligible gaps", () => {
  expect(toggleDebtSelection(
    { active: true, selectedIds: ["row-a"], anchorId: "row-a" },
    ["row-a", "row-c", "row-d"],
    "row-d",
    true,
  )).toEqual({ active: true, selectedIds: ["row-a", "row-c", "row-d"], anchorId: "row-a" });
});

test("plain toggle changes one stable ID and establishes the new anchor", () => {
  expect(toggleDebtSelection(
    { active: true, selectedIds: ["row-a", "row-c"], anchorId: "row-a" },
    ["row-a", "row-b", "row-c"],
    "row-c",
    false,
  )).toEqual({ active: true, selectedIds: ["row-a"], anchorId: "row-c" });
});

test("inactive and ineligible rows cannot enter the selection", () => {
  const state = { active: false, selectedIds: ["row-a"], anchorId: "row-a" };
  expect(toggleDebtSelection(state, ["row-a", "row-b"], "row-b", false)).toEqual(state);
  expect(toggleDebtSelection({ ...state, active: true }, ["row-a"], "paid-row", false).selectedIds).toEqual(["row-a"]);
});

test("toolbar calls the bounded actions and disables selections over the 600-row limit", () => {
  const onActivate = vi.fn();
  const onSelectAll = vi.fn();
  const onDeselectAll = vi.fn();
  const onRequestCorrection = vi.fn();
  const props = { active: false, selectedCount: 0, eligibleCount: 2, disabled: false,
    onActivate, onExit: vi.fn(), onSelectAll, onDeselectAll, onRequestCorrection };
  const view = render(<InstallmentSelection {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Select" }));
  expect(onActivate).toHaveBeenCalledOnce();

  view.rerender(<InstallmentSelection {...props} active selectedCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
  expect(onSelectAll).toHaveBeenCalledOnce();
  expect(onDeselectAll).toHaveBeenCalledOnce();
  expect(onRequestCorrection).toHaveBeenCalledOnce();

  view.rerender(<InstallmentSelection {...props} active selectedCount={601} eligibleCount={601} />);
  expect((screen.getByRole("button", { name: "Select all" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Select up to 600 installments per correction.");
});

test("toolbar honors a caller disabled state", () => {
  render(<InstallmentSelection active selectedCount={2} eligibleCount={2} disabled
    onActivate={vi.fn()} onExit={vi.fn()} onSelectAll={vi.fn()} onDeselectAll={vi.fn()} onRequestCorrection={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Select all" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(true);
});
