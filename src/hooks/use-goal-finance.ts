import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetchGoalFinance } from "@/lib/goals/client";
import type { GoalFinanceSnapshot } from "@/lib/goals/contracts";
import { refreshFinancialData } from "@/lib/refresh-financial-data";

export function useGoalFinance(userId: string | null) {
  const { mutate: mutateCache } = useSWRConfig();
  const [snapshotUserId, setSnapshotUserId] = useState(userId);
  const selectedUserId = useRef(userId);
  selectedUserId.current = userId;
  const key = userId ? ["goalFinance", userId] as const : null;
  const fetchForUser = useCallback(async () => {
    const snapshot = await fetchGoalFinance();
    if (selectedUserId.current === userId) setSnapshotUserId(userId);
    return snapshot;
  }, [userId]);
  const { data: cachedData, error, isLoading, mutate } = useSWR<GoalFinanceSnapshot>(key, fetchForUser);

  useEffect(() => setSnapshotUserId(userId), [userId]);

  useEffect(() => {
    if (userId !== null) return;
    void mutateCache(
      cacheKey => Array.isArray(cacheKey) && (cacheKey[0] === "goalFinance" || cacheKey[0] === "goalHistory"),
      () => undefined,
      { populateCache: true, revalidate: false },
    );
  }, [mutateCache, userId]);

  const refresh = useCallback(async () => {
    if (userId === null) return;
    await refreshFinancialData(userId, mutateCache);
  }, [mutateCache, userId]);

  return { data: snapshotUserId === userId ? cachedData : undefined, isLoading, error, refresh, mutate };
}
