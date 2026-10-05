import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LandingPage } from "@/components/landing/LandingPage";
import { REMEMBER_ME_COOKIE, TAB_SESSION_COOKIE } from "@/lib/session-preferences";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const cookieStore = cookies();
    const rememberMeCookie = cookieStore.get(REMEMBER_ME_COOKIE)?.value;
    const tabSessionCookie = cookieStore.get(TAB_SESSION_COOKIE)?.value;
    const rememberMe = rememberMeCookie !== "0";

    if (rememberMe || tabSessionCookie === "1") {
      redirect("/dashboard");
    }
  }

  return <LandingPage />;
}

