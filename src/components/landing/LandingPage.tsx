"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Wallet, Target, CreditCard } from "lucide-react";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { useToast } from "@/components/ui/use-toast";
import { createClient } from "@/lib/supabase/client";
import { getRememberMePreference, saveRememberMePreference, TAB_SESSION_KEY } from "@/lib/session-preferences";
import { HeroPhone } from "./HeroPhone";

function sanitizeRedirect(raw: string | null, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.includes("://")) return fallback;
  return raw;
}

function GoogleMark() {
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>;
}

function FacebookMark() {
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>;
}

function LandingPageInner() {
  const [rememberMe, setRememberMe] = useState(true);
  const [pendingProvider, setPendingProvider] = useState<"google" | "facebook" | null>(null);
  const isLoading = pendingProvider !== null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const supabase = createClient();
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"));

  useEffect(() => {
    const preference = getRememberMePreference();
    setRememberMe(preference);
    if (!supabase?.auth) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      const hasTabSession = sessionStorage.getItem(TAB_SESSION_KEY) === "1";
      if (preference || hasTabSession) router.replace(redirectTo);
    });
  }, [redirectTo, router, supabase]);

  const handleOAuthLogin = async (provider: "google" | "facebook") => {
    setPendingProvider(provider);
    try {
      saveRememberMePreference(rememberMe);
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      } });
      if (error) toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } catch {
      toast({ title: "Login error", description: "An unexpected error occurred during sign-in.", variant: "destructive" });
    } finally { setPendingProvider(null); }
  };

  return (
    <div className="min-h-[100svh] bg-background text-foreground" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <div className="mx-auto max-w-[1400px] px-5 sm:px-10 lg:px-16">
        <header className="flex min-h-24 flex-wrap items-center justify-between gap-3 py-5">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-heading text-xl font-bold sm:text-2xl"><Image src="/logos/main-logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />Monetigia</Link>
          <div className="flex items-center gap-2"><ModeToggle /><Link href="#sign-in" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Sign in</Link></div>
        </header>
        <main>
          <section aria-labelledby="landing-title" className="grid items-center gap-8 pb-12 pt-8 sm:pt-12 lg:min-h-[540px] lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-16">
            <div>
              <h1 id="landing-title" className="max-w-[650px] font-heading text-[clamp(2.5rem,5vw,4.5rem)] font-bold leading-[1.03] tracking-[-0.045em]">Know what you<br className="hidden sm:block" /> can spend<span className="text-primary">.</span></h1>
              <p className="mt-6 max-w-[450px] text-base leading-7 text-muted-foreground sm:text-lg">Track wallets, set aside for goals, and manage credit in one place.</p>
              <div id="sign-in" className="mt-7 max-w-[420px] scroll-mt-8">
                <div className="grid gap-3">
                  <button type="button" onClick={() => handleOAuthLogin("google")} disabled={isLoading} aria-busy={pendingProvider === "google"} className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
                    {pendingProvider === "google" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <GoogleMark />}{pendingProvider === "google" ? "Opening Google sign-in..." : "Start with Google"}
                  </button>
                  <button type="button" onClick={() => handleOAuthLogin("facebook")} disabled={isLoading} aria-busy={pendingProvider === "facebook"} className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60">
                    {pendingProvider === "facebook" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FacebookMark />}{pendingProvider === "facebook" ? "Opening Facebook sign-in..." : "Continue with Facebook"}
                  </button>
                </div>
                <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-muted-foreground"><input type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} disabled={isLoading} className="h-4 w-4 shrink-0 accent-primary" /><span>Keep me signed in on this device</span></label>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">New here? Signing in creates your account.</p>
              </div>
            </div>
            <HeroPhone />
          </section>
          <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-8 border-t border-border py-10 sm:py-12">
            <div>
              <h2 id="how-it-works-title" className="font-heading text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Give every peso a place.</h2>
              <div className="mt-6 grid gap-x-8 divide-y divide-border sm:grid-cols-3 sm:divide-y-0">
                {[
                  { id: "wallets", title: "Wallets", text: "See balances together.", Icon: Wallet },
                  { id: "goals", title: "Goals", text: "Set aside money before spending.", Icon: Target },
                  { id: "credit-schedule", title: "Credit", text: "Track what is left to pay.", Icon: CreditCard },
                ].map(({ id, title, text, Icon }) => <div key={id} id={id} className="flex scroll-mt-8 items-center gap-5 py-5"><Icon aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" /><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></div>)}
              </div>
            </div>

          </section>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border py-6 text-sm text-muted-foreground">
          <span>Monetigia · Philippine Peso (PHP)</span><nav aria-label="Footer" className="flex flex-wrap gap-5"><Link href="#sign-in" className="inline-flex min-h-11 items-center hover:text-foreground">Sign in</Link><Link href="/mobile-app" className="inline-flex min-h-11 items-center hover:text-foreground">Android app</Link></nav>
        </footer>
      </div>
    </div>
  );
}

export function LandingPage() {
  return <Suspense fallback={null}><LandingPageInner /></Suspense>;
}
