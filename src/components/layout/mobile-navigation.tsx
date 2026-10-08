"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeftRight,
  Home,
  Tags,
  Target,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NavigationLink } from "@/components/layout/navigation-link";
import { useNavigation } from "@/components/layout/navigation-provider";
import { useMobileNavigationVisibility } from "@/hooks/use-mobile-navigation-visibility";

const primaryItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/accounts", label: "Wallets", icon: Wallet },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/categories", label: "Categories", icon: Tags },
];

export function MobileNavigation(): JSX.Element {
  const pathname = usePathname();
  const { pendingHref, mobileRequest } = useNavigation();
  const requestDescriptionId = useId();
  const requestedPath = mobileRequest ? new URL(mobileRequest.href, "http://navigation.local").pathname : null;
  const requestedItem = primaryItems.find((item) => item.href === requestedPath);
  const selectedPath = requestedItem ? requestedPath : pathname;
  const { blockedByModal, keyboardOpen } = useMobileNavigationVisibility();
  const prefersReducedMotion = useReducedMotion();
  const [isDesktop, setIsDesktop] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hidden = blockedByModal || keyboardOpen || isDesktop;
  const indicatorTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.7 };

  useEffect(() => {
    const mediaQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 1024px)")
      : null;
    const updateBreakpoint = () => {
      setIsDesktop(mediaQuery ? mediaQuery.matches : window.innerWidth >= 1024);
    };

    updateBreakpoint();

    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", updateBreakpoint);
        return () => mediaQuery.removeEventListener("change", updateBreakpoint);
      }

      mediaQuery.addListener(updateBreakpoint);
      return () => mediaQuery.removeListener(updateBreakpoint);
    }

    window.addEventListener("resize", updateBreakpoint);
    return () => window.removeEventListener("resize", updateBreakpoint);
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    const shell = surface?.closest<HTMLElement>("[data-dashboard-shell]");
    if (!surface || !shell) return;

    if (isDesktop) {
      shell.style.removeProperty("--mobile-navigation-height");
      return;
    }

    const updateHeight = () => {
      const height = surface.getBoundingClientRect().height;
      if (height > 0) shell.style.setProperty("--mobile-navigation-height", `${Math.ceil(height)}px`);
    };

    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      return () => shell.style.removeProperty("--mobile-navigation-height");
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(surface);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--mobile-navigation-height");
    };
  }, [isDesktop]);

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="mobile-navigation"
      data-no-press-motion
      hidden={hidden}
    >
      <div ref={surfaceRef} className="mobile-navigation-surface">
        {primaryItems.map((item) => {
          const isActive = selectedPath === item.href;
          const isRequested = requestedItem?.href === item.href;
          const isPending = mobileRequest ? isRequested && mobileRequest.phase === "loading" : pendingHref === item.href;
          const Icon = item.icon;

          return (
            <NavigationLink
              key={item.href}
              href={item.href}
              navigationSource="mobile"
              aria-label={item.label}
              aria-current={pathname === item.href ? "page" : undefined}
              aria-busy={isPending ? "true" : undefined}
              aria-describedby={isRequested ? requestDescriptionId : undefined}
              className={cn(
                "mobile-navigation-control",
                isActive && "mobile-navigation-control-active"
              )}
              data-active={isActive ? "true" : undefined}
            >
              {isActive && (
                <motion.span
                  aria-hidden="true"
                  className="mobile-navigation-active-indicator"
                  layoutId={prefersReducedMotion ? undefined : "mobile-navigation-active-indicator"}
                  transition={indicatorTransition}
                />
              )}
              <Icon
                className={cn(
                  "mobile-navigation-icon",
                  isActive && "mobile-navigation-icon-active"
                )}
                aria-hidden="true"
              />
              {isPending && !mobileRequest && <span className="sr-only" role="status">Loading {item.label}</span>}
            </NavigationLink>
          );
        })}
      </div>
      {requestedItem && (
        <span className="sr-only" id={requestDescriptionId}>
          Requested destination: {requestedItem.label}
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {requestedItem && mobileRequest?.phase === "loading" ? `Loading ${requestedItem.label}` : ""}
      </span>
    </nav>
  );
}
