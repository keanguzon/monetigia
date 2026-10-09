import { normalizeTransactionDescription } from "@/lib/transactions/description";

export type TransactionHistorySort = "date_added" | "transaction_date";

export type TransactionHistoryRow = {
  id: string;
  user_id: string;
  account_id: string;
  type: "expense" | "income" | "transfer";
  amount: number | string;
  description: string | null;
  date: string;
  created_at: string;
  history_date?: string | null;
  installment_group_id?: string | null;
  purchase_date?: string | null;
  category?: { name?: string | null } | null;
  account?: { name?: string | null } | null;
  transfer_to_account?: { name?: string | null } | null;
  descriptionProof?: InstallmentDescriptionProof | null;
};

export type InstallmentDescriptionProof = { count: number; ordinal: number };

export type InstallmentHistoryEntry = {
  kind: "installment_group";
  key: string;
  groupId: string;
  children: TransactionHistoryRow[];
  description: string;
  baseDescription: string | null;
  descriptionState: "consistent" | "needs_review";
  descriptionProofState?: "verified" | "needs_review";
  purchaseDate: string | null;
  firstDueDate: string | null;
  remainingAmount: number | null;
  addedAt: string;
  sortId: string;
  latestDueDate: string | null;
  latestDueCreatedAt: string;
  latestDueSortId: string;
};

export type TransactionHistoryEntry =
  | { kind: "transaction"; key: string; transaction: TransactionHistoryRow }
  | InstallmentHistoryEntry;

export type TransactionHistoryPage = {
  rows: TransactionHistoryRow[];
  nextOffset: number | null;
};

export const HISTORY_PAGE_SIZE = 50;
const HISTORY_SELECT = "id,user_id,account_id,category_id,goal_id,type,amount,description,date,created_at,installment_group_id,purchase_date,history_date,transfer_to_account_id,category:categories(id,name,color),account:accounts!account_id(id,name,type),transfer_to_account:accounts!transfer_to_account_id(id,name,type)";

function amountInCents(value: number | string): bigint | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = text.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = BigInt(match[2]) * BigInt(100) + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}

function sumMoneyAmounts(rows: TransactionHistoryRow[]): number | null {
  let total = BigInt(0);
  for (const row of rows) {
    const cents = amountInCents(row.amount);
    if (cents === null) return null;
    total += cents;
  }
  const safeCents = BigInt(Number.MAX_SAFE_INTEGER);
  if (total > safeCents || total < -safeCents) return null;
  return Number(total) / 100;
}

function dueDateOrder(left: TransactionHistoryRow, right: TransactionHistoryRow): number {
  return left.date.localeCompare(right.date) || left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
}

export function formatInstallmentDescription(description: string | null | undefined): string {
  return description?.replace(/\s*\(Installment\s+\d+\s*\/\s*\d+\)\s*$/i, "").trim() ?? "";
}

function installmentBaseDescription(description: string | null): string | null {
  if (description === null) return null;
  const suffix = description.match(/ \(Installment [1-9]\d*\/[1-9]\d*\)[\u0009-\u000D\u0020]*$/);
  return normalizeTransactionDescription(suffix?.index === undefined ? description : description.slice(0, suffix.index));
}

function hasOwnDescriptionProof(row: TransactionHistoryRow): boolean {
  return Object.prototype.hasOwnProperty.call(row, "descriptionProof");
}

function provenInstallmentBase(row: TransactionHistoryRow): { valid: boolean; base: string | null } {
  const proof = row.descriptionProof;
  if (!proof || !Number.isInteger(proof.count) || proof.count < 1 || proof.count > 12
    || !Number.isInteger(proof.ordinal) || proof.ordinal < 1 || proof.ordinal > proof.count) {
    return { valid: false, base: null };
  }
  if (proof.count === 1) return { valid: true, base: normalizeTransactionDescription(row.description) };
  if (row.description === null) return { valid: false, base: null };
  const suffix = ` (Installment ${proof.ordinal}/${proof.count})`;
  if (!row.description.endsWith(suffix)) return { valid: false, base: null };
  return { valid: true, base: normalizeTransactionDescription(row.description.slice(0, -suffix.length)) };
}

