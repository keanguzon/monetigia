import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import {
  FinancialCommandSchema,
  FinancialErrorCodeSchema,
  FinancialResultSchema,
  GoalFinanceSnapshotSchema,
  ReleaseLineSchema,
  TransactionDraftSchema,
  TransactionQuoteSchema,
  type FinancialCommand,
  type FinancialErrorCode,
  type FinancialResult,
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

export class SupersededGoalFinanceRequestError extends Error {
  constructor() {
    super("The signed-in user changed while the goal snapshot was loading.");
    this.name = "SupersededGoalFinanceRequestError";
  }
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
