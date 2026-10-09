import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SWRConfig, useSWRConfig } from "swr";
import type { DebtSnapshot } from "@/lib/debt/contracts";
import { useDebtCommand } from "@/hooks/use-debt";
import { DebtCorrectionDialog } from "@/components/transactions/DebtCorrectionDialog";

const state = vi.hoisted(() => ({
  owner: "10000000-0000-4000-8000-000000000001",
  snapshot: null as DebtSnapshot | null,
  snapshotFailure: false,
  commandBehavior: "success" as "success" | "network" | "rejected" | "deferred",
  resolveCommand: null as null | ((response: unknown) => void),
  rpc: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  listeners: [] as Array<(event: string, session: unknown) => void>,
  scopedMutate: null as null | ((...args: any[]) => Promise<unknown>),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: state.getUser,
      getSession: state.getSession,
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        state.listeners.push(listener);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    rpc: (...args: unknown[]) => {
      const promise = Promise.resolve().then(() => state.rpc(...args));
      return { setHeader: () => promise, then: promise.then.bind(promise) };
    },
  }),
}));

vi.mock("@/hooks/use-goals", () => ({ useGoals: () => ({ userId: state.owner }) }));

const accountId = "20000000-0000-4000-8000-000000000001";
const groupId = "30000000-0000-4000-8000-000000000001";
const rowOneId = "40000000-0000-4000-8000-000000000001";
const rowTwoId = "40000000-0000-4000-8000-000000000002";
const savedResult = { operationId: "50000000-0000-4000-8000-000000000001", transactionIds: [], replayed: false };
let ownerSerial = 0;

