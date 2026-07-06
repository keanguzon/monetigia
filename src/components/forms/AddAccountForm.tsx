"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

const EWalletIcons = ["gcash.png", "maya.png", "gotyme.png", "seabank.png"];
const DebtIcons = ["Spaylater.png", "Metrobank.webp", "tiktok.png"];

export default function AddAccountForm() {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();

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
    // Prevent saving an unrelated icon when switching account types.
    if (availableIcons.length === 0) {
      setIcon("");
      return;
    }
    if (!icon || !availableIcons.includes(icon)) {
      setIcon(availableIcons[0]);
    }
  }, [availableIcons]);

  useEffect(() => {
    // Reset balance to 0 for debt accounts (most people start with no debt)
    if (type === "credit_card") {
      setBalance("0");
    }
  }, [type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

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
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div>
        <label className="text-sm font-medium">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GCash - Main" required />
      </div>

      <div>
        <label className="text-sm font-medium">Type</label>
        <select value={type} onChange={(e) => setType(e.target.value as any)} className="mt-1 block w-full rounded-md border px-3 py-2">
          <option value="e_wallet">E-Wallet</option>
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
          <option value="credit_card">PayLater / Debt</option>
          <option value="investment">Investment</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-medium">
          {type === "credit_card" ? "Initial Debt (if any)" : "Initial balance"}
        </label>
        {type === "credit_card" && (
          <p className="text-xs text-muted-foreground mt-1">
            Usually leave this at 0. Only enter an amount if you already have existing debt to track.
          </p>
        )}
        <Input value={balance} onChange={(e) => setBalance(e.target.value)} type="number" step="0.01" />
      </div>

      <div>
        <label className="text-sm font-medium">Color</label>
        <Input value={color} onChange={(e) => setColor(e.target.value)} type="color" />
      </div>

      {type === "e_wallet" && (
        <div>
          <label className="text-sm font-medium">E-wallet Logo</label>
          <div className="flex gap-2 mt-2 flex-wrap">
            {EWalletIcons.map((i) => (
              <label key={i} className={`p-1 border rounded cursor-pointer ${icon === i ? "ring-2 ring-offset-2" : ""}`}>
                <input type="radio" name="icon" value={i} checked={icon === i} onChange={() => setIcon(i)} className="hidden" />
                <Image src={`/logos/${i}`} alt={i} width={32} height={32} className="h-8 w-8" />
              </label>
            ))}
          </div>
        </div>
      )}

      {type === "credit_card" && (
        <div>
          <label className="text-sm font-medium">PayLater Logo</label>
          <p className="text-xs text-muted-foreground mt-1">
            Tip: you can replace these by adding your own images in `public/logos/`.
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            {DebtIcons.map((i) => (
              <label key={i} className={`p-1 border rounded cursor-pointer ${icon === i ? "ring-2 ring-offset-2" : ""}`}>
                <input type="radio" name="icon" value={i} checked={icon === i} onChange={() => setIcon(i)} className="hidden" />
                <Image src={`/logos/${i}`} alt={i} width={32} height={32} className="h-8 w-8" />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isLoading}>{isLoading ? "Saving..." : "Create Wallet"}</Button>
        <Button variant="ghost" onClick={() => { window.history.back(); }}>Cancel</Button>
      </div>
    </form>
  );
}
