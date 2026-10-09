import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ui = vi.hoisted(() => ({
  command: null as any,
  submit: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
  refresh: vi.fn(async () => undefined),
  loadTransaction: vi.fn(),
  loadGroup: vi.fn(),
}));

vi.mock("@/hooks/use-transaction-description", () => ({
  useTransactionDescription: () => ({ ...ui.command, submit: ui.submit, retry: ui.retry, reset: ui.reset, refresh: ui.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/transactions/history", () => ({
  groupTransactions: vi.fn(() => []),
  loadHistoryGroup: ui.loadGroup,
  loadHistoryTransaction: ui.loadTransaction,
}));

import TransactionDescriptionEditor from "@/components/transactions/TransactionDescriptionEditor";

function idleCommand() {
  return { isSaving: false, unresolved: false, saved: null, error: null, errorCode: null, refreshError: null, pendingCommand: null };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  ui.command = idleCommand();
});

describe("transaction description editor", () => {
  test("preserves multiline input and accepts 500 Unicode code points without intercepting native selection keys", async () => {
    const user = userEvent.setup();
    render(<TransactionDescriptionEditor
      target={{ transactionId: "transaction-1", groupId: null }}
      currentDescription="Old description"
      userId="owner-1"
      refreshHistory={ui.refresh}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
    />);

    const textarea = screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement;
    await user.click(textarea);
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    expect(textarea.value).toBe("");

    const valid = `first line\n${"a".repeat(488)}🙂`;
    fireEvent.change(textarea, { target: { value: valid } });
    expect(screen.getByText("500/500 code points")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save description" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(textarea, { target: { value: `${valid}🙂` } });
    expect(screen.getByText("501/500 code points")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save description" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: valid } });
    await user.click(screen.getByRole("button", { name: "Save description" }));
    expect(ui.submit).toHaveBeenCalledWith({
      kind: "edit_transaction_description",
      transactionId: "transaction-1",
      groupId: null,
      description: valid,
      expectedDescription: "Old description",
    });
  });

  test("recovers the frozen target and draft after retry reports a stale quote, then requires explicit latest review", async () => {
    const user = userEvent.setup();
    const transactionId = "50000000-0000-4000-8000-000000000005";
    ui.command = {
      ...idleCommand(),
      unresolved: true,
      pendingCommand: {
        kind: "edit_transaction_description",
        transactionId,
        groupId: null,
        description: "draft\nkept",
        expectedDescription: null,
      },
    };
    ui.loadTransaction.mockResolvedValue({ id: transactionId, installment_group_id: null, description: "latest" });
    const props = {
      target: { transactionId: null, groupId: null },
      currentDescription: null,
      userId: "owner-1",
      refreshHistory: ui.refresh,
      onCancel: vi.fn(),
      onSaved: vi.fn(),
    };
    const view = render(<TransactionDescriptionEditor {...props} />);

    expect((screen.getByRole("textbox", { name: "Unconfirmed description" }) as HTMLTextAreaElement).value).toBe("draft\nkept");
    await user.click(screen.getByRole("button", { name: "Retry same edit" }));
    ui.command = { ...idleCommand(), error: "This description changed. Review it before trying again.", errorCode: "STALE_QUOTE" };
    view.rerender(<TransactionDescriptionEditor {...props} />);

    const textarea = screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("draft\nkept");
    await user.click(screen.getByRole("button", { name: "Review latest description" }));
    expect(await screen.findByText(/Latest saved description: latest/)).toBeTruthy();
    await waitFor(() => expect(ui.loadTransaction).toHaveBeenCalledWith(expect.anything(), "owner-1", transactionId));
    await user.click(screen.getByRole("button", { name: "Save description" }));

    expect(ui.submit).toHaveBeenCalledWith({
      kind: "edit_transaction_description",
      transactionId,
      groupId: null,
      description: "draft\nkept",
      expectedDescription: "latest",
    });
  });
});
