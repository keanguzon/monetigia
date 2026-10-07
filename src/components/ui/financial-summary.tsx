import { Skeleton } from "./skeleton";
import type { WalletFunds, Money } from "@/lib/goals/contracts";
import { fromMinorUnits, toMinorUnits } from "@/lib/goals/summary";

export const summaryPanelClass = "rounded-2xl border border-border/40 bg-card/40 p-5 sm:p-7 shadow-sm";
export const summaryAmountClass = "text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight";
export const pageTitleClass = "text-2xl sm:text-3xl font-bold tracking-tight text-foreground";

type WalletSummaryAccount = {
  id: string;
  balance: number | string | null;
  type?: string | null;
  include_in_networth?: boolean | null;
  currency?: string | null;
  is_active?: boolean | null;
};

export type WalletFundsSummary = {
  netWorth: Money;
  actual: Money;
  reserved: Money;
  available: Money;
};

function addCents(total: number, amount: number): number {
  const result = total + amount;
  if (!Number.isSafeInteger(result)) throw new Error("Wallet total exceeds the safe centavo range");
  return result;
}

function accountBalanceCents(balance: number | string | null): number {
  const amount = Number(balance ?? 0);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents)) {
    throw new Error("Wallet balance is not a valid amount");
  }
  return cents;
}

export function summarizeWalletFunds(accounts: WalletSummaryAccount[], wallets: WalletFunds[]): WalletFundsSummary {
  const balances = new Map(wallets.map(wallet => [wallet.accountId, wallet]));
  let actual = 0;
  let reserved = 0;
  let available = 0;

  for (const account of accounts) {
    if (account.type === "credit_card" || account.include_in_networth === false) continue;

    const funds = balances.get(account.id);
    if (!funds && account.currency === "PHP" && account.is_active === true) {
      throw new Error("An eligible wallet is missing from the finance snapshot");
    }

    if (funds) {
      actual = addCents(actual, toMinorUnits(funds.actual));
      reserved = addCents(reserved, toMinorUnits(funds.reserved));
      available = addCents(available, toMinorUnits(funds.available));
    } else {
      const balance = accountBalanceCents(account.balance);
      actual = addCents(actual, balance);
      available = addCents(available, balance);
    }
  }

  return {
    netWorth: fromMinorUnits(actual),
    actual: fromMinorUnits(actual),
    reserved: fromMinorUnits(reserved),
    available: fromMinorUnits(available),
  };
}

export function WalletFundsBreakdown({
  summary,
  isLoading,
  error,
}: {
  summary: WalletFundsSummary | null;
  isLoading: boolean;
  error?: unknown;
}) {
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading wallet balances" className="mt-5 grid grid-cols-1 gap-4 border-t border-border/30 pt-4 sm:grid-cols-3 sm:gap-6">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-36 max-w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !summary) {
    return (
      <p role="alert" className="mt-5 border-t border-border/30 pt-4 text-sm text-muted-foreground">
        Wallet balances could not be loaded. Refresh the page to try again.
      </p>
    );
  }

  const values = [
    { label: "Actual wallet balance", amount: summary.actual },
    { label: "Reserved for goals", amount: summary.reserved },
    { label: "Available to spend", amount: summary.available },
  ];

  return (
    <div role="group" aria-label="Wallet funds summary" className="mt-5 grid grid-cols-1 gap-4 border-t border-border/30 pt-4 sm:grid-cols-3 sm:gap-6">
      {values.map(({ label, amount }, index) => (
        <div key={label} className={index > 0 ? "border-t border-border/30 pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0" : "min-w-0"}>
          <p className="text-xs text-muted-foreground">{label}</p>
          <output aria-label={label} data-money={amount} className="mt-1 block break-words font-heading text-lg font-bold tabular-nums text-foreground">
            {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(amount))}
          </output>
        </div>
      ))}
    </div>
  );
}

export function SummarySkeleton({ columns = 3 }: { columns?: 3 | 4 }) {
  return (
    <div role="status" aria-label="Loading summary" className={summaryPanelClass}>
      <div
        className={`grid grid-cols-1 gap-6 sm:gap-8 ${
          columns === 4
            ? "sm:grid-cols-2 lg:grid-cols-4"
            : "sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/30"
        }`}
      >
        {Array.from({ length: columns }, (_, index) => (
          <div
            key={index}
            className={`space-y-3 ${
              columns === 4
                ? "border-t border-border/30 pt-5 first:border-0 first:pt-0 sm:border-t-0 sm:pt-0 sm:even:border-l sm:even:pl-8 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-8"
                : index > 0
                ? "sm:pl-8 pt-4 sm:pt-0"
                : ""
            }`}
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-40 max-w-full" />
            <Skeleton className="h-4 w-32 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
