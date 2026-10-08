"use client";

import { createContext, useContext, useState, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

export type MobileNavigationRequest = {
  id: number;
  href: string;
  phase: "loading" | "delayed" | "failed";
};

interface NavigationContextValue {
  pendingHref: string | null;
  navigate: (href: string, options?: { source?: "mobile" }) => void;
  mobileRequest: MobileNavigationRequest | null;
  mobileRefreshing: boolean;
  refreshMobileDestination: () => void;
}

const NavigationContext = createContext<NavigationContextValue>({
  pendingHref: null,
  navigate: () => {},
  mobileRequest: null,
  mobileRefreshing: false,
  refreshMobileDestination: () => {},
});

const mobilePaths = new Set(["/dashboard", "/transactions", "/accounts", "/goals", "/categories"]);
const assignLocation = (href: string) => window.location.assign(href);

function matchesPath(href: string, pathname: string): boolean {
  try {
    return new URL(href, "http://navigation.local").pathname === pathname;
  } catch {
    return false;
  }
}

export function NavigationProvider({ children, navigateDocument = assignLocation }: {
  children: ReactNode;
  navigateDocument?: (href: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [destination, setDestination] = useState<string | null>(null);
  const [mobileRequest, setMobileRequest] = useState<MobileNavigationRequest | null>(null);
  const [mobileRefreshing, setMobileRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentId = useRef(0);
  const currentRequest = useRef<MobileNavigationRequest | null>(null);
  const refreshing = useRef(false);
  const isAtDestination = destination !== null && matchesPath(destination, pathname);

  function clearWatchdog() {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  function clearMobileRequest() {
    currentRequest.current = null;
    refreshing.current = false;
    setMobileRequest(null);
    setMobileRefreshing(false);
  }

  useEffect(() => {
    if (isAtDestination) {
      setDestination(null);
      clearWatchdog();
    }
    const request = currentRequest.current;
    if (request && matchesPath(request.href, pathname)) clearMobileRequest();
  }, [pathname, isAtDestination]);

  function navigate(href: string, options?: { source?: "mobile" }) {
    clearWatchdog();
    const id = ++intentId.current;
    const request: MobileNavigationRequest | null = options?.source === "mobile"
      ? { id, href, phase: "loading" }
      : null;
    currentRequest.current = request;
    refreshing.current = false;
    setMobileRefreshing(false);
    setMobileRequest(request);
    setDestination(href);

    timeoutRef.current = setTimeout(() => {
      if (intentId.current !== id) return;
      timeoutRef.current = null;
      setDestination(null);
      if (currentRequest.current?.id === id) {
        const delayed: MobileNavigationRequest = { ...currentRequest.current, phase: "delayed" };
        currentRequest.current = delayed;
        setMobileRequest(delayed);
      }
    }, 8000);

    startTransition(() => {
      try {
        router.push(href);
      } catch (error) {
        if (!request) throw error;
        if (currentRequest.current?.id !== id) return;
        clearWatchdog();
        setDestination(null);
        const failed: MobileNavigationRequest = { ...request, phase: "failed" };
        currentRequest.current = failed;
        setMobileRequest(failed);
      }
    });
  }

  function refreshMobileDestination() {
    const request = currentRequest.current;
    if (!request || request.phase === "loading" || refreshing.current) return;
    let url: URL;
    try {
      url = new URL(request.href, window.location.origin);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin || !mobilePaths.has(url.pathname)) return;
    refreshing.current = true;
    setMobileRefreshing(true);
    try {
      navigateDocument(url.href);
    } catch {
      refreshing.current = false;
      setMobileRefreshing(false);
    }
  }

  useEffect(() => {
    function invalidateLatestIntent() {
      ++intentId.current;
    }

    const onPopState = () => {
      invalidateLatestIntent();
      clearWatchdog();
      clearMobileRequest();
      setDestination(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      invalidateLatestIntent();
      currentRequest.current = null;
      clearWatchdog();
    };
  }, []);

  const pendingHref = isPending || (destination !== null && !isAtDestination) ? destination : null;
  return (
    <NavigationContext.Provider value={{ pendingHref, navigate, mobileRequest, mobileRefreshing, refreshMobileDestination }}>
      {children}
    </NavigationContext.Provider>
  );
}

export const useNavigation = () => useContext(NavigationContext);
