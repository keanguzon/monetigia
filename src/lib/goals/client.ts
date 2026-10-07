import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import {
  FinancialCommandSchema,
  FinancialErrorCodeSchema,
  FinancialResultSchema,
  AllocationEventSchema,
  GoalFinanceSnapshotSchema,
  ReleaseLineSchema,
  TransactionDraftSchema,
  TransactionQuoteSchema,
  type FinancialCommand,
  type FinancialErrorCode,
  type FinancialResult,
  type AllocationEvent,
  type GoalFinanceSnapshot,
  type ReleaseLine,
  type TransactionDraft,
  type TransactionQuote,
} from "./contracts";

export { parseMoney, toMinorUnits, fromMinorUnits, summarizeGoal } from "./summary";

export class FinancialCommandError extends Error {
  readonly code: FinancialErrorCode | "TRANSPORT_ERROR";
  readonly hint: string | null;
  readonly outcome: "rejected" | "unknown";

  constructor(options: {
    message: string;
    code?: FinancialErrorCode | "TRANSPORT_ERROR";
    hint?: string | null;
    outcome: "rejected" | "unknown";
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "FinancialCommandError";
    this.code = options.code ?? "TRANSPORT_ERROR";
    this.hint = options.hint ?? null;
    this.outcome = options.outcome;
  }
}

export function financialCommandMessage(error: unknown, fallback: string): string {
  if (!(error instanceof FinancialCommandError)) return error instanceof Error ? error.message : fallback;
  if (error.hint?.trim()) return error.hint.trim();
  const guidance: Partial<Record<FinancialCommandError["code"], string>> = {
    INSUFFICIENT_ACTUAL: "This wallet does not have enough money for that amount.",
    INSUFFICIENT_AVAILABLE: "The wallet has less available money now. Review the amount and try again.",
    INSUFFICIENT_RESERVATION: "This goal has less reserved money in that wallet now. Review the amount and try again.",
    STALE_QUOTE: "The financial details changed. Review them and try again.",
    NEEDS_REVIEW: "Review and confirm this goal before changing its reservations.",
    INVALID_STATE: "This goal or wallet can no longer use that action.",
    REQUEST_CONFLICT: "This save request conflicts with an earlier attempt. Refresh the goal and try again.",
    NOT_ALLOWED: "That wallet or goal is not available for this action.",
  };
  return guidance[error.code] ?? fallback;
}

export class SupersededGoalFinanceRequestError extends Error {
  constructor() {
    super("The signed-in user changed while the goal snapshot was loading.");
    this.name = "SupersededGoalFinanceRequestError";
  }
}

export type GoalWalletMetadata = { id: string; name: string; type: string; currency: string; is_active: boolean };
export type GoalHistoryEntry = Omit<AllocationEvent, "kind"> & {
  kind: AllocationEvent["kind"] | "transaction_reversal";
  accountName: string;
  operationKind: FinancialCommand["kind"] | null;
};

function normalizeDatabaseDecimal(value: unknown): string {
  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) {
    throw new Error("Allocation history contains an invalid decimal amount.");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const normalized = `${whole}.${fraction.padEnd(2, "0")}`;
  return negative && normalized !== "0.00" ? `-${normalized}` : normalized;
}

export async function fetchGoalWalletMetadata(userId: string): Promise<GoalWalletMetadata[]> {
  const { data, error } = await (createClient() as any)
    .from("accounts")
    .select("id,name,type,currency,is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  if (!Array.isArray(data) || data.some(row => typeof row?.id !== "string" || typeof row?.name !== "string" ||
    typeof row?.type !== "string" || typeof row?.currency !== "string" || typeof row?.is_active !== "boolean")) {
    throw new Error("Wallet details could not be read.");
  }
  return data.map(({ id, name, type, currency, is_active }) => ({ id, name, type, currency, is_active }));
}

