import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Escape JSON.stringify output for safe embedding inside an inline <script> block.
 * Prevents </script> breakout and problematic Unicode line separators.
 */
function escapeJsonForInlineScript(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Only allow same-site relative paths. Blocks absolute URLs, protocol-relative
 * URLs (//evil.com), backslash tricks (/\evil.com), and embedded protocols.
 */
function sanitizeRedirect(raw: string | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.startsWith("/\\")) return fallback;
  if (raw.includes("://")) return fallback;
  return raw;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const redirect = sanitizeRedirect(requestUrl.searchParams.get("redirect"));
  const isPopup = requestUrl.searchParams.get("popup") === "1";

  const cookieStore = cookies();
  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          pendingCookies.push(...cookiesToSet);
        },
      },
    }
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      if (isPopup) {
        const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Sign in failed</title>
  </head>
  <body>
    <script>
      (function () {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'oauth-error', message: ${escapeJsonForInlineScript(JSON.stringify(
          error.message
        ))} }, ${escapeJsonForInlineScript(JSON.stringify(requestUrl.origin))});
          }
        } catch (e) {}
        try { window.close(); } catch (e) {}
      })();
    </script>
    <p>Sign in failed. You can close this window.</p>
  </body>
</html>`;

        const response = new NextResponse(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });

        pendingCookies.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        return response;
      }

      const response = NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, requestUrl.origin)
      );
      pendingCookies.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
      return response;
    }

    if (isPopup) {
      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Signed in</title>
  </head>
  <body>
    <script>
      (function () {
        var origin = ${escapeJsonForInlineScript(JSON.stringify(requestUrl.origin))};
        var redirectTo = ${escapeJsonForInlineScript(JSON.stringify(redirect))};

        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'oauth-success', redirect: redirectTo }, origin);
          }
        } catch (e) {}

        // Give the browser a tick to persist cookies.
        setTimeout(function () {
          try { window.close(); } catch (e) {}
          // If the popup cannot be closed, fallback to navigating.
          try { window.location.replace(redirectTo); } catch (e) {}
        }, 250);
      })();
    </script>
    <p>Signed in. You can close this window.</p>
  </body>
</html>`;

      const response = new NextResponse(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });

      pendingCookies.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });

      return response;
    }

    // Best-effort: mark OAuth / confirmed-email users as verified in public.users
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      const provider = (user as any)?.app_metadata?.provider;
      const emailConfirmedAt = (user as any)?.email_confirmed_at;

      const shouldVerify = Boolean(emailConfirmedAt) || (provider && provider !== "email");
      if (shouldVerify && user?.id) {
        await (supabase as any).from("users").update({ is_verified: true }).eq("id", user.id);
      }
    } catch {
      // ignore verification update failures
    }
  }

  const response = NextResponse.redirect(new URL(redirect, requestUrl.origin));
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}
