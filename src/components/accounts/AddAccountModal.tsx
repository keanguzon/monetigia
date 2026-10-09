"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { parseNonNegativeAmount, sanitizeColor } from "@/lib/utils";
import { useAccounts } from "@/hooks/use-data";
import { useGoals } from "@/hooks/use-goals";
import { useDebt, useDebtAccountCreate } from "@/hooks/use-debt";
import { ExistingDebtFields, validateExistingDebtFields, type ExistingDebtFieldsValue } from "./ExistingDebtFields";
import type { Database } from "@/types/database";

type AccountOption = { type: "cash" | "bank" | "credit_card" | "e_wallet" | "investment"; icon: string; name: string; color: string; isSavings: boolean };
const accountOptions: AccountOption[] = [
  { type: "e_wallet", icon: "gcash.png", name: "GCash", color: "#007DFE", isSavings: false },
  { type: "e_wallet", icon: "maya.png", name: "Maya", color: "#10b981", isSavings: false },
  { type: "bank", icon: "gotyme.png", name: "GoTyme", color: "#06b6d4", isSavings: false },
  { type: "cash", icon: "", name: "Cash on Hand", color: "#86efac", isSavings: false },
  { type: "e_wallet", icon: "gcash.png", name: "GCash Savings", color: "#007DFE", isSavings: true },
  { type: "e_wallet", icon: "maya.png", name: "Maya Savings", color: "#10b981", isSavings: true },
  { type: "bank", icon: "gotyme.png", name: "GoTyme Savings", color: "#06b6d4", isSavings: true },
  { type: "bank", icon: "seabank.png", name: "SeaBank Savings", color: "#FF6B00", isSavings: true },
  { type: "credit_card", icon: "Spaylater.png", name: "SPayLater", color: "#10b981", isSavings: false },
  { type: "credit_card", icon: "Metrobank.webp", name: "Metrobank", color: "#007DFE", isSavings: false },
  { type: "credit_card", icon: "tiktok.png", name: "TikTok PayLater", color: "#000000", isSavings: false },
];
type Category = "wallet" | "savings" | "paylater";
interface AddAccountModalProps { isOpen: boolean; onClose: () => void; existingAccounts: Array<{ icon: string; is_savings: boolean }> }
const inputClass = "min-h-11 w-full min-w-0 rounded-lg border px-4 py-2 dark:bg-slate-900 dark:border-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const actionClass = "min-h-11 rounded-lg border px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50";