export async function fetchGoalHistory(userId: string, goalId: string): Promise<GoalHistoryEntry[]> {
  const db = createClient() as any;
  const { data: rawEvents, error: eventError } = await db.from("goal_allocation_events")
    .select("id,user_id,goal_id,account_id,operation_id,kind,reserved_delta::text,spent_delta::text,transaction_id,reversal_of,created_at")
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    .order("created_at", { ascending: false });
  if (eventError) throw eventError;
  if (!Array.isArray(rawEvents)) throw new Error("Goal history could not be read.");

  const events = rawEvents.map((row: Record<string, unknown>) => AllocationEventSchema.parse({
    ...row,
    reserved_delta: normalizeDatabaseDecimal(row.reserved_delta),
    spent_delta: normalizeDatabaseDecimal(row.spent_delta),
  }));
  const accountIds = Array.from(new Set(events.map(event => event.account_id)));
  const operationIds = Array.from(new Set(events.map(event => event.operation_id)));
  const [accountResult, sourceOperationResult] = await Promise.all([
    accountIds.length === 0 ? Promise.resolve({ data: [], error: null }) : db.from("accounts")
      .select("id,name,type,currency,is_active")
      .eq("user_id", userId)
      .in("id", accountIds),
    operationIds.length === 0 ? Promise.resolve({ data: [], error: null }) : db.from("financial_operations")
      .select("id,command,result,created_at")
      .eq("user_id", userId)
      .in("id", operationIds),
  ]);
  if (accountResult.error) throw accountResult.error;
  if (sourceOperationResult.error) throw sourceOperationResult.error;
  const accountNames = new Map<string, string>((accountResult.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name]));
  type OperationRow = { id: string; command: { kind?: unknown; transactionId?: unknown }; result?: { transactionIds?: unknown }; created_at: string };
  const sourceOperations = (sourceOperationResult.data ?? []) as OperationRow[];
  const sourceOperationsById = new Map<string, OperationRow>(sourceOperations.map(row => [row.id, row]));
  const transactionIds = Array.from(new Set(events.flatMap(event => {
    if (event.transaction_id) return [event.transaction_id];
    const operation = sourceOperationsById.get(event.operation_id);
    return Array.isArray(operation?.result?.transactionIds)
      ? operation.result.transactionIds.filter((value): value is string => typeof value === "string")
      : [];
  })));
  const reversalOperationsResult = transactionIds.length === 0 ? { data: [], error: null } : await db.from("financial_operations")
    .select("id,command,result,created_at")
    .eq("user_id", userId)
    .in("command->>transactionId", transactionIds);
  if (reversalOperationsResult.error) throw reversalOperationsResult.error;
  const reversalOperations = (reversalOperationsResult.data ?? []) as OperationRow[];
  const operationRows = [...sourceOperations, ...reversalOperations];
  const operationKinds = new Map<string, FinancialCommand["kind"] | null>(operationRows.map((row) => [
    row.id,
    typeof row.command?.kind === "string" && ["reserve", "release", "reallocate", "close", "reopen", "archive", "transaction", "delete_transaction", "adopt_legacy"].includes(row.command.kind)
      ? row.command.kind as FinancialCommand["kind"]
      : null,
  ]));
  const deleteOperationByTransactionId = new Map<string, OperationRow>();
  for (const row of reversalOperations) {
    const command = row.command;
    if (command?.kind === "delete_transaction" && typeof command.transactionId === "string") {
      deleteOperationByTransactionId.set(command.transactionId, row);
    }
  }
  const rows: GoalHistoryEntry[] = events.map(event => ({
    ...event,
    accountName: accountNames.get(event.account_id) ?? "Wallet",
    operationKind: operationKinds.get(event.operation_id) ?? null,
  }));
  const reversedEventIds = new Set(events.filter(event => event.kind === "reversal" && event.reversal_of !== null).map(event => event.reversal_of));
  for (const event of events) {
    if (reversedEventIds.has(event.id)) continue;
    const source = sourceOperationsById.get(event.operation_id);
    const linkedIds = event.transaction_id ? [event.transaction_id] : Array.isArray(source?.result?.transactionIds)
      ? source.result.transactionIds.filter((value): value is string => typeof value === "string")
      : [];
    for (const transactionId of linkedIds) {
      const deletion = deleteOperationByTransactionId.get(transactionId);
      if (!deletion) continue;
      rows.push({
        ...event,
        id: `${deletion.id}:${event.id}`,
        operation_id: deletion.id,
        kind: "transaction_reversal",
        reserved_delta: "0.00",
        spent_delta: "0.00",
        transaction_id: transactionId,
        reversal_of: null,
        created_at: deletion.created_at,
        accountName: accountNames.get(event.account_id) ?? "Wallet",
        operationKind: "delete_transaction",
      });
    }
  }
  return rows.sort((left, right) => right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id));
}

const requestIdSchema = z.string().uuid();

