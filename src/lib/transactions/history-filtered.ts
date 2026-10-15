import { z } from "zod";
import { groupTransactions, type TransactionHistoryEntry, type TransactionHistoryRow } from "./history";
import { isHistoryCivilDate, normalizeHistoryQuery, HISTORY_QUERY_PAGE_SIZE, type HistoryQuery } from "./history-query";

const uuid = z.string().uuid();
const civilDate = z.string().refine(isHistoryCivilDate).nullable();
const timestamp = z.string().datetime({ offset: true });
const exactAmount = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/);
const account = z.object({ id: uuid, name: z.string(), type: z.enum(["cash", "bank", "credit_card", "e_wallet", "investment"]) }).strict().nullable();
const rowSchema = z.object({
  id: uuid, user_id: uuid, account_id: uuid, category_id: uuid.nullable(), goal_id: uuid.nullable(),
  transfer_to_account_id: uuid.nullable(), type: z.enum(["expense", "income", "transfer"]),
  amount: z.string().regex(/^(?:-?\d+(?:\.\d{1,2})?|NaN|-?Infinity)$/), description: z.string().nullable(),
  date: civilDate, created_at: timestamp, history_date: civilDate, installment_group_id: uuid.nullable(), purchase_date: civilDate,
  category: z.object({ id: uuid, name: z.string(), color: z.string().nullable() }).strict().nullable(),
  account, transfer_to_account: account,
}).strict();
const entrySchema = z.object({
  key: z.string(), kind: z.enum(["transaction", "installment_group"]), groupId: uuid.nullable(),
  rows: z.array(rowSchema).min(1), matchingRowIds: z.array(uuid).min(1), recordedAmount: exactAmount.nullable(),
  currency: z.string().min(1).nullable(), transactionDate: civilDate, createdAt: timestamp, sortId: uuid,
}).strict();
const count = z.number().int().nonnegative().safe();
const pageSchema = z.object({
  version: z.literal(1), entries: z.array(entrySchema).max(HISTORY_QUERY_PAGE_SIZE), nextOffset: count.nullable(),
  totalMatchingEntries: count, excludedCurrencyEntryCount: count, invalidAmountEntryCount: count,
}).strict();

export type FilteredHistoryMetadata = {
  matchingRowIds: string[];
  recordedAmount: string | null;
  currency: string | null;
  transactionDate: string | null;
  createdAt: string;
  sortId: string;
};
export type FilteredHistoryEntry = TransactionHistoryEntry & FilteredHistoryMetadata;
export type FilteredHistoryPage = {
  entries: FilteredHistoryEntry[];
  nextOffset: number | null;
  totalMatchingEntries: number;
  excludedCurrencyEntryCount: number;
  invalidAmountEntryCount: number;
};

function invalid(): never { throw new Error("The transaction history response could not be verified."); }

