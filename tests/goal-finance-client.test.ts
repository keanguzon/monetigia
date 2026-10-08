import { afterEach, beforeEach, expect, test, vi } from "vitest";

const rpcState = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: rpcState.rpc }) }));

import { applyFinancialCommand, fetchGoalFinance, quoteTransaction, readFinancialRpcError, unknownFinancialOutcome } from "@/lib/goals/client";
import type { GoalFinanceSnapshot, TransactionDraft } from "@/lib/goals/contracts";

const userId = "10000000-0000-4000-8000-000000000001";
const goalId = "20000000-0000-4000-8000-000000000002";
const accountId = "30000000-0000-4000-8000-000000000003";
const requestId = "40000000-0000-4000-8000-000000000004";

const snapshot: GoalFinanceSnapshot = {
  goals: [{
    id: goalId, goalId, user_id: userId, name: "Emergency fund", target_amount: "5000.00", current_amount: "5000.00",
    target_date: null, color: null, icon: null, is_completed: true, status: "completed", review_state: "confirmed",
    completed_at: null, archived_at: null, is_priority: false, category: "Savings", allocation_per_cycle: "0.00",
    allocation_frequency: "monthly", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    reserved: "0.00", spent: "5000.00", progressAmount: "5000.00", remaining: "0.00", progressPercent: 100,
    walletReservations: [], legacyTaggedAmount: "0.00",
  }],
  wallets: [{ accountId, actual: "8000.00", reserved: "0.00", available: "8000.00" }],
};

const draft: TransactionDraft = {
  type: "expense", accountId, transferToAccountId: null, categoryId: null, goalId: null,
  amount: "12.30", description: "Lunch", date: "2026-10-07", installments: null, reservationMoves: [],
};

beforeEach(() => rpcState.rpc.mockReset());
afterEach(() => vi.clearAllMocks());

test("shared error classifiers retain named rejection and ambiguous write semantics", () => {
  expect(readFinancialRpcError({ message: "REQUEST_CONFLICT", status: 503 }, true)).toMatchObject({ outcome: "rejected", code: "REQUEST_CONFLICT" });
  expect(readFinancialRpcError({ message: "gateway", status: 503 }, true)).toMatchObject({ outcome: "unknown" });
  expect(readFinancialRpcError({ message: "gateway", status: 503 })).toMatchObject({ outcome: "rejected" });
  expect(unknownFinancialOutcome(new Error("network"))).toMatchObject({ outcome: "unknown", code: "TRANSPORT_ERROR" });
});

test("serializes canonical money strings at the quote RPC boundary", async () => {
  rpcState.rpc.mockResolvedValue({ data: { fingerprint: "fresh", actual: "12.30", reserved: "0.00", available: "8000.00", releases: [] }, error: null });

  const quote = await quoteTransaction(draft);

  expect(quote.actual).toBe("12.30");
  expect(rpcState.rpc).toHaveBeenCalledWith("goal_transaction_quote", {
    p_draft: draft,
    p_releases: null,
  });
});

test("rejects malformed snapshot RPC results instead of coercing amounts", async () => {
  rpcState.rpc.mockResolvedValue({ data: { goals: [{ ...snapshot.goals[0], target_amount: 5000 }], wallets: [] }, error: null });

  await expect(fetchGoalFinance()).rejects.toThrow();
});

test("preserves named SQL errors and corrective HINT text", async () => {
  rpcState.rpc.mockResolvedValue({ data: null, error: { message: "INSUFFICIENT_AVAILABLE", hint: "Release or move a reservation first." } });

  await expect(applyFinancialCommand(requestId, { kind: "reserve", goalId, accountId, amount: "1.00" }))
    .rejects.toMatchObject({ code: "INSUFFICIENT_AVAILABLE", hint: "Release or move a reservation first.", outcome: "rejected" });
});

test("retry recovers a committed operation using the caller's same UUID", async () => {
  rpcState.rpc
    .mockResolvedValueOnce({ data: { operationId: requestId, transactionIds: [], replayed: false }, error: null })
    .mockResolvedValueOnce({ data: { operationId: requestId, transactionIds: [], replayed: true }, error: null });

  const command = { kind: "reserve" as const, goalId, accountId, amount: "25.00" };
  const first = await applyFinancialCommand(requestId, command);
  const second = await applyFinancialCommand(requestId, command);

  expect(rpcState.rpc).toHaveBeenNthCalledWith(1, "goal_finance_apply", { p_request_id: requestId, p_command: command, p_quote: null });
  expect(rpcState.rpc).toHaveBeenNthCalledWith(2, "goal_finance_apply", { p_request_id: requestId, p_command: command, p_quote: null });
  expect(second.operationId).toBe(first.operationId);
  expect(second.replayed).toBe(true);
});

test("restores an archived goal through the owner-authorized RPC with the caller's request UUID", async () => {
  const saved = { operationId: requestId, transactionIds: [], replayed: false };
  rpcState.rpc.mockResolvedValue({ data: saved, error: null });
  const client = await import("@/lib/goals/client") as unknown as Record<string, (...args: string[]) => Promise<unknown>>;

  await expect(client.restoreArchivedGoal(requestId, goalId)).resolves.toEqual(saved);
  expect(rpcState.rpc).toHaveBeenCalledWith("goal_restore_archived", { p_request_id: requestId, p_goal_id: goalId });
});

test("keeps a restore request retryable after an unknown transport outcome", async () => {
  rpcState.rpc.mockResolvedValue({ data: null, error: { message: "TypeError: Failed to fetch", status: 0 } });
  const client = await import("@/lib/goals/client") as unknown as Record<string, (...args: string[]) => Promise<unknown>>;

  await expect(client.restoreArchivedGoal(requestId, goalId)).rejects.toMatchObject({ outcome: "unknown" });
  expect(rpcState.rpc).toHaveBeenCalledWith("goal_restore_archived", { p_request_id: requestId, p_goal_id: goalId });
});

test("marks an unclassified transport failure as an unknown outcome", async () => {
  rpcState.rpc.mockResolvedValue({ data: null, error: { message: "TypeError: Failed to fetch", status: 0 } });

  const error = await applyFinancialCommand(requestId, { kind: "reserve", goalId, accountId, amount: "1.00" })
    .then(() => null, caught => caught);
  expect(error).toMatchObject({ outcome: "unknown" });
});

test("reads fully funded goals without issuing completion writes", async () => {
  rpcState.rpc.mockResolvedValue({ data: snapshot, error: null });

  await expect(fetchGoalFinance()).resolves.toEqual(snapshot);
  expect(rpcState.rpc).toHaveBeenCalledTimes(1);
  expect(rpcState.rpc).toHaveBeenCalledWith("goal_finance_snapshot");
});
