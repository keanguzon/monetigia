import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DebtAccountCreateInputSchema, DebtAccountCreateResultSchema, OpeningDebtDraftSchema } from "@/lib/debt/contracts";
import { MoneySchema } from "@/lib/goals/contracts";

const debt = (overrides = {}) => ({ clientId: "opaque-1", name: "Laptop", mode: "installments", amount: "1000.00", firstDueDate: "2026-01-31", count: 3, ...overrides });
const input = (openingDebts: unknown[] = [debt()], account = {}) => ({ requestId: randomUUID(), account: { name: "Credit", type: "credit_card", currency: "PHP", color: "#00aA99", icon: "gcash.png", is_savings: false, interest_rate: 0, include_in_networth: true, display_order: 0, ...account }, openingDebts });

describe("opening debt creation contract", () => {
  it("accepts zero debt and typed 2, 24, 600 counts and trims names", () => {
    expect(DebtAccountCreateInputSchema.parse(input([])).openingDebts).toEqual([]);
    for (const count of [2, 24, 600]) expect(OpeningDebtDraftSchema.parse(debt({ count })).count).toBe(count);
    expect(DebtAccountCreateInputSchema.parse(input([debt({ name: " Laptop " })], { name: " Credit " })).account.name).toBe("Credit");
    expect(OpeningDebtDraftSchema.parse(debt({ name: " Laptop " })).name).toBe("Laptop");
    expect(OpeningDebtDraftSchema.safeParse(debt({ mode: "single", count: 1 })).success).toBe(true);
  });
  it("rejects permissive types, unknown keys, invalid names, icons, colors and account controls", () => {
    for (const count of ["2", "2e1", 2.5, 0, -1, 601, Infinity, 9007199254740992]) expect(OpeningDebtDraftSchema.safeParse(debt({ count })).success).toBe(false);
    for (const extra of [{ ownerId: randomUUID() }, { accountId: randomUUID() }, { purchaseDate: "2026-01-01" }]) expect(OpeningDebtDraftSchema.safeParse(debt(extra)).success).toBe(false);
    for (const override of [{ name: " " }, { name: "x".repeat(61) }, { color: "#fff" }, { icon: "../x.png" }, { icon: "https://x.png" }, { icon: "x\\y.png" }, { icon: "x.exe" }, { display_order: 2147483648 }, { display_order: "0" }, { include_in_networth: "true" }, { balance: "1.00" }, { user_id: randomUUID() }, { is_active: true }, { interest_rate: "0" }, { is_savings: true }, { type: "cash" }]) expect(DebtAccountCreateInputSchema.safeParse(input([], override)).success).toBe(false);
    for (const override of [{ name: " " }, { name: "x".repeat(61) }, { clientId: "" }, { clientId: "x".repeat(101) }, { mode: "single", count: 2 }]) expect(OpeningDebtDraftSchema.safeParse(debt(override)).success).toBe(false);
    expect(DebtAccountCreateInputSchema.safeParse({ ...input(), extra: true }).success).toBe(false);
  });
  it("enforces exact positive decimal money and account storage range without changing shared Money", () => {
    expect(MoneySchema.safeParse("90071992547409.91").success).toBe(true);
    expect(OpeningDebtDraftSchema.safeParse(debt({ amount: "9999999999999.99" })).success).toBe(true);
    for (const amount of [1000, "0.00", "01.00", "1", "1.001", "-1.00", "1e2", "10000000000000.00", "90071992547409.91", "0.02"]) expect(OpeningDebtDraftSchema.safeParse(debt({ amount })).success).toBe(false);
    expect(DebtAccountCreateInputSchema.safeParse(input([debt({ amount: "9999999999999.99" }), debt({ clientId: "2", amount: "0.03" })])).success).toBe(false);
  });
  it("validates exact dates, overdue dates and full schedule endpoint", () => {
    for (const firstDueDate of ["0001-01-01", "2028-02-29", "2000-01-01", "9999-10-31"]) expect(OpeningDebtDraftSchema.safeParse(debt({ firstDueDate })).success).toBe(true);
    for (const firstDueDate of ["0000-01-01", "2026-02-30", "2027-02-29", "10000-01-01", "2026-1-01", "9999-12-31"]) expect(OpeningDebtDraftSchema.safeParse(debt({ firstDueDate })).success).toBe(false);
  });
  it("bounds item and row allocation and rejects duplicate client IDs while allowing duplicate names", () => {
    const items = Array.from({ length: 100 }, (_, i) => debt({ clientId: `${i}`, count: 60 }));
    expect(DebtAccountCreateInputSchema.safeParse(input(items)).success).toBe(true);
    expect(DebtAccountCreateInputSchema.safeParse(input([...items, debt({ clientId: "101" })])).success).toBe(false);
    expect(DebtAccountCreateInputSchema.safeParse(input(items.map(d => ({ ...d, count: 61 })))).success).toBe(false);
    expect(DebtAccountCreateInputSchema.safeParse(input([debt(), debt()])).success).toBe(false);
  });
  it("accepts only the complete strict result", () => {
    const result = { accountId: randomUUID(), debtItemIds: [randomUUID()], replayed: false };
    expect(DebtAccountCreateResultSchema.parse(result)).toEqual(result);
    for (const bad of [{ ...result, transactionIds: [] }, { ...result, replayed: "false" }, { ...result, debtItemIds: ["bad"] }, { debtItemIds: [], replayed: false }]) expect(DebtAccountCreateResultSchema.safeParse(bad).success).toBe(false);
  });
});
