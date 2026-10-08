import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
const state = vi.hoisted(() => ({ owner: '', rpc: vi.fn(), account: null as any, refreshFail: false, metadata: [{ id: '20000000-0000-4000-8000-000000000002', currency: 'PHP', is_active: true, type: 'credit_card', name: 'Legacy card' }] }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-goals', () => ({ useGoals: () => ({ userId: state.owner, financeSnapshot: { goals: [], wallets: [] }, isLoading: false, isError: null, refresh: async () => {} }) }));
vi.mock('@/hooks/use-data', () => ({ useAccounts: () => ({ data: state.metadata }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: state.owner } }, error: null }), getSession: async () => ({ data: { session: { user: { id: state.owner }, access_token: 'token' } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, rpc: (...args: unknown[]) => { const promise = Promise.resolve().then(() => state.rpc(...args)); return { setHeader: () => promise, then: promise.then.bind(promise) }; } }) }));
import { LegacyDebtReviewDialog } from '@/components/accounts/LegacyDebtReviewDialog';
import AccountsPage from '@/app/(dashboard)/accounts/page';
const accountId = '20000000-0000-4000-8000-000000000002';
let serial = 0;
beforeEach(() => { state.owner = `10000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`; state.refreshFail = false; state.account = { accountId, totalOutstanding: '5000.00', undatedOutstanding: '5000.00', fingerprint: 'a'.repeat(64), reconciliation: 'balanced', reconciliationDelta: '0.00' }; state.rpc.mockReset().mockImplementation(async (name: string) => name === 'debt_snapshot' ? { data: { accounts: [state.account], rows: [] }, error: state.refreshFail ? { message: 'Unavailable' } : null } : { data: { operationId: accountId, transactionIds: [], replayed: false }, error: null }); });
afterEach(cleanup);
function mount() { const cache = new Map(); return render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}><LegacyDebtReviewDialog isOpen onClose={() => {}} account={state.account} /></SWRConfig>); }
async function fill(amount = '5000') { await waitFor(() => expect((screen.getByRole('button', { name: 'Add another existing debt' }) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole('button', { name: 'Add another existing debt' })); fireEvent.change(screen.getByLabelText('Debt name'), { target: { value: 'Legacy laptop' } }); fireEvent.change(screen.getByLabelText('Remaining debt (PHP)'), { target: { value: amount } }); fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-08' } }); }
function writes() { return state.rpc.mock.calls.filter(([name]) => name === 'goal_finance_apply'); }
test('cancel and mismatched residual never send an adoption command', async () => { mount(); await fill('3000'); fireEvent.click(screen.getByRole('button', { name: 'Review schedule' })); expect(screen.getByRole('alert').textContent).toMatch(/entire/i); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(writes()).toHaveLength(0); });
test('explicit confirmation adopts complete residual with current fingerprint', async () => { mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Review schedule' })); expect(writes()).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Confirm due dates' })); await waitFor(() => expect(writes()).toHaveLength(1)); const command = writes()[0][1].p_command; expect(command.accountId).toBe(accountId); expect(command.fingerprint).toBe('a'.repeat(64)); expect(command.items[0].amount).toBe('5000.00'); });
test('unknown save survives unmount and retry resends frozen full command', async () => { state.rpc.mockImplementation(async (name: string) => { if (name === 'goal_finance_apply') throw new Error('network'); return { data: { accounts: [state.account], rows: [] }, error: null }; }); const view = mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Review schedule' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm due dates' })); await screen.findByRole('button', { name: 'Retry same request' }); const original = structuredClone(writes()[0][1]); view.unmount(); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Retry same request' })); await waitFor(() => expect(writes()).toHaveLength(2)); expect(writes()[1][1]).toEqual(original); expect((screen.getByLabelText('Debt name') as HTMLInputElement).value).toBe('Legacy laptop'); });
test('stale fingerprint keeps draft and requires renewed review against refreshed snapshot', async () => { let stale = true; state.rpc.mockImplementation(async (name: string) => { if (name === 'debt_snapshot') return { data: { accounts: [state.account], rows: [] }, error: null }; if (stale) { stale = false; state.account = { ...state.account, fingerprint: 'b'.repeat(64) }; return { data: null, error: { message: 'STALE_QUOTE' } }; } return { data: { operationId: accountId, transactionIds: [], replayed: false }, error: null }; }); mount(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Review schedule' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm due dates' })); await screen.findByRole('button', { name: 'Review schedule' }); expect((screen.getByLabelText('Debt name') as HTMLInputElement).value).toBe('Legacy laptop'); expect(writes()).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: 'Review schedule' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm due dates' })); await waitFor(() => expect(writes()).toHaveLength(2)); expect(writes()[1][1].p_command.fingerprint).toBe('b'.repeat(64)); });
test('saved refresh failure retries only the snapshot', async () => { mount(); await fill(); state.refreshFail = true; fireEvent.click(screen.getByRole('button', { name: 'Review schedule' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm due dates' })); const retry = await screen.findByRole('button', { name: 'Retry refresh' }); state.refreshFail = false; fireEvent.click(retry); await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry refresh' })).toBeNull()); expect(writes()).toHaveLength(1); });
test('Wallets remount exposes immutable unknown adoption retry after server committed all residual', async () => {
  state.rpc.mockImplementation(async (name: string) => {
    if (name === 'goal_finance_apply') { state.account = { ...state.account, undatedOutstanding: '0.00', fingerprint: 'b'.repeat(64) }; throw new Error('response lost after commit'); }
    return { data: { accounts: [state.account], rows: [] }, error: null };
  });
  const originalView = mount(); await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Review schedule' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm due dates' }));
  await screen.findByRole('button', { name: 'Retry same request' });
  const original = structuredClone(writes()[0][1]); originalView.unmount();
  const cache = new Map();
  render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false }}><AccountsPage /></SWRConfig>);
  await waitFor(() => expect(screen.getByLabelText('Outstanding debt').getAttribute('data-money')).toBe('5000.00'));
  expect(screen.queryByRole('button', { name: 'Review due dates' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Recover due-date save' }));
  expect((await screen.findByLabelText('Debt name') as HTMLInputElement).value).toBe('Legacy laptop');
  expect((screen.getByLabelText('Remaining debt (PHP)') as HTMLInputElement).value).toBe('5000.00');
  state.rpc.mockImplementation(async (name: string) => name === 'goal_finance_apply' ? { data: { operationId: accountId, transactionIds: [], replayed: true }, error: null } : { data: { accounts: [state.account], rows: [] }, error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1][1]).toEqual(original);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Recover due-date save' })).toBeNull());
});