type OriginalInstallmentOperation = {
  id?: unknown;
  user_id?: unknown;
  completed_at?: unknown;
  command?: unknown;
  result?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function proveLiveInstallments(
  operation: OriginalInstallmentOperation | null,
  userId: string,
  groupId: string,
  rows: TransactionHistoryRow[],
): Map<string, InstallmentDescriptionProof> | null {
  if (!operation || operation.id !== groupId || operation.user_id !== userId
    || typeof operation.completed_at !== "string" || !operation.completed_at) return null;
  const command = isRecord(operation.command) ? operation.command : null;
  const draft = command && isRecord(command.draft) ? command.draft : null;
  const installments = draft && isRecord(draft.installments) ? draft.installments : null;
  const result = isRecord(operation.result) ? operation.result : null;
  if (command?.kind !== "transaction" || draft?.type !== "expense" || !installments || !result
    || result.operationId !== groupId || !Array.isArray(result.transactionIds)) return null;

  const count = installments.count;
  const accountId = draft.accountId;
  const rawIds = result.transactionIds;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 12
    || typeof accountId !== "string" || !uuidPattern.test(accountId)
    || rawIds.length !== count || rawIds.some(id => typeof id !== "string" || !uuidPattern.test(id))) return null;

  const orderedIds = (rawIds as string[]).map(id => id.toLowerCase());
  if (new Set(orderedIds).size !== count || rows.some(row => row.user_id !== userId
    || row.installment_group_id !== groupId || row.type !== "expense" || row.account_id.toLowerCase() !== accountId.toLowerCase())
    || new Set(rows.map(row => row.id.toLowerCase())).size !== rows.length) return null;

  const ordinalById = new Map(orderedIds.map((id, index) => [id, index + 1]));
  const proof = new Map<string, InstallmentDescriptionProof>();
  for (const row of rows) {
    const ordinal = ordinalById.get(row.id.toLowerCase());
    if (!ordinal) return null;
    proof.set(row.id, { count, ordinal });
  }
  return proof;
}

export function installmentPosition(row: TransactionHistoryRow, fallbackIndex: number, fallbackCount: number) {
  const match = row.description?.match(/\(Installment\s+(\d+)\s*\/\s*(\d+)\)/i);
  if (match) return { number: Number(match[1]), count: Number(match[2]) };
  return { number: fallbackIndex + 1, count: fallbackCount };
}

