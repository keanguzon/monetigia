import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertSameOrigin } from "@/lib/security/origin";
import { consumeRateLimit, getClientIp } from "@/lib/security/rate-limit";

export async function POST(req: Request) {
  try { assertSameOrigin(req); } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientIp = getClientIp(req);
  const limit = consumeRateLimit(`check-availability:${clientIp}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";

  if (!email && !username) {
    return NextResponse.json({ error: "Missing email or username" }, { status: 400 });
  }

  if (email) {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!isEmail || email.length > 255) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
  }

  if (username) {
    const validUsername = /^[a-z0-9_]{3,30}$/.test(username);
    if (!validUsername) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("check-availability: missing required Supabase env vars");
    return NextResponse.json(
      { error: "Service temporarily unavailable" },
      { status: 503 }
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let emailExists = false;
  let usernameExists = false;

  if (email) {
    // Prefer checking auth.users (covers OAuth-only accounts), fall back to public.users.
    try {
      // @ts-expect-error - auth.admin typing depends on supabase-js version
      const { data } = await admin.auth.admin.getUserByEmail(email);
      emailExists = Boolean(data?.user);
    } catch {
      const { data } = await admin.from("users").select("id").eq("email", email).limit(1);
      emailExists = (data?.length ?? 0) > 0;
    }
  }

  if (username) {
    const { data } = await admin.from("users").select("id").eq("username", username).limit(1);
    usernameExists = (data?.length ?? 0) > 0;
  }

  return NextResponse.json({ emailExists, usernameExists });
}
