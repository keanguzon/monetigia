import { describe, expect, test, vi } from "vitest";
import { loadFilteredHistoryPage, parseFilteredHistoryPage, loadHistoryFilterOptions } from "@/lib/transactions/history-filtered";
import { defaultHistoryQuery } from "@/lib/transactions/history-query";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(99);
const row = (n: number, groupId: string | null = null) => ({ id: id(n), user_id: owner, account_id: id(90), category_id: null, goal_id: null, transfer_to_account_id: null, type: "expense", amount: "1.00", description: "Purchase", date: "2026-01-01", created_at: "2026-01-01T00:00:00+00:00", history_date: "2026-01-01", installment_group_id: groupId, purchase_date: null, account: { id: id(90), name: "Cash", type: "cash" }, category: null, transfer_to_account: null });
const entry = (n: number) => ({ key: `transaction:${id(n)}`, kind: "transaction", groupId: null, rows: [row(n)], matchingRowIds: [id(n)], recordedAmount: "1.00", transactionDate: "2026-01-01", createdAt: "2026-01-01T00:00:00+00:00", sortId: id(n) });
const page = (entries: unknown[] = [entry(1)]) => ({ version: 1, entries, nextOffset: null, totalMatchingEntries: entries.length, invalidAmountEntryCount: 0 });
const groupEntry = () => ({ ...entry(2), key: `installment:${id(80)}`, kind: "installment_group", groupId: id(80),
  rows: [row(1, id(80)), { ...row(2, id(80)), created_at: "2026-01-02T00:00:00+00:00" }],
  recordedAmount: "2.00", createdAt: "2026-01-02T00:00:00+00:00" });
