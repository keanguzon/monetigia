"use client";

import { createContext, useContext, useState, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

interface NavigationContextValue {
  pendingHref: string | null;
  navigate: (href: string) => void;
}

const NavigationContext = createContext<NavigationContextValue>({
  pendingHref: null,
  navigate: (_href: string) => {},
});

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [destination, setDestination] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Normalize path comparison
  const isAtDestination = destination ? (() => {
    try {
      const targetUrl = new URL(destination, window.location.origin);
      return targetUrl.pathname === pathname;
    } catch {
      return destination === pathname;
    }
  })() : false;

  useEffect(() => {
    if (isAtDestination) {
      setDestination(null);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [isAtDestination]);

  function navigate(href: string) {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setDestination(href);

    startTransition(() => {
      router.push(href);
    });

    // Safety fallback: if navigation takes longer than 8 seconds, clear pending state
    timeoutRef.current = setTimeout(() => {
      setDestination(null);
    }, 8000);
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const isNavigating = isPending || (destination !== null && !isAtDestination);
  const pendingHref = isNavigating ? destination : null;

  return (
    <NavigationContext.Provider value={{ pendingHref, navigate }}>
      {children}
    </NavigationContext.Provider>
  );
}

export const useNavigation = () => useContext(NavigationContext);
