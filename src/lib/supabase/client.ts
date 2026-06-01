import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const createClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Safe check to prevent runtime crashes during local development/builds if keys are empty or placeholders
  if (!url || !anonKey || url === "your_supabase_project_url" || anonKey === "your_supabase_anon_key") {
    return {} as SupabaseClient<Database>;
  }

  return createBrowserClient<any>(url, anonKey) as SupabaseClient<Database>;
};
