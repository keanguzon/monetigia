import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetchGoalFinance, fetchGoalHistory, fetchGoalWalletMetadata } from "@/lib/goals/client";
import type { GoalFinanceSnapshot } from "@/lib/goals/contracts";
import { refreshFinancialData } from "@/lib/refresh-financial-data";
import { createClient } from "@/lib/supabase/client";

export function useGoalFinance(userId: string | null) {
  const { mutate: mutateCache } = useSWRConfig();
  const { cache } = useSWRConfig();
  const [snapshotUserId, setSnapshotUserId] = useState(userId);
  const selectedUser = useRef({ userId, revision: 0 });
  if (selectedUser.current.userId !== userId) {
    selectedUser.current = { userId, revision: selectedUser.current.revision + 1 };
  }
  const sessionRevision = useRef(0);
  const key = userId ? ["goalFinance", userId] as const : null;
  const fetchForUser = useCallback(async () => {
    const selection = selectedUser.current;
    const requestSessionRevision = sessionRevision.current;
    const isCurrentRequest = () => selectedUser.current.userId === userId &&
      selectedUser.current.revision === selection.revision &&
      sessionRevision.current === requestSessionRevision;
    const snapshot = await fetchGoalFinance(userId ?? undefined, isCurrentRequest);
    if (isCurrentRequest()) setSnapshotUserId(userId);
    return snapshot;
  }, [userId, selectedUser.current.revision]);
  const { data: cachedData, error, isLoading, mutate } = useSWR<GoalFinanceSnapshot>(key, fetchForUser);

  useEffect(() => setSnapshotUserId(userId), [userId]);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange(event => {
      if (event !== "INITIAL_SESSION") sessionRevision.current += 1;
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId !== null) return;
    void mutateCache(
      cacheKey => Array.isArray(cacheKey) && (cacheKey[0] === "goalFinance" || cacheKey[0] === "goalHistory" || cacheKey[0] === "goalWalletMetadata"),
      () => undefined,
      { populateCache: true, revalidate: false },
    );
  }, [mutateCache, userId]);

  const refresh = useCallback(async () => {
    if (userId === null) return;
    await refreshFinancialData(userId, mutateCache, cache);
  }, [cache, mutateCache, userId]);

  const data = snapshotUserId === userId ? cachedData : undefined;
  return { data, snapshot: data, userId, isLoading, error, refresh, mutate };
}

export function useGoalWalletMetadata(userId: string | null) {
  const key = userId ? ["goalWalletMetadata", userId] as const : null;
  const { data, error, isLoading, mutate } = useSWR(key, ([, scopedUserId]) => fetchGoalWalletMetadata(scopedUserId));
  return { data: userId ? data : undefined, error, isLoading, refresh: mutate };
}

export function useGoalHistory(userId: string | null, goalId: string | null) {
  const key = userId && goalId ? ["goalHistory", userId, goalId] as const : null;
  const { data, error, isLoading, mutate } = useSWR(key, ([, scopedUserId, scopedGoalId]) => fetchGoalHistory(scopedUserId, scopedGoalId));
  return { data: userId && goalId ? data : undefined, error, isLoading, refresh: mutate };
}