function readServerError(error: unknown, ambiguousOutcome = false): FinancialCommandError {
  if (typeof error === "object" && error !== null) {
    const response = error as { message?: unknown; hint?: unknown; status?: unknown };
    const message = typeof response.message === "string" ? response.message : "The server rejected the financial command.";
    const codeMatch = message.match(/\b(INSUFFICIENT_ACTUAL|INSUFFICIENT_AVAILABLE|INSUFFICIENT_RESERVATION|STALE_QUOTE|NEEDS_REVIEW|INVALID_STATE|REQUEST_CONFLICT|NOT_ALLOWED)\b/);
    const code = codeMatch ? FinancialErrorCodeSchema.parse(codeMatch[1]) : undefined;
    const status = typeof response.status === "number" ? response.status : null;
    const uncertainResponse = ambiguousOutcome && (
      status === 0 || (status !== null && status >= 500) ||
      /failed to fetch|network(error| request)|load failed|invalid json|unexpected end of json/i.test(message)
    );
    if (uncertainResponse && code === undefined) {
      return unknownOutcome(error);
    }
    return new FinancialCommandError({
      message,
      code,
      hint: typeof response.hint === "string" ? response.hint : null,
      outcome: "rejected",
      cause: error,
    });
  }
  return new FinancialCommandError({
    message: "The server rejected the financial command.",
    outcome: "rejected",
    cause: error,
  });
}

function unknownOutcome(error: unknown): FinancialCommandError {
  const message = error instanceof Error ? error.message : "The financial command response could not be confirmed.";
  return new FinancialCommandError({ message, code: "TRANSPORT_ERROR", outcome: "unknown", cause: error });
}

export async function fetchGoalFinance(
  expectedUserId?: string,
  isCurrentRequest: () => boolean = () => true,
): Promise<GoalFinanceSnapshot> {
  const client = createClient();
  let requestToken: string | null = null;
  if (expectedUserId !== undefined) {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session || session.user.id !== expectedUserId || !isCurrentRequest()) {
      throw new SupersededGoalFinanceRequestError();
    }
    requestToken = session.access_token;
  }

  const request = client.rpc("goal_finance_snapshot");
  const { data, error } = await (requestToken === null
    ? request
    : request.setHeader("Authorization", `Bearer ${requestToken}`));
  if (error) throw readServerError(error);
  const snapshot = GoalFinanceSnapshotSchema.parse(data);

  if (expectedUserId !== undefined) {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session || session.user.id !== expectedUserId || session.access_token !== requestToken || !isCurrentRequest() ||
      snapshot.goals.some(goal => goal.user_id !== expectedUserId)) {
      throw new SupersededGoalFinanceRequestError();
    }
  }
  return snapshot;
}

export async function quoteTransaction(draft: TransactionDraft, releases?: ReleaseLine[]): Promise<TransactionQuote> {
  const safeDraft = TransactionDraftSchema.parse(draft);
  const safeReleases = releases === undefined ? null : z.array(ReleaseLineSchema).parse(releases);
  const { data, error } = await createClient().rpc("goal_transaction_quote", {
    p_draft: safeDraft,
    p_releases: safeReleases,
  });
  if (error) throw readServerError(error);
  return TransactionQuoteSchema.parse(data);
}

export async function applyFinancialCommand(
  requestId: string,
  command: FinancialCommand,
  quote?: TransactionQuote,
): Promise<FinancialResult> {
  const safeRequestId = requestIdSchema.parse(requestId);
  const safeCommand = FinancialCommandSchema.parse(command);
  const isTransaction = safeCommand.kind === "transaction";
  if (isTransaction && quote === undefined) throw new Error("A fresh quote is required for a transaction command.");
  if (!isTransaction && quote !== undefined) throw new Error("Quotes are only valid for transaction commands.");
  const safeQuote = quote === undefined ? null : TransactionQuoteSchema.parse(quote);

  const response = await Promise.resolve().then(() => createClient().rpc("goal_finance_apply", {
      p_request_id: safeRequestId,
      p_command: safeCommand,
      p_quote: safeQuote,
    })).catch(error => { throw unknownOutcome(error); });
  if (response.error) throw readServerError(response.error, true);
  try {
    return FinancialResultSchema.parse(response.data);
  } catch (error) {
    // The database may have committed even when its response cannot be parsed.
    throw unknownOutcome(error);
  }
}
