"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMobileNavigationVisibility } from "@/hooks/use-mobile-navigation-visibility";
import { useNavigation } from "./navigation-provider";

const destinationLabels: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/transactions": "Transactions",
  "/accounts": "Wallets",
  "/goals": "Goals",
  "/categories": "Categories",
};

export function MobileNavigationRecovery({ suppressed = false }: { suppressed?: boolean } = {}): JSX.Element | null {
  const { mobileRequest, mobileRefreshing, refreshMobileDestination } = useNavigation();
  const { blockedByModal, keyboardOpen } = useMobileNavigationVisibility();
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1024px)") : null;
    const update = () => setIsDesktop(query ? query.matches : window.innerWidth >= 1024);
    update();
    if (query) {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
      }
      query.addListener(update);
      return () => query.removeListener(update);
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (!mobileRequest || isDesktop || suppressed || blockedByModal || keyboardOpen) return null;
  let label: string | undefined;
  try {
    label = destinationLabels[new URL(mobileRequest.href, "http://navigation.local").pathname];
  } catch {
    return null;
  }
  if (!label) return null;

  return (
    <section className="mobile-navigation-recovery" aria-label={`${label} navigation`}>
      {mobileRequest.phase === "loading" ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          <div className="mobile-navigation-recovery-skeleton" aria-hidden="true">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </>
      ) : (
        <div className="mobile-navigation-recovery-feedback">
          <button
            type="button"
            className="mobile-navigation-recovery-refresh"
            onClick={refreshMobileDestination}
            disabled={mobileRefreshing}
            aria-label={`Refresh ${label}`}
            aria-busy={mobileRefreshing ? "true" : undefined}
          >
            <RefreshCw size={40} aria-hidden="true" />
          </button>
          <div className="mobile-navigation-recovery-message" role="status" aria-live="polite" aria-atomic="true">
            {mobileRequest.phase === "failed" ? (
              <>
                <h1 className="text-xl font-semibold tracking-tight">Can&apos;t load page</h1>
                <p className="mt-2 text-sm leading-relaxed">Please try again.</p>
              </>
            ) : (
              <p className="text-sm leading-relaxed">Taking longer than expected. Try refreshing.</p>
            )}
          </div>
          <p className="sr-only" role="status" aria-live="polite">{mobileRefreshing ? `Refreshing ${label}…` : ""}</p>
        </div>
      )}
    </section>
  );
}