export function parseFilteredHistoryPage(value: unknown, userId: string, input: HistoryQuery): FilteredHistoryPage {
  const query = normalizeHistoryQuery(input);
  const page = pageSchema.parse(value);
  const expectedSize = Math.min(HISTORY_QUERY_PAGE_SIZE, Math.max(0, page.totalMatchingEntries - query.offset));
  if (page.entries.length !== expectedSize || page.nextOffset !== (page.totalMatchingEntries > query.offset + HISTORY_QUERY_PAGE_SIZE ? query.offset + HISTORY_QUERY_PAGE_SIZE : null)) invalid();
  const amountMode = query.sort.startsWith("amount_") || query.minAmount !== null || query.maxAmount !== null;
  if (!amountMode && (page.excludedCurrencyEntryCount !== 0 || page.invalidAmountEntryCount !== 0)) invalid();
  const keys = new Set<string>();
  const ids = new Set<string>();
  const entries = page.entries.map(envelope => {
    if (keys.has(envelope.key)) invalid();
    keys.add(envelope.key);
    const childIds = new Set(envelope.rows.map(row => row.id));
    if (new Set(envelope.matchingRowIds).size !== envelope.matchingRowIds.length || envelope.matchingRowIds.some(id => !childIds.has(id))) invalid();
    if (!envelope.rows.some(row => row.id === envelope.sortId && row.created_at === envelope.createdAt)) invalid();
    for (const row of envelope.rows) {
      if (row.user_id !== userId || ids.has(row.id) || row.installment_group_id !== envelope.groupId) invalid();
      if (row.account !== null && row.account.id !== row.account_id || row.category !== null && row.category.id !== row.category_id
        || row.transfer_to_account !== null && row.transfer_to_account.id !== row.transfer_to_account_id) invalid();
      ids.add(row.id);
    }
    if (envelope.kind === "transaction" ? envelope.groupId !== null || envelope.rows.length !== 1 || envelope.key !== `transaction:${envelope.rows[0].id}`
      : envelope.groupId === null || envelope.key !== `installment:${envelope.groupId}`) invalid();
    const cents = envelope.rows.map(row => /^\d+(?:\.\d{1,2})?$/.test(row.amount)
      ? BigInt(row.amount.split(".")[0]) * BigInt(100) + BigInt((row.amount.split(".")[1] ?? "").padEnd(2, "0")) : null);
    const recordedCents = envelope.recordedAmount === null ? null : BigInt(envelope.recordedAmount.replace(".", ""));
    if (cents.some(value => value === null) ? recordedCents !== null : recordedCents !== cents.reduce<bigint>((sum, value) => sum + value!, BigInt(0))) invalid();
    if (amountMode && (envelope.currency !== "PHP" || envelope.recordedAmount === null || envelope.rows.some(row => !/^\d+(?:\.\d{1,2})?$/.test(row.amount)))) invalid();
    // The existing card model uses an empty date for unavailable legacy civil dates.
    const rows: TransactionHistoryRow[] = envelope.rows.map(row => ({ ...row, date: row.date ?? "", descriptionProof: null }));
    const entry = groupTransactions(rows)[0];
    if (!entry || entry.kind !== envelope.kind) invalid();
    if (entry.kind === "installment_group") {
      entry.firstDueDate = entry.firstDueDate || null;
      entry.latestDueDate = entry.latestDueDate || null;
      entry.purchaseDate = envelope.transactionDate !== null && envelope.rows.every(row => row.purchase_date === envelope.transactionDate) ? envelope.transactionDate : null;
      entry.addedAt = envelope.createdAt;
      if (envelope.recordedAmount === null) entry.remainingAmount = null;
    }
    return { ...entry, matchingRowIds: envelope.matchingRowIds, recordedAmount: envelope.recordedAmount, currency: envelope.currency,
      transactionDate: envelope.transactionDate, createdAt: envelope.createdAt, sortId: envelope.sortId } as FilteredHistoryEntry;
  });
  return { entries, nextOffset: page.nextOffset, totalMatchingEntries: page.totalMatchingEntries,
    excludedCurrencyEntryCount: page.excludedCurrencyEntryCount, invalidAmountEntryCount: page.invalidAmountEntryCount };
}

type HistoryRpcClient = { rpc: (name: "transaction_history_page", args: { p_query: HistoryQuery }) => { setHeader: (name: string, value: string) => PromiseLike<{ data: unknown; error: unknown }> } };
export async function loadFilteredHistoryPage(client: HistoryRpcClient, userId: string, input: HistoryQuery, accessToken: string): Promise<FilteredHistoryPage> {
  const query = normalizeHistoryQuery(input);
  const { data, error } = await client.rpc("transaction_history_page", { p_query: query }).setHeader("Authorization", `Bearer ${accessToken}`);
  if (error) throw error;
  return parseFilteredHistoryPage(data, userId, query);
}

export type HistoryWalletOption = { id: string; name: string; type: string; currency: string; isActive: boolean };
export type HistoryCategoryOption = { id: string; name: string; type: "income" | "expense"; color: string | null };
export type HistoryFilterOptions = { wallets: HistoryWalletOption[]; categories: HistoryCategoryOption[] };
const walletSchema = z.object({ id: uuid, user_id: uuid, name: z.string(), type: z.string(), currency: z.string(), is_active: z.boolean() }).strict();
const categorySchema = z.object({ id: uuid, user_id: uuid.nullable(), name: z.string(), type: z.enum(["income", "expense"]), color: z.string().nullable(), is_default: z.boolean() }).strict();

export async function loadHistoryFilterOptions(client: any, userId: string, accessToken: string): Promise<HistoryFilterOptions> {
  uuid.parse(userId);
  const [wallets, categories] = await Promise.all([
    client.from("accounts").select("id,user_id,name,type,currency,is_active").eq("user_id", userId).order("name")
      .setHeader("Authorization", `Bearer ${accessToken}`),
    client.from("categories").select("id,user_id,name,type,color,is_default").or(`user_id.eq.${userId},and(user_id.is.null,is_default.eq.true)`).order("name")
      .setHeader("Authorization", `Bearer ${accessToken}`),
  ]);
  if (wallets.error) throw wallets.error;
  if (categories.error) throw categories.error;
  const walletRows = z.array(walletSchema).parse(wallets.data);
  const categoryRows = z.array(categorySchema).parse(categories.data);
  if (walletRows.some(row => row.user_id !== userId) || categoryRows.some(row => row.user_id !== userId && !(row.user_id === null && row.is_default))) invalid();
  if (new Set(walletRows.map(row => row.id)).size !== walletRows.length || new Set(categoryRows.map(row => row.id)).size !== categoryRows.length) invalid();
  return { wallets: walletRows.map(row => ({ id: row.id, name: row.name, type: row.type, currency: row.currency, isActive: row.is_active })),
    categories: categoryRows.map(row => ({ id: row.id, name: row.name, type: row.type, color: row.color })) };
}
