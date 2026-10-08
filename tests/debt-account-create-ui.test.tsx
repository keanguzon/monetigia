import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddAccountModal from '@/components/accounts/AddAccountModal';
import AddAccountForm from '@/components/forms/AddAccountForm';
const f = vi.hoisted(() => ({ create: vi.fn(), retry: vi.fn(), reset: vi.fn(), refresh: vi.fn(), insert: vi.fn(), close: vi.fn(), push: vi.fn(), toast: vi.fn(), state: {} as any, userId: 'owner' as string | null }));
vi.mock('@/hooks/use-goals', () => ({ useGoals: () => ({ userId: f.userId }) }));
vi.mock('@/hooks/use-debt', () => ({ useDebtAccountCreate: () => ({ ...f.state, create: f.create, retry: f.retry, reset: f.reset }), useDebt: () => ({ refresh: f.refresh }) }));
vi.mock('@/hooks/use-data', () => ({ useAccounts: () => ({ mutate: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: f.userId ? { id: f.userId } : null } }) }, from: () => ({ insert: f.insert }) }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: f.push, refresh: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: f.toast }) }));
vi.mock('next/image', () => ({ default: (props: any) => <img {...props} /> }));
beforeEach(() => { Object.values(f).forEach(v => { if (typeof v === 'function' && 'mockReset' in v) v.mockReset(); }); f.userId = 'owner'; f.state = { isSaving: false, unresolved: false, saved: null, error: null, refreshError: null, pendingInput: null }; f.insert.mockResolvedValue({ error: null }); f.create.mockResolvedValue(undefined); f.refresh.mockResolvedValue(undefined); });
afterEach(cleanup);
const account = { name: 'SPayLater', type: 'credit_card', currency: 'PHP', color: '#10b981', icon: 'Spaylater.png', is_savings: false, interest_rate: 0, include_in_networth: false, display_order: 0 };
const pending = { account, openingDebts: [{ clientId: 'frozen', name: 'Phone', mode: 'installments', amount: '1000.00', firstDueDate: '2026-01-31', count: 3 }] };
const modal = () => <AddAccountModal isOpen onClose={f.close} existingAccounts={[]} />;
function submit() { fireEvent.click(screen.getByRole('button', { name: 'Create Wallet' })); }
async function standaloneCredit() { const view = render(<AddAccountForm />); fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My debt' } }); fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'credit_card' } }); return view; }
test('preset credit None uses exact atomic input without direct insert', async () => { render(modal()); fireEvent.click(screen.getByRole('button', { name: /SPayLater/ })); submit(); await waitFor(() => expect(f.create).toHaveBeenCalledWith({ account, openingDebts: [] })); expect(f.insert).not.toHaveBeenCalled(); });
test('custom credit sends nullable icon and separate scheduled debts', async () => { render(modal()); const section = screen.getByText('PayLater / Debt').parentElement!; fireEvent.click(within(section).getByRole('button', { name: 'Custom' })); fireEvent.change(screen.getByLabelText('Account Name *'), { target: { value: 'My credit' } }); fireEvent.click(screen.getByRole('radio', { name: 'Existing debt' })); fireEvent.change(screen.getByLabelText('Debt name'), { target: { value: 'Phone' } }); fireEvent.change(screen.getByLabelText('Remaining debt (PHP)'), { target: { value: '1000' } }); fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-01-31' } }); submit(); await waitFor(() => expect(f.create).toHaveBeenCalled()); expect(f.create.mock.calls[0][0]).toEqual({ account: { ...account, name: 'My credit', icon: null }, openingDebts: [expect.objectContaining({ name: 'Phone', amount: '1000.00', count: 1 })] }); expect(f.insert).not.toHaveBeenCalled(); });
test('standalone credit None uses exact atomic input', async () => { await standaloneCredit(); submit(); await waitFor(() => expect(f.create).toHaveBeenCalledWith({ account: { ...account, name: 'My debt', color: '#22c55e' }, openingDebts: [] })); expect(f.push).not.toHaveBeenCalled(); expect(f.insert).not.toHaveBeenCalled(); });
test('ordinary preset retains direct insertion', async () => { render(modal()); fireEvent.click(screen.getByRole('button', { name: 'Cash' })); fireEvent.change(screen.getByLabelText('Initial Balance'), { target: { value: '25' } }); submit(); await waitFor(() => expect(f.insert).toHaveBeenCalledWith([expect.objectContaining({ name: 'Cash on Hand', type: 'cash', balance: 25, user_id: 'owner' })])); expect(f.create).not.toHaveBeenCalled(); });
test('unknown modal reopen restores frozen account and draft and retries only', async () => { f.state = { ...f.state, unresolved: true, error: 'Save could not be confirmed', pendingInput: pending }; render(modal()); expect((screen.getByLabelText('Debt name') as HTMLInputElement).value).toBe('Phone'); expect(screen.getByLabelText('Debt name').matches(':disabled')).toBe(true); expect(screen.queryByRole('button', { name: 'Create Wallet' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Retry same save' })); expect(f.retry).toHaveBeenCalledTimes(1); expect(f.create).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(f.close).toHaveBeenCalled(); expect(f.reset).not.toHaveBeenCalled(); });
test('standalone saved refresh failure offers refresh only and routes after recovery', async () => { f.state = { ...f.state, saved: { accountId: 'created' }, refreshError: new Error('offline') }; render(<AddAccountForm />); fireEvent.click(screen.getByRole('button', { name: 'Refresh views' })); await waitFor(() => expect(f.push).toHaveBeenCalledWith('/accounts')); expect(f.create).not.toHaveBeenCalled(); expect(f.retry).not.toHaveBeenCalled(); });
test('known rejection retains submitted standalone draft and error', async () => {
  const view = await standaloneCredit();
  fireEvent.click(screen.getByRole('radio', { name: 'Existing debt' }));
  fireEvent.change(screen.getByLabelText('Debt name'), { target: { value: 'Phone' } });
  f.state = { ...f.state, isSaving: true, pendingInput: { ...pending, account: { ...account, name: 'My debt' } } };
  view.rerender(<AddAccountForm />);
  f.state = { ...f.state, isSaving: false, pendingInput: null, error: 'Save rejected' };
  view.rerender(<AddAccountForm />);
  expect(screen.getByRole('alert').textContent).toContain('Save rejected');
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('My debt');
  expect((screen.getByLabelText('Debt name') as HTMLInputElement).value).toBe('Phone');
  expect(screen.getByLabelText('Name').matches(':disabled')).toBe(false);
});
test('modal has labelled Radix modal, bounded scroll body and linked fixed footer', async () => { render(modal()); const dialog = screen.getByRole('dialog', { name: 'Add New Account' }); expect(dialog.getAttribute('data-mobile-nav-blocking')).not.toBeNull(); const button = screen.getByRole('button', { name: 'Create Wallet' }); expect((button as HTMLButtonElement).form).not.toBeNull(); expect(button.parentElement!.className).toContain('shrink-0'); expect(button.parentElement!.getAttribute('style')).toContain('safe-area-inset-bottom'); fireEvent.keyDown(dialog, { key: 'Escape' }); await waitFor(() => expect(f.close).toHaveBeenCalledTimes(1)); expect(f.insert).not.toHaveBeenCalled(); });
test('Enter and immediate duplicate submit start one credit save', async () => { const user = userEvent.setup(); render(modal()); fireEvent.click(screen.getByRole('button', { name: /SPayLater/ })); f.create.mockReturnValue(new Promise(() => {})); const button = screen.getByRole('button', { name: 'Create Wallet' }); button.focus(); await user.keyboard('{Enter}'); fireEvent.submit((button as HTMLButtonElement).form!); await waitFor(() => expect(f.create).toHaveBeenCalledTimes(1)); });
test('signed-out standalone shows reachable feedback and writes nothing', async () => { f.userId = null; await standaloneCredit(); submit(); await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Sign in')); expect(f.create).not.toHaveBeenCalled(); expect(f.insert).not.toHaveBeenCalled(); });


test('known rejection keeps the submitted modal draft editable', async () => {
  const view = render(modal());
  fireEvent.click(screen.getByRole('button', { name: /SPayLater/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'Existing debt' }));
  fireEvent.change(screen.getByLabelText('Debt name'), { target: { value: 'Phone' } });
  f.state = { ...f.state, isSaving: true, pendingInput: pending };
  view.rerender(modal());
  f.state = { ...f.state, isSaving: false, pendingInput: null, error: 'Save rejected' };
  view.rerender(modal());
  expect((screen.getByLabelText('Debt name') as HTMLInputElement).value).toBe('Phone');
  expect(screen.getByLabelText('Debt name').matches(':disabled')).toBe(false);
  expect(screen.getByRole('alert').textContent).toContain('Save rejected');
});

test('standalone pending input restores original null icon and raw frozen schedule on remount', async () => {
  f.state = { ...f.state, unresolved: true, pendingInput: { ...pending, account: { ...account, name: 'Original custom debt', icon: null } } };
  const first = render(<AddAccountForm />);
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Original custom debt');
  expect((screen.getByLabelText('Remaining installments') as HTMLInputElement).value).toBe('3');
  expect(screen.getByLabelText('Debt name').matches(':disabled')).toBe(true);
  expect(screen.getAllByRole('radio').filter(r => r.getAttribute('name') === 'icon').every(r => !(r as HTMLInputElement).checked)).toBe(true);
  first.unmount();
  render(<AddAccountForm />);
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Original custom debt');
  fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
  expect(f.retry).toHaveBeenCalledTimes(1);
  expect(f.create).not.toHaveBeenCalled();
});

test('switching standalone to ordinary wallet discards hidden credit debts from insertion', async () => {
  await standaloneCredit();
  fireEvent.click(screen.getByRole('radio', { name: 'Existing debt' }));
  fireEvent.change(screen.getByLabelText('Debt name'), { target: { value: 'Hidden debt' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'cash' } });
  submit();
  await waitFor(() => expect(f.insert).toHaveBeenCalledWith({ user_id: 'owner', name: 'My debt', type: 'cash', balance: 0, currency: 'PHP', color: '#22c55e', icon: null }));
  expect(f.create).not.toHaveBeenCalled();
});

test('saved modal refresh failure refreshes views and closes without another create', async () => {
  f.state = { ...f.state, saved: { accountId: 'created' }, refreshError: new Error('offline') };
  render(modal());
  expect(screen.queryByRole('button', { name: 'Create Wallet' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh views' }));
  await waitFor(() => expect(f.close).toHaveBeenCalledTimes(1));
  expect(f.refresh).toHaveBeenCalledTimes(1);
  expect(f.create).not.toHaveBeenCalled();
});

test('standalone sends separate exact debts and prevents partial invalid creation', async () => {
  await standaloneCredit();
  fireEvent.click(screen.getByRole('radio', { name: 'Existing debt' }));
  fireEvent.change(screen.getByLabelText('Debt name'), { target: { value: 'Phone' } });
  fireEvent.change(screen.getByLabelText('Remaining debt (PHP)'), { target: { value: '16000' } });
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-01-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add another existing debt' }));
  submit();
  expect(f.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getAllByLabelText('Debt name')[1], { target: { value: 'Laptop' } });
  fireEvent.change(screen.getAllByLabelText('Remaining debt (PHP)')[1], { target: { value: '3000' } });
  fireEvent.change(screen.getAllByLabelText('Due date')[1], { target: { value: '2026-02-01' } });
  submit();
  await waitFor(() => expect(f.create).toHaveBeenCalledTimes(1));
  const input = f.create.mock.calls[0][0];
  expect(input.openingDebts).toEqual([
    { clientId: expect.any(String), name: 'Phone', mode: 'single', amount: '16000.00', firstDueDate: '2026-01-31', count: 1 },
    { clientId: expect.any(String), name: 'Laptop', mode: 'single', amount: '3000.00', firstDueDate: '2026-02-01', count: 1 },
  ]);
  expect(input.openingDebts[0].clientId).not.toBe(input.openingDebts[1].clientId);
  expect(f.insert).not.toHaveBeenCalled();
});

test('unknown modal attempt survives closing and an actual unmount before reopen', async () => {
  f.state = { ...f.state, unresolved: true, pendingInput: pending };
  const first = render(modal());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  first.unmount();
  render(modal());
  expect((screen.getByLabelText('Debt name') as HTMLInputElement).value).toBe('Phone');
  expect((screen.getByLabelText('Remaining installments') as HTMLInputElement).value).toBe('3');
  expect(screen.getByLabelText('Debt name').matches(':disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'GCash' }).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry same save' }));
  expect(f.retry).toHaveBeenCalledTimes(1);
  expect(f.reset).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});

test('modal traps focus and Escape returns it to the opener without writing', async () => {
  const user = userEvent.setup();
  function Harness() {
    const [open, setOpen] = React.useState(false);
    return <><button onClick={() => setOpen(true)}>Add wallet opener</button><AddAccountModal isOpen={open} onClose={() => setOpen(false)} existingAccounts={[]} /></>;
  }
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Add wallet opener' });
  await user.click(opener);
  const dialog = screen.getByRole('dialog');
  const footerButton = screen.getByRole('button', { name: 'Cancel' });
  footerButton.focus();
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(f.create).not.toHaveBeenCalled();
  expect(f.insert).not.toHaveBeenCalled();
});

test('modal captures opener before layout effects move focus during opening', async () => {
  const user = userEvent.setup();
  function Harness() {
    const [open, setOpen] = React.useState(false);
    const decoy = React.useRef<HTMLButtonElement>(null);
    React.useLayoutEffect(() => { if (open) decoy.current?.focus(); }, [open]);
    return <><button onClick={() => setOpen(true)}>Original opener</button><button ref={decoy}>Other control</button><AddAccountModal isOpen={open} onClose={() => setOpen(false)} existingAccounts={[]} /></>;
  }
  render(<Harness />);
  const original = screen.getByRole('button', { name: 'Original opener' });
  await user.click(original);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(original));
});
