"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

import { useGoals } from "@/hooks/use-goals";
import { useDebt, useDebtAccountCreate } from "@/hooks/use-debt";
import { ExistingDebtFields, validateExistingDebtFields, type ExistingDebtFieldsValue } from "@/components/accounts/ExistingDebtFields";

const EWalletIcons = ["gcash.png", "maya.png", "gotyme.png", "seabank.png"];
const DebtIcons = ["Spaylater.png", "Metrobank.webp", "tiktok.png"];

export default function AddAccountForm() {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();

  const { userId } = useGoals();
  const creation = useDebtAccountCreate(userId);
  const { refresh } = useDebt(userId);
  const busy = useRef(false);
  const handled = useRef<unknown>(null);
  const [debts, setDebts] = useState<ExistingDebtFieldsValue>({ enabled: false, items: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const frozen = creation.isSaving || creation.unresolved || !!creation.saved;
  const [name, setName] = useState("");
  const [type, setType] = useState<"cash" | "bank" | "credit_card" | "e_wallet" | "investment">("e_wallet");
  const [balance, setBalance] = useState("0");
  const [color, setColor] = useState("#22c55e");
  const [icon, setIcon] = useState<string>(EWalletIcons[0]);
  const [isLoading, setIsLoading] = useState(false);

  const availableIcons = useMemo(() => {
    if (type === "e_wallet") return EWalletIcons;
    if (type === "credit_card") return DebtIcons;
    return [];
  }, [type]);

  useEffect(() => {
    if (frozen) return;
    if (availableIcons.length === 0) {
      setIcon("");
      return;
    }
    if (!icon || !availableIcons.includes(icon)) {
      setIcon(availableIcons[0]);
    }
  }, [availableIcons, frozen]);

  useEffect(() => {
    // Reset balance to 0 for debt accounts (most people start with no debt)
    if (type === "credit_card") {
      setBalance("0");
    }
  }, [type]);

  useEffect(() => {
    const pending = creation.pendingInput;
    if (!pending) return;
    setName(pending.account.name); setType("credit_card"); setColor(pending.account.color ?? "#22c55e"); setIcon(pending.account.icon ?? "");
    setDebts({ enabled: pending.openingDebts.length > 0, items: pending.openingDebts.map(item => ({ clientId: item.clientId, name: item.name, mode: item.mode, amountText: item.amount, firstDueDate: item.firstDueDate, countText: String(item.count) })) });
  }, [userId, creation.pendingInput]);
  const finishCredit = () => { handled.current = creation.saved; creation.reset(); router.push("/accounts"); router.refresh(); };
  useEffect(() => { if (creation.saved && handled.current !== creation.saved && !creation.isSaving && !creation.refreshError) finishCredit(); }, [creation.saved, creation.isSaving, creation.refreshError]);
  const refreshOnly = async () => {
    if (busy.current) return;
    busy.current = true; setIsLoading(true); setSaveError(null);
    try { await refresh(); finishCredit(); } catch { setSaveError("Wallet saved. Views could not refresh. Try refreshing again."); }
    finally { busy.current = false; setIsLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || frozen || isLoading) return;
    setSaveError(null);
    if (type === "credit_card") {
      const validation = validateExistingDebtFields(debts);
      if (!validation.success) { setErrors(validation.errors); return; }
      setErrors({});
      if (!userId) { setSaveError("Sign in to add a wallet."); return; }
      busy.current = true; setIsLoading(true);
      try { await creation.create({ account: { name: name.trim(), type: "credit_card", currency: "PHP", color, icon: icon || null, is_savings: false, interest_rate: 0, include_in_networth: false, display_order: 0 }, openingDebts: validation.openingDebts }); }
      finally { busy.current = false; setIsLoading(false); }
      return;
    }
    busy.current = true; setIsLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        toast({ title: "Not signed in", description: "You must be signed in to add wallets", variant: "destructive" });
        return;
      }

      const { error } = await (supabase as any).from("accounts").insert({
        user_id: user.id,
        name,
        type,
        balance: Number(balance || 0),
        currency: "PHP",
        color,
        icon: icon || null,
      });

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Wallet added", description: "Your wallet was created successfully." });
      router.push("/accounts");
      router.refresh();
    } catch (err) {
      toast({ title: "Error", description: "An unexpected error occurred", variant: "destructive" });
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      {(saveError || creation.error) && <p role="alert" className="text-sm text-destructive">{saveError || creation.error}</p>}
      {creation.unresolved && <div className="space-y-2"><p role="status" className="text-sm">This save is unconfirmed. The original wallet and debts are frozen.</p><Button type="button" className="min-h-11" disabled={creation.isSaving || isLoading} onClick={() => void creation.retry()}>Retry same save</Button></div>}
      {creation.saved && !!creation.refreshError && <div className="space-y-2"><p role="status" className="text-sm">Wallet saved. Views could not refresh.</p><Button type="button" className="min-h-11" disabled={isLoading} onClick={() => void refreshOnly()}>Refresh views</Button></div>}
      <fieldset disabled={frozen || isLoading} className="min-w-0 space-y-4">
      <div>
        <label htmlFor="account-name" className="text-sm font-medium">Name</label>
        <Input id="account-name" disabled={frozen || isLoading} maxLength={60} className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="GCash - Main" required />
      </div>

      <div>
        <label htmlFor="account-type" className="text-sm font-medium">Type</label>
        <select id="account-type" disabled={frozen || isLoading} value={type} onChange={(e) => setType(e.target.value as any)} className="min-h-11 mt-1 block w-full rounded-md border px-3 py-2">
          <option value="e_wallet">E-Wallet</option>
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
          <option value="credit_card">PayLater / Debt</option>
          <option value="investment">Investment</option>
        </select>
      </div>

      {type === "credit_card" ? <ExistingDebtFields value={debts} onChange={setDebts} disabled={frozen || isLoading} errors={errors} /> : <div>
        <label htmlFor="account-balance" className="text-sm font-medium">Initial balance</label>
        <Input id="account-balance" className="min-h-11" value={balance} onChange={e => setBalance(e.target.value)} type="number" step="0.01" />
      </div>}

      <div>
        <label htmlFor="account-color" className="text-sm font-medium">Color</label>
        <Input id="account-color" className="min-h-11" value={color} onChange={(e) => setColor(e.target.value)} type="color" />
      </div>

      {type === "e_wallet" && (
        <div>
          <label className="text-sm font-medium">E-wallet Logo</label>
          <div className="flex gap-2 mt-2 flex-wrap">
            {EWalletIcons.map((i) => (
              <label key={i} className={`min-h-11 min-w-11 flex items-center justify-center p-1 border rounded cursor-pointer focus-within:ring-2 focus-within:ring-primary ${icon === i ? "ring-2 ring-offset-2" : ""}`}>
                <input type="radio" name="icon" value={i} checked={icon === i} onChange={() => setIcon(i)} className="sr-only" />
                <Image src={`/logos/${i}`} alt={i} width={32} height={32} className="h-8 w-8" />
              </label>
            ))}
          </div>
        </div>
      )}

      {type === "credit_card" && (
        <div>
          <label className="text-sm font-medium">PayLater Logo</label>
          <div className="flex gap-2 mt-2 flex-wrap">
            {DebtIcons.map((i) => (
              <label key={i} className={`min-h-11 min-w-11 flex items-center justify-center p-1 border rounded cursor-pointer focus-within:ring-2 focus-within:ring-primary ${icon === i ? "ring-2 ring-offset-2" : ""}`}>
                <input type="radio" name="icon" value={i} checked={icon === i} onChange={() => setIcon(i)} className="sr-only" />
                <Image src={`/logos/${i}`} alt={i} width={32} height={32} className="h-8 w-8" />
              </label>
            ))}
          </div>
        </div>
      )}

      </fieldset>
      <div className="flex gap-2">
        {!creation.unresolved && !creation.saved && <Button type="submit" className="min-h-11 text-green-950" disabled={isLoading || frozen}>{isLoading || creation.isSaving ? "Saving..." : "Create Wallet"}</Button>}
        <Button type="button" className="min-h-11" variant="ghost" onClick={() => { window.history.back(); }}>Cancel</Button>
      </div>
    </form>
  );
}
