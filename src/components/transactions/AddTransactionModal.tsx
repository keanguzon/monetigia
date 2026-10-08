"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { X, ArrowUpRight, ArrowDownLeft, ArrowLeftRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { GoalSelector } from "@/components/goals/GoalSelector";
import { useTransactionSubmit } from "@/hooks/use-transaction-submit";
import { useGoals } from "@/hooks/use-goals";
import { parseMoney, splitInstallments } from "@/lib/goals/summary";
import { GoalReleaseDialog } from "./GoalReleaseDialog";
import type { TransactionDraft, TransactionQuote } from "@/lib/goals/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import { getFirstInstallmentDueDate, getInstallmentScheduleDates, isValidCalendarDate, toLocalDateInputValue } from "@/lib/transactions/installment-dates";

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAccountId?: string;
  defaultGoalId?: string;
}

export default function AddTransactionModal({ isOpen, onClose, defaultAccountId, defaultGoalId }: AddTransactionModalProps) {
  const supabase = createClient();
  const sb = supabase as any;
  const submit = useTransactionSubmit();
  const { reset: resetSubmit } = submit;
  const { financeSnapshot } = useGoals();

  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);

  const [accountId, setAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [goalId, setGoalId] = useState("");
  const [type, setType] = useState<"income" | "expense" | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [firstDueDateEdited, setFirstDueDateEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [transferToAccountId, setTransferToAccountId] = useState<string>("");
  const isLoading = submit.phase === "saving" || submit.phase === "quoting";
  const [reviewDisplay, setReviewDisplay] = useState<{ quote: TransactionQuote; draft: TransactionDraft } | null>(null);
  const formContentRef = useRef<HTMLDivElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formScrollRef = useRef<HTMLDivElement | null>(null);
  const formScrollTop = useRef(0);
  const wasReviewOpen = useRef(false);
  const restoringFormFocus = useRef(false);
  const currentReview = submit.phase === "review" && !submit.unresolved && submit.transactionQuote && submit.draft
    ? { quote: submit.transactionQuote, draft: submit.draft } : null;
  const displayReview = currentReview || (isLoading && !submit.unresolved ? reviewDisplay : null);
  const reviewOpen = isOpen && !!displayReview;
  useEffect(() => {
    if (!isOpen || submit.unresolved || submit.phase === "editing" || submit.phase === "saved") setReviewDisplay(null);
    else if (submit.phase === "review" && submit.transactionQuote && submit.draft) setReviewDisplay({ quote: submit.transactionQuote, draft: submit.draft });
  }, [isOpen, submit.phase, submit.unresolved, submit.transactionQuote, submit.draft]);
  useLayoutEffect(() => {
    formContentRef.current?.toggleAttribute("inert", reviewOpen);
    const returning = wasReviewOpen.current && !reviewOpen && isOpen;
    if (returning) restoringFormFocus.current = true;
    else if (reviewOpen || !isOpen) restoringFormFocus.current = false;
    wasReviewOpen.current = reviewOpen;
    if (!returning) return;
    // Radix restores aria-hidden and autofocus during its deferred scope cleanup.
    const timer = setTimeout(() => {
      formContentRef.current?.removeAttribute("aria-hidden");
      formContentRef.current?.removeAttribute("inert");
      if (submit.unresolved) retryButtonRef.current?.focus();
      else if (submit.phase === "editing") (submit.error ? errorRef.current : submitButtonRef.current)?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [reviewOpen, isOpen, submit.unresolved, submit.phase, submit.error]);
  const retainFormScroll = React.useCallback((node: HTMLDivElement | null) => {
    if (formScrollRef.current) formScrollTop.current = formScrollRef.current.scrollTop;
    formScrollRef.current = node;
    if (node) node.scrollTop = formScrollTop.current;
  }, []);
  const [formError, setFormError] = useState("");
  const [carryAmount, setCarryAmount] = useState("");
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [debtByMonthForPaymentTarget, setDebtByMonthForPaymentTarget] = useState<Record<string, number>>({});
  const [isDebtMonthLoading, setIsDebtMonthLoading] = useState(false);

  const [isPayLater, setIsPayLater] = useState(false);
  const [payLaterAccountId, setPayLaterAccountId] = useState<string>("");
  const [installments, setInstallments] = useState<number>(1);
  useEffect(() => {
    let cancelled = false;
    resetSubmit();
    if (isOpen) {
      setIsDataLoading(true);
      setDataError("");
      setAccountId("");
      setAccounts([]);
      setGoalId(defaultGoalId || "");
      setType("expense");
      setAmount("");
      setDescription("");
      setFormError("");
      setCarryAmount("");
      const localToday = toLocalDateInputValue();
      setDate(localToday);
      setFirstDueDate(getFirstInstallmentDueDate(localToday));
      setFirstDueDateEdited(false);
      setIsPayLater(false);
      setInstallments(1);
      setTransferToAccountId("");
      loadData(defaultAccountId, () => !cancelled)
        .catch(() => { if (!cancelled) setDataError("Could not load accounts. Close and reopen to try again."); })
        .finally(() => { if (!cancelled) setIsDataLoading(false); });
    }
    return () => { cancelled = true; };
  }, [isOpen, defaultAccountId, defaultGoalId, resetSubmit]);

  useEffect(() => {
    if (isOpen && submit.phase === "saved" && !submit.refreshError) {
      resetSubmit();
      onClose();
    }
  }, [isOpen, submit.phase, submit.refreshError, resetSubmit, onClose]);

  useEffect(() => {
    // Auto-select first matching category when type changes
    if (type === "transfer") {
      setCategoryId("transfer");
    } else {
      const matchingCats = categories.filter(c => c.type === type);
      if (matchingCats.length > 0) {
        setCategoryId(matchingCats[0]?.id ?? "");
      }
    }
  }, [type, categories]);

  useEffect(() => {
    // PayLater mode only makes sense for expenses
    if (type !== "expense") {
      setIsPayLater(false);
      setInstallments(1);
    }
  }, [type]);

  const loadData = async (preferredAccountId: string | undefined, isCurrent: () => boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!isCurrent()) return;
    if (!user?.id) throw new Error("Not signed in");

    const { data: accountsData, error: accountsError } = await sb.from("accounts").select("*").eq("user_id", user.id).order("name");
    const accountsList = ((accountsData ?? []) as any[]).filter(a => a.is_active === true && a.currency === "PHP");

    const { data: catsData, error: categoriesError } = await sb.from("categories").select("*").order("name");
    if (!isCurrent()) return;
    if (accountsError || categoriesError) throw accountsError || categoriesError;
    const catsList = (catsData ?? []) as any[];
    setAccounts(accountsList);
    setCategories(catsList);

    if (accountsList.length > 0) {
      const preferred = preferredAccountId
        ? accountsList.find((a: any) => a?.id === preferredAccountId)
        : null;

      if (preferred) {
        if (preferred?.type === "credit_card") {
          // Credit card was clicked - set up as debt payment (transfer TO the credit card)
          setType("transfer");
          setTransferToAccountId(preferred.id);
          const firstNonCredit = accountsList.find((a: any) => a?.type !== "credit_card");
          if (firstNonCredit) setAccountId(firstNonCredit.id);
        } else {
          setAccountId(preferred.id);
        }
      } else {
        const firstNonCredit = accountsList.find((a: any) => a?.type !== "credit_card");
        setAccountId(defaultGoalId ? "" : firstNonCredit?.id ?? accountsList[0]?.id ?? "");
      }
    }
    if (catsList.length > 0) setCategoryId(catsList[0]?.id ?? "");

    const firstCredit = accountsList.find((a: any) => a?.type === "credit_card");
    if (firstCredit) setPayLaterAccountId(firstCredit.id);
  };

  const getAccount = (id: string) => accounts.find((a: any) => a?.id === id);

  const effectiveAccountId = type === "expense" && isPayLater ? payLaterAccountId : accountId;
  const selectedAccount = effectiveAccountId ? getAccount(effectiveAccountId) : null;
  const selectedAccountBalance = Number(selectedAccount?.balance ?? 0);

  const transferToAccount = transferToAccountId ? getAccount(transferToAccountId) : null;
  const transferToBalance = Number(transferToAccount?.balance ?? 0);
  const isDebtPayment = type === "transfer" && transferToAccount?.type === "credit_card";

  useEffect(() => {
    const loadDebtByMonth = async () => {
      if (!isDebtPayment || !transferToAccountId) {
        setDebtByMonthForPaymentTarget({});
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      setIsDebtMonthLoading(true);
      try {
        const creditId = transferToAccountId;
        const { data: txData, error: txErr } = await sb
          .from("transactions")
          .select("id, account_id, type, amount, date, transfer_to_account_id")
          .eq("user_id", user.id)
          .or(`account_id.eq.${creditId},transfer_to_account_id.eq.${creditId}`)
          .order("date", { ascending: false })
          .limit(5000);

        if (txErr) {
          console.error("Failed to load debt-by-month for payment target", txErr);
          setDebtByMonthForPaymentTarget({});
          return;
        }

        const byMonth: Record<string, number> = {};
        (txData || []).forEach((t: any) => {
          const monthKey = typeof t?.date === "string" ? t.date.slice(0, 7) : "unknown";
          if (!monthKey || monthKey === "unknown") return;
          if (!byMonth[monthKey]) byMonth[monthKey] = 0;

          const amt = Number(t?.amount || 0);
          const isCreditSource = t?.account_id === creditId;
          const isCreditDestination = t?.transfer_to_account_id === creditId;

          // Debt math rules for credit cards:
          // - expense on credit_card increases debt
          // - income on credit_card decreases debt
          // - transfer TO credit_card decreases debt (payment)
          // - transfer FROM credit_card increases debt (cash advance / movement)
          if (t.type === "expense" && isCreditSource) byMonth[monthKey] += amt;
          else if (t.type === "income" && isCreditSource) byMonth[monthKey] -= amt;
          else if (t.type === "transfer") {
            if (isCreditDestination) byMonth[monthKey] -= amt;
            if (isCreditSource) byMonth[monthKey] += amt;
          }
        });

        // Keep debt-month view consistent with Accounts page by carrying
        // any negative month credit forward to newer months.
        const normalizedByMonth: Record<string, number> = {};
        const ascMonths = Object.keys(byMonth).sort((a, b) => (a < b ? -1 : 1));
        let carry = 0;
        for (const m of ascMonths) {
          const raw = Number(byMonth[m] || 0);
          const next = raw + carry;
          if (next < 0) {
            normalizedByMonth[m] = 0;
            carry = next;
          } else {
            normalizedByMonth[m] = next;
            carry = 0;
          }
        }

        setDebtByMonthForPaymentTarget(normalizedByMonth);
      } finally {
        setIsDebtMonthLoading(false);
      }
    };

    loadDebtByMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDebtPayment, transferToAccountId]);

  const paymentMonth = date.slice(0, 7);
  const selectedDebtMonthAmount = isDebtPayment
    ? Math.max(0, Number(debtByMonthForPaymentTarget[paymentMonth] || 0))
    : 0;

  const selectedDebtMonthLabel = (() => {
    if (!isValidCalendarDate(date)) return "";
    try {
      const [year, month] = date.split("-").map(Number);
      const d = new Date(year, month - 1, 1);
      return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
    } catch {
      return paymentMonth;
    }
  })();

  const installmentPreview = (() => {
    if (!isPayLater || !isValidCalendarDate(firstDueDate)) return [];
    try {
      const amounts = splitInstallments(parseMoney(amount), installments);
      const dueDates = getInstallmentScheduleDates(firstDueDate, installments);
      return dueDates.map((dueDate, index) => ({ dueDate, amount: amounts[index] }));
    } catch {
      return [];
    }
  })();

  const handleDateChange = (nextDate: string) => {
    setDate(nextDate);
    if (!firstDueDateEdited) {
      setFirstDueDate(nextDate && isValidCalendarDate(nextDate) ? getFirstInstallmentDueDate(nextDate) : "");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDataLoading || isLoading || dataError || submit.phase === "saved" || submit.phase === "review") return;
    setFormError("");
    try {
      const exactAmount = parseMoney(amount);
      if (!effectiveAccountId || exactAmount === "0.00") { setFormError("Select a wallet and enter an amount greater than zero."); return; }
      if (type === "transfer" && (!transferToAccountId || transferToAccountId === effectiveAccountId)) { setFormError("Choose a different destination wallet."); return; }
      if (type === "expense" && isPayLater && !isValidCalendarDate(firstDueDate)) { setFormError("Choose a valid first payment due date."); return; }
      const cashTransfer = type === "transfer" && !isDebtPayment;
      const selectedGoalId = type === "income" ? null : goalId || null;
      if (selectedGoalId && financeSnapshot?.goals.find(goal => goal.id === selectedGoalId)?.review_state === "needs_review") {
        setFormError("Review existing funding on the Goals page before using this goal.");
        return;
      }
      await submit.quote({
        type, accountId: effectiveAccountId, transferToAccountId: type === "transfer" ? transferToAccountId : null,
        categoryId: type === "transfer" ? null : categoryId || null, goalId: cashTransfer ? null : selectedGoalId,
        amount: exactAmount, description: description.trim() || (isDebtPayment ? `Debt - ${selectedDebtMonthLabel || paymentMonth}` : null),
        date,
        installments: type === "expense" && isPayLater ? { count: installments, firstDueDate } : null,
        reservationMoves: cashTransfer && selectedGoalId ? [{ goalId: selectedGoalId, amount: parseMoney(carryAmount) }] : [],
      });
    } catch { setFormError("Enter valid amounts with no more than two decimal places."); }
  };
  const close = () => { submit.reset(); onClose(); };

  if (!isOpen) return null;

  return (
    <Dialog.Root modal={!reviewOpen} open={isOpen} onOpenChange={(open) => { if (!open && !isLoading && !reviewOpen) close(); }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content ref={formContentRef} aria-hidden={reviewOpen || undefined} data-mobile-nav-blocking="" data-no-press-motion="" aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground rounded-2xl w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] flex flex-col overflow-hidden shadow-xl" onEscapeKeyDown={(event) => { if (isLoading || reviewOpen) event.preventDefault(); }} onPointerDownOutside={(event) => { if (isLoading || reviewOpen) event.preventDefault(); }} onOpenAutoFocus={event => { if (reviewOpen || wasReviewOpen.current || restoringFormFocus.current) event.preventDefault(); }}>
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between p-6 border-b dark:border-slate-700">
          <Dialog.Title className="text-xl font-semibold">Add Transaction</Dialog.Title>
          <button
            onClick={close}
            disabled={isLoading}
            aria-label="Close transaction form"
            className="min-h-11 min-w-11 p-2 hover:bg-muted rounded-lg focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <div ref={retainFormScroll} onScroll={event => { formScrollTop.current = event.currentTarget.scrollTop; }} className="min-h-0 overflow-y-auto">
          {dataError && <p role="alert" className="px-6 pt-4 text-sm text-red-700 dark:text-red-300">{dataError}</p>}
          <fieldset onChange={() => { submit.reset(); setFormError(""); }} disabled={isDataLoading || isLoading || submit.unresolved || submit.phase === "saved"} className="p-6 space-y-6 min-w-0">
            {/* Transaction Type Selector */}
            <div>
              <label className="block text-sm font-medium mb-3">Transaction Type</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => { submit.reset(); setType("expense"); }}
                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-colors duration-200 motion-reduce:transition-none ${type === "expense"
                    ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-gray-200 dark:border-slate-700 hover:border-red-300"
                    }`}
                >
                  <ArrowUpRight className={`h-6 w-6 mb-2 ${type === "expense" ? "text-red-500" : "text-gray-400"}`} />
                  <span className={`text-sm font-medium ${type === "expense" ? "text-red-500" : ""}`}>Expense</span>
                </button>
                <button
                  type="button"
                  onClick={() => { submit.reset(); setType("income"); }}
                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-colors duration-200 motion-reduce:transition-none ${type === "income"
                    ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                    : "border-gray-200 dark:border-slate-700 hover:border-green-300"
                    }`}
                >
                  <ArrowDownLeft className={`h-6 w-6 mb-2 ${type === "income" ? "text-green-500" : "text-gray-400"}`} />
                  <span className={`text-sm font-medium ${type === "income" ? "text-green-500" : ""}`}>Income</span>
                </button>
                <button
                  type="button"
                  onClick={() => { submit.reset(); setType("transfer"); }}
                  className={`flex flex-col items-center justify-center p-4 border-2 rounded-xl transition-colors duration-200 motion-reduce:transition-none ${type === "transfer"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                    : "border-gray-200 dark:border-slate-700 hover:border-blue-300"
                    }`}
                >
                  <ArrowLeftRight className={`h-6 w-6 mb-2 ${type === "transfer" ? "text-blue-500" : "text-gray-400"}`} />
                  <span className={`text-sm font-medium ${type === "transfer" ? "text-blue-500" : ""}`}>Transfer</span>
                </button>
              </div>
            </div>

            {/* Amount */}
            <div>
              <label htmlFor="amount" className="block text-sm font-medium mb-2">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">₱</span>
                <input
                  type="number"
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  step="0.01"
                  min="0"
                  className="w-full pl-8 pr-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 text-lg font-semibold focus:ring-2 focus:ring-primary transition-all"
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            {/* Account */}
            <div>
              <label htmlFor="account" className="block text-sm font-medium mb-2">
                {type === "transfer" ? "From Account" : isPayLater && type === "expense" ? "PayLater/Debt Account" : "Account"}
              </label>
              {isDataLoading ? (
                <p role="status" className="min-h-11 text-sm text-muted-foreground p-3 bg-muted rounded-lg">Loading accounts…</p>
              ) : dataError ? (
                <p className="min-h-11 text-sm text-muted-foreground p-3 bg-muted rounded-lg">Accounts unavailable.</p>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 bg-slate-100 dark:bg-slate-900 rounded-lg">
                  You don&apos;t have any accounts yet. <Link href="/accounts" className="text-primary underline">Create an account first</Link>
                </p>
              ) : (
                <select
                  id="account"
                  value={isPayLater && type === "expense" ? payLaterAccountId : accountId}
                  onChange={(e) => {
                    if (isPayLater && type === "expense") {
                      setPayLaterAccountId(e.target.value);
                    } else {
                      setAccountId(e.target.value);
                    }
                  }}
                  className="w-full px-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-primary transition-all"
                  required
                >
                  <option value="">Select a wallet</option>
                  {(isPayLater && type === "expense"
                    ? accounts.filter((a: any) => a?.type === "credit_card")
                    : accounts.filter((a: any) => a?.type !== "credit_card")
                  ).map((a: any) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              {selectedAccount ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Balance: <span className="font-medium text-foreground">{formatCurrency(selectedAccountBalance)}</span>
                </p>
              ) : null}
              {isPayLater && type === "expense" && accounts.filter((a: any) => a?.type === "credit_card").length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No PayLater/Debt accounts yet. Create one in Accounts (type: Credit Card) and name it “SpayLater”.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="date" className="block text-sm font-medium mb-2">{isPayLater ? "Purchase date" : isDebtPayment ? "Payment date" : "Date"}</label>
              <input
                type="date"
                id="date"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
                className="min-h-11 w-full px-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-primary transition-all appearance-none block min-w-full bg-transparent"
                required
              />
            </div>

            {type === "expense" && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={isPayLater}
                    onChange={(e) => setIsPayLater(e.target.checked)}
                    className="h-4 w-4"
                  />
                  PayLater purchase (adds to debt)
                </label>
                <p className="text-xs text-muted-foreground">
                  If enabled, this expense will be recorded under your PayLater/Debt account. Your cash accounts won’t go down until you record a payment.
                </p>
                {isPayLater && (
                  <div className="space-y-4 border-t border-border pt-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">Payment schedule</h3>
                      <p className="text-xs text-muted-foreground">This purchase is recorded on the purchase date above. Due dates are separate.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="installments" className="block text-sm font-medium mb-2">Number of payments</label>
                        <select
                          id="installments"
                          value={installments}
                          onChange={(e) => setInstallments(Number(e.target.value))}
                          className="min-h-11 w-full px-4 py-3 border border-input rounded-lg bg-background focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                            <option key={n} value={n}>
                              {n === 1 ? "Pay in full" : `${n} payments`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="firstDueDate" className="block text-sm font-medium mb-2">First payment due date</label>
                        <input
                          type="date"
                          id="firstDueDate"
                          value={firstDueDate}
                          onChange={(e) => {
                            setFirstDueDate(e.target.value);
                            setFirstDueDateEdited(true);
                          }}
                          className="min-h-11 w-full px-4 py-3 border border-input rounded-lg bg-background focus-visible:ring-2 focus-visible:ring-primary"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold text-muted-foreground">Estimated payment dates</h4>
                      <p className="text-xs text-muted-foreground">The dates follow the first due date above. Adjust it to match your lender’s schedule.</p>
                      {installmentPreview.length > 0 ? (
                        <ul aria-label="Payment schedule preview" className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                          {installmentPreview.map(({ dueDate, amount: paymentAmount }, index) => {
                            const [year, month, day] = dueDate.split("-").map(Number);
                            const label = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
                              .format(new Date(year, month - 1, day));
                            return (
                              <li key={`${dueDate}-${index}`} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm">
                                <time dateTime={dueDate} className="text-muted-foreground">{label}</time>
                                <span className="shrink-0 font-semibold text-foreground">₱{paymentAmount}</span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                          Enter an amount that can be split across each payment to preview the schedule.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Transfer To Account */}
            {type === "transfer" && (
              <div className="animate-in slide-in-from-top duration-200 motion-reduce:animate-none">
                <label htmlFor="transferTo" className="block text-sm font-medium mb-2">To Account</label>
                <select
                  id="transferTo"
                  value={transferToAccountId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setTransferToAccountId(nextId);
                  }}
                  className="w-full px-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-primary transition-all"
                  required
                >
                  <option value="">Select destination account</option>
                  {accounts.filter(a => a.id !== accountId).map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}{a.type === "credit_card" ? " (Pay Debt)" : ""}
                    </option>
                  ))}
                </select>
                {transferToAccount ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Balance: <span className="font-medium text-foreground">{formatCurrency(transferToBalance)}</span>
                  </p>
                ) : null}
                {isDebtPayment ? (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground">
                      Payment will be recorded on the chosen date and included in the {selectedDebtMonthLabel || "selected month"} debt summary.
                    </p>
                    <p className="mt-2 text-base font-semibold text-primary">
                      {selectedDebtMonthLabel} debt total: {isDebtMonthLoading ? "Loading..." : formatCurrency(selectedDebtMonthAmount)}
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {/* Category */}
            <div>
              <label htmlFor="category" className="block text-sm font-medium mb-2">Category</label>
              {type === "transfer" ? (
                <input
                  type="text"
                  value="Transfer"
                  readOnly
                  className="w-full px-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 bg-gray-50 dark:bg-slate-950 cursor-not-allowed text-muted-foreground"
                />
              ) : (
                <select
                  id="category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-primary transition-all"
                >
                  <option value="">No category</option>
                  {categories.filter(c => c.type === type).map((c) => (
                    <option value={c.id} key={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Date */}
            {(type === "expense" || type === "transfer") && <GoalSelector value={goalId} onChange={setGoalId} disabled={isLoading} meaning={isPayLater ? "purchase" : type === "transfer" && !isDebtPayment ? "carry" : "spend"} debtOnly={isDebtPayment} />}
            {type === "transfer" && !isDebtPayment && goalId && <div>
              <label htmlFor="carry-amount" className="block text-sm font-medium mb-2">Reservation to carry</label>
              <input id="carry-amount" type="number" min="0.01" step="0.01" required value={carryAmount} onChange={event => setCarryAmount(event.target.value)} className="min-h-11 w-full px-4 py-3 border rounded-lg bg-background focus-visible:ring-2 focus-visible:ring-primary" />
            </div>}

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium mb-2">Description (Optional)</label>
              <input
                type="text"
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg dark:bg-slate-900 dark:border-slate-700 focus:ring-2 focus:ring-primary transition-all"
                placeholder="Enter description"
              />
            </div>
          </fieldset>

          </div>
          <div className="shrink-0 border-t dark:border-slate-700">
            {!reviewOpen && (formError || submit.error) && (
              <div className="max-h-28 overflow-y-auto overscroll-contain px-4 pt-3 sm:px-6">
                <p ref={errorRef} tabIndex={-1} role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{formError || submit.error}</p>
              </div>
            )}
            {submit.unresolved && (
              <div className="px-4 pt-3 sm:px-6">
                <button ref={retryButtonRef} type="button" disabled={isLoading} onClick={() => { void submit.confirm(); }} className="min-h-11 px-4 py-3 rounded-lg bg-primary text-slate-950 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary">Retry same transaction</button>
              </div>
            )}
            {submit.phase === "saved" && <p role="status" className="max-h-28 overflow-y-auto overscroll-contain break-words px-4 pt-3 text-sm sm:px-6">{submit.refreshError ? "Transaction saved. Some views could not refresh. Close and refresh the page; do not save it again." : "Transaction saved."}</p>}
            {/* Modal Footer */}
            <div className="flex shrink-0 gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={close}
                disabled={isLoading}
                className="flex-1 min-h-11 px-4 py-3 text-sm border rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-200 motion-reduce:transition-none font-medium"
              >
                {submit.phase === "saved" ? "Close" : "Cancel"}
              </button>
              <button
                ref={submitButtonRef}
                type="submit"
                disabled={isLoading || isDataLoading || !!dataError || accounts.length === 0 || submit.phase === "review" || submit.phase === "saved"}
                className="flex-1 min-h-11 px-4 py-3 text-sm rounded-lg bg-primary text-slate-950 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 motion-reduce:transition-none font-medium hover:shadow-lg"
              >
                {isLoading ? "Checking..." : isDataLoading ? "Loading accounts..." : submit.phase === "saved" ? "Saved" : "Add Transaction"}
              </button>
            </div>
          </div>
        </form>
      </Dialog.Content>
      </Dialog.Portal>
      {reviewOpen && displayReview && <GoalReleaseDialog open quote={displayReview.quote} draft={displayReview.draft} snapshot={financeSnapshot} busy={isLoading || submit.phase !== "review"} error={submit.error} returnFocusRef={submitButtonRef} onChange={releases => { if (submit.draft) void submit.quote(submit.draft, releases); }} onConfirm={() => { void submit.confirm(); }} onCancel={submit.reset} />}
    </Dialog.Root>
  );
}
