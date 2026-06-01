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

  if (isAuthRoute && user) {
    const redirectResponse = NextResponse.redirect(new URL("/dashboard", request.url));
    // Copy refreshed session cookies to prevent session loss
    response.headers.getSetCookie().forEach((cookie) => {
      redirectResponse.headers.append("Set-Cookie", cookie);
    });
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/transactions/:path*",
    "/accounts/:path*",
    "/categories/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ],
};
