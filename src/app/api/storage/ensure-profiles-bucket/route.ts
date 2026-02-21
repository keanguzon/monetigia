import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  // Require an authenticated session — this route uses the service role key
  const supabase = createAuthClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error("ensure-profiles-bucket: missing NEXT_PUBLIC_SUPABASE_URL");
    return NextResponse.json(
      { error: "Service temporarily unavailable" },
      { status: 503 }
    );
  }

  if (!serviceKey) {
    return NextResponse.json({ ok: false, skipped: true, reason: "missing_service_role" });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.storage.createBucket("profiles", {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  });

  if (error && !/already exists/i.test(error.message)) {
    console.error("ensure-profiles-bucket: storage error", error.message);
    return NextResponse.json({ error: "Storage error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
