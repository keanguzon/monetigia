import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TransactionFilterDialog, type TransactionFilterOptionsState } from "@/components/transactions/TransactionFilterDialog";
import { TransactionFilterChips } from "@/components/transactions/TransactionFilterChips";
import { TransactionSortControl } from "@/components/transactions/TransactionSortControl";
import { PeriodBar } from "@/components/transactions/PeriodBar";
import { formatHistoryDateRange } from "@/lib/transactions/history-format";
import { defaultHistoryQuery, type HistoryDateSelection, type HistoryQuery } from "@/lib/transactions/history-query";
import type { HistoryFilterOptions } from "@/lib/transactions/history-filtered";

const walletOne = "11111111-1111-4111-8111-111111111111";
const walletTwo = "22222222-2222-4222-8222-222222222222";
const oldWallet = "33333333-3333-4333-8333-333333333333";
const categoryOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const preset: Extract<HistoryDateSelection, { kind: "preset" }> = { kind: "preset", period: { kind: "month", start: "2026-10-01", end: "2026-10-31" } };
const loadedOptions: HistoryFilterOptions = {
  wallets: [
    { id: walletOne, name: "Daily wallet", type: "cash", isActive: true },
    { id: walletTwo, name: "Travel wallet", type: "cash", isActive: true },
    { id: oldWallet, name: "Archived savings", type: "bank", isActive: false },
  ],
  categories: [{ id: categoryOne, name: "Groceries", type: "expense", color: null }],
};
const readyOptions = { ...loadedOptions, isLoading: false, error: null, retry: vi.fn(async () => undefined) };
const query = (changes: Partial<HistoryQuery> = {}): HistoryQuery => ({ ...defaultHistoryQuery(), ...changes });
afterEach(cleanup);

function renderDialog({
  current = query(),
  dateSelection = { kind: "all" } as HistoryDateSelection,
  options = readyOptions as TransactionFilterOptionsState,
  onApply = vi.fn(),
  onClearAll = vi.fn(),
}: {
  current?: HistoryQuery;
  dateSelection?: HistoryDateSelection;
  options?: TransactionFilterOptionsState;
  onApply?: (filters: Omit<HistoryQuery, "version" | "sort" | "offset">, dateSelection: HistoryDateSelection) => void;
  onClearAll?: () => void;
} = {}) {
  render(<TransactionFilterDialog query={current} dateSelection={dateSelection} options={options} onApply={onApply} onClearAll={onClearAll} />);
  return { onApply, onClearAll };
}

