"use client";
import { useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PositiveMoneySchema } from "@/lib/money/contracts";
import { useSpendingOwner } from "@/hooks/use-spending-owner";
import { useSpendingLimitCommand, type SpendingLimitValue } from "@/hooks/use-spending";

export function SpendingLimitDialog({ limit, retry, available = true }: { limit: SpendingLimitValue | null | undefined; retry: () => Promise<unknown>; available?: boolean }) {
  const owner = useSpendingOwner();
  const command = useSpendingLimitCommand();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<SpendingLimitValue["cadence"]>("month");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const binding = useRef<{ userId: string | null; generation: number } | null>(null);
  const sequence = useRef(0);
  const amountId = useId();
  const errorId = useId();
  const matches = () => binding.current?.userId === owner.userId && binding.current?.generation === owner.generation && owner.isCurrent();
  const close = () => { sequence.current += 1; setOpen(false); setPending(false); };
  useEffect(() => { if (open && !matches()) close(); }, [owner.userId, owner.generation, owner.status, open]);
  const changeOpen = (next: boolean) => {
    if (!next) { close(); return; }
    if (!available || !owner.isCurrent()) return;
    binding.current = { userId: owner.userId, generation: owner.generation };
    setAmount(limit?.amount ?? ""); setCadence(limit?.cadence ?? "month"); setError(null); setConfirm(false); setRefreshFailed(false); setOpen(true);
  };
  const submit = async (remove: boolean) => {
    if (pending || !matches()) return;
    let normalized = "";
    if (!remove) {
      if (/^\d+(?:\.\d{1,2})?$/.test(amount)) normalized = Number(amount.split(".")[0]).toString() + "." + (amount.split(".")[1] ?? "").padEnd(2, "0");
      if (!PositiveMoneySchema.safeParse(normalized).success) { setError("Enter an amount greater than ₱0."); return; }
    }
    setPending(true); setError(null);
    const attempt = ++sequence.current;
    const isCurrent = owner.isCurrent;
    try {
      const outcome = await (remove ? command.remove() : command.save(normalized, cadence));
      if (!isCurrent() || attempt !== sequence.current) return;
      if (outcome.refreshError) { setRefreshFailed(true); setConfirm(false); }
      else close();
    } catch {
      if (isCurrent() && attempt === sequence.current) setError("The limit couldn't be saved. Try again.");
    } finally { if (isCurrent() && attempt === sequence.current) setPending(false); }
  };
  const retryRefresh = async () => {
    if (pending || !matches()) return;
    const attempt = ++sequence.current;
    const isCurrent = owner.isCurrent;
    setPending(true);
    try {
      await retry();
      if (isCurrent() && attempt === sequence.current) close();
    } catch {
      if (isCurrent() && attempt === sequence.current) setPending(false);
    }
  };
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><Button hidden={!available} variant="ghost" className="min-h-11 px-0">{limit ? "Edit spending limit" : "Set spending limit"}</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" /><Dialog.Content data-mobile-nav-blocking="" data-no-press-motion="" className="[&_button]:min-h-11 fixed left-1/2 top-1/2 z-[60] max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-card p-6 text-card-foreground shadow-xl [--destructive:0_72%_42%] dark:[--destructive:0_84%_60%]">
      <Dialog.Title className="font-heading text-xl font-semibold">Spending limit</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-muted-foreground">This is a guide only. You can still record any expense.</Dialog.Description>
      {refreshFailed ? <div className="mt-5 space-y-3"><p role="status">Your limit change was saved, but the latest limit couldn't load.</p><Button disabled={pending} variant="outline" onClick={() => void retryRefresh()}>Retry refresh</Button><Button variant="outline" onClick={close}>Close</Button></div> : <form className="mt-5 space-y-4" noValidate onSubmit={event => { event.preventDefault(); void submit(false); }}>
        <div className="space-y-2"><label htmlFor={amountId}>Limit amount (₱)</label><Input id={amountId} inputMode="decimal" value={amount} disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={event => setAmount(event.target.value)} /></div>
        <fieldset disabled={pending} className="space-y-2"><legend className="mb-2 text-sm font-medium">Repeat limit</legend><label className="flex min-h-11 items-center gap-3"><input type="radio" name={amountId + "cadence"} checked={cadence === "month"} onChange={() => setCadence("month")} />Every month</label><label className="flex min-h-11 items-center gap-3"><input type="radio" name={amountId + "cadence"} checked={cadence === "cutoff"} onChange={() => setCadence("cutoff")} />Every cutoff (1st–15th, 16th–end)</label></fieldset>
        {error && <p role="alert" id={errorId}>{error}</p>}
        {confirm && <div className="space-y-2"><p>Remove your spending limit?</p><Button type="button" disabled={pending} onClick={() => void submit(true)}>Confirm removal</Button></div>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save limit"}</Button><Button type="button" variant="outline" onClick={close}>Cancel</Button>{limit && <Button type="button" variant="outline" className="text-destructive" disabled={pending} onClick={() => setConfirm(true)}>Remove limit</Button>}</div>
      </form>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
