"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { REMEMBER_ME_KEY, TAB_SESSION_KEY } from "@/lib/session-preferences";

const protectedRoutes = [
  "/dashboard",
  "/transactions",
  "/accounts",
  "/categories",
  "/reports",
  "/settings",
];

export function AuthSessionManager() {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let isCancelled = false;

    const enforceRememberPreference = async () => {
      const rememberMe = localStorage.getItem(REMEMBER_ME_KEY) !== "0";
      if (rememberMe) {
        sessionStorage.setItem(TAB_SESSION_KEY, "1");
        return;
      }

      const hasTabSession = sessionStorage.getItem(TAB_SESSION_KEY) === "1";
      if (hasTabSession) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || isCancelled) return;

      await supabase.auth.signOut();
      if (isCancelled) return;

      const isProtectedRoute = protectedRoutes.some((route) =>
        pathname.startsWith(route)
      );

      if (isProtectedRoute) {
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
        router.refresh();
      }
    };

    enforceRememberPreference();

    return () => {
      isCancelled = true;
    };
  }, [pathname, router, supabase]);

  return null;
}
