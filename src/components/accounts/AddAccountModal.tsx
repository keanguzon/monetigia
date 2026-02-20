"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { X, Plus } from "lucide-react";

interface AccountOption {
  type: "cash" | "bank" | "credit_card" | "e_wallet" | "investment";
  icon: string;
  name: string;
  color: string;
  isSavings: boolean;
  isCustom?: boolean;
}

const accountOptions: AccountOption[] = [
  // Wallet Category
  { type: "e_wallet", icon: "gcash.png", name: "GCash", color: "#007DFE", isSavings: false },
  { type: "e_wallet", icon: "maya.png", name: "Maya", color: "#10b981", isSavings: false },
  { type: "bank", icon: "gotyme.png", name: "GoTyme", color: "#06b6d4", isSavings: false },
  { type: "cash", icon: "", name: "Cash on Hand", color: "#86efac", isSavings: false },
  // Savings Category
  { type: "e_wallet", icon: "gcash.png", name: "GCash Savings", color: "#007DFE", isSavings: true },
  { type: "e_wallet", icon: "maya.png", name: "Maya Savings", color: "#10b981", isSavings: true },
  { type: "bank", icon: "gotyme.png", name: "GoTyme Savings", color: "#06b6d4", isSavings: true },
  { type: "bank", icon: "seabank.png", name: "SeaBank Savings", color: "#FF6B00", isSavings: true },
  // PayLater / Debt (tracked as credit_card)
  { type: "credit_card", icon: "Spaylater.png", name: "SPayLater", color: "#10b981", isSavings: false },
  { type: "credit_card", icon: "Metrobank.webp", name: "Metrobank", color: "#007DFE", isSavings: false },
  { type: "credit_card", icon: "tiktok.png", name: "TikTok PayLater", color: "#000000", isSavings: false },
];

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingAccounts: Array<{ icon: string; is_savings: boolean }>;
}