function rowId(index: number) {
  return `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function balancedSnapshot(fingerprint = "a".repeat(64)): DebtSnapshot {
  return {
    accounts: [{ accountId, totalOutstanding: "0.30", undatedOutstanding: "0.00", fingerprint, reconciliation: "balanced", reconciliationDelta: "0.00" }],
    rows: [
      { id: rowOneId, accountId, groupId, source: "opening", transactionId: null, dueDate: "2026-11-01", originalAmount: "100.00", paidAmount: "99.90", correctedAmount: "0.00", remainingAmount: "0.10", ordinal: 1, name: "Laptop" },
      { id: rowTwoId, accountId, groupId, source: "opening", transactionId: null, dueDate: "2026-12-01", originalAmount: "200.00", paidAmount: "199.80", correctedAmount: "0.00", remainingAmount: "0.20", ordinal: 2, name: "Laptop" },
    ],
  };
}

function wrapper() {
  const cache = new Map();
  function CaptureScope({ children }: { children: React.ReactNode }) {
    state.scopedMutate = useSWRConfig().mutate as (...args: any[]) => Promise<unknown>;
    return <>{children}</>;
  }
  return function TestProviders({ children }: { children: React.ReactNode }) {
    return <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}>
      <CaptureScope>{children}</CaptureScope>
    </SWRConfig>;
  };
}

function commandCalls() {
  return state.rpc.mock.calls.filter(([name]) => name === "goal_finance_apply").map(([, args]) => args as { p_request_id: string; p_command: unknown; p_quote: unknown });
}

function mount(props: Partial<React.ComponentProps<typeof DebtCorrectionDialog>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  const allProps = { open: true, onClose, accountId, groupId, groupName: "Laptop", selectedIds: [rowOneId, rowTwoId], onSaved, ...props };
  const view = render(<DebtCorrectionDialog {...allProps} />, { wrapper: wrapper() });
  return { ...view, onClose, onSaved };
}

async function waitForReview() {
  return screen.findByText(/2 installments · ₱0\.30 remaining/);
}

beforeEach(() => {
  ownerSerial += 1;
  state.owner = `10000000-0000-4000-8000-${String(ownerSerial).padStart(12, "0")}`;
  state.snapshot = balancedSnapshot();
  state.snapshotFailure = false;
  state.commandBehavior = "success";
  state.resolveCommand = null;
  state.listeners = [];
  state.scopedMutate = null;
  state.getUser.mockReset().mockImplementation(async () => ({ data: { user: { id: state.owner } }, error: null }));
  state.getSession.mockReset().mockImplementation(async () => ({ data: { session: { user: { id: state.owner }, access_token: "token" } }, error: null }));
  state.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "debt_snapshot") {
      return state.snapshotFailure
        ? { data: null, error: { message: "debt unavailable" } }
        : { data: state.snapshot, error: null };
    }
    if (name === "goal_finance_apply") {
      if (state.commandBehavior === "network") throw new Error("network request failed");
      if (state.commandBehavior === "rejected") return { data: null, error: { message: "REQUEST_CONFLICT" } };
      if (state.commandBehavior === "deferred") return await new Promise((resolve) => { state.resolveCommand = resolve; });
      return { data: savedResult, error: null };
    }
    return { data: null, error: null };
  });
});

afterEach(cleanup);

test("confirmation totals exact partially paid remaining centavos and sends the frozen row IDs", async () => {
  mount();
  expect(await waitForReview()).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  await waitFor(() => expect(commandCalls()).toHaveLength(1));
  expect(commandCalls()[0].p_command).toEqual({
    kind: "correct_debt_rows", accountId, rowIds: [rowOneId, rowTwoId], fingerprint: "a".repeat(64),
  });
});

test("changed fingerprint requires renewed review before confirmation", async () => {
  mount();
  await waitForReview();
  const updated = balancedSnapshot("b".repeat(64));
  await act(async () => { await state.scopedMutate?.(["debtSnapshot", state.owner], updated, { populateCache: true, revalidate: false }); });
  expect(await screen.findByText(/debt changed after this review/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm correction" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review updated debt" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  await waitFor(() => expect(commandCalls()).toHaveLength(1));
  expect(commandCalls()[0].p_command).toMatchObject({ fingerprint: "b".repeat(64), rowIds: [rowOneId, rowTwoId] });
});

test("paid rows, mixed groups, duplicate IDs, and empty selections cannot be confirmed", async () => {
  state.snapshot = balancedSnapshot();
  state.snapshot.rows[0] = { ...state.snapshot.rows[0], paidAmount: "100.00", remainingAmount: "0.00" };
  mount({ selectedIds: [rowOneId] });
  expect((await screen.findByRole("alert")).textContent).toMatch(/positive remaining balance/i);
  expect(screen.queryByRole("button", { name: "Confirm correction" })).toBeNull();
  expect(commandCalls()).toHaveLength(0);

  cleanup();
  state.snapshot = balancedSnapshot();
  state.snapshot.rows.push({ ...state.snapshot.rows[1], id: "40000000-0000-4000-8000-000000000003", groupId: "30000000-0000-4000-8000-000000000002", ordinal: 3 });
  mount({ selectedIds: [rowOneId, "40000000-0000-4000-8000-000000000003"] });
  expect((await screen.findByRole("alert")).textContent).toMatch(/one debt group/i);
  expect(commandCalls()).toHaveLength(0);

  cleanup();
  state.snapshot = balancedSnapshot();
  state.snapshot.rows[1] = { ...state.snapshot.rows[1], source: "purchase", transactionId: "60000000-0000-4000-8000-000000000001" };
  mount();
  expect((await screen.findByRole("alert")).textContent).toMatch(/one debt source/i);
  expect(commandCalls()).toHaveLength(0);

  cleanup();
  state.snapshot = balancedSnapshot();
  mount({ selectedIds: [rowOneId, rowOneId] });
  expect((await screen.findByRole("alert")).textContent).toMatch(/duplicate installments/i);
  expect(commandCalls()).toHaveLength(0);

  cleanup();
  state.snapshot = balancedSnapshot();
  mount({ selectedIds: [] });
  expect((await screen.findByRole("alert")).textContent).toMatch(/select at least one installment/i);
  expect(commandCalls()).toHaveLength(0);
});

test("the 600-row boundary is submitted whole and a larger selection is rejected", async () => {
  const rows = Array.from({ length: 600 }, (_, index) => ({
    id: rowId(index), accountId, groupId, source: "opening" as const, transactionId: null,
    dueDate: "2026-11-01", originalAmount: "1.00", paidAmount: "0.00", correctedAmount: "0.00",
    remainingAmount: "1.00", ordinal: index + 1, name: "Laptop",
  }));
  state.snapshot = { accounts: [{ ...balancedSnapshot().accounts[0], totalOutstanding: "600.00" }], rows };
  mount({ selectedIds: rows.map((row) => row.id) });
  expect(await screen.findByText(/600 installments · ₱600\.00 remaining/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  await waitFor(() => expect(commandCalls()).toHaveLength(1));
  expect((commandCalls()[0].p_command as { rowIds: string[] }).rowIds).toHaveLength(600);

  cleanup();
  state.snapshot = { accounts: [{ ...balancedSnapshot().accounts[0], totalOutstanding: "601.00" }], rows: [...rows, {
    ...rows[0], id: rowId(600), ordinal: 601,
  }] };
  mount({ selectedIds: [...rows.map((row) => row.id), rowId(600)] });
  expect((await screen.findByRole("alert")).textContent).toMatch(/no more than 600/i);
  expect(screen.queryByRole("button", { name: "Confirm correction" })).toBeNull();
  expect(commandCalls()).toHaveLength(1);
});

test("Cancel and Escape close the presentation without submitting", async () => {
  const cancelled = mount();
  await waitForReview();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancelled.onClose).toHaveBeenCalledOnce();
  expect(commandCalls()).toHaveLength(0);

  cleanup();
  const escaped = mount();
  await waitForReview();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(escaped.onClose).toHaveBeenCalled());
  expect(commandCalls()).toHaveLength(0);
});

test("double confirmation sends one financial command", async () => {
  state.commandBehavior = "deferred";
  mount();
  await waitForReview();
  const confirm = screen.getByRole("button", { name: "Confirm correction" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(commandCalls()).toHaveLength(1));
  await act(async () => { state.resolveCommand?.({ data: savedResult, error: null }); });
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/correction saved/i));
  expect(commandCalls()).toHaveLength(1);
});

test("an unknown correction keeps the same request after close and remount even when its rows disappear", async () => {
  state.commandBehavior = "network";
  const first = mount();
  await waitForReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  await screen.findByRole("status");
  const original = commandCalls()[0];
  expect(first.onClose).not.toHaveBeenCalled();
  first.unmount();

  state.snapshot = { accounts: [{ ...balancedSnapshot("c".repeat(64)).accounts[0], totalOutstanding: "0.00" }], rows: [] };
  state.commandBehavior = "success";
  mount({ selectedIds: [] });
  expect(await screen.findByText(/unconfirmed.*original correction/i)).toBeTruthy();
  expect(await screen.findByText(/2 installments in the saved request/i)).toBeTruthy();
  expect(screen.queryByText(/₱0\.30 remaining/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry same correction" }));
  await waitFor(() => expect(commandCalls()).toHaveLength(2));
  expect(commandCalls()[1].p_request_id).toBe(original.p_request_id);
  expect(commandCalls()[1].p_command).toEqual(original.p_command);
  expect((commandCalls()[1].p_command as { rowIds: string[] }).rowIds).toEqual([rowOneId, rowTwoId]);
});

test("an adoption attempt blocks correction without exposing an adoption retry", async () => {
  state.commandBehavior = "network";
  const view = renderHook(() => useDebtCommand(state.owner), { wrapper: wrapper() });
  await act(async () => {
    await view.result.current.submit({ kind: "adopt_opening_debt", accountId, fingerprint: "a".repeat(64), items: [
      { clientId: "original", name: "Laptop", mode: "single", amount: "1.00", firstDueDate: "2026-11-01", count: 1 },
    ] });
  });
  expect(view.result.current.unresolved).toBe(true);
  view.unmount();
  mount();
  expect((await screen.findByRole("status")).textContent).toMatch(/resolve the existing debt save/i);
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  expect(commandCalls()).toHaveLength(1);
});

test("a previous saved receipt is cleared on fresh open and is not reported as a correction success", async () => {
  const previous = renderHook(() => useDebtCommand(state.owner), { wrapper: wrapper() });
  await act(async () => {
    await previous.result.current.submit({ kind: "adopt_opening_debt", accountId, fingerprint: "a".repeat(64), items: [
      { clientId: "original", name: "Laptop", mode: "single", amount: "1.00", firstDueDate: "2026-11-01", count: 1 },
    ] });
  });
  expect(previous.result.current.saved).toEqual(savedResult);
  previous.unmount();

  const correction = mount();
  await waitForReview();
  expect(screen.queryByText(/Correction saved/i)).toBeNull();
  expect(correction.onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  await waitFor(() => expect(commandCalls()).toHaveLength(2));
  expect(commandCalls()[1].p_command).toMatchObject({ kind: "correct_debt_rows", accountId });
  expect(correction.onSaved).toHaveBeenCalledOnce();
});

test("a rejected correction keeps its IDs and requires review before a new request", async () => {
  state.commandBehavior = "rejected";
  mount();
  await waitForReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review updated debt" }));
  state.commandBehavior = "success";
  const updated = balancedSnapshot("d".repeat(64));
  await act(async () => { await state.scopedMutate?.(["debtSnapshot", state.owner], updated, { populateCache: true, revalidate: false }); });
  fireEvent.click(screen.getByRole("button", { name: "Review updated debt" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  await waitFor(() => expect(commandCalls()).toHaveLength(2));
  expect(commandCalls()[1].p_command).toEqual({
    kind: "correct_debt_rows", accountId, rowIds: [rowOneId, rowTwoId], fingerprint: "d".repeat(64),
  });
  expect(commandCalls()[0].p_request_id).not.toBe(commandCalls()[1].p_request_id);
});

test("a saved correction with hook or history refresh failures offers read-only view refresh", async () => {
  const onSaved = vi.fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error("history refresh failed"))
    .mockResolvedValue(undefined);
  mount({ onSaved });
  await waitForReview();
  state.snapshotFailure = true;
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  expect((await screen.findByText(/some views could not refresh/i)).textContent).toMatch(/some views could not refresh/i);
  expect(screen.getByRole("button", { name: "Refresh views" })).toBeTruthy();

  state.snapshotFailure = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh views" }));
  expect(await screen.findByText(/Debt views refreshed/i)).toBeTruthy();
  expect(onSaved).toHaveBeenCalledTimes(2);
  expect(commandCalls()).toHaveLength(1);
});

test("a failed history refresh stays recoverable after the dialog remounts", async () => {
  const onSaved = vi.fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error("history refresh failed"))
    .mockResolvedValue(undefined);
  const first = mount({ onSaved });
  await waitForReview();
  fireEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  expect(await screen.findByRole("button", { name: "Refresh views" })).toBeTruthy();
  first.unmount();

  mount({ onSaved });
  expect(await screen.findByRole("button", { name: "Refresh views" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm correction" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh views" }));
  expect(await screen.findByText(/Debt views refreshed/i)).toBeTruthy();
  expect(onSaved).toHaveBeenCalledTimes(2);
  expect(commandCalls()).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Confirm correction" })).toBeTruthy();
});

test("an owner change discards the open confirmation and blocks the new owner from sending it", async () => {
  const view = mount();
  await waitForReview();
  state.owner = "10000000-0000-4000-8000-999999999999";
  view.rerender(<DebtCorrectionDialog open onClose={view.onClose} accountId={accountId} groupId={groupId} groupName="Laptop" selectedIds={[rowOneId, rowTwoId]} onSaved={view.onSaved} />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/signed-in account changed/i);
  expect(screen.queryByRole("button", { name: "Confirm correction" })).toBeNull();
  expect(commandCalls()).toHaveLength(0);
});
