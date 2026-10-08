"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useGoals } from "@/hooks/use-goals";
import { financialCommandMessage } from "@/lib/goals/client";
import type { GoalFinanceGoal } from "@/lib/goals/contracts";
import { restoreArchivedGoalAndRefresh } from "@/lib/refresh-financial-data";

const sectionClass = "grid gap-5 px-5 py-6 sm:px-7 sm:py-7 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8";
const sectionTitleClass = "font-heading text-lg font-bold tracking-tight text-foreground";
const sectionDescriptionClass = "max-w-xs text-sm leading-relaxed text-muted-foreground";

type ArchivedGoalsUserState = {
  requestIds: Map<string, string>;
  inFlight: Set<string>;
  savedGoalIds: Set<string>;
  busyGoalId: string | null;
  actionError: string;
  savedMessage: string;
  refreshError: string;
  loadRetryError: string;
  loadRetrying: boolean;
  refreshRetrying: boolean;
};

function createUserState(): ArchivedGoalsUserState {
  return {
    requestIds: new Map(), inFlight: new Set(), savedGoalIds: new Set(), busyGoalId: null,
    actionError: "", savedMessage: "", refreshError: "", loadRetryError: "",
    loadRetrying: false, refreshRetrying: false,
  };
}

function statusLabel(status: GoalFinanceGoal["status"]) {
  return status === "active" ? "Active" : status === "completed" ? "Completed" : "Cancelled";
}

function archiveDateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date)
    : "Date unavailable";
}