describe("filtered history adapter", () => {
  test("rejects an older creation pair, smaller tied ID and unrelated valid civil sort dates", () => {
    const group = groupEntry();
    expect(() => parseFilteredHistoryPage(page([{ ...group, sortId: id(1), createdAt: group.rows[0].created_at }]), owner, defaultHistoryQuery())).toThrow();
    expect(() => parseFilteredHistoryPage(page([{ ...group, rows: group.rows.map(value => ({ ...value, created_at: group.createdAt })), sortId: id(1) }]), owner, defaultHistoryQuery())).toThrow();
    expect(() => parseFilteredHistoryPage(page([{ ...group, transactionDate: "2026-03-01" }]), owner, defaultHistoryQuery())).toThrow();
    expect(() => parseFilteredHistoryPage(page([{ ...entry(1), transactionDate: "2026-03-01" }]), owner, defaultHistoryQuery())).toThrow();
  });
  test("compares creation timestamps by exact instant, including microseconds and offsets", () => {
    const group = groupEntry();
    const rows = [{ ...group.rows[0], created_at: "2026-01-02T08:00:00.123456+08:00" }, { ...group.rows[1], created_at: "2026-01-02T00:00:00.123455+00:00" }];
    expect(() => parseFilteredHistoryPage(page([{ ...group, rows, sortId: id(2), createdAt: rows[1].created_at }]), owner, defaultHistoryQuery())).toThrow();
    expect(parseFilteredHistoryPage(page([{ ...group, rows, sortId: id(1), createdAt: "2026-01-02T00:00:00.123456Z" }]), owner, defaultHistoryQuery()).entries).toHaveLength(1);
  });
  test("accepts purchase dates, missing or inconsistent purchase fallback, and defensible legacy unknown dates", () => {
    const group = groupEntry();
    const rows = [{ ...group.rows[0], date: "2026-02-01", purchase_date: "2025-12-01" }, { ...group.rows[1], date: "2026-03-01", purchase_date: "2025-12-01" }];
    const parse = (changes: Record<string, unknown>) => parseFilteredHistoryPage(page([{ ...group, rows, ...changes }]), owner, defaultHistoryQuery());
    expect(parse({ transactionDate: "2025-12-01" }).entries[0].transactionDate).toBe("2025-12-01");
    expect(() => parse({ transactionDate: "2026-03-01" })).toThrow();
    expect(() => parse({ transactionDate: null })).toThrow();
    expect(parse({ rows: rows.map(value => ({ ...value, purchase_date: null })), transactionDate: "2026-03-01" }).entries).toHaveLength(1);
    expect(parse({ rows: [rows[0], { ...rows[1], purchase_date: "2025-12-02" }], transactionDate: "2026-03-01" }).entries).toHaveLength(1);
    expect(() => parse({ rows: [rows[0], { ...rows[1], purchase_date: "2025-12-02" }], transactionDate: null })).toThrow();
    expect(parse({ rows: [rows[0], { ...rows[1], purchase_date: null }], transactionDate: null }).entries).toHaveLength(1);
    expect(parse({ rows: [{ ...rows[0], purchase_date: null }, { ...rows[1], purchase_date: null, date: null }], transactionDate: null }).entries).toHaveLength(1);
    expect(() => parse({ rows: [{ ...rows[0], purchase_date: null }, { ...rows[1], purchase_date: null, date: null }], transactionDate: "2026-02-01" })).toThrow();
  });
  test("option reads pin ownership and token, include archived wallets and reject private categories", async () => {
    const reads: any[] = [];
    const client = { from: (table: string) => {
      const call = { table, eq: [] as any[], or: "", header: [] as string[] }; reads.push(call);
      const query: any = { select: () => query, eq: (...args: any[]) => { call.eq.push(args); return query; }, or: (value: string) => { call.or = value; return query; }, order: () => query,
        setHeader: (...args: string[]) => { call.header = args; return Promise.resolve({ data: table === "accounts" ? [{ id: id(90), user_id: owner, name: "Archived", type: "cash", is_active: false }] : [{ id: id(80), user_id: null, name: "Default", type: "expense", is_default: true, color: null }], error: null }); } };
      return query;
    } };
    const result = await loadHistoryFilterOptions(client, owner, "token");
    expect(result.wallets[0].isActive).toBe(false);
    expect(reads[0].eq).toEqual([["user_id", owner]]);
    expect(reads[1].or).toBe(`user_id.eq.${owner},and(user_id.is.null,is_default.eq.true)`);
    expect(reads.map(call => call.header)).toEqual([["Authorization", "Bearer token"], ["Authorization", "Bearer token"]]);
    const privateClient = { from: (table: string) => {
      const query: any = { select: () => query, eq: () => query, or: () => query, order: () => query,
        setHeader: async () => ({ data: table === "accounts" ? [] : [{ id: id(80), user_id: id(98), name: "Private", type: "expense", is_default: false, color: null }], error: null }) };
      return query;
    } };
    await expect(loadHistoryFilterOptions(privateClient, owner, "token")).rejects.toThrow();
  });
  test("pins the RPC token and preserves server order", async () => {
    const setHeader = vi.fn().mockResolvedValue({ data: page([entry(2), entry(1)]), error: null });
    const rpc = vi.fn(() => ({ setHeader }));
    const result = await loadFilteredHistoryPage({ rpc }, owner, defaultHistoryQuery(), "token");
    expect(rpc).toHaveBeenCalledWith("transaction_history_page", { p_query: defaultHistoryQuery() });
    expect(setHeader).toHaveBeenCalledWith("Authorization", "Bearer token");
    expect(result.entries.map(value => value.key)).toEqual([`transaction:${id(2)}`, `transaction:${id(1)}`]);
  });
  test("hydrates complete groups, keeps exact huge totals and cannot grant description proof", () => {
    const groupId = id(80);
    const group = { ...entry(1), key: `installment:${groupId}`, kind: "installment_group", groupId,
      rows: Array.from({ length: 12 }, (_, index) => ({ ...row(index + 1, groupId), amount: "9999999999999.99" })), recordedAmount: "119999999999999.88", sortId: id(12) };
    const result = parseFilteredHistoryPage(page([group]), owner, defaultHistoryQuery()).entries[0];
    expect(result.matchingRowIds).toEqual([id(1)]);
    expect(result.recordedAmount).toBe("119999999999999.88");
    expect(result.kind).toBe("installment_group");
    if (result.kind !== "installment_group") throw new Error("group");
    expect(result.children).toHaveLength(12);
    expect(result.descriptionProofState).toBe("needs_review");
  });
  test("keeps unavailable legacy dates and invalid amounts without invented dates or zero", () => {
    const value = entry(1);
    const legacy = { ...value, transactionDate: null, recordedAmount: null, rows: [{ ...value.rows[0], date: null, history_date: null, amount: "NaN" }] };
    const result = parseFilteredHistoryPage(page([legacy]), owner, defaultHistoryQuery()).entries[0];
    expect(result.transactionDate).toBeNull();
    if (result.kind !== "transaction") throw new Error("transaction");
    expect(result.transaction.date).toBe("");
    expect(result.transaction.amount).toBe("NaN");
    expect(() => parseFilteredHistoryPage(page([legacy]), owner, { ...defaultHistoryQuery(), sort: "amount_asc" })).toThrow();
  });
  test.each([
    (p: any) => { p.version = 2; },
    (p: any) => { p.entries.push(p.entries[0]); p.totalMatchingEntries = 2; },
    (p: any) => { p.entries[0].rows[0].user_id = id(98); },
    (p: any) => { p.entries[0].matchingRowIds = [id(2)]; },
    (p: any) => { p.entries[0].matchingRowIds = []; },
    (p: any) => { p.entries[0].rows[0].descriptionProof = { count: 1, ordinal: 1 }; },
    (p: any) => { p.entries[0].recordedAmount = "1.001"; },
    (p: any) => { p.entries[0].recordedAmount = "2.00"; },
    (p: any) => { p.entries[0].sortId = id(2); },
    (p: any) => { p.entries[0].createdAt = "2026-01-02T00:00:00+00:00"; },
    (p: any) => { p.entries[0].transactionDate = "2026-02-30"; },
    (p: any) => { p.nextOffset = 0; },
    (p: any) => { p.totalMatchingEntries = 0; },
  ])("rejects malformed or inconsistent envelopes %#", change => {
    const value = page(); change(value);
    expect(() => parseFilteredHistoryPage(value, owner, defaultHistoryQuery())).toThrow();
  });
});