export function groupTransactions(rows: TransactionHistoryRow[]): TransactionHistoryEntry[] {
  const entries: TransactionHistoryEntry[] = [];
  const groups = new Map<string, InstallmentHistoryEntry>();

  for (const row of rows) {
    const groupId = row.installment_group_id;
    if (!groupId) {
      entries.push({ kind: "transaction", key: `transaction:${row.id}`, transaction: row });
      continue;
    }

    let group = groups.get(groupId);
    if (!group) {
      group = {
        kind: "installment_group",
        key: `installment:${groupId}`,
        groupId,
        children: [],
        description: "",
        baseDescription: null,
        descriptionState: "consistent",
        purchaseDate: row.purchase_date ?? null,
        firstDueDate: null,
        remainingAmount: null,
        addedAt: row.created_at,
        sortId: row.id,
        latestDueDate: null,
        latestDueCreatedAt: "",
        latestDueSortId: "",
      };
      groups.set(groupId, group);
      entries.push(group);
    }
    group.children.push(row);
    if (!group.purchaseDate && row.purchase_date) group.purchaseDate = row.purchase_date;
    if (!group.description) group.description = formatInstallmentDescription(row.description);
    if (row.created_at > group.addedAt || row.created_at === group.addedAt && row.id > group.sortId) {
      group.addedAt = row.created_at;
      group.sortId = row.id;
    }
  }

  for (const entry of entries) {
    if (entry.kind !== "installment_group") continue;
    entry.children.sort(dueDateOrder);
    const proofRows = entry.children.filter(hasOwnDescriptionProof);
    if (proofRows.length > 0) {
      const proofValues = entry.children.map(row => row.descriptionProof);
      const count = proofValues[0]?.count;
      const ordinals = new Set<number>();
      const completeProof = proofValues.every(proof => proof !== null && proof !== undefined
        && Number.isInteger(proof.count) && proof.count >= 1 && proof.count <= 12 && proof.count === count
        && Number.isInteger(proof.ordinal) && proof.ordinal >= 1 && proof.ordinal <= proof.count
        && !ordinals.has(proof.ordinal) && Boolean(ordinals.add(proof.ordinal)));
      const provenBases = completeProof ? entry.children.map(provenInstallmentBase) : [];
      entry.descriptionProofState = completeProof && provenBases.every(base => base.valid) ? "verified" : "needs_review";
      const descriptionsMatch = entry.descriptionProofState === "verified"
        && provenBases.every(base => base.base === provenBases[0]?.base);
      entry.descriptionState = descriptionsMatch ? "consistent" : "needs_review";
      entry.baseDescription = descriptionsMatch ? provenBases[0]?.base ?? null : null;
    } else {
      const bases = entry.children.map(row => installmentBaseDescription(row.description));
      const commonBase = bases[0] ?? null;
      const descriptionsMatch = bases.every(base => base === commonBase);
      entry.descriptionState = descriptionsMatch ? "consistent" : "needs_review";
      entry.baseDescription = descriptionsMatch ? commonBase : null;
    }
    entry.firstDueDate = entry.children[0]?.date ?? null;
    const latestDue = entry.children[entry.children.length - 1];
    entry.latestDueDate = latestDue?.date ?? null;
    const latestDueRows = entry.children.filter(row => row.date === entry.latestDueDate);
    const latestDueSortRow = latestDueRows.reduce<TransactionHistoryRow | null>((best, row) => {
      if (!best || row.created_at > best.created_at || row.created_at === best.created_at && row.id > best.id) return row;
      return best;
    }, null);
    entry.latestDueCreatedAt = latestDueSortRow?.created_at ?? "";
    entry.latestDueSortId = latestDueSortRow?.id ?? "";
    entry.remainingAmount = sumMoneyAmounts(entry.children);
    if (!entry.description) entry.description = entry.children[0]?.category?.name ?? "Installment purchase";
  }
  return entries;
}

function entryDate(entry: TransactionHistoryEntry, sort: TransactionHistorySort): string {
  if (entry.kind === "installment_group") return sort === "date_added" ? entry.addedAt : entry.purchaseDate ?? entry.latestDueDate ?? "";
  return sort === "date_added" ? entry.transaction.created_at : entry.transaction.date;
}

function entryCreatedAt(entry: TransactionHistoryEntry, sort: TransactionHistorySort): string {
  if (entry.kind !== "installment_group") return entry.transaction.created_at;
  return sort === "transaction_date" && !entry.purchaseDate ? entry.latestDueCreatedAt : entry.addedAt;
}

function entrySortId(entry: TransactionHistoryEntry, sort: TransactionHistorySort): string {
  if (entry.kind !== "installment_group") return entry.transaction.id;
  return sort === "transaction_date" && !entry.purchaseDate ? entry.latestDueSortId : entry.sortId;
}

export function sortHistoryEntries(entries: TransactionHistoryEntry[], sort: TransactionHistorySort): TransactionHistoryEntry[] {
  return [...entries].sort((left, right) => {
    const dateOrder = entryDate(right, sort).localeCompare(entryDate(left, sort));
    if (dateOrder) return dateOrder;
    const createdOrder = entryCreatedAt(right, sort).localeCompare(entryCreatedAt(left, sort));
    if (createdOrder) return createdOrder;
    return entrySortId(right, sort).localeCompare(entrySortId(left, sort));
  });
}