export default function AddAccountModal({ isOpen, onClose, existingAccounts }: AddAccountModalProps) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();

  const [selectedAccount, setSelectedAccount] = useState<AccountOption | null>(null);
  const [balance, setBalance] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [includeNetworth, setIncludeNetworth] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Custom wallet states
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customColor, setCustomColor] = useState("#10b981");
  const [customCategory, setCustomCategory] = useState<"wallet" | "savings" | "paylater">("wallet");
  const [customType, setCustomType] = useState<"cash" | "bank" | "credit_card" | "e_wallet">("e_wallet");

  const customColors = [
    "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6",
    "#ec4899", "#f43f5e", "#f59e0b", "#84cc16"
  ];

  // When account type changes, reset balance and adjust includeNetworth
  React.useEffect(() => {
    if (selectedAccount?.type === "credit_card") {
      setBalance("0");
      setIncludeNetworth(false); // Debt accounts shouldn't increase net worth
    }
  }, [selectedAccount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount && !isCreatingCustom) return;
    if (isCreatingCustom && !customName.trim()) {
      toast({ title: "Name required", description: "Please enter a name for your custom wallet", variant: "destructive" });
      return;
    }

    setIsLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        toast({ title: "Not signed in", description: "You must be signed in to add accounts", variant: "destructive" });
        return;
      }

      let accountData: any;

      if (isCreatingCustom) {
        const isSavings = customCategory === "savings";
        const isDebt = customCategory === "paylater";
        const accountType = isDebt ? "credit_card" : customType;

        accountData = {
          user_id: user.id,
          name: customName.trim(),
          type: accountType,
          balance: Number(balance || 0),
          currency: "PHP",
          color: customColor,
          icon: "", // No icon for custom wallets
          is_savings: isSavings,
          interest_rate: isSavings ? Number(interestRate || 0) : 0,
          include_in_networth: isDebt ? false : includeNetworth,
        };
      } else {
        accountData = {
          user_id: user.id,
          name: selectedAccount!.name,
          type: selectedAccount!.type,
          balance: Number(balance || 0),
          currency: "PHP",
          color: selectedAccount!.color,
          icon: selectedAccount!.icon,
          is_savings: selectedAccount!.isSavings,
          interest_rate: selectedAccount!.isSavings ? Number(interestRate || 0) : 0,
          include_in_networth: includeNetworth,
        };
      }

      const { error } = await (supabase as any).from("accounts").insert([accountData]);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Account added", description: "Your account was created successfully." });

      // Reset states
      setSelectedAccount(null);
      setIsCreatingCustom(false);
      setCustomName("");
      setCustomColor("#10b981");
      setCustomCategory("wallet");
      setBalance("");
      setInterestRate("");

      onClose();
      router.refresh();
    } catch (err) {
      toast({ title: "Error", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Check if an account option is already added (duplicate check)
  const isAccountDisabled = (option: AccountOption) => {
    return existingAccounts.some(
      (acc) => option.icon && acc.icon === option.icon && acc.is_savings === option.isSavings
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b dark:border-slate-700 flex-shrink-0">
          <h3 className="text-xl font-semibold">Add New Account</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all duration-200 hover:rotate-90"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-6 space-y-6 overflow-y-auto flex-1">
            {/* Wallet Category */}
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Wallet</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {accountOptions
                  .filter((opt) => !opt.isSavings && opt.type !== "credit_card")
                  .map((option, idx) => {
                    const isDisabled = isAccountDisabled(option);
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && setSelectedAccount(option)}
                        className={`
                          flex flex-col items-center p-4 border-2 rounded-xl transition-all
                          ${isDisabled
                            ? "opacity-40 cursor-not-allowed border-gray-200 dark:border-slate-700"
                            : selectedAccount === option
                              ? "border-primary shadow-lg"
                              : "border-gray-200 dark:border-slate-700 hover:border-primary/50"
                          }
                        `}
                        style={
                          !isDisabled && selectedAccount === option
                            ? { borderColor: option.color, boxShadow: `0 4px 12px ${option.color}40` }
                            : {}
                        }
                      >
                        <div className="w-12 h-12 mb-2 flex items-center justify-center bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-700">
                          {option.icon ? (
                            <Image src={`/logos/${option.icon}`} alt={option.name} width={40} height={40} className="w-10 h-10 object-contain" />
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={option.color} strokeWidth="2">
                              <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path>
                              <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path>
                              <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path>
                            </svg>
                          )}
                        </div>
                        <span className="text-sm font-medium text-center">{option.name.split(" ")[0]}</span>
                      </button>
                    );
                  })}
                {/* Custom Wallet Button */}
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingCustom(true);
                    setSelectedAccount(null);
                    setCustomCategory("wallet");
                  }}
                  className={`
                    flex flex-col items-center p-4 border-2 rounded-xl transition-all
                    ${isCreatingCustom && customCategory === "wallet"
                      ? "border-primary shadow-lg"
                      : "border-dashed border-gray-300 dark:border-slate-600 hover:border-primary/50 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }
                  `}
                >
                  <div className="w-12 h-12 mb-2 flex items-center justify-center bg-primary/10 rounded-lg">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-center">Custom</span>
                </button>
              </div>
            </div>

            {/* Savings Category */}
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Savings</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {accountOptions
                  .filter((opt) => opt.isSavings)
                  .map((option, idx) => {
                    const isDisabled = isAccountDisabled(option);
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && setSelectedAccount(option)}
                        className={`
                          flex flex-col items-center p-4 border-2 rounded-xl transition-all
                          ${isDisabled
                            ? "opacity-40 cursor-not-allowed border-gray-200 dark:border-slate-700"
                            : selectedAccount === option
                              ? "border-primary shadow-lg"
                              : "border-gray-200 dark:border-slate-700 hover:border-primary/50"
                          }
                        `}
                        style={
                          !isDisabled && selectedAccount === option
                            ? { borderColor: option.color, boxShadow: `0 4px 12px ${option.color}40` }
                            : {}
                        }
                      >
                        <div className="w-12 h-12 mb-2 flex items-center justify-center bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-700">
                          {option.icon ? (
                            <Image src={`/logos/${option.icon}`} alt={option.name} width={40} height={40} className="w-10 h-10 object-contain" />
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={option.color} strokeWidth="2">
                              <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path>
                              <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path>
                              <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path>
                            </svg>
                          )}
                        </div>
                        <span className="text-sm font-medium text-center">{option.name.split(" ")[0]}</span>
                      </button>
                    );
                  })}
                {/* Custom Savings Button */}
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingCustom(true);
                    setSelectedAccount(null);
                    setCustomCategory("savings");
                  }}
                  className={`
                    flex flex-col items-center p-4 border-2 rounded-xl transition-all
                    ${isCreatingCustom && customCategory === "savings"
                      ? "border-primary shadow-lg"
                      : "border-dashed border-gray-300 dark:border-slate-600 hover:border-primary/50 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }
                  `}
                >
                  <div className="w-12 h-12 mb-2 flex items-center justify-center bg-primary/10 rounded-lg">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-center">Custom</span>
                </button>
              </div>
            </div>

            {/* PayLater / Debt Category */}
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">PayLater / Debt</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Track your buy-now-pay-later purchases. Your cash won't decrease until you record a payment.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {accountOptions
                  .filter((opt) => !opt.isSavings && opt.type === "credit_card")
                  .map((option, idx) => {
                    const isDisabled = isAccountDisabled(option);
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => !isDisabled && setSelectedAccount(option)}
                        className={`
                          flex flex-col items-center p-4 border-2 rounded-xl transition-all
                          ${isDisabled
                            ? "opacity-40 cursor-not-allowed border-gray-200 dark:border-slate-700"
                            : selectedAccount === option
                              ? "border-primary shadow-lg"
                              : "border-gray-200 dark:border-slate-700 hover:border-primary/50"
                          }
                        `}
                        style={
                          !isDisabled && selectedAccount === option
                            ? { borderColor: option.color, boxShadow: `0 4px 12px ${option.color}40` }
                            : {}
                        }
                      >
                        <div className="w-12 h-12 mb-2 flex items-center justify-center bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-700">
                          {option.icon ? (
                            <Image src={`/logos/${option.icon}`} alt={option.name} width={40} height={40} className="w-10 h-10 object-contain" />
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={option.color} strokeWidth="2">
                              <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                              <path d="M2 10h20"></path>
                            </svg>
                          )}
                        </div>
                        <span className="text-xs font-medium text-center leading-tight">{option.name}</span>
                      </button>
                    );
                  })}
                {/* Custom PayLater Button */}
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingCustom(true);
                    setSelectedAccount(null);
                    setCustomCategory("paylater");
                  }}
                  className={`
                    flex flex-col items-center p-4 border-2 rounded-xl transition-all
                    ${isCreatingCustom && customCategory === "paylater"
                      ? "border-primary shadow-lg"
                      : "border-dashed border-gray-300 dark:border-slate-600 hover:border-primary/50 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }
                  `}
                >
                  <div className="w-12 h-12 mb-2 flex items-center justify-center bg-primary/10 rounded-lg">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-center">Custom</span>
                </button>
              </div>
            </div>

            {/* Custom Wallet Form */}
            {isCreatingCustom && (
              <div className="space-y-4 p-4 border-2 border-primary/20 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                <h4 className="text-sm font-semibold">Create Custom {customCategory === "wallet" ? "Wallet" : customCategory === "savings" ? "Savings Account" : "PayLater Account"}</h4>

                {/* Account Name */}
                <div>
                  <label htmlFor="customName" className="block text-sm font-medium mb-2">
                    Account Name *
                  </label>
                  <input
                    type="text"
                    id="customName"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700"
                    placeholder="e.g., My Cash, Emergency Fund, Credit Card"
                    required
                  />
                </div>

                {/* Color Picker */}
                <div>
                  <label htmlFor="customColor" className="block text-sm font-medium mb-2">
                    Color *
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      id="customColor"
                      value={customColor}
                      onChange={(e) => setCustomColor(e.target.value)}
                      className="w-16 h-10 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={customColor}
                      onChange={(e) => setCustomColor(e.target.value)}
                      className="flex-1 px-4 py-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700 font-mono text-sm"
                      placeholder="#3b82f6"
                      pattern="^#[0-9A-Fa-f]{6}$"
                    />
                  </div>
                </div>

                {/* Account Type */}
                <div>
                  <label htmlFor="customType" className="block text-sm font-medium mb-2">
                    Account Type *
                  </label>
                  <select
                    id="customType"
                    value={customType}
                    onChange={(e) => setCustomType(e.target.value as "cash" | "bank" | "e_wallet" | "credit_card")}
                    className="w-full px-4 py-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700"
                    required
                  >
                    {customCategory === "wallet" && (
                      <>
                        <option value="cash">Cash</option>
                        <option value="bank">Bank Account</option>
                        <option value="e_wallet">E-Wallet</option>
                      </>
                    )}
                    {customCategory === "savings" && (
                      <>
                        <option value="bank">Bank Savings</option>
                        <option value="e_wallet">E-Wallet Savings</option>
                      </>
                    )}
                    {customCategory === "paylater" && (
                      <option value="credit_card">Credit Card / PayLater</option>
                    )}
                  </select>
                </div>
              </div>
            )}

            {/* Show form fields only if an account is selected or creating custom */}
            {(selectedAccount || isCreatingCustom) && (
              <>
                {/* Include in Net Worth - hide for debt accounts */}
                {((selectedAccount && selectedAccount.type !== "credit_card") || (isCreatingCustom && customCategory !== "paylater")) && (
                  <div className="flex items-start space-x-2">
                    <input
                      type="checkbox"
                      id="includeNetworth"
                      checked={includeNetworth}
                      onChange={(e) => setIncludeNetworth(e.target.checked)}
                      className="mt-1"
                    />
                    <div>
                      <label htmlFor="includeNetworth" className="text-sm font-medium cursor-pointer">
                        Include in Total Net Worth
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Uncheck if you don't want this account counted in your total net worth
                      </p>
                    </div>
                  </div>
                )}

                {/* Initial Balance / Debt */}
                <div>
                  <label htmlFor="balance" className="block text-sm font-medium mb-2">
                    {((selectedAccount && selectedAccount.type === "credit_card") || (isCreatingCustom && customCategory === "paylater")) ? "Initial Debt (if any)" : "Initial Balance"}
                  </label>
                  {((selectedAccount && selectedAccount.type === "credit_card") || (isCreatingCustom && customCategory === "paylater")) && (
                    <p className="text-xs text-muted-foreground mb-2">
                      Usually leave this at 0. Only enter an amount if you already have existing debt to track.
                    </p>
                  )}
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">₱</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      id="balance"
                      value={balance}
                      onChange={(e) => setBalance(e.target.value)}
                      className="w-full pl-8 pr-4 py-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700"
                      placeholder="0.00"
                      required
                    />
                  </div>
                </div>

                {/* Interest Rate (only for savings) */}
                {((selectedAccount && selectedAccount.isSavings) || (isCreatingCustom && customCategory === "savings")) && (
                  <div>
                    <label htmlFor="interestRate" className="block text-sm font-medium mb-2">
                      Interest Rate (% per year)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      id="interestRate"
                      value={interestRate}
                      onChange={(e) => setInterestRate(e.target.value)}
                      className="w-full px-4 py-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700"
                      placeholder="0.00"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex gap-3 p-6 border-t dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={(!selectedAccount && (!isCreatingCustom || !customName.trim())) || isLoading}
              className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? "Adding..." : "Add Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
