"use client";

import React, { useState } from "react";
import {
  Wallet,
  CreditCard,
  Landmark,
  Smartphone,
  TrendingUp,
  GripVertical,
  Edit2,
  Trash2,
  Percent,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

export const accountTypeIcons: Record<string, React.ElementType> = {
  cash: Wallet,
  bank: Landmark,
  credit_card: CreditCard,
  e_wallet: Smartphone,
  investment: TrendingUp,
};

export const accountTypeLabels: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  credit_card: "Credit / PayLater",
  e_wallet: "E-Wallet",
  investment: "Investment",
};

export function normalizeLogoFilename(filename: string) {
  const cleaned = filename.replace(/^\/?logos\//i, "").replace(/^\//, "");
  return cleaned.replace(/\.avif$/i, ".png");
}

export function isCustomAccount(account: any) {
  return !account.icon && account.name !== "Cash on Hand";
}

interface WalletTileCardProps {
  account: any;
  index: number;
  isEditingOrder: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onClick: () => void;
  editingAccountId: string | null;
  editingAccountName: string;
  setEditingAccountName: (name: string) => void;
  startEditingAccount: (id: string, name: string) => void;
  saveAccountName: (id: string) => void;
  setEditingAccountId: (id: string | null) => void;
  setAccountToDelete: (id: string) => void;
  toggleIncludeInNetworth: (id: string) => void;
  interestRateDraft: Record<string, string>;
  setInterestRateDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saveInterestRate: (id: string) => void;
  onPayDebt: (id: string) => void;
}

export function WalletTileCard({
  account,
  index,
  isEditingOrder,
  onDragStart,
  onDragOver,
  onDragEnd,
  onClick,
  editingAccountId,
  editingAccountName,
  setEditingAccountName,
  startEditingAccount,
  saveAccountName,
  setEditingAccountId,
  setAccountToDelete,
  toggleIncludeInNetworth,
  interestRateDraft,
  setInterestRateDraft,
  saveInterestRate,
  onPayDebt,
}: WalletTileCardProps) {
  const [isEditingRateInline, setIsEditingRateInline] = useState(false);
  const Icon = accountTypeIcons[account.type] || Wallet;
  const isCredit = account.type === "credit_card";
  const numBalance = Number(account.balance || 0);

  // Interest rate value
  const currentRateStr =
    interestRateDraft[account.id] ?? String(Number(account?.interest_rate || 0));

  return (
    <div
      draggable={isEditingOrder}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (!isEditingOrder && !isCredit) {
          onClick();
        }
      }}
      className={`group relative flex flex-col justify-between rounded-xl p-3 sm:p-4 transition-all duration-200 ${
        isEditingOrder
          ? "cursor-move border-2 border-dashed border-primary/50 bg-primary/5 shadow-sm"
          : isCredit
          ? "border border-border/50 bg-card/60 hover:border-border hover:bg-card/90"
          : "cursor-pointer border border-border/50 bg-card/60 hover:border-border hover:bg-card/90 hover:shadow-sm"
      }`}
    >
      {/* Header Row: Logo/Icon, Name, Badge, Actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div
            className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg border border-border/30 transition-transform group-hover:scale-105"
            style={{ backgroundColor: `${account.color || "#3b82f6"}15` }}
          >
            {account.icon ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/logos/${normalizeLogoFilename(account.icon)}`}
                alt={account.name}
                className="h-4 w-4 sm:h-5 sm:w-5 object-contain"
              />
            ) : (
              <Icon
                className="h-4 w-4 sm:h-4.5 sm:w-4.5"
                style={{ color: account.color || "#22c55e" }}
              />
            )}
          </div>

          <div className="min-w-0">
            {editingAccountId === account.id ? (
              <div
                className="flex items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <Input
                  value={editingAccountName}
                  onChange={(e) => setEditingAccountName(e.target.value)}
                  className="h-6 sm:h-7 text-xs px-1.5 sm:px-2 w-24 sm:w-32 font-medium"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveAccountName(account.id);
                    if (e.key === "Escape") setEditingAccountId(null);
                  }}
                  onBlur={() => saveAccountName(account.id)}
                />
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className="font-semibold text-xs sm:text-sm tracking-tight text-foreground truncate max-w-[85px] sm:max-w-[140px]">
                  {account.name}
                </span>
                {isCustomAccount(account) && !isEditingOrder && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditingAccount(account.id, account.name);
                    }}
                    className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-0.5 text-muted-foreground hover:text-foreground"
                    title="Rename wallet"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground truncate">
              {accountTypeLabels[account.type] || "Account"}
            </p>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isEditingOrder ? (
            <div className="p-0.5 text-muted-foreground">
              <GripVertical className="h-4 w-4" />
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAccountToDelete(account.id);
              }}
              className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Delete wallet"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Center: Prominent Balance Display */}
      <div className="my-2.5 sm:my-3.5">
        <div className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground/80 font-medium truncate">
          {isCredit ? "Statement Balance" : "Current Balance"}
        </div>
        <div
          className={`text-base sm:text-xl font-bold font-mono tabular-nums tracking-tight mt-0.5 truncate ${
            isCredit ? "text-rose-500" : "text-foreground"
          }`}
        >
          {isCredit ? "-" : ""}
          {formatCurrency(Math.abs(numBalance))}
        </div>
      </div>

      {/* Footer Strip: Yield / Net Worth / Pay Debt */}
      <div
        className="pt-2 sm:pt-2.5 border-t border-border/40 flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Net Worth or Savings Yield */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {!isCredit && (
            <label
              htmlFor={`tile-networth-${account.id}`}
              className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-muted-foreground hover:text-foreground cursor-pointer select-none"
            >
              <input
                type="checkbox"
                id={`tile-networth-${account.id}`}
                checked={account.include_in_networth !== false}
                onChange={() => toggleIncludeInNetworth(account.id)}
                className="h-3 w-3 sm:h-3.5 sm:w-3.5 rounded border-border text-primary focus:ring-0 cursor-pointer"
              />
              <span className="hidden xs:inline">Net Worth</span>
              <span className="xs:hidden">NW</span>
            </label>
          )}

          {account?.is_savings && (
            <div className="flex items-center gap-1">
              {isEditingRateInline ? (
                <div className="flex items-center gap-1">
                  <Input
                    inputMode="decimal"
                    type="number"
                    step="0.01"
                    min={0}
                    className="h-6 w-16 px-1.5 text-xs font-mono"
                    value={currentRateStr}
                    onChange={(e) =>
                      setInterestRateDraft((prev) => ({
                        ...prev,
                        [account.id]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        saveInterestRate(account.id);
                        setIsEditingRateInline(false);
                      }
                      if (e.key === "Escape") {
                        setIsEditingRateInline(false);
                      }
                    }}
                    onBlur={() => {
                      saveInterestRate(account.id);
                      setIsEditingRateInline(false);
                    }}
                    autoFocus
                  />
                  <span className="text-[11px] font-mono text-muted-foreground">%/yr</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingRateInline(true)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-medium hover:bg-emerald-500/20 transition-colors"
                  title="Click to edit interest rate"
                >
                  <Percent className="h-3 w-3" />
                  <span>{currentRateStr}% APY</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: Pay Debt button if credit card */}
        {isCredit && numBalance > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] font-medium px-2.5 text-rose-500 hover:bg-rose-500 hover:text-white border-rose-500/30"
            onClick={() => onPayDebt(account.id)}
          >
            Pay Debt
          </Button>
        )}
      </div>
    </div>
  );
}
