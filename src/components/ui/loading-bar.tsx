"use client";

import { useNavigation } from "@/components/layout/navigation-provider";

export function LoadingBar() {
  const { pendingHref } = useNavigation();
  if (!pendingHref) return null;

  return (
    <div role="status" className="loading-bar-track pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-primary/20">
      <span className="sr-only">Loading page</span>
      <div className="loading-bar-segment h-full w-full animate-pulse bg-primary motion-reduce:animate-none" />
    </div>
  );
}
