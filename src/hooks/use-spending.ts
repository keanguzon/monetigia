import { useRef, useState } from "react";
import useSWR, { unstable_serialize, useSWRConfig } from "swr";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { PositiveMoneySchema } from "@/lib/money/contracts";
import { comparisonRange, spentToDateEnd, type SpendingPeriod } from "@/lib/spending/periods";
import { fetchSpendingSummary } from "@/lib/spending/summary";
import { useSpendingOwner } from "./use-spending-owner";

const limitSchema = z.object({ user_id: z.string(), amount: PositiveMoneySchema, cadence: z.enum(["month", "cutoff"]) });
export type SpendingLimitValue = Pick<z.infer<typeof limitSchema>, "amount" | "cadence">;
export type SpendingLimitSaveOutcome = { saved: SpendingLimitValue | null; refreshError: unknown | null };
const limitFields = "user_id,amount::text,cadence";
const limitKey = (userId: string) => ["spending-limit", userId] as const;

function parseLimit(value: unknown, userId: string): SpendingLimitValue {
  const row = limitSchema.parse(value);
  if (row.user_id !== userId) throw new Error("The spending limit belongs to a different account.");
  return { amount: row.amount, cadence: row.cadence };
}

export function useSpendingSummary(period: SpendingPeriod | null, today: Date) {
  const owner = useSpendingOwner();
  const end = period ? spentToDateEnd(period, today) : null;
  const enabled = Boolean(period && end && period.start <= end && owner.userId);
  const previous = enabled && period ? comparisonRange(period, today) : null;
  const currentKey = enabled && period && owner.userId && end ? ["spending-summary", owner.userId, period.start, end] as const : null;
  const previousKey = previous && owner.userId ? ["spending-summary", owner.userId, previous.start, previous.end] as const : null;
  const read = async ([, , start, rangeEnd]: readonly [string, string, string, string]) => {
    const request = await owner.capture();
    const data = await fetchSpendingSummary({ start, end: rangeEnd }, request.accessToken);
    request.assertCurrent();
    return data;
  };
  const current = useSWR(currentKey, read, { keepPreviousData: false });
  const comparison = useSWR(previousKey, read, { keepPreviousData: false });
  const visible = enabled && owner.isCurrent();
  return {
    data: visible ? current.data : undefined,
    error: owner.error ?? (visible ? current.error : undefined),
    isLoading: Boolean(period && (owner.isLoading || (enabled && current.isLoading))),
    comparison: visible ? comparison.data : undefined,
    comparisonError: owner.error ?? (visible ? comparison.error : undefined),
    isComparisonLoading: Boolean(period && (owner.isLoading || (enabled && comparison.isLoading))),
    retry: () => Promise.allSettled([current.mutate(), comparison.mutate()]),
  };
}

export function useSpendingLimit() {
  const owner = useSpendingOwner();
  const result = useSWR(owner.userId ? limitKey(owner.userId) : null, async () => {
    const request = await owner.capture();
    const { data, error } = await createClient().from("spending_limits").select(limitFields).eq("user_id", request.userId)
      .maybeSingle().setHeader("Authorization", `Bearer ${request.accessToken}`);
    request.assertCurrent();
    if (error) throw error;
    return data === null ? null : parseLimit(data, request.userId);
  }, { keepPreviousData: false });
  return {
    limit: owner.status === "signed-out" ? null : owner.isCurrent() ? result.data : undefined,
    error: owner.error ?? (owner.isCurrent() ? result.error ?? null : null),
    isLoading: owner.isLoading || Boolean(owner.userId && result.isLoading),
  };
}

export function useSpendingLimitCommand() {
  const owner = useSpendingOwner();
  const { mutate, cache } = useSWRConfig();
  const [state, setState] = useState<{ generation: number; isSaving: boolean; error: unknown | null }>({ generation: -1, isSaving: false, error: null });
  const saving = useRef(false);
  const run = async (input: SpendingLimitValue | null): Promise<SpendingLimitSaveOutcome> => {
    if (saving.current) throw new Error("A spending limit change is already saving.");
    saving.current = true;
    if (owner.isCurrent()) setState({ generation: owner.generation, isSaving: true, error: null });
    try {
      const request = await owner.capture();
      const client = createClient();
      let saved: SpendingLimitValue | null;
      if (input) {
        const amount = PositiveMoneySchema.parse(input.amount);
        const cadence = z.enum(["month", "cutoff"]).parse(input.cadence);
        const { data, error } = await client.from("spending_limits").upsert({ user_id: request.userId, amount, cadence }, { onConflict: "user_id" })
          .select(limitFields).single().setHeader("Authorization", `Bearer ${request.accessToken}`);
        if (error) throw error;
        saved = parseLimit(data, request.userId);
      } else {
        const { data, error } = await client.from("spending_limits").delete().eq("user_id", request.userId)
          .select(limitFields).setHeader("Authorization", `Bearer ${request.accessToken}`);
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error("The spending limit removal could not be confirmed.");
        for (const row of data) parseLimit(row, request.userId);
        saved = null;
      }
      let refreshError: unknown | null = null;
      try {
        await mutate(limitKey(request.userId));
        const failure = cache.get(unstable_serialize(limitKey(request.userId)))?.error;
        if (failure) throw failure;
      } catch (error) { refreshError = error; }
      return { saved, refreshError };
    } catch (error) {
      if (owner.isCurrent()) setState({ generation: owner.generation, isSaving: false, error });
      throw error;
    } finally {
      saving.current = false;
      if (owner.isCurrent()) setState(current => ({ ...current, isSaving: false }));
    }
  };
  return {
    save: (amount: string, cadence: SpendingLimitValue["cadence"]) => run({ amount, cadence }),
    remove: () => run(null),
    isSaving: state.generation === owner.generation && state.isSaving,
    error: owner.error ?? (state.generation === owner.generation ? state.error : null),
  };
}