function targetLabel(value: string) {
  return `PHP ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function outcomeIsUnknown(error: unknown) {
  return typeof error === "object" && error !== null && "outcome" in error && error.outcome === "unknown";
}

function messageFrom(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

export function ArchivedGoalsSection() {
  const finance = useGoals();
  const userStates = useRef(new Map<string, ArchivedGoalsUserState>());
  const activeSession = useRef({ userId: finance.userId, revision: 0 });
  const [, setRenderRevision] = useState(0);

  if (activeSession.current.userId !== finance.userId) {
    activeSession.current = { userId: finance.userId, revision: activeSession.current.revision + 1 };
  }

  let userState: ArchivedGoalsUserState | null = null;
  if (finance.userId) {
    userState = userStates.current.get(finance.userId) ?? createUserState();
    userStates.current.set(finance.userId, userState);
  }

  const rerenderIfCurrent = (userId: string | null, revision: number) => {
    if (activeSession.current.userId === userId && activeSession.current.revision === revision) {
      setRenderRevision(value => value + 1);
    }
  };

  const retryLoading = async () => {
    const userId = finance.userId;
    if (!userId || !userState || userState.loadRetrying) return;
    const revision = activeSession.current.revision;
    userState.loadRetrying = true;
    userState.loadRetryError = "";
    setRenderRevision(value => value + 1);
    try {
      await finance.refresh();
    } catch (error) {
      userState.loadRetryError = messageFrom(error, "Please try again.");
    } finally {
      userState.loadRetrying = false;
      rerenderIfCurrent(userId, revision);
    }
  };

  const restoreGoal = async (goal: GoalFinanceGoal) => {
    const userId = finance.userId;
    if (!userId || !userState || userState.inFlight.has(goal.id)) return;
    const sessionState = userState;
    const revision = activeSession.current.revision;
    sessionState.inFlight.add(goal.id);
    sessionState.busyGoalId = goal.id;
    sessionState.actionError = "";
    sessionState.savedMessage = "";
    sessionState.refreshError = "";
    setRenderRevision(value => value + 1);

    const requestId = sessionState.requestIds.get(goal.id) ?? crypto.randomUUID();
    sessionState.requestIds.set(goal.id, requestId);
    try {
      const result = await restoreArchivedGoalAndRefresh(requestId, goal.id, finance.refresh);
      sessionState.requestIds.delete(goal.id);
      sessionState.savedMessage = `${goal.name} moved back to Goals. It is still ${statusLabel(goal.status).toLowerCase()}, and its spending history is unchanged.`;
      if (result.refreshError) {
        sessionState.savedGoalIds.add(goal.id);
        sessionState.refreshError = messageFrom(result.refreshError, "The saved change could not be refreshed.");
      } else {
        sessionState.savedGoalIds.delete(goal.id);
      }
    } catch (error) {
      if (!outcomeIsUnknown(error)) sessionState.requestIds.delete(goal.id);
      sessionState.actionError = outcomeIsUnknown(error)
        ? `${goal.name}: We could not confirm the restore. Retry to check the same request.`
        : `${goal.name}: ${financialCommandMessage(error, "Could not restore this goal. Try again.")}`;
    } finally {
      sessionState.inFlight.delete(goal.id);
      sessionState.busyGoalId = null;
      rerenderIfCurrent(userId, revision);
    }
  };

  const retryRefresh = async () => {
    const userId = finance.userId;
    if (!userId || !userState || userState.refreshRetrying) return;
    const sessionState = userState;
    const revision = activeSession.current.revision;
    sessionState.refreshRetrying = true;
    sessionState.refreshError = "";
    setRenderRevision(value => value + 1);
    try {
      await finance.refresh();
      sessionState.savedGoalIds.clear();
    } catch (error) {
      sessionState.refreshError = messageFrom(error, "The saved change could not be refreshed.");
    } finally {
      sessionState.refreshRetrying = false;
      rerenderIfCurrent(userId, revision);
    }
  };

  const archivedGoals = (finance.financeSnapshot?.goals ?? [])
    .filter(goal => goal.archived_at !== null && !userState?.savedGoalIds.has(goal.id));

  return (
    <section aria-labelledby="archived-goals-heading" className={sectionClass}>
      <div className="space-y-1">
        <h2 id="archived-goals-heading" className={sectionTitleClass}>Archived goals</h2>
        <p className={sectionDescriptionClass}>
          Restore a goal to Goals with its status and spending history intact. Reopen it separately from Goals.
        </p>
      </div>
      <div className="min-w-0 space-y-3">
        {finance.isLoading ? (
          <p role="status" aria-label="Loading archived goals" className="text-sm text-muted-foreground">Loading archived goals…</p>
        ) : finance.isError && !finance.userId ? (
          <p role="alert" className="text-sm text-foreground">Your session could not be checked. Refresh Settings or sign in again.</p>
        ) : !finance.userId ? (
          <p className="text-sm text-muted-foreground">Sign in to view archived goals.</p>
        ) : finance.isError ? (
          <div role="alert" className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-foreground">
            <p>Archived goals could not load. Try again. {userState?.loadRetryError}</p>
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-[44px] border-foreground/50"
              disabled={userState?.loadRetrying ?? false}
              onClick={() => void retryLoading()}
            >
              {userState?.loadRetrying ? "Retrying…" : "Retry loading archived goals"}
            </Button>
          </div>
        ) : archivedGoals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No archived goals. Goals you archive will appear here.</p>
        ) : (
          <ul className="min-w-0 divide-y divide-border/70" aria-label="Archived goals">
            {archivedGoals.map(goal => {
              const busy = userState?.busyGoalId === goal.id;
              const isRetry = userState?.requestIds.has(goal.id) ?? false;
              return (
                <li key={goal.id} className="grid min-w-0 gap-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0 space-y-2">
                    <h3 className="break-words [overflow-wrap:anywhere] text-sm font-semibold text-foreground">{goal.name}</h3>
                    <dl className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm">
                      <div className="flex flex-wrap gap-x-1">
                        <dt className="text-muted-foreground">Status</dt>
                        <dd className="text-foreground">{statusLabel(goal.status)}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-1">
                        <dt className="text-muted-foreground">Target</dt>
                        <dd className="text-foreground">{targetLabel(goal.target_amount)}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-1">
                        <dt className="text-muted-foreground">Archived</dt>
                        <dd className="text-foreground">{goal.archived_at ? archiveDateLabel(goal.archived_at) : "Date unavailable"}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`${isRetry ? "Retry restore" : "Restore"} ${goal.name}`}
                      disabled={!userState || userState.busyGoalId !== null || userState.refreshRetrying || userState.loadRetrying}
                      className="h-11 min-w-[44px] max-w-full border-foreground/50 px-4"
                      onClick={() => void restoreGoal(goal)}
                    >
                      {busy ? "Restoring…" : isRetry ? "Retry restore" : "Restore"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {userState?.actionError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{userState.actionError}</p>}
        {userState?.savedMessage && <p role="status" className="text-sm text-foreground">{userState.savedMessage}</p>}
        {userState?.refreshError && (
          <div role="alert" className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-foreground">
            <p>The restore was saved, but archived goals could not refresh. {userState.refreshError}</p>
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-[44px] border-foreground/50"
              disabled={userState.refreshRetrying}
              onClick={() => void retryRefresh()}
            >
              {userState.refreshRetrying ? "Refreshing…" : "Retry refreshing archived goals"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
