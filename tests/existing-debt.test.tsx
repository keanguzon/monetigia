import React, { useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ExistingDebtFields, validateExistingDebtFields, type ExistingDebtFieldItem, type ExistingDebtFieldsValue } from "@/components/accounts/ExistingDebtFields";

afterEach(cleanup);
const debt = (overrides: Partial<ExistingDebtFieldItem> = {}): ExistingDebtFieldItem => ({ clientId: "one", name: "Phone", mode: "installments", amountText: "1000", firstDueDate: "2026-01-31", countText: "3", ...overrides });
const validate = (...items: ExistingDebtFieldItem[]) => validateExistingDebtFields({ enabled: true, items });
function Harness({ initial = { enabled: false, items: [] }, disabled = false }: { initial?: ExistingDebtFieldsValue; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <><ExistingDebtFields value={value} onChange={setValue} disabled={disabled} /><output data-testid="draft">{JSON.stringify(value)}</output></>;
}

describe("existing debt validation", () => {
  test("None sends zero without validating retained hidden drafts", () => {
    expect(validateExistingDebtFields({ enabled: false, items: [debt({ amountText: "bad" })] })).toEqual({ success: true, openingDebts: [], total: "0.00" });
    expect(validate()).toEqual({ success: false, errors: { form: expect.any(String) } });
  });
  test("requires name, amount and date with no partial valid payload", () => {
    const result = validate(debt(), debt({ clientId: "two", name: " ", amountText: "", firstDueDate: "" }));
    expect(result).toEqual({ success: false, errors: { "two.name": expect.any(String), "two.amountText": expect.any(String), "two.firstDueDate": expect.any(String) } });
  });
  test("single ignores hidden count and allows overdue dates", () => {
    expect(validate(debt({ mode: "single", countText: "bad", firstDueDate: "2020-01-01" }))).toEqual({ success: true, total: "1000.00", openingDebts: [{ clientId: "one", name: "Phone", mode: "single", amount: "1000.00", firstDueDate: "2020-01-01", count: 1 }] });
  });
  test.each(["2", "02", "24", "600"])("accepts raw count %s", countText => {
    const result = validate(debt({ countText }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.openingDebts[0].count).toBe(Number(countText));
  });
  test.each(["", "0", "601", "2.5", "2e1", "-2", "+2", "abc", " 2", "2 "])("rejects raw count %s", countText => {
    expect(validate(debt({ countText }))).toEqual({ success: false, errors: { "one.countText": expect.any(String) } });
  });
  test("checks dates, centavos, names and amount range", () => {
    for (const overrides of [{ firstDueDate: "2026-02-30" }, { firstDueDate: "0000-01-01" }, { firstDueDate: "9999-12-31" }, { amountText: "0.02" }, { amountText: "0" }, { amountText: "1.001" }, { amountText: "10000000000000" }, { name: "a".repeat(61) }]) expect(validate(debt(overrides)).success).toBe(false);
    expect(validate(debt({ name: "a".repeat(60), mode: "single", amountText: "9999999999999.99" })).success).toBe(true);
  });
  test("sums exactly and bounds aggregate amount, IDs, items and rows", () => {
    const result = validate(debt({ amountText: "16000" }), debt({ clientId: "two", amountText: "3000" }));
    expect(result.success && result.total).toBe("19000.00");
    expect(validate(debt(), debt()).success).toBe(false);
    expect(validate(debt({ amountText: "9999999999999.99" }), debt({ clientId: "two", amountText: "0.03" })).success).toBe(false);
    const items = Array.from({ length: 100 }, (_, i) => debt({ clientId: String(i), countText: "60" }));
    expect(validate(...items).success).toBe(true);
    expect(validate(...items, debt({ clientId: "extra" })).success).toBe(false);
    expect(validate(...items.map((item, i) => i ? item : { ...item, countText: "61" })).success).toBe(false);
  });
});

describe("shared existing debt fields", () => {
  test("defaults to None and retains drafts across the None toggle", () => {
    render(<Harness />);
    expect((screen.getByRole("radio", { name: "None" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Existing debt" }));
    fireEvent.change(screen.getByLabelText("Debt name"), { target: { value: "Phone" } });
    fireEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(screen.queryByLabelText("Debt name")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Existing debt" }));
    expect((screen.getByLabelText("Debt name") as HTMLInputElement).value).toBe("Phone");
  });
  test("preserves pasted invalid count and omits its preview", () => {
    render(<Harness initial={{ enabled: true, items: [debt()] }} />);
    const count = screen.getByLabelText("Remaining installments");
    expect(count.getAttribute("type")).toBe("text");
    expect(count.getAttribute("inputmode")).toBe("numeric");
    fireEvent.change(count, { target: { value: "2e1" } });
    expect((count as HTMLInputElement).value).toBe("2e1");
    expect(screen.queryByRole("table")).toBeNull();
  });
  test("previews approved remainder and month-end dates", () => {
    render(<Harness initial={{ enabled: true, items: [debt()] }} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("₱333.33")).toHaveLength(2);
    expect(within(table).getByText("₱333.34")).toBeTruthy();
    expect(within(table).getByText("2026-03-31")).toBeTruthy();
    expect(screen.getByText("Total existing debt: ₱1,000.00")).toBeTruthy();
  });
  test("renders only three rows until full 600-row schedule is requested", () => {
    render(<Harness initial={{ enabled: true, items: [debt({ countText: "600", amountText: "6" })] }} />);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "View full schedule" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(601);
    fireEvent.click(screen.getByRole("button", { name: "Hide full schedule" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
  });
  test("keeps client IDs stable through edits and removal", () => {
    render(<Harness initial={{ enabled: true, items: [debt(), debt({ clientId: "two", name: "Laptop" })] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add another existing debt" }));
    const before = JSON.parse(screen.getByTestId("draft").textContent!);
    expect(new Set(before.items.map((item: ExistingDebtFieldItem) => item.clientId)).size).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove Phone" }));
    const after = JSON.parse(screen.getByTestId("draft").textContent!);
    expect(after.items.map((item: ExistingDebtFieldItem) => item.clientId)).toEqual(before.items.slice(1).map((item: ExistingDebtFieldItem) => item.clientId));
  });
  test("freezes every control and preview action while disabled", () => {
    render(<Harness disabled initial={{ enabled: true, items: [debt({ countText: "24" })] }} />);
    for (const control of screen.getAllByRole("button")) expect((control as HTMLButtonElement).disabled || control.closest("fieldset")?.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add another existing debt" }));
    expect(JSON.parse(screen.getByTestId("draft").textContent!).items).toHaveLength(1);
  });
  test("exposes supplied errors through named fields", () => {
    render(<ExistingDebtFields value={{ enabled: true, items: [debt()] }} onChange={() => {}} errors={{ "one.amountText": "Enter a valid remaining debt.", form: "Review your debts." }} />);
    const amount = screen.getByLabelText("Remaining debt (PHP)");
    expect(amount.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(amount.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a valid remaining debt.");
    expect(screen.getByText("Review your debts.")).toBeTruthy();
  });
  test("disables adding at either cap with a readable reason", () => {
    const hundred = Array.from({ length: 100 }, (_, index) => debt({ clientId: String(index), name: "", amountText: "", countText: "1" }));
    const view = render(<Harness initial={{ enabled: true, items: hundred }} />);
    expect((screen.getByRole("button", { name: "Add another existing debt" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Maximum 100 existing debts reached.")).toBeTruthy();
    view.unmount();
    render(<Harness initial={{ enabled: true, items: Array.from({ length: 10 }, (_, index) => debt({ clientId: String(index), countText: "600" })) }} />);
    expect((screen.getByRole("button", { name: "Add another existing debt" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Maximum 6000 due rows reached.")).toBeTruthy();
  });
  test("withholds preview until the whole item is valid", () => {
    render(<Harness initial={{ enabled: true, items: [debt({ name: "" })] }} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/Total existing debt/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Debt name"), { target: { value: "Phone" } });
    expect(screen.getByRole("table")).toBeTruthy();
  });
});
