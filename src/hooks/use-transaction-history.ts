import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { historyQueryFingerprint, normalizeHistoryQuery, type HistoryQuery } from "@/lib/transactions/history-query";
import { loadFilteredHistoryPage, loadHistoryFilterOptions, type FilteredHistoryEntry, type FilteredHistoryPage, type HistoryFilterOptions } from "@/lib/transactions/history-filtered";
import { SpendingOwnerChangedError, useSpendingOwner } from "./use-spending-owner";

type ReadMode = "initial" | "more" | "refresh";
type HistoryState = {
  key: string; entries: FilteredHistoryEntry[]; nextOffset: number | null; loadedPages: number;
  totalMatchingEntries: number | null; invalidAmountEntryCount: number | null;
  loading: ReadMode | null; error: unknown | null; failedMode: ReadMode | null;
};
const empty = (key: string): HistoryState => ({ key, entries: [], nextOffset: null, loadedPages: 0, totalMatchingEntries: null,
  invalidAmountEntryCount: null, loading: null, error: null, failedMode: null });
type OptionsState = HistoryFilterOptions & { key: string; loading: boolean; error: unknown | null };

export function useTransactionHistory(input: Partial<HistoryQuery> = {}) {
  const owner = useSpendingOwner();
  const query = normalizeHistoryQuery({ ...input, offset: 0 });
  const fingerprint = historyQueryFingerprint(query);
  const ownerKey = `${owner.userId ?? ""}:${owner.generation}:${owner.status}`;
  const key = `${ownerKey}:${fingerprint}`;
  const alive = useRef(false);
  const epoch = useRef(0);
  const readSequence = useRef(0);
  const optionSequence = useRef(0);
  const inFlight = useRef<number | null>(null);
  const current = useRef({ key, ownerKey, owner, query });
  if (current.current.key !== key) {
    epoch.current += 1;
    inFlight.current = null;
  }
  current.current = { key, ownerKey, owner, query };
  const [state, setState] = useState<HistoryState>(() => empty(key));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [options, setOptions] = useState<OptionsState>({ key: "", wallets: [], categories: [], loading: false, error: null });
  const publish = useCallback((value: HistoryState) => { stateRef.current = value; setState(value); }, []);

  useEffect(() => { alive.current = true; return () => {
    alive.current = false; epoch.current += 1; readSequence.current += 1; optionSequence.current += 1; inFlight.current = null;
  }; }, []);

  const run = useCallback(async (mode: ReadMode) => {
    const context = current.current;
    if (!alive.current || context.owner.status !== "authenticated" || !context.owner.isCurrent()) {
      if (mode === "refresh") throw new SpendingOwnerChangedError();
      return;
    }
    if (inFlight.current !== null && mode !== "refresh") return;
    const previous = stateRef.current.key === context.key ? stateRef.current : empty(context.key);
    if (mode === "more" && previous.nextOffset === null) return;
    const sequence = ++readSequence.current;
    inFlight.current = sequence;
    const requestEpoch = epoch.current;
    const valid = () => alive.current && epoch.current === requestEpoch && current.current.key === context.key && sequence === readSequence.current && context.owner.isCurrent();
    publish({ ...previous, loading: mode, error: null, failedMode: null });
    try {
      const request = await context.owner.capture();
      if (!valid() || !request.isCurrent()) throw new SpendingOwnerChangedError();
      const client = createClient();
      const pages: FilteredHistoryPage[] = [];
      let offset = mode === "more" ? previous.nextOffset! : 0;
      const pageCount = mode === "refresh" ? Math.max(1, previous.loadedPages) : 1;
      for (let index = 0; index < pageCount; index += 1) {
        request.assertCurrent();
        const page = await loadFilteredHistoryPage(client, request.userId, { ...context.query, offset }, request.accessToken);
        if (!valid() || !request.isCurrent()) throw new SpendingOwnerChangedError();
        pages.push(page);
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
      const last = pages[pages.length - 1];
      const entries = [...(mode === "more" ? previous.entries : []), ...pages.flatMap(page => page.entries)];
      if (new Set(entries.map(entry => entry.key)).size !== entries.length) throw new Error("History changed while loading. Refresh the list.");
      const rowIds = entries.flatMap(entry => entry.kind === "transaction" ? [entry.transaction.id] : entry.children.map(row => row.id));
      if (new Set(rowIds).size !== rowIds.length) throw new Error("History changed while loading. Refresh the list.");
      publish({ key: context.key, entries, nextOffset: last.nextOffset, loadedPages: (mode === "more" ? previous.loadedPages : 0) + pages.length,
        totalMatchingEntries: last.totalMatchingEntries, invalidAmountEntryCount: last.invalidAmountEntryCount,
        loading: null, error: null, failedMode: null });
    } catch (error) {
      if (valid()) { publish({ ...previous, loading: null, error, failedMode: mode }); throw error; }
      if (mode === "refresh") throw error;
    } finally { if (inFlight.current === sequence) inFlight.current = null; }
  }, [publish]);

  const previousQuery = useRef<HistoryQuery | null>(null);
  useEffect(() => {
    const context = current.current;
    const before = previousQuery.current;
    previousQuery.current = context.query;
    if (context.owner.status !== "authenticated") return;
    publish({ ...empty(context.key), loading: "initial" });
    const searchChanged = before?.search !== context.query.search && context.query.search !== "";
    const otherChanged = before !== null && historyQueryFingerprint({ ...before, search: "" }) !== historyQueryFingerprint({ ...context.query, search: "" });
    if (searchChanged && !otherChanged) {
      const timer = setTimeout(() => { void run("initial").catch(() => undefined); }, 300);
      return () => clearTimeout(timer);
    }
    void run("initial").catch(() => undefined);
  }, [key, publish, run]);

  const retryOptions = useCallback(async () => {
    const context = current.current;
    if (!alive.current || context.owner.status !== "authenticated" || !context.owner.isCurrent()) return;
    const sequence = ++optionSequence.current;
    const valid = () => alive.current && current.current.ownerKey === context.ownerKey && sequence === optionSequence.current && context.owner.isCurrent();
    setOptions({ key: context.ownerKey, wallets: [], categories: [], loading: true, error: null });
    try {
      const request = await context.owner.capture();
      if (!valid() || !request.isCurrent()) return;
      const data = await loadHistoryFilterOptions(createClient(), request.userId, request.accessToken);
      if (valid() && request.isCurrent()) setOptions({ ...data, key: context.ownerKey, loading: false, error: null });
    } catch (error) {
      if (valid()) { setOptions({ key: context.ownerKey, wallets: [], categories: [], loading: false, error }); throw error; }
    }
  }, []);
  useEffect(() => { void retryOptions().catch(() => undefined); }, [ownerKey, retryOptions]);

  const visible = owner.status === "authenticated" && owner.isCurrent();
  const shown = visible && state.key === key ? state : empty(key);
  const shownOptions = visible && options.key === ownerKey ? options : { wallets: [], categories: [], loading: false, error: null };
  return {
    userId: owner.userId, ownerStatus: owner.status, query, queryKey: key,
    entries: shown.entries, matchingRowIds: shown.entries.flatMap(entry => entry.matchingRowIds), nextOffset: shown.nextOffset,
    totalMatchingEntries: shown.totalMatchingEntries, invalidAmountEntryCount: shown.invalidAmountEntryCount,
    isLoading: owner.isLoading || visible && (state.key !== key || shown.loading === "initial" || shown.loadedPages === 0 && shown.error === null),
    isLoadingMore: shown.loading === "more", isRefreshing: shown.loading === "refresh",
    error: owner.error ?? shown.error,
    loadMore: () => run("more"), refresh: () => run("refresh"), retry: () => run(stateRef.current.key === key ? stateRef.current.failedMode ?? "initial" : "initial"),
    options: { wallets: shownOptions.wallets, categories: shownOptions.categories, isLoading: owner.isLoading || visible && (options.key !== ownerKey || shownOptions.loading),
      error: owner.error ?? shownOptions.error, retry: retryOptions },
  };
}