describe("TransactionFilterDialog", () => {
  test("keeps a selected preset when only a wallet draft changes", async () => {
    const user = userEvent.setup();
    const selection: HistoryDateSelection = { ...preset, period: { ...preset.period } };
    const { onApply } = renderDialog({ current: query({ start: preset.period.start, end: preset.period.end, walletIds: [walletOne] }), dateSelection: selection });
    await user.click(screen.getByRole("button", { name: "Filters, 1 active" }));
    expect(screen.getByRole("checkbox", { name: "Archived savings" })).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Travel wallet" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ walletIds: [walletOne, walletTwo], start: preset.period.start, end: preset.period.end }), selection);
  });

  test("uses explicit date edits to replace a preset with a custom range", async () => {
    const user = userEvent.setup();
    const selection: HistoryDateSelection = preset;
    const { onApply } = renderDialog({ current: query({ start: selection.period.start, end: selection.period.end }), dateSelection: selection });
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.clear(screen.getByLabelText("Start date"));
    await user.type(screen.getByLabelText("Start date"), "2026-10-03");
    await user.clear(screen.getByLabelText("End date"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Enter both dates.");
    await user.type(screen.getByLabelText("End date"), "2026-10-15");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ start: "2026-10-03", end: "2026-10-15" }), { kind: "custom", start: "2026-10-03", end: "2026-10-15" });
  });

  test("rejects invalid money and reversed bounds before applying", async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.type(screen.getByLabelText("Minimum amount"), "10.001");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Enter a valid amount.");
    await user.clear(screen.getByLabelText("Minimum amount"));
    await user.type(screen.getByLabelText("Minimum amount"), "20");
    await user.type(screen.getByLabelText("Maximum amount"), "10");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Minimum must not exceed maximum.");
    expect(onApply).not.toHaveBeenCalled();
  });

  test("rejects a reversed custom date range", async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.type(screen.getByLabelText("Start date"), "2026-10-15");
    await user.type(screen.getByLabelText("End date"), "2026-10-14");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toContain("End date must be on or after start date.");
    expect(onApply).not.toHaveBeenCalled();
  });

  test("Cancel discards a changed selection and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    renderDialog({ current: query({ walletIds: [walletOne] }), onApply });
    const trigger = screen.getByRole("button", { name: "Filters, 1 active" });
    await user.click(trigger);
    await user.click(screen.getByRole("checkbox", { name: "Daily wallet" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    expect((screen.getByRole("checkbox", { name: "Daily wallet" }) as HTMLInputElement).checked).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });

  test("discards drafts on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog();
    const trigger = screen.getByRole("button", { name: "Filters" });
    await user.click(trigger);
    await user.click(screen.getByRole("checkbox", { name: "Travel wallet" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onApply).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  test("keeps unavailable selections visible and exposes option loading errors with retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn(async () => undefined);
    const options = { wallets: [], categories: [], isLoading: false, error: new Error("offline"), retry };
    renderDialog({ current: query({ walletIds: [oldWallet] }), options });
    await user.click(screen.getByRole("button", { name: "Filters, 1 active" }));
    expect(screen.getByText("Options couldn't load.")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Unavailable wallet/ })).toBeTruthy();
    expect(screen.queryByText("No wallets.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry options" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  test("shows loading instead of treating empty options as a loaded empty result", async () => {
    const user = userEvent.setup();
    renderDialog({ options: { wallets: [], categories: [], isLoading: true, error: null, retry: vi.fn() } });
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("status", { name: "Loading filter options" })).toBeTruthy();
    expect(screen.queryByText("No wallets.")).toBeNull();
  });

  test("Reset clears only dialog drafts while Clear all calls the global action", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClearAll = vi.fn();
    const selection: HistoryDateSelection = { kind: "custom", start: "2026-10-03", end: "2026-10-15" };
    renderDialog({ current: query({ search: "rent", type: "expense", walletIds: [walletOne], minAmount: "10.00", start: selection.start, end: selection.end }), dateSelection: selection, onApply, onClearAll });
    await user.click(screen.getByRole("button", { name: "Filters, 3 active" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect((screen.getByLabelText("Minimum amount") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("checkbox", { name: "Daily wallet" }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ search: "rent", type: "expense", walletIds: [], minAmount: null, start: null, end: null }), { kind: "all" });
    expect(onClearAll).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Filters, 3 active" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledOnce();
  });
});

describe("TransactionFilterChips", () => {
  test("hides when empty and removes only the selected wallet immediately", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<TransactionFilterChips query={query()} dateSelection={{ kind: "all" }} options={loadedOptions} onChange={onChange} onClearAll={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();
    view.rerender(<TransactionFilterChips query={query({ walletIds: [walletOne, walletTwo] })} dateSelection={{ kind: "all" }} options={loadedOptions} onChange={onChange} onClearAll={vi.fn()} />);
    const row = screen.getByRole("group", { name: "Active filters" });
    expect(row.className).toContain("flex-wrap");
    await user.click(screen.getByRole("button", { name: "Remove Daily wallet filter" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ walletIds: [walletTwo] }), { kind: "all" });
  });

  test("removing the date chip returns to All time and Clear all preserves sort through its parent callback", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClearAll = vi.fn();
    const dateSelection: HistoryDateSelection = { kind: "custom", start: "2026-10-03", end: "2026-10-15" };
    render(<TransactionFilterChips query={query({ sort: "amount_desc", start: dateSelection.start, end: dateSelection.end })} dateSelection={dateSelection} options={loadedOptions} onChange={onChange} onClearAll={onClearAll} />);
    expect(screen.getByText("Oct 3–15, 2026")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove date range filter" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sort: "amount_desc", start: null, end: null }), { kind: "all" });
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });
});

describe("TransactionSortControl", () => {
  test("offers the six sort modes through a native select and the mobile menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TransactionSortControl sort="date_added_desc" onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Sort transactions" }) as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.textContent)).toEqual([
      "Transaction date: newest", "Transaction date: oldest", "Date added: newest", "Date added: oldest", "Amount: highest", "Amount: lowest",
    ]);
    await user.selectOptions(select, "amount_asc");
    expect(onChange).toHaveBeenLastCalledWith("amount_asc");
    await user.click(screen.getByRole("button", { name: "Sort transactions: Date added: newest" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Amount: highest" }));
    expect(onChange).toHaveBeenLastCalledWith("amount_desc");
  });
});

describe("PeriodBar custom date display", () => {
  test("shows custom dates, disables preset stepping, and returns to All time from the period menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PeriodBar period={null} customDateRange={{ start: "2026-10-03", end: "2026-10-15" }} today={new Date(2026, 9, 15)} onChange={onChange} />);
    expect(screen.getByText("Oct 3–15, 2026")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous period" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Choose period" }));
    expect(screen.getByRole("menuitemradio", { name: "Custom range" })).toBeTruthy();
    await user.click(screen.getByRole("menuitemradio", { name: "All time" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  test("uses the shared date-range label and keeps toolbar icons accessible without native titles", () => {
    expect(formatHistoryDateRange("2026-10-03", "2026-10-15")).toBe("Oct 3–15, 2026");
    const view = render(<>
      <TransactionFilterDialog query={query()} dateSelection={{ kind: "all" }} options={readyOptions} onApply={vi.fn()} onClearAll={vi.fn()} />
      <TransactionSortControl sort="date_added_desc" onChange={vi.fn()} />
      <PeriodBar period={null} today={new Date(2026, 9, 15)} onChange={vi.fn()} />
      <TransactionFilterChips query={query({ walletIds: [walletOne] })} dateSelection={{ kind: "all" }} options={loadedOptions} onChange={vi.fn()} onClearAll={vi.fn()} />
    </>);
    const sortTrigger = screen.getByRole("button", { name: "Sort transactions: Date added: newest" });
    expect(sortTrigger.textContent).toBe("");
    expect(sortTrigger.className).toContain("h-11");
    expect(sortTrigger.className).toContain("w-11");
    expect(sortTrigger.getAttribute("aria-label")).toBe("Sort transactions: Date added: newest");
    expect(sortTrigger.closest("[data-tooltip]")?.getAttribute("data-tooltip")).toBe("Sort: Date added: newest");
    expect(view.container.querySelector("[title]")).toBeNull();
  });
});