function rowSearchText(row: TransactionHistoryRow): string {
  return [
    row.description,
    row.category?.name,
    row.amount,
    row.account?.name,
    row.transfer_to_account?.name,
    row.date,
    row.purchase_date,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

export function filterHistoryEntries(
  entries: TransactionHistoryEntry[],
  query: string,
  type: "all" | "expense" | "income" | "transfer" = "all",
): TransactionHistoryEntry[] {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter(entry => {
    const rows = entry.kind === "installment_group" ? entry.children : [entry.transaction];
    if (type !== "all" && !rows.some(row => row.type === type)) return false;
    if (!search) return true;
    return rows.some(row => rowSearchText(row).includes(search));
  });
}

export function mergeHistoryRows(current: TransactionHistoryRow[], incoming: TransactionHistoryRow[]): TransactionHistoryRow[] {
  const rows = new Map<string, TransactionHistoryRow>();
  for (const row of [...current, ...incoming]) {
    if (!rows.has(row.id)) rows.set(row.id, row);
  }
  return Array.from(rows.values());
}

export async function loadHistoryPage(
  client: any,
  userId: string,
  sort: TransactionHistorySort,
  offset = 0,
): Promise<TransactionHistoryPage> {
  const query = client.from("transactions").select(HISTORY_SELECT).eq("user_id", userId);
  const ordered = sort === "date_added"
    ? query.order("created_at", { ascending: false }).order("id", { ascending: false })
    : query.order("history_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false });
  const { data, error } = await ordered.range(offset, offset + HISTORY_PAGE_SIZE - 1);
  if (error) throw error;

  const selectedRows = (data ?? []) as TransactionHistoryRow[];
  const groupIds = Array.from(new Set(selectedRows.map(row => row.installment_group_id).filter((id): id is string => !!id)));
  let completeRows = selectedRows;

  if (groupIds.length > 0) {
    const { data: children, error: childrenError } = await client
      .from("transactions")
      .select(HISTORY_SELECT)
      .eq("user_id", userId)
      .in("installment_group_id", groupIds)
      .order("date", { ascending: true })
      .order("id", { ascending: true });
    if (childrenError) throw childrenError;
    completeRows = mergeHistoryRows(selectedRows, (children ?? []) as TransactionHistoryRow[]);
  }

  return {
    rows: completeRows,
    nextOffset: selectedRows.length === HISTORY_PAGE_SIZE ? offset + HISTORY_PAGE_SIZE : null,
  };
}

export async function loadHistoryTransaction(
  client: any,
  userId: string,
  transactionId: string,
): Promise<TransactionHistoryRow | null> {
  const { data, error } = await client
    .from("transactions")
    .select(HISTORY_SELECT)
    .eq("user_id", userId)
    .eq("id", transactionId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TransactionHistoryRow | null;
}

export async function loadHistoryGroup(
  client: any,
  userId: string,
  groupId: string,
): Promise<TransactionHistoryRow[]> {
  const { data: operation, error: operationError } = await client
    .from("financial_operations")
    .select("id,user_id,command,result,completed_at")
    .eq("user_id", userId)
    .eq("id", groupId)
    .maybeSingle();
  if (operationError) throw operationError;

  const { data, error } = await client
    .from("transactions")
    .select(HISTORY_SELECT)
    .eq("user_id", userId)
    .eq("installment_group_id", groupId)
    .order("date", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as TransactionHistoryRow[];
  const proof = proveLiveInstallments(operation as OriginalInstallmentOperation | null, userId, groupId, rows);
  return rows.map(row => ({ ...row, descriptionProof: proof?.get(row.id) ?? null }));
}
