import { createClient } from "@/lib/supabase/client";
import { financialOwnerToken, readFinancialRpcError, unknownFinancialOutcome } from "@/lib/goals/client";
import { DebtAccountCreateInputSchema, DebtAccountCreateResultSchema, DebtSnapshotSchema,
  type DebtAccountCreateInput, type DebtAccountCreateResult, type DebtSnapshot } from "./contracts";

export class SupersededDebtRequestError extends Error {
  constructor() { super("The signed-in session changed while debt was loading."); this.name = "SupersededDebtRequestError"; }
}

export async function fetchDebtSnapshot(expectedUserId: string, isCurrentRequest: () => boolean = () => true): Promise<DebtSnapshot> {
  const client = createClient();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session || session.user.id !== expectedUserId || !isCurrentRequest()) throw new SupersededDebtRequestError();
  const token = session.access_token;
  const { data, error } = await client.rpc("debt_snapshot").setHeader("Authorization", `Bearer ${token}`);
  if (error) throw readFinancialRpcError(error);
  const snapshot = DebtSnapshotSchema.parse(data);
  const { data: { session: after }, error: afterError } = await client.auth.getSession();
  if (afterError) throw afterError;
  if (!after || after.user.id !== expectedUserId || after.access_token !== token || !isCurrentRequest()) throw new SupersededDebtRequestError();
  return snapshot;
}

export async function createDebtAccount(input: DebtAccountCreateInput, expectedUserId?: string): Promise<DebtAccountCreateResult> {
  const safe = DebtAccountCreateInputSchema.parse(input);
  const client = createClient();
  const token = expectedUserId === undefined ? null : await financialOwnerToken(expectedUserId);
  const response = await Promise.resolve().then(() => {
    const request = client.rpc("debt_account_create", { p_request_id: safe.requestId, p_account: safe.account, p_opening_debts: safe.openingDebts });
    return token === null ? request : request.setHeader("Authorization", `Bearer ${token}`);
  }).catch(error => { throw unknownFinancialOutcome(error); });
  if (response.error) throw readFinancialRpcError(response.error, true);
  try { return DebtAccountCreateResultSchema.parse(response.data); }
  catch (error) { throw unknownFinancialOutcome(error); }
}
