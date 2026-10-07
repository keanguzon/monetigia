"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { useToast } from "@/components/ui/use-toast";
import { createClient } from "@/lib/supabase/client";
import { getRememberMePreference, saveRememberMePreference, TAB_SESSION_KEY } from "@/lib/session-preferences";

function sanitizeRedirect(raw: string | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\") || raw.includes("://")) return fallback;
  return raw;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function LandingPageInner() {
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

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
    setIsLoading(true);
    try {
      saveRememberMePreference(rememberMe);

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
        },
      });

      if (error) {
        toast({
          title: "Login failed",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Login error",
        description: "An unexpected error occurred during sign-in.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            <Image
              src="/logos/main-logo.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg"
            />
            <span className="font-heading text-lg font-bold tracking-tight text-foreground sm:text-xl">
              Monetigia
            </span>
          </Link>

          <nav aria-label="Main navigation" className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">
            <Link href="#wallets" className="rounded-sm hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              Wallets
            </Link>
            <Link href="#goals" className="rounded-sm hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              Goals
            </Link>
            <Link href="#credit-schedule" className="rounded-sm hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
              Credit schedule
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="#sign-in"
              className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-semibold text-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Sign in
            </Link>
            <ModeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section aria-labelledby="landing-title" className="border-b border-border">
          <div className="container mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:items-center lg:gap-14 lg:py-20">
            <div className="space-y-7">
              <div className="max-w-xl space-y-4">
                <p className="text-sm font-semibold text-foreground">A personal financial ledger</p>
                <h1 id="landing-title" className="font-heading text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
                  See what is available, what is reserved, and what is due.
                </h1>
                <p className="max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
                  Keep wallet balances, goal reservations, and PayLater or credit charges in one ledger. Add the accounts you use, then record transactions as they happen.
                </p>
              </div>

              <div id="sign-in" className="max-w-md scroll-mt-24 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin("google")}
                    disabled={isLoading}
                    className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-md bg-green-800 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
                    aria-busy={isLoading}
                  >
                    {isLoading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <GoogleMark />}
                    <span>{isLoading ? "Opening Google sign-in..." : "Start with Google"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin("facebook")}
                    disabled={isLoading}
                    className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-md border border-muted-foreground bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                    aria-busy={isLoading}
                  >
                    {isLoading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <FacebookMark />}
                    <span>{isLoading ? "Opening Facebook sign-in..." : "Continue with Facebook"}</span>
                  </button>
                </div>

                <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
                  <input
                    id="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={event => setRememberMe(event.target.checked)}
                    disabled={isLoading}
                    className="h-4 w-4 shrink-0 rounded border-border accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  />
                  <span>Keep me signed in on this device</span>
                </label>

                <p className="text-xs leading-5 text-muted-foreground">
                  New to Monetigia? Your account starts when you sign in for the first time.
                </p>
              </div>

              <Link
                href="#how-it-works"
                className="inline-flex min-h-11 items-center text-sm font-semibold text-foreground underline decoration-primary/60 underline-offset-4 hover:decoration-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              >
                See how goals and credit fit in
              </Link>
            </div>

            <article id="wallets" aria-labelledby="wallet-summary-title" className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Example wallet view</p>
                  <h2 id="wallet-summary-title" className="mt-1 font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                    One balance, with a clear split
                  </h2>
                </div>
                <span className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  Illustrative data
                </span>
              </div>

              <dl className="mt-6 grid gap-4 border-y border-border py-5 sm:grid-cols-3 sm:gap-3">
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Actual wallet balance</dt>
                  <dd className="font-heading text-2xl font-bold tabular-nums tracking-tight text-foreground">₱57,500</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Reserved for goals</dt>
                  <dd className="font-heading text-2xl font-bold tabular-nums tracking-tight text-foreground">₱12,000</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Available to use</dt>
                  <dd className="font-heading text-2xl font-bold tabular-nums tracking-tight text-primary">₱45,500</dd>
                </div>
              </dl>

              <div className="space-y-4 pt-5">
                <p className="text-sm font-semibold text-foreground">By wallet</p>
                <div className="space-y-4">
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">BPI Savings</p>
                      <p className="text-sm leading-5 text-muted-foreground">₱12,000 reserved · ₱40,000 available</p>
                    </div>
                    <p className="shrink-0 font-heading font-bold tabular-nums text-foreground">₱52,000 actual</p>
                  </div>
                  <div className="flex flex-col gap-1.5 border-t border-border pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">GCash</p>
                      <p className="text-sm leading-5 text-muted-foreground">₱0 reserved · ₱5,500 available</p>
                    </div>
                    <p className="shrink-0 font-heading font-bold tabular-nums text-foreground">₱5,500 actual</p>
                  </div>
                </div>
              </div>

              <p className="mt-5 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
                ₱57,500 actual minus ₱12,000 reserved leaves ₱45,500 available. A reservation stays in its wallet while reducing what is free for other spending.
              </p>
            </article>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-20 border-b border-border bg-muted/20">
          <div className="container mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
            <div className="max-w-2xl space-y-3">
              <p className="text-sm font-semibold text-foreground">Plan before you spend</p>
              <h2 id="how-it-works-title" className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Goals separate money set aside from money already spent.
              </h2>
              <p className="text-base leading-7 text-muted-foreground">
                Reserve funds from a wallet for a goal. The money remains in that wallet, but it no longer counts as available for other spending. When you record a purchase for the goal, the ledger keeps that spending visible in its progress.
              </p>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:items-stretch">
              <article id="goals" aria-labelledby="goal-example-title" className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Example goal</p>
                    <h3 id="goal-example-title" className="mt-1 font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                      Emergency fund
                    </h3>
                  </div>
                  <span className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">Sample amounts</span>
                </div>

                <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Progress</p>
                    <p className="mt-1 font-heading text-3xl font-bold tabular-nums tracking-tight text-foreground">₱10,000 <span className="text-base font-medium text-muted-foreground">of ₱30,000</span></p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-foreground">33% complete</p>
                </div>
                <div
                  className="mt-4 h-2.5 rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Example emergency fund progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={33}
                  aria-valuetext="₱10,000 of ₱30,000"
                >
                  <div className="h-full rounded-full bg-green-800 dark:bg-primary" style={{ width: "33.33%" }} />
                </div>

                <dl className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-muted-foreground">Still reserved</dt>
                    <dd className="mt-1 font-heading text-xl font-bold tabular-nums text-foreground">₱8,000</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Spent toward this goal</dt>
                    <dd className="mt-1 font-heading text-xl font-bold tabular-nums text-foreground">₱2,000</dd>
                  </div>
                </dl>
              </article>

              <aside className="flex flex-col justify-between gap-7 rounded-2xl border border-border bg-background p-5 sm:p-7">
                <div className="space-y-3">
                  <h3 className="font-heading text-xl font-bold tracking-tight text-foreground">A reserve is still yours.</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    The wallet balance does not drop when you reserve money. Monetigia tracks the reserved amount separately so the available figure stays useful.
                  </p>
                </div>
                <div className="border-t border-border pt-5">
                  <p className="text-sm font-semibold text-foreground">In this example</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    ₱8,000 reserved plus ₱2,000 spent equals ₱10,000 of goal progress.
                  </p>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section id="credit-schedule" aria-labelledby="credit-schedule-title" className="scroll-mt-20 border-b border-border">
          <div className="container mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-end">
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">PayLater and credit</p>
                <h2 id="credit-schedule-title" className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Review charges together by statement month.
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                Record purchases under a PayLater or credit wallet, then check the charges grouped by month. Your cash balance changes when you record a settlement.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <article aria-label="Example October credit statement" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Example statement</p>
                    <h3 className="mt-1 font-heading text-xl font-bold text-foreground">October 2026</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Statement total</p>
                    <p className="font-heading text-xl font-bold tabular-nums text-foreground">₱2,050</p>
                  </div>
                </div>
                <dl className="divide-y divide-border">
                  <div className="flex items-center justify-between gap-4 py-3 text-sm">
                    <dt className="text-foreground">Household supplies</dt>
                    <dd className="shrink-0 font-semibold tabular-nums text-foreground">₱1,250</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-3 text-sm">
                    <dt className="text-foreground">Transit pass</dt>
                    <dd className="shrink-0 font-semibold tabular-nums text-foreground">₱800</dd>
                  </div>
                </dl>
              </article>

              <article aria-label="Example November credit statement" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Example statement</p>
                    <h3 className="mt-1 font-heading text-xl font-bold text-foreground">November 2026</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Statement total</p>
                    <p className="font-heading text-xl font-bold tabular-nums text-foreground">₱640</p>
                  </div>
                </div>
                <dl className="divide-y divide-border">
                  <div className="flex items-center justify-between gap-4 py-3 text-sm">
                    <dt className="text-foreground">Streaming plan</dt>
                    <dd className="shrink-0 font-semibold tabular-nums text-foreground">₱640</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">Example amounts only. This is not live account data.</p>
              </article>
            </div>
          </div>
        </section>

        <section aria-labelledby="closing-title" className="bg-muted/20">
          <div className="container mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 sm:py-14 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl space-y-2">
              <h2 id="closing-title" className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Start with the accounts you already use.
              </h2>
              <p className="text-sm leading-6 text-muted-foreground sm:text-base">
                Add wallets, record transactions, and set aside funds for goals as you go.
              </p>
            </div>
            <Link
              href="#sign-in"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-muted-foreground bg-background px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Create an account or sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-background">
        <div className="container mx-auto flex max-w-6xl flex-col gap-6 px-4 py-7 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logos/main-logo.png"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 rounded"
            />
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Monetigia. Personal financial ledger.
            </p>
          </div>
          <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <Link href="#wallets" className="min-h-11 rounded-sm py-3 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Wallets
            </Link>
            <Link href="#goals" className="min-h-11 rounded-sm py-3 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Goals
            </Link>
            <Link href="#credit-schedule" className="min-h-11 rounded-sm py-3 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Credit schedule
            </Link>
            <Link href="#sign-in" className="min-h-11 rounded-sm py-3 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Sign in
            </Link>
            <Link href="/mobile-app" className="min-h-11 rounded-sm py-3 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Android app
            </Link>
            <span className="flex min-h-11 items-center">Philippine Peso (PHP)</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingPageInner />
    </Suspense>
  );
}
