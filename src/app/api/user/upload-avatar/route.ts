import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { consumeRateLimit, getClientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientIp = getClientIp(request);
  const limit = consumeRateLimit(`upload-avatar:${clientIp}`, 20, 5 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const path = formData.get("path") as string;

    if (!file || !path) {
      return NextResponse.json({ error: "Missing file or path" }, { status: 400 });
    }

    // Validate file type
    const allowedMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    if (!allowedMimes.has(file.type)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    // Validate file size (2 MB max)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large" }, { status: 400 });
    }

    // 1. Verify User FIRST (before any path logic)
    const supabase = createAuthClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate upload path — must be under avatars/<user.id>/ with no traversal
    // IDOR guard: user can only upload to their own folder
    const expectedPrefix = `avatars/${user.id}/`;
    if (path.includes("..") || !path.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "Invalid upload path" }, { status: 403 });
    }

    // 2. Setup Admin Client (Service Role)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      console.error("upload-avatar: missing SUPABASE_SERVICE_ROLE_KEY");
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }

    const admin = createAdminClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3. Ensure Bucket Exists
    const { error: createError } = await admin.storage.createBucket("profiles", {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    });

    if (createError && !/already exists/i.test(createError.message)) {
      console.error("Bucket creation error:", createError);
      // Continue anyway, maybe it exists but create failed for other reasons
    }

    // 4. Upload File (Upsert)
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const { data, error: uploadError } = await admin.storage
      .from("profiles")
      .upload(path, fileBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    return NextResponse.json({ path: data.path });
  } catch (error: any) {
    console.error("Server upload error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
