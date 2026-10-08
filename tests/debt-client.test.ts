import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn(), headers: [] as string[] }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getSession: state.session },
  rpc: (...args: unknown[]) => {
    const promise = Promise.resolve().then(() => state.rpc(...args));
    return { setHeader: (_name: string, value: string) => { state.headers.push(value); return promise; }, then: promise.then.bind(promise) };
  },
}) }));
const owner = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000002";
const requestId = "30000000-0000-4000-8000-000000000003";
const input = { requestId, account: { name: "Card", type: "credit_card" as const, currency: "PHP" as const,
  color: null, icon: null, is_savings: false as const, interest_rate: 0 as const, include_in_networth: true, display_order: 0 },
openingDebts: [{ clientId: "a", name: "Old debt", mode: "single" as const, amount: "12.30", firstDueDate: "2026-10-08", count: 1 }] };
beforeEach(() => {
  state.rpc.mockReset(); state.headers = [];
  state.session.mockReset().mockResolvedValue({ data: { session: { user: { id: owner }, access_token: "token" } }, error: null });
});
test("creation uses the atomic RPC and retains canonical decimal payload", async () => {
  const client = await import("@/lib/debt/client");
  state.rpc.mockResolvedValue({ data: { accountId, debtItemIds: [accountId], replayed: false }, error: null });
  expect(await client.createDebtAccount(input)).toEqual({ accountId, debtItemIds: [accountId], replayed: false });
  expect(state.rpc).toHaveBeenCalledWith("debt_account_create", { p_request_id: requestId, p_account: input.account, p_opening_debts: input.openingDebts });
});
test.each([
  [{ data: {}, error: null }, "unknown"],
  [{ data: null, error: { message: "REQUEST_CONFLICT" } }, "rejected"],
  [{ data: null, error: { message: "gateway failure", status: 503 } }, "unknown"],
])("creation distinguishes rejection from ambiguous response %#", async (response, outcome) => {
  const client = await import("@/lib/debt/client"); state.rpc.mockResolvedValue(response);
  await expect(client.createDebtAccount(input)).rejects.toMatchObject({ outcome });
});
test("a thrown network failure is unknown and never automatically replayed", async () => {
  const client = await import("@/lib/debt/client"); state.rpc.mockRejectedValue(new Error("network"));
  await expect(client.createDebtAccount(input)).rejects.toMatchObject({ outcome: "unknown" }); expect(state.rpc).toHaveBeenCalledTimes(1);
});
test("invalid creation never reaches the server", async () => {
  const client = await import("@/lib/debt/client");
  await expect(client.createDebtAccount({ ...input, openingDebts: [{ ...input.openingDebts[0], amount: "12.3" }] })).rejects.toThrow();
  expect(state.rpc).not.toHaveBeenCalled();
});
test("snapshot binds its token and rejects a superseded owner after response", async () => {
  const client = await import("@/lib/debt/client"); state.rpc.mockResolvedValue({ data: { accounts: [], rows: [] }, error: null });
  expect(await client.fetchDebtSnapshot(owner)).toEqual({ accounts: [], rows: [] }); expect(state.headers).toEqual(["Bearer token"]);
  state.session.mockResolvedValueOnce({ data: { session: { user: { id: owner }, access_token: "token" } }, error: null })
    .mockResolvedValueOnce({ data: { session: { user: { id: accountId }, access_token: "other" } }, error: null });
  await expect(client.fetchDebtSnapshot(owner)).rejects.toMatchObject({ name: "SupersededDebtRequestError" });
});
test("snapshot validates canonical money without coercion", async () => {
  const client = await import("@/lib/debt/client");
  const account = { accountId, totalOutstanding: "12.30", undatedOutstanding: "12.30", reconciliation: "balanced", reconciliationDelta: "0.00", fingerprint: "a".repeat(64) };
  state.rpc.mockResolvedValue({ data: { accounts: [account], rows: [] }, error: null });
  expect((await client.fetchDebtSnapshot(owner)).accounts[0].totalOutstanding).toBe("12.30");
  state.rpc.mockResolvedValue({ data: { accounts: [{ ...account, totalOutstanding: 12.3 }], rows: [] }, error: null });
  await expect(client.fetchDebtSnapshot(owner)).rejects.toThrow();
});
test("owner-bound creation rejects a different session before dispatch", async () => {
  const client = await import("@/lib/debt/client");
  state.session.mockResolvedValue({ data: { session: { user: { id: accountId }, access_token: "other" } }, error: null });
  await expect(client.createDebtAccount(input, owner)).rejects.toMatchObject({ outcome: "rejected", code: "NOT_ALLOWED" });
  expect(state.rpc).not.toHaveBeenCalled();
});
test("owner-bound creation pins the verified token even if identity changes at dispatch", async () => {
  const client = await import("@/lib/debt/client");
  state.rpc.mockImplementation(() => {
    state.session.mockResolvedValue({ data: { session: { user: { id: accountId }, access_token: "other" } }, error: null });
    return { data: { accountId, debtItemIds: [], replayed: false }, error: null };
  });
  await client.createDebtAccount(input, owner);
  expect(state.headers).toEqual(["Bearer token"]);
});
test("owner-bound financial command pins the original token and rejects another owner", async () => {
  const { applyFinancialCommand } = await import("@/lib/goals/client");
  const command = { kind: "correct_debt_rows" as const, accountId, rowIds: [accountId], fingerprint: "a".repeat(64) };
  state.rpc.mockResolvedValue({ data: { operationId: requestId, transactionIds: [], replayed: false }, error: null });
  await applyFinancialCommand(requestId, command, undefined, owner);
  expect(state.headers).toEqual(["Bearer token"]);
  state.session.mockResolvedValue({ data: { session: { user: { id: accountId }, access_token: "other" } }, error: null });
  await expect(applyFinancialCommand(requestId, command, undefined, owner)).rejects.toMatchObject({ outcome: "rejected", code: "NOT_ALLOWED" });
  expect(state.rpc).toHaveBeenCalledTimes(1);
});
