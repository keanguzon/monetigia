import { createClient } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes
  const protectedRoutes = [
    "/dashboard",
    "/transactions",
    "/accounts",
    "/categories",
    "/goals",
    "/reports",
    "/settings",
  ];

  const isProtectedRoute = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  // Auth routes (redirect if already logged in)
  const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"];
  const isAuthRoute = authRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  // Check remember-me and tab session cookies
  const rememberMeCookie = request.cookies.get("monetigia-remember-me")?.value;
  const tabSessionCookie = request.cookies.get("monetigia-tab-session")?.value;
  const rememberMe = rememberMeCookie !== "0";
  const isRootRoute = request.nextUrl.pathname === "/";

  // If user chose not to be remembered and closed the tab, clear session on cold start
  if (isProtectedRoute && user && !rememberMe && tabSessionCookie !== "1") {
    const redirectUrl = new URL("/", request.url);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.includes("sb-") || cookie.name.includes("auth-token")) {
        redirectResponse.cookies.set(cookie.name, "", { maxAge: 0, path: "/" });
      }
    });
    return redirectResponse;
  }

  if (isProtectedRoute && !user) {
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set("redirect", request.nextUrl.pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // Copy refreshed session cookies to prevent session loss
    response.headers.getSetCookie().forEach((cookie) => {
      redirectResponse.headers.append("Set-Cookie", cookie);
    });
    return redirectResponse;
  }

  // Redirect to dashboard if already logged in and visiting auth routes or root landing page
  if (user && (isAuthRoute || isRootRoute)) {
    if (rememberMe || tabSessionCookie === "1") {
      const redirectResponse = NextResponse.redirect(new URL("/dashboard", request.url));
      // Copy refreshed session cookies to prevent session loss
      response.headers.getSetCookie().forEach((cookie) => {
        redirectResponse.headers.append("Set-Cookie", cookie);
      });
      return redirectResponse;
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/transactions/:path*",
    "/accounts/:path*",
    "/categories/:path*",
    "/goals/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ],
};