export default function AddAccountModal({ isOpen, onClose, existingAccounts }: AddAccountModalProps) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();
  const { mutate: mutateAccounts } = useAccounts();
  const { userId } = useGoals();
  const creation = useDebtAccountCreate(userId);
  const { refresh } = useDebt(userId);
  const busy = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) opener.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  wasOpen.current = isOpen;
  const handled = useRef<unknown>(null);
  const [selected, setSelected] = useState<AccountOption | null>(null);
  const [custom, setCustom] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [type, setType] = useState<"cash" | "bank" | "e_wallet">("e_wallet");
  const [balance, setBalance] = useState("");
  const [interest, setInterest] = useState("");
  const [includeNetworth, setIncludeNetworth] = useState(true);
  const [debts, setDebts] = useState<ExistingDebtFieldsValue>({ enabled: false, items: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const credit = custom === "paylater" || selected?.type === "credit_card";
  const savings = custom === "savings" || selected?.isSavings;
  const frozen = creation.isSaving || creation.unresolved || !!creation.saved;
  const resetDraft = () => { setSelected(null); setCustom(null); setName(""); setColor("#10b981"); setType("e_wallet"); setBalance(""); setInterest(""); setIncludeNetworth(true); setDebts({ enabled: false, items: [] }); setErrors({}); setError(null); };
  useEffect(() => { if (isOpen && !frozen && !creation.pendingInput) resetDraft(); }, [isOpen, userId]);
  useEffect(() => {
    if (!isOpen) return;
    const pending = creation.pendingInput;
    if (pending) {
      const preset = accountOptions.find(option => option.name === pending.account.name && option.icon === pending.account.icon);
      setSelected(preset ?? null); setCustom(preset ? null : "paylater"); setName(pending.account.name);
      setColor(pending.account.color ?? "#10b981"); setIncludeNetworth(pending.account.include_in_networth);
      setDebts({ enabled: pending.openingDebts.length > 0, items: pending.openingDebts.map(item => ({ clientId: item.clientId, name: item.name, mode: item.mode, amountText: item.amount, firstDueDate: item.firstDueDate, countText: String(item.count) })) });
    }
  }, [isOpen, userId, creation.pendingInput]);
  useEffect(() => { if (credit && !frozen) { setIncludeNetworth(false); setBalance("0"); } }, [credit, frozen]);
  const finish = () => { handled.current = creation.saved; creation.reset(); resetDraft(); onClose(); router.refresh(); };
  useEffect(() => { if (isOpen && creation.saved && handled.current !== creation.saved && !creation.isSaving && !creation.refreshError) finish(); }, [isOpen, creation.saved, creation.isSaving, creation.refreshError]);
  const refreshOnly = async () => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(null);
    try { await refresh(); finish(); } catch { setError("Wallet saved. Views could not refresh. Try refreshing again."); }
    finally { busy.current = false; setLoading(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || loading || frozen || (!selected && !custom)) return;
    setError(null);
    const walletName = custom ? name.trim() : selected!.name;
    if (!walletName || walletName.length > 60) { setError("Enter a wallet name of 60 characters or fewer."); return; }
    if (credit) {
      const validation = validateExistingDebtFields(debts);
      if (!validation.success) { setErrors(validation.errors); return; }
      setErrors({});
      if (!userId) { setError("Sign in to add a wallet."); return; }
      busy.current = true; setLoading(true);
      try { await creation.create({ account: { name: walletName, type: "credit_card", currency: "PHP", color: sanitizeColor(custom ? color : selected!.color), icon: custom ? null : selected!.icon || null, is_savings: false, interest_rate: 0, include_in_networth: includeNetworth, display_order: 0 }, openingDebts: validation.openingDebts }); }
      finally { busy.current = false; setLoading(false); }
      return;
    }
    const amount = parseNonNegativeAmount(balance || "0");
    const rate = Number(interest || "0");
    if (amount === null) { setError("Balance must be a non-negative amount."); return; }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { setError("Interest rate must be between 0 and 100."); return; }
    busy.current = true; setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) { setError("Sign in to add a wallet."); return; }
      const account: Database["public"]["Tables"]["accounts"]["Insert"] = { user_id: user.id, name: walletName, type: custom ? type : selected!.type, balance: amount, currency: "PHP", color: sanitizeColor(custom ? color : selected!.color), icon: custom ? "" : selected!.icon, is_savings: !!savings, interest_rate: savings ? rate : 0, include_in_networth: includeNetworth };
      const { error: insertError } = await supabase.from("accounts").insert([account]);
      if (insertError) { setError(insertError.message); return; }
      toast({ title: "Account added", description: "Your account was created successfully." });
      resetDraft(); onClose(); void mutateAccounts(); router.refresh();
    } catch { setError("An unexpected error occurred. Try again."); }
    finally { busy.current = false; setLoading(false); }
  };
  return <Dialog.Root open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content data-mobile-nav-blocking="" aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-800"
        onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
        <div className="flex shrink-0 items-center justify-between border-b p-4 sm:px-6 dark:border-slate-700"><Dialog.Title className="text-xl font-semibold">Add New Account</Dialog.Title><button type="button" aria-label="Close add wallet" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><X className="h-5 w-5" /></button></div>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {(error || creation.error) && <p role="alert" className="mb-4 text-sm text-destructive">{error || creation.error}</p>}
            {creation.unresolved && <div className="mb-4 space-y-2"><p role="status" className="text-sm">This save is unconfirmed. The original wallet and debts are frozen.</p><button type="button" disabled={creation.isSaving || loading} onClick={() => void creation.retry()} className={actionClass}>Retry same save</button></div>}
            {creation.saved && !!creation.refreshError && <div className="mb-4 space-y-2"><p role="status" className="text-sm">Wallet saved. Views could not refresh.</p><button type="button" disabled={loading} onClick={() => void refreshOnly()} className={actionClass}>Refresh views</button></div>}
            <fieldset disabled={frozen || loading} className="min-w-0 space-y-6">
              {([['wallet', 'Wallet'], ['savings', 'Savings'], ['paylater', 'PayLater / Debt']] as const).map(([category, label]) => <div key={category}>
                <h4 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">{label}</h4>
                {category === "paylater" && <p className="mb-3 text-xs text-muted-foreground">Track your buy-now-pay-later purchases. Your cash won&apos;t decrease until you record a payment.</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {accountOptions.filter(option => category === "savings" ? option.isSavings : category === "paylater" ? option.type === "credit_card" : !option.isSavings && option.type !== "credit_card").map(option => {
                    const disabled = !!option.icon && existingAccounts.some(account => account.icon === option.icon && account.is_savings === option.isSavings);
                    const expanded = selected === option && option.type === "credit_card";
                    return <div key={option.name} className={expanded ? "col-span-full min-w-0 rounded-xl border-2 border-primary" : "min-w-0"}>
                    <button type="button" aria-label={option.name === "Cash on Hand" ? "Cash" : option.name} disabled={disabled || frozen || loading} onClick={() => { setSelected(option); setCustom(null); }} className={`flex w-full min-h-11 flex-col items-center rounded-xl border-2 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${disabled ? 'cursor-not-allowed opacity-40' : expanded ? 'border-transparent' : selected === option ? 'border-primary' : 'border-gray-200 dark:border-slate-700 hover:border-primary/50'}`}>
                      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg border bg-white dark:bg-slate-900 dark:border-slate-700">{option.icon ? <Image src={`/logos/${option.icon}`} alt="" width={40} height={40} className="h-10 w-10 object-contain" /> : <span className="text-xl" aria-hidden="true">₱</span>}</div>
                      <span className="text-xs font-medium leading-tight">{option.name === "Cash on Hand" ? "Cash" : option.name}</span>
                    </button>
                    {expanded && <div className="border-t border-primary/20 p-4"><ExistingDebtFields value={debts} onChange={setDebts} disabled={frozen || loading} errors={errors} /></div>}
                    </div>;
                  })}
                  <div className={custom === category ? "col-span-full min-w-0" : "min-w-0"}>
                  <button type="button" disabled={frozen || loading} onClick={() => { setCustom(category); setSelected(null); }} className={`flex w-full flex-col items-center rounded-xl border-2 border-dashed p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${custom === category ? 'border-primary' : 'border-gray-300 dark:border-slate-600'}`}><span className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10"><Plus className="h-6 w-6 text-primary" /></span><span className="text-sm font-medium">Custom</span></button>
{custom === category && <div className="space-y-4 rounded-xl border-2 border-primary/20 bg-slate-50 p-4 dark:bg-slate-800/50">
                <h4 className="text-sm font-semibold">Create Custom {custom === "wallet" ? "Wallet" : custom === "savings" ? "Savings Account" : "PayLater Account"}</h4>
                <div><label htmlFor="customName" className="mb-2 block text-sm font-medium">Account Name *</label><input id="customName" value={name} onChange={e => setName(e.target.value)} className={inputClass} required maxLength={60} /></div>
                <div><label htmlFor="customColor" className="mb-2 block text-sm font-medium">Color *</label><div className="flex min-w-0 gap-3"><input id="customColor" type="color" value={color} onChange={e => setColor(e.target.value)} className="h-11 w-16 shrink-0" /><input aria-label="Color hex value" value={color} onChange={e => setColor(e.target.value)} className={inputClass} pattern="^#[0-9A-Fa-f]{6}$" /></div></div>
                <div><label htmlFor="customType" className="mb-2 block text-sm font-medium">Account Type *</label><select id="customType" value={custom === "paylater" ? "credit_card" : type} onChange={e => setType(e.target.value as typeof type)} className={inputClass}>{custom === "paylater" ? <option value="credit_card">Credit Card / PayLater</option> : <>{custom === "wallet" && <option value="cash">Cash</option>}<option value="bank">{custom === "savings" ? "Bank Savings" : "Bank Account"}</option><option value="e_wallet">{custom === "savings" ? "E-Wallet Savings" : "E-Wallet"}</option></>}</select></div>
                {custom === "paylater" && <ExistingDebtFields value={debts} onChange={setDebts} disabled={frozen || loading} errors={errors} />}
              </div>}
                  </div>
                </div>
              </div>)}
              {(selected || custom) && <>
                {!credit && <div><label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={includeNetworth} onChange={e => setIncludeNetworth(e.target.checked)} />Include in Total Net Worth</label><p className="text-xs text-muted-foreground">Uncheck if you don&apos;t want this account counted in your total net worth</p></div>}
                {!credit && <div><label htmlFor="balance" className="mb-2 block text-sm font-medium">Initial Balance</label><input id="balance" value={balance} onChange={e => setBalance(e.target.value)} type="text" inputMode="decimal" placeholder="0.00" className={inputClass} required /></div>}
                {savings && <div><label htmlFor="interestRate" className="mb-2 block text-sm font-medium">Interest Rate (% per year)</label><input id="interestRate" value={interest} onChange={e => setInterest(e.target.value)} inputMode="decimal" className={inputClass} placeholder="0.00" /></div>}
              </>}
            </fieldset>
          </div>
          <div className="flex shrink-0 gap-3 border-t p-4 sm:px-6 dark:border-slate-700" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <button type="button" onClick={onClose} className={`${actionClass} flex-1`}>Cancel</button>
            {!creation.unresolved && !creation.saved && <button type="submit" disabled={(!selected && (!custom || !name.trim())) || loading || frozen} className={`${actionClass} flex-1 border-primary bg-primary text-primary-foreground hover:bg-primary/90`}>{loading || creation.isSaving ? "Saving..." : "Create Wallet"}</button>}
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
