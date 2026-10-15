import { describe, expect, it } from "vitest";
import { defaultHistoryQuery, historyDateBounds, historyQueryFingerprint, normalizeHistoryQuery, normalizeLegacyHistorySort, parseHistoryQuery } from "@/lib/transactions/history-query";

const a = "00000000-0000-0000-0000-000000000001";
const b = "abcdefab-0000-0000-0000-000000000002";
describe("history query contract", () => {
  it("supplies explicit wire defaults and independent selection arrays", () => {
    expect(defaultHistoryQuery()).toEqual({ version: 1, sort: "date_added_desc", type: "all", search: "", walletIds: [], categoryIds: [], includeUncategorized: false, minAmount: null, maxAmount: null, start: null, end: null, offset: 0 });
    const query = defaultHistoryQuery(); query.walletIds.push(a);
    expect(defaultHistoryQuery().walletIds).toEqual([]);
  });
  it.each(["transaction_date_desc", "transaction_date_asc", "date_added_desc", "date_added_asc", "amount_desc", "amount_asc"])("accepts %s", sort => {
    expect(parseHistoryQuery({ sort }).sort).toBe(sort);
  });
  it("normalizes mixed filters and retains literal search punctuation", () => {
    expect(normalizeHistoryQuery({ walletIds: [b.toUpperCase(), a, b], categoryIds: [b], includeUncategorized: true, type: "expense", search: "  50%_\\ literal  ", minAmount: "000.0", maxAmount: "9999999999999.99", start: "2024-02-29", end: "2030-01-01", offset: 50 })).toMatchObject({ walletIds: [a,b], categoryIds: [b], includeUncategorized: true, search: "50%_\\ literal", minAmount: "0.00", maxAmount: "9999999999999.99", start: "2024-02-29", offset: 50 });
  });
  it("keeps Uncategorized distinct from an unfiltered category field", () => {
    expect(historyQueryFingerprint({ includeUncategorized: true })).not.toBe(historyQueryFingerprint({}));
  });
  it("gives equivalent queries the same fingerprint regardless of key or ID order", () => {
    expect(historyQueryFingerprint({ walletIds: [b,a,b], minAmount: "01.2", search: " x " })).toBe(historyQueryFingerprint({ search: "x", minAmount: "1.20", walletIds: [a,b] }));
    expect(historyQueryFingerprint({ offset: 50 })).not.toBe(historyQueryFingerprint({}));
  });
  it.each(["-1", "NaN", "Infinity", "1e2", "1.001", "10000000000000", "1."])("rejects invalid money %s", minAmount => {
    expect(() => normalizeHistoryQuery({ minAmount })).toThrow();
  });
  it("rejects reversed money bounds but accepts equal and blank bounds", () => {
    expect(() => normalizeHistoryQuery({ minAmount: "2", maxAmount: "1.99" })).toThrow();
    expect(normalizeHistoryQuery({ minAmount: "0", maxAmount: "0.00" }).maxAmount).toBe("0.00");
    expect(normalizeHistoryQuery({ minAmount: " " }).minAmount).toBeNull();
  });
  it.each(["2023-02-29", "2024-04-31", "0000-01-01", "2024-1-01", "2024-01-01T00:00:00Z"])("rejects impossible or noncivil date %s", start => {
    expect(() => normalizeHistoryQuery({ start, end: "2030-01-01" })).toThrow();
  });
  it("requires complete ordered inclusive date bounds", () => {
    expect(() => normalizeHistoryQuery({ start: "2024-01-01" })).toThrow();
    expect(() => normalizeHistoryQuery({ start: "2024-02-01", end: "2024-01-01" })).toThrow();
    expect(normalizeHistoryQuery({ start: "2024-02-29", end: "2024-02-29" }).end).toBe("2024-02-29");
  });
  it("enforces strict wire shape, UUIDs, type, version and offset limits", () => {
    for (const input of [null, [], { extra: true }, { version: 2 }, { sort: "date_added" }, { type: "debt" }, { walletIds: ["bad"] }, { categoryIds: "bad" }, { includeUncategorized: 1 }, { offset: -1 }, { offset: 0.5 }, { offset: 1000001 }, { minAmount: 1 }]) expect(() => parseHistoryQuery(input)).toThrow();
    expect(parseHistoryQuery({ offset: 1000000 }).offset).toBe(1000000);
  });
  it("caps supplied arrays at 100 and counts Unicode search code points", () => {
    expect(() => normalizeHistoryQuery({ walletIds: Array(101).fill(a) })).toThrow();
    expect(normalizeHistoryQuery({ search: "😀".repeat(120) }).search).toHaveLength(240);
    expect(() => normalizeHistoryQuery({ search: "😀".repeat(121) })).toThrow();
  });
  it("maps legacy sorts without changing their meaning", () => {
    expect(normalizeLegacyHistorySort("date_added")).toBe("date_added_desc");
    expect(normalizeLegacyHistorySort("transaction_date")).toBe("transaction_date_desc");
    expect(normalizeLegacyHistorySort("amount_asc")).toBe("amount_asc");
  });
  it("projects exactly one UI date selection into wire bounds", () => {
    expect(historyDateBounds({ kind: "all" })).toEqual({ start: null, end: null });
    expect(historyDateBounds({ kind: "preset", period: { kind: "first_half", start: "2024-03-01", end: "2024-03-15" } })).toEqual({ start: "2024-03-01", end: "2024-03-15" });
    expect(historyDateBounds({ kind: "custom", start: "2030-01-01", end: "2030-01-02" })).toEqual({ start: "2030-01-01", end: "2030-01-02" });
    expect(() => historyDateBounds({ kind: "custom", start: "2024-02-30", end: "2024-03-01" })).toThrow();
  });
});
