import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ write: vi.fn(), toast: vi.fn(), name: "Food", deleted: false }));
const owner = "10000000-0000-4000-8000-000000000001";
const categoryId = "20000000-0000-4000-8000-000000000001";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
  from: () => {
    let operation = "read"; let name: string;
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder,
      update: (value: { name: string }) => { operation = "rename"; name = value.name; return builder; },
      delete: () => { operation = "delete"; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(async () => {
        if (operation !== "read") { const result = await state.write(operation, name); if (!result.error) { if (operation === "rename") state.name = name; else state.deleted = true; } return result; }
        return { data: state.deleted ? [] : [{ id: categoryId, name: state.name, type: "expense", user_id: owner }], error: null };
      }).then(resolve, reject),
    }; return builder;
  },
}) }));
import CategoriesPage from "@/app/(dashboard)/categories/page";
let failure: Error | null;
function SummaryProbe() {
  const summary = useSWR(["spending-summary", owner, "2026-10-01", "2026-10-15"], () => { if (failure) throw failure; return state.deleted ? "Uncategorized" : state.name; });
  return <output aria-label="summary category">{summary.data}</output>;
}
function show() {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}><CategoriesPage /><SummaryProbe /></SWRConfig>);
}
async function rename() {
  await screen.findByText("Food", { selector: "span" });
  fireEvent.click(document.querySelector('[data-tooltip="Rename category"]')!);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Groceries" } }); fireEvent.keyDown(input, { key: "Enter" });
}
beforeEach(() => { state.name = "Food"; state.deleted = false; state.write.mockReset().mockResolvedValue({ data: null, error: null }); state.toast.mockReset(); failure = null; vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("confirmed category rename refreshes the spending category label", async () => {
  show(); await rename();
  await waitFor(() => expect(screen.getByLabelText("summary category").textContent).toBe("Groceries"));
});
test("confirmed category deletion refreshes the spending Uncategorized bucket", async () => {
  show(); await screen.findByText("Food", { selector: "span" }); fireEvent.click(document.querySelector('[data-tooltip="Delete category"]')!);
  await waitFor(() => expect(screen.getByLabelText("summary category").textContent).toBe("Uncategorized"));
});
test("a saved category with failed refresh reports the distinction without replaying its write", async () => {
  show(); await screen.findByText("Food", { selector: "span" }); failure = new Error("summary offline"); await rename();
  await waitFor(() => expect(state.toast.mock.calls.some(([toast]) => toast.title === "Category saved, refresh failed")).toBe(true));
  expect(state.write).toHaveBeenCalledTimes(1); expect(screen.getByLabelText("summary category").textContent).toBe("Food");
});
test("a rejected category rename never refreshes the spending summary", async () => {
  state.write.mockResolvedValue({ data: null, error: new Error("rejected") }); show(); await rename();
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Error" })));
  expect(screen.getByLabelText("summary category").textContent).toBe("Food");
});
