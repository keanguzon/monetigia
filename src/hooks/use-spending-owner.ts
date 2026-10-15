import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type OwnerState = {
  userId: string | null;
  status: "resolving" | "authenticated" | "signed-out" | "error";
  error: unknown | null;
  generation: number;
};
export class SpendingOwnerChangedError extends Error {
  constructor() {
    super("Sign in to the account that started this request.");
    this.name = "SpendingOwnerChangedError";
  }
}
export type SpendingOwnerRequest = { userId: string; accessToken: string; isCurrent: () => boolean; assertCurrent: () => void };

export function useSpendingOwner() {
  const [state, setState] = useState<OwnerState>({ userId: null, status: "resolving", error: null, generation: 0 });
  const current = useRef(state);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let active = true;
    let events = 0;
    const publish = (userId: string | null, error: unknown | null = null) => {
      if (!active) return;
      const status = error ? "error" : userId ? "authenticated" : "signed-out";
      const previous = current.current;
      const next: OwnerState = { userId, status, error, generation: previous.generation + (previous.userId !== userId || previous.status !== status ? 1 : 0) };
      current.current = next;
      setState(next);
    };
    const client = createClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      events += 1;
      publish(session?.user.id ?? null);
    });
    const lookupEvents = events;
    void client.auth.getUser().then(({ data, error }) => {
      if (events === lookupEvents) publish(error ? null : data.user?.id ?? null, error);
    }).catch(error => { if (events === lookupEvents) publish(null, error); });
    return () => { active = false; alive.current = false; subscription.unsubscribe(); };
  }, []);

  const isCurrent = () => alive.current && state.userId !== null && current.current.status === "authenticated" &&
    current.current.userId === state.userId && current.current.generation === state.generation;
  const assertCurrent = () => { if (!isCurrent()) throw new SpendingOwnerChangedError(); };
  const capture = async (): Promise<SpendingOwnerRequest> => {
    assertCurrent();
    const { data: { session }, error } = await createClient().auth.getSession();
    assertCurrent();
    if (error || !session || session.user.id !== state.userId) throw new SpendingOwnerChangedError();
    return { userId: session.user.id, accessToken: session.access_token, isCurrent, assertCurrent };
  };
  return { ...state, isLoading: state.status === "resolving", isCurrent, capture };
}
