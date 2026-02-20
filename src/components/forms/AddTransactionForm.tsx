"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export default function AddTransactionForm() {
  const supabase = createClient();
  const sb = supabase as any;
  const router = useRouter();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);

  const [accountId, setAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [type, setType] = useState<"income" | "expense" | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [transferToAccountId, setTransferToAccountId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [debtPaymentMonth, setDebtPaymentMonth] = useState<string>(new Date().toISOString().slice(0, 7));

  const getAccount = (id: string) => accounts.find((a: any) => a?.id === id);

  const [isPayLater, setIsPayLater] = useState(false);
  const [payLaterAccountId, setPayLaterAccountId] = useState<string>("");
  const [installments, setInstallments] = useState<number>(1);
  const [startMonth, setStartMonth] = useState<string>(new Date().toISOString().slice(0, 7));

  const debtAccounts = accounts.filter((a: any) => a?.type === "credit_card");
  const transferToAccount = transferToAccountId ? getAccount(transferToAccountId) : null;
  const isDebtPayment = type === "transfer" && transferToAccount?.type === "credit_card";

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      const { data: accountsData } = await sb.from("accounts").select("*").eq("user_id", user.id).order("name");
      const accountsList = (accountsData ?? []) as any[];
      setAccounts(accountsList);

      const { data: catsData } = await sb.from("categories").select("*").order("name");
      const catsList = (catsData ?? []) as any[];
      setCategories(catsList);

      if (accountsList.length > 0) setAccountId(accountsList[0]?.id ?? "");
      if (catsList.length > 0) setCategoryId(catsList[0]?.id ?? "");

      const firstCredit = accountsList.find((a: any) => a?.type === "credit_card");
      if (firstCredit) setPayLaterAccountId(firstCredit.id);
    };

    load();
  }, []);

  useEffect(() => {
    if (type !== "expense") {
      setIsPayLater(false);
      setInstallments(1);
    }
  }, [type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast({ title: "Not signed in", description: "You must be signed in to add transactions", variant: "destructive" });
        return;
      }

      const amt = Number(amount);
      const effectiveAccountId = type === "expense" && isPayLater ? payLaterAccountId : accountId;
      if (!effectiveAccountId || !amt) {
        toast({ title: "Missing fields", description: "Please select account and amount", variant: "destructive" });
        return;
      }

      // Month-level guard for debt payments (transfer TO credit card)
      if (isDebtPayment) {
        if (!transferToAccountId) {
          toast({ title: "Missing fields", description: "Please select a destination account", variant: "destructive" });
          return;
        }
        if (!debtPaymentMonth) {
          toast({ title: "Missing month", description: "Please select a debt month to pay", variant: "destructive" });
          return;
        }

        const creditId = transferToAccountId;
        const start = `${debtPaymentMonth}-01`;
        const nextMonth = new Date(`${debtPaymentMonth}-01T00:00:00`);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const end = nextMonth.toISOString().slice(0, 10);

        const { data: monthTx, error: monthTxErr } = await sb
          .from("transactions")
          .select("account_id, type, amount, date, transfer_to_account_id")
          .eq("user_id", user.id)
          .gte("date", start)
          .lt("date", end)
          .or(`account_id.eq.${creditId},transfer_to_account_id.eq.${creditId}`);

        if (monthTxErr) {
          toast({ title: "Error", description: "Failed to validate month debt", variant: "destructive" });
          return;
        }

        let monthDebt = 0;
        (monthTx || []).forEach((t: any) => {
          const amtNum = Number(t?.amount || 0);
          const isCreditSource = t?.account_id === creditId;
          const isCreditDestination = t?.transfer_to_account_id === creditId;

          if (t.type === "expense" && isCreditSource) monthDebt += amtNum;
          else if (t.type === "income" && isCreditSource) monthDebt -= amtNum;
          else if (t.type === "transfer") {
            if (isCreditDestination) monthDebt -= amtNum;
            if (isCreditSource) monthDebt += amtNum;
          }
        });

        monthDebt = Math.max(0, Number(monthDebt || 0));
        let label = debtPaymentMonth;
        try {
          const d = new Date(`${debtPaymentMonth}-01T00:00:00`);
          label = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
        } catch {
          // ignore
        }

        if (monthDebt <= 0) {
          toast({ title: "No debt for this month", description: `There is no remaining debt for ${label}.`, variant: "destructive" });
          return;
        }
        if (amt - monthDebt > 1e-9) {
          toast({ title: "Payment too large", description: `Max for ${label} is ₱${monthDebt.toFixed(2)}.`, variant: "destructive" });
          return;
        }
      }

      // Insert transaction(s) - for PayLater with installments, create multiple transactions
      if (type === "expense" && isPayLater && installments > 1) {
        const installmentAmount = amt / installments;
        const transactions = [];

        for (let i = 0; i < installments; i++) {
          const installmentDate = new Date(startMonth + "-01");
          installmentDate.setMonth(installmentDate.getMonth() + i);
          const dateStr = installmentDate.toISOString().slice(0, 10);

          transactions.push({
            user_id: user.id,
            account_id: effectiveAccountId,
            category_id: categoryId || null,
            type,
            amount: installmentAmount,
            description: `${description} (Installment ${i + 1}/${installments})`,
            date: dateStr,
            transfer_to_account_id: null,
          });
        }

        const { error } = await sb.from("transactions").insert(transactions);
        if (error) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
          return;
        }

        // Update debt account balance (sum of all installments)
        const { data: acc } = await sb.from("accounts").select("balance").eq("id", effectiveAccountId).single();
        const current = Number(acc?.balance || 0);
        const newBal = current + amt; // Debt increases by total amount
        await sb.from("accounts").update({ balance: newBal }).eq("id", effectiveAccountId);
      } else {
        // Single transaction
        const transactionDate = isDebtPayment
          ? `${debtPaymentMonth}-01`
          : (type === "expense" && isPayLater)
            ? new Date(startMonth + "-01").toISOString().slice(0, 10)
            : date;
        const finalDescription = (() => {
          const trimmed = (description || "").trim();
          if (trimmed) return trimmed;
          if (!isDebtPayment) return "";
          let label = debtPaymentMonth;
          try {
            const d = new Date(`${debtPaymentMonth}-01T00:00:00`);
            label = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
          } catch {
            // ignore
          }
          return `Debt - ${label}`;
        })();
        const { error, data: inserted } = await sb.from("transactions").insert({
          user_id: user.id,
          account_id: effectiveAccountId,
          category_id: categoryId || null,
          type,
          amount: amt,
          description: finalDescription,
          date: transactionDate,
          transfer_to_account_id: type === "transfer" ? transferToAccountId || null : null,
        }).select();

        if (error) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
          return;
        }

        // Update balances for single transaction
        if (type === "income") {
          const meta = getAccount(effectiveAccountId);
          const { data: acc } = await sb.from("accounts").select("balance").eq("id", effectiveAccountId).single();
          const current = Number(acc?.balance || 0);
          if (meta?.type === "credit_card" && current - amt < 0) {
            toast({
              title: "Payment too large",
              description: `This would make your debt negative. Current debt: ${current.toFixed(2)}.`,
              variant: "destructive",
            });
            return;
          }
          const newBal = meta?.type === "credit_card" ? current - amt : current + amt;
          await sb.from("accounts").update({ balance: newBal }).eq("id", effectiveAccountId);
        } else if (type === "expense") {
          const meta = getAccount(effectiveAccountId);
          const { data: acc } = await sb.from("accounts").select("balance").eq("id", effectiveAccountId).single();
          const current = Number(acc?.balance || 0);
          const newBal = meta?.type === "credit_card" ? current + amt : current - amt;
          await sb.from("accounts").update({ balance: newBal }).eq("id", effectiveAccountId);
        } else if (type === "transfer") {
          // subtract from source
          const { data: src } = await sb.from("accounts").select("balance").eq("id", accountId).single();
          const { data: dst } = await sb.from("accounts").select("balance").eq("id", transferToAccountId).single();
          const srcMeta = getAccount(accountId);
          const dstMeta = getAccount(transferToAccountId);
          if (!dst) {
            toast({ title: "Error", description: "Transfer destination not found", variant: "destructive" });
          } else {
            const srcCurrent = Number(src?.balance || 0);
            const dstCurrent = Number(dst?.balance || 0);
            const nextSrc = srcMeta?.type === "credit_card" ? srcCurrent + amt : srcCurrent - amt;
            const nextDst = dstMeta?.type === "credit_card" ? dstCurrent - amt : dstCurrent + amt;
            if (dstMeta?.type === "credit_card" && nextDst < 0) {
              toast({
                title: "Payment too large",
                description: `You can only pay up to ${dstCurrent.toFixed(2)} for this debt account.`,
                variant: "destructive",
              });
              return;
            }
            await sb.from("accounts").update({ balance: nextSrc }).eq("id", accountId);
            await sb.from("accounts").update({ balance: nextDst }).eq("id", transferToAccountId);
          }
        }
      }

      toast({
        title: "Transaction added",
        description: isPayLater && installments > 1
          ? `Created ${installments} installments successfully.`
          : "Your transaction was saved."
      });
      router.push("/transactions");
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
        <label className="text-sm font-medium">Type</label>
        <select className="mt-1 w-full rounded-md border px-3 py-2" value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
      </div>

      <div>
        <label className="text-sm font-medium">Account</label>
        {type === "expense" && (
          <div className="mt-2 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPayLater} onChange={(e) => setIsPayLater(e.target.checked)} className="h-4 w-4" />
              PayLater purchase (adds to debt)
            </label>

            {/* Installment options */}
            {isPayLater && (
              <div className="space-y-3 pl-6 border-l-2">
                <div>
                  <label htmlFor="installments" className="block text-sm font-medium mb-1">
                    Installments
                  </label>
                  <select
                    id="installments"
                    value={installments}
                    onChange={(e) => setInstallments(Number(e.target.value))}
                    className="w-full rounded-md border px-3 py-2"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                      <option key={n} value={n}>
                        {n === 1 ? "Pay in full (1 month)" : `${n} months`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="startMonth" className="block text-sm font-medium mb-1">
                    Payment Due (Start Month)
                  </label>
                  <input
                    type="month"
                    id="startMonth"
                    value={startMonth}
                    onChange={(e) => setStartMonth(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 appearance-none block min-w-full bg-transparent"
                  />
                </div>
                {installments > 1 && (
                  <p className="text-xs text-muted-foreground">
                    ₱{(Number(amount) / installments || 0).toFixed(2)} per month for {installments} months
                  </p>
                )}
                {installments === 1 && (
                  <p className="text-xs text-muted-foreground">
                    Full payment due in {startMonth}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <select
          className="mt-1 w-full rounded-md border px-3 py-2"
          value={type === "expense" && isPayLater ? payLaterAccountId : accountId}
          onChange={(e) => {
            if (type === "expense" && isPayLater) setPayLaterAccountId(e.target.value);
            else setAccountId(e.target.value);
          }}
        >
          {(type === "expense" && isPayLater
            ? accounts.filter((a: any) => a?.type === "credit_card")
            : accounts.filter((a: any) => a?.type !== "credit_card")
          ).map((a: any) => (
            <option value={a.id} key={a.id}>{a.name} ({a.currency})</option>
          ))}
        </select>
        {type === "expense" && isPayLater && accounts.filter((a: any) => a?.type === "credit_card").length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Create a PayLater/Debt account first (type: Credit Card) in Accounts.</p>
        )}
      </div>

      {type === "transfer" && (
        <div>
          <label className="text-sm font-medium">Transfer to</label>
          <select
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={transferToAccountId}
            onChange={(e) => {
              const nextId = e.target.value;
              setTransferToAccountId(nextId);
              const nextAcc = getAccount(nextId);
              if (nextAcc?.type === "credit_card") {
                const month = debtPaymentMonth || new Date().toISOString().slice(0, 7);
                setDebtPaymentMonth(month);
                setDate(`${month}-01`);
              }
            }}
          >
            <option value="">Select destination account</option>
            {accounts.filter(a => a.id !== accountId).map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}{a.type === "credit_card" ? " (Pay Debt)" : ""}
              </option>
            ))}
          </select>
          {isDebtPayment ? (
            <div className="mt-2">
              <label htmlFor="debtMonth" className="block text-xs font-medium text-muted-foreground mb-1">
                Debt month to pay
              </label>
              <input
                type="month"
                id="debtMonth"
                value={debtPaymentMonth}
                onChange={(e) => {
                  const month = e.target.value;
                  setDebtPaymentMonth(month);
                  if (month) setDate(`${month}-01`);
                }}
                className="w-full rounded-md border px-3 py-2 appearance-none block min-w-full bg-transparent"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Payment will be recorded under this month in your debt breakdown.
              </p>
            </div>
          ) : null}
        </div>
      )}

      <div>
        <label className="text-sm font-medium">Category</label>
        <select className="mt-1 w-full rounded-md border px-3 py-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option value={c.id} key={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-sm font-medium">Amount</label>
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" required />
      </div>

      <div>
        <label className="text-sm font-medium">Date</label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="appearance-none block min-w-full bg-transparent w-full" />
      </div>

      <div>
        <label className="text-sm font-medium">Description</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isLoading}>{isLoading ? "Saving..." : "Save Transaction"}</Button>
        <Button variant="ghost" onClick={() => window.history.back()}>Cancel</Button>
      </div>
    </form>
  );
}
