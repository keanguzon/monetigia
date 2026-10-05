"use client";

import React, { useState } from "react";
import {
  GripVertical,
  Edit2,
  Trash2,
  Percent,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import {
  accountTypeIcons,
  accountTypeLabels,
  normalizeLogoFilename,
  isCustomAccount,
} from "./WalletTileCard";

interface WalletLedgerViewProps {
  accounts: any[];
  isEditingOrder: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onSelectAccount: (id: string) => void;
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

export function WalletLedgerView({
  accounts,
  isEditingOrder,
  onDragStart,
  onDragOver,
  onDragEnd,
  onSelectAccount,
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
}: WalletLedgerViewProps) {
  const [editingRateId, setEditingRateId] = useState<string | null>(null);

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="border-b border-border/50 text-[11px] uppercase tracking-wider text-muted-foreground/80 font-medium bg-muted/20">
            {isEditingOrder && <th className="w-8 py-3 pl-3"></th>}
            <th className="py-3 px-4">Account / Institution</th>
            <th className="py-3 px-3 hidden sm:table-cell">Type</th>
            <th className="py-3 px-3 hidden md:table-cell">Yield / APR</th>
            <th className="py-3 px-3 hidden lg:table-cell">Net Worth</th>
            <th className="py-3 px-4 text-right">Balance</th>
            <th className="py-3 pr-4 pl-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40 text-foreground">
          {accounts.map((account, index) => {
            const Icon = accountTypeIcons[account.type] || Wallet;
            const isCredit = account.type === "credit_card";
            const numBalance = Number(account.balance || 0);
            const currentRateStr =
              interestRateDraft[account.id] ?? String(Number(account?.interest_rate || 0));

            return (
              <tr
                key={account.id}
                draggable={isEditingOrder}
                onDragStart={() => onDragStart(index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDragEnd={onDragEnd}
                onClick={() => {
                  if (!isEditingOrder && !isCredit) {
                    onSelectAccount(account.id);
                  }
                }}
                className={`group transition-colors ${
                  isEditingOrder
                    ? "cursor-move bg-primary/5 hover:bg-primary/10"
                    : isCredit
                    ? "hover:bg-muted/30"
                    : "cursor-pointer hover:bg-muted/30"
                }`}
              >
                {/* Drag Handle Column */}
                {isEditingOrder && (
                  <td className="py-3.5 pl-3 w-8 text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                  </td>
                )}

                {/* Account Name & Icon */}
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/30"
                      style={{ backgroundColor: `${account.color || "#3b82f6"}15` }}
                    >
                      {account.icon ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`/logos/${normalizeLogoFilename(account.icon)}`}
                          alt={account.name}
                          className="h-5 w-5 object-contain"
                        />
                      ) : (
                        <Icon
                          className="h-4 w-4"
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
                            className="h-7 text-xs px-2 w-32 font-medium"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveAccountName(account.id);
                              if (e.key === "Escape") setEditingAccountId(null);
                            }}
                            onBlur={() => saveAccountName(account.id)}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm tracking-tight text-foreground truncate max-w-[150px] sm:max-w-[200px]">
                            {account.name}
                          </span>
                          {isCustomAccount(account) && !isEditingOrder && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditingAccount(account.id, account.name);
                              }}
                              className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-foreground"
                              title="Rename wallet"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground sm:hidden">
                        {accountTypeLabels[account.type] || "Account"}
                      </p>
                    </div>
                  </div>
                </td>

                {/* Account Type */}
                <td className="py-3.5 px-3 hidden sm:table-cell text-xs text-muted-foreground">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                    {accountTypeLabels[account.type] || "Account"}
                  </span>
                </td>

                {/* Yield / APR */}
                <td className="py-3.5 px-3 hidden md:table-cell text-xs">
                  {account?.is_savings ? (
                    editingRateId === account.id ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
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
                              setEditingRateId(null);
                            }
                            if (e.key === "Escape") {
                              setEditingRateId(null);
                            }
                          }}
                          onBlur={() => {
                            saveInterestRate(account.id);
                            setEditingRateId(null);
                          }}
                          autoFocus
                        />
                        <span className="text-[11px] font-mono text-muted-foreground">%/yr</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRateId(account.id);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-xs font-medium hover:bg-emerald-500/20 transition-colors"
                        title="Click to edit interest rate"
                      >
                        <Percent className="h-3 w-3" />
                        <span>{currentRateStr}% APY</span>
                      </button>
                    )
                  ) : (
                    <span className="text-muted-foreground/60 text-xs">—</span>
                  )}
                </td>

                {/* Net Worth Checkbox */}
                <td className="py-3.5 px-3 hidden lg:table-cell text-xs">
                  {!isCredit ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <label
                        htmlFor={`ledger-networth-${account.id}`}
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          id={`ledger-networth-${account.id}`}
                          checked={account.include_in_networth !== false}
                          onChange={() => toggleIncludeInNetworth(account.id)}
                          className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-0 cursor-pointer"
                        />
                        <span>{account.include_in_networth !== false ? "Included" : "Excluded"}</span>
                      </label>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/60 text-xs">Excluded</span>
                  )}
                </td>

                {/* Balance (Right aligned font-mono tabular-nums) */}
                <td className="py-3.5 px-4 text-right">
                  <span
                    className={`font-semibold font-mono tabular-nums text-sm sm:text-base ${
                      isCredit ? "text-rose-500" : "text-foreground"
                    }`}
                  >
                    {isCredit ? "-" : ""}
                    {formatCurrency(Math.abs(numBalance))}
                  </span>
                </td>

                {/* Actions */}
                <td className="py-3.5 pr-4 pl-2 text-right">
                  <div
                    className="flex items-center justify-end gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isCredit && numBalance > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs font-medium px-2.5 text-rose-500 hover:bg-rose-500 hover:text-white border-rose-500/30"
                        onClick={() => onPayDebt(account.id)}
                      >
                        Pay
                      </Button>
                    )}

                    {!isEditingOrder && (
                      <button
                        type="button"
                        onClick={() => setAccountToDelete(account.id)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete wallet"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
