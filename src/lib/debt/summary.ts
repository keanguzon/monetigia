import type { DebtSnapshot } from './contracts';
import type { Money } from '@/lib/money/contracts';
import { MoneySchema } from '@/lib/money/contracts';
function cents(amount: Money) { return BigInt(MoneySchema.parse(amount).replace('.', '')); }
function money(amount: bigint): Money {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Debt total exceeds safe centavo range');
  const digits = amount.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
export function summarizeDebt(snapshot: DebtSnapshot, selectedMonths: string[] | null): { totalOutstanding: Money; scheduledDebt: Money | null; undatedOutstanding: Money; needsReviewAccountIds: string[] } {
  if (selectedMonths?.some(month => !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month))) throw new Error('Select valid YYYY-MM months');
  const months = selectedMonths === null ? null : new Set(selectedMonths);
  const accounts = new Set(snapshot.accounts.map(account => account.accountId));
  const needsReviewAccountIds = snapshot.accounts.filter(account => account.reconciliation === 'needs_review').map(account => account.accountId);
  return {
    totalOutstanding: money(snapshot.accounts.reduce((sum, account) => sum + cents(account.totalOutstanding), BigInt(0))),
    scheduledDebt: needsReviewAccountIds.length ? null : money(snapshot.rows.reduce((sum, row) => accounts.has(row.accountId) && row.dueDate && (months === null || months.has(row.dueDate.slice(0, 7))) ? sum + cents(row.remainingAmount) : sum, BigInt(0))),
    undatedOutstanding: money(snapshot.accounts.reduce((sum, account) => sum + cents(account.undatedOutstanding), BigInt(0))), needsReviewAccountIds,
  };
}
