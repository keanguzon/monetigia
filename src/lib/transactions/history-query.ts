import type { SpendingPeriod } from "@/lib/spending/periods";

export const HISTORY_SORTS = ["transaction_date_desc", "transaction_date_asc", "date_added_desc", "date_added_asc", "amount_desc", "amount_asc"] as const;
export type HistorySort = typeof HISTORY_SORTS[number];
export type HistoryType = "all" | "expense" | "income" | "transfer";
export type HistoryFilters = {
  type: HistoryType;
  search: string;
  walletIds: string[];
  categoryIds: string[];
  includeUncategorized: boolean;
  minAmount: string | null;
  maxAmount: string | null;
  start: string | null;
  end: string | null;
};
export type HistoryQuery = HistoryFilters & { version: 1; sort: HistorySort; offset: number };
export type HistoryDateSelection =
  | { kind: "all" }
  | { kind: "preset"; period: SpendingPeriod }
  | { kind: "custom"; start: string; end: string };

export const HISTORY_QUERY_PAGE_SIZE = 50;
export const HISTORY_QUERY_MAX_OFFSET = 1000000;
export const HISTORY_QUERY_MAX_IDS = 100;
export const HISTORY_QUERY_MAX_SEARCH_LENGTH = 120;
export const DEFAULT_HISTORY_QUERY: Readonly<HistoryQuery> = Object.freeze({
  version: 1, sort: "date_added_desc", type: "all", search: "",
  walletIds: Object.freeze([]) as unknown as string[], categoryIds: Object.freeze([]) as unknown as string[],
  includeUncategorized: false, minAmount: null, maxAmount: null, start: null, end: null, offset: 0,
});
export function defaultHistoryQuery(): HistoryQuery {
  return { ...DEFAULT_HISTORY_QUERY, walletIds: [], categoryIds: [] };
}
export class HistoryQueryValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "HistoryQueryValidationError";
  }
}
function invalid(field: string): never {
  throw new HistoryQueryValidationError(field, `Invalid history query field: ${field}`);
}
function ids(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > HISTORY_QUERY_MAX_IDS) return invalid(field);
  if (value.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return invalid(field);
  return Array.from(new Set((value as string[]).map(id => id.toLowerCase()))).sort();
}
export function normalizeHistoryAmount(value: unknown, field = "amount"): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return invalid(field);
  const text = value.trim();
  if (!text) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return invalid(field);
  const whole = match[1].replace(/^0+(?=\d)/, "");
  if (whole.length > 13) return invalid(field);
  return `${whole}.${(match[2] ?? "").padEnd(2, "0")}`;
}
export function isHistoryCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0,4));
  const month = Number(value.slice(5,7));
  const day = Number(value.slice(8,10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function dateBounds(start: unknown, end: unknown): Pick<HistoryFilters, "start" | "end"> {
  if (start === null && end === null) return { start: null, end: null };
  if (!isHistoryCivilDate(start)) return invalid("start");
  if (!isHistoryCivilDate(end) || end < start) return invalid("end");
  return { start, end };
}
export function historyDateBounds(selection: HistoryDateSelection): Pick<HistoryFilters, "start" | "end"> {
  if (selection.kind === "all") return { start: null, end: null };
  const range = selection.kind === "preset" ? selection.period : selection;
  return dateBounds(range.start, range.end);
}
export function parseHistoryQuery(input: unknown): HistoryQuery {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid("query");
  const supplied = input as Record<string, unknown>;
  for (const key of Object.keys(supplied)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_HISTORY_QUERY, key)) return invalid(key);
  }
  const value = { ...defaultHistoryQuery(), ...supplied };
  if (value.version !== 1) return invalid("version");
  if (!(HISTORY_SORTS as readonly unknown[]).includes(value.sort)) return invalid("sort");
  if (!["all", "expense", "income", "transfer"].includes(value.type)) return invalid("type");
  if (typeof value.search !== "string") return invalid("search");
  const search = value.search.trim();
  if (Array.from(search).length > HISTORY_QUERY_MAX_SEARCH_LENGTH) return invalid("search");
  if (typeof value.includeUncategorized !== "boolean") return invalid("includeUncategorized");
  if (!Number.isInteger(value.offset) || value.offset < 0 || value.offset > HISTORY_QUERY_MAX_OFFSET) return invalid("offset");
  const minAmount = normalizeHistoryAmount(value.minAmount, "minAmount");
  const maxAmount = normalizeHistoryAmount(value.maxAmount, "maxAmount");
  if (minAmount !== null && maxAmount !== null && BigInt(minAmount.replace(".", "")) > BigInt(maxAmount.replace(".", ""))) return invalid("maxAmount");
  const range = dateBounds(value.start, value.end);
  return {
    version: 1, sort: value.sort, type: value.type, search,
    walletIds: ids(value.walletIds, "walletIds"), categoryIds: ids(value.categoryIds, "categoryIds"),
    includeUncategorized: value.includeUncategorized, minAmount, maxAmount,
    start: range.start, end: range.end, offset: value.offset,
  };
}
export function normalizeHistoryQuery(input: Partial<HistoryQuery> = {}): HistoryQuery {
  return parseHistoryQuery(input);
}
export function historyQueryFingerprint(input: Partial<HistoryQuery>): string {
  return JSON.stringify(normalizeHistoryQuery(input));
}
export function normalizeLegacyHistorySort(sort: HistorySort | "date_added" | "transaction_date"): HistorySort {
  if (sort === "date_added") return "date_added_desc";
  if (sort === "transaction_date") return "transaction_date_desc";
  return sort;
}

