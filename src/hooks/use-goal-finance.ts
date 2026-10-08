import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetchGoalFinance, fetchGoalHistory, fetchGoalWalletMetadata, SupersededGoalFinanceRequestError } from "@/lib/goals/client";
import type { GoalFinanceSnapshot } from "@/lib/goals/contracts";
import { refreshFinancialData } from "@/lib/refresh-financial-data";
import { createClient } from "@/lib/supabase/client";

export function useGoalFinance(userId: string | null) {
  const { mutate: mutateCache } = useSWRConfig();
  const { cache } = useSWRConfig();
  const [snapshotUserId, setSnapshotUserId] = useState(userId);
  const previousUserId = useRef(userId);
  const selectedUser = useRef({ userId, revision: 0 });
  if (selectedUser.current.userId !== userId) {
    selectedUser.current = { userId, revision: selectedUser.current.revision + 1 };
  }
  const sessionRevision = useRef(0);
  const identityRevision = useRef(0);
  const authSession = useRef<{ userId: string; accessToken: string } | null>(null);
  const key = userId ? ["goalFinance", userId] as const : null;
  const fetchForUser = useCallback(async () => {
    const selection = selectedUser.current;
    let requestSessionRevision = sessionRevision.current;
    const requestIdentityRevision = identityRevision.current;
    const isCurrentRequest = () => selectedUser.current.userId === userId &&
      selectedUser.current.revision === selection.revision &&
      sessionRevision.current === requestSessionRevision;
    let snapshot: GoalFinanceSnapshot;
    try {
      snapshot = await fetchGoalFinance(userId ?? undefined, isCurrentRequest);
    } catch (error) {
      if (!(error instanceof SupersededGoalFinanceRequestError) ||
        selectedUser.current.revision !== selection.revision ||
        identityRevision.current !== requestIdentityRevision ||
        sessionRevision.current === requestSessionRevision || authSession.current?.userId !== userId) throw error;
      requestSessionRevision = sessionRevision.current;
      snapshot = await fetchGoalFinance(userId ?? undefined, isCurrentRequest);
    }
    if (isCurrentRequest()) setSnapshotUserId(userId);
    return snapshot;
  }, [userId]);
  const { data: cachedData, error, isLoading, mutate } = useSWR<GoalFinanceSnapshot>(key, fetchForUser);

  useEffect(() => setSnapshotUserId(userId), [userId]);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      const nextSession = session ? { userId: session.user.id, accessToken: session.access_token } : null;
      const previousSession = authSession.current;
      const repeatedSignIn = event === "SIGNED_IN" && previousSession !== null && nextSession !== null &&
        previousSession.userId === nextSession.userId && previousSession.accessToken === nextSession.accessToken;
      if (event !== "INITIAL_SESSION" && !repeatedSignIn) sessionRevision.current += 1;
      if (event !== "INITIAL_SESSION" && !repeatedSignIn &&
        !((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && nextSession !== null &&
          (previousSession === null || previousSession.userId === nextSession.userId))) {
        identityRevision.current += 1;
      }
      authSession.current = nextSession;
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const signedOutUserId = previousUserId.current;
    previousUserId.current = userId;
    if (userId !== null || signedOutUserId === null) return;
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
