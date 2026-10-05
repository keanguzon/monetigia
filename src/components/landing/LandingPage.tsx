"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { ModeToggle } from "@/components/ui/mode-toggle";
import {
  Loader2,
  Wallet,
  Building2,
  CreditCard,
  TrendingUp,
  Smartphone,
  ShieldCheck,
  ArrowRight,
  Download,
  CalendarClock,
  PieChart,
  CheckCircle2,
} from "lucide-react";
import { getRememberMePreference, saveRememberMePreference, TAB_SESSION_KEY } from "@/lib/session-preferences";

function sanitizeRedirect(raw: string | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\") || raw.includes("://")) return fallback;
  return raw;
}

function LandingPageInner() {
  const [scrolled, setScrolled] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const supabase = createClient();

  const redirectTo = sanitizeRedirect(searchParams.get("redirect"));

  useEffect(() => {
    const pref = getRememberMePreference();
    setRememberMe(pref);

    if (supabase && supabase.auth) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          const hasTabSession = sessionStorage.getItem(TAB_SESSION_KEY) === "1";
          if (pref || hasTabSession) {
            router.replace(redirectTo);
          }
        }
      });
    }
  }, [redirectTo, router, supabase]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
          title: "Login Failed",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Login Error",
        description: "An unexpected error occurred during sign-in.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-200">
      {/* ─── Navigation Header ─── */}
      <header
        className={`sticky top-0 z-50 w-full transition-all duration-200 ${
          scrolled
            ? "border-b border-border bg-background/95 backdrop-blur shadow-sm"
            : "border-b border-transparent bg-background"
        }`}
      >
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-90">
            <Image
              src="/logos/main-logo.png"
              alt="Monetigia Logo"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg"
            />
            <span className="text-xl font-bold tracking-tight text-foreground font-heading">
              Monetigia
            </span>
          </Link>

          <nav className="flex items-center gap-3">
            <ModeToggle />
            <Link href="/mobile-app">
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex items-center gap-1.5 font-medium border-border"
              >
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <span>Android App</span>
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* ─── Hero & Sign In Section ─── */}
        <section className="relative landing-surface-radial py-12 md:py-20">
          <div className="container mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
              
              {/* Left Column: Product Narrative */}
              <div className="lg:col-span-7 space-y-6">
                <div className="inline-flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Personal Finance & Debt Ledger</span>
                </div>

                <div className="space-y-3">
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight font-heading text-foreground leading-[1.1]">
                    Follow the footprints of your money.
                  </h1>
                  <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
                    Track GCash, Maya, bank deposits, and SPayLater debts in a single unified ledger. Clear numbers with zero clutter.
                  </p>
                </div>

                {/* Core Pillars */}
                <div className="grid gap-3 pt-2 sm:grid-cols-2">
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5">
                    <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
                      <Wallet className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Multi-Wallet Balances</p>
                      <p className="text-xs text-muted-foreground">Physical cash, bank accounts, and digital wallets.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5">
                    <div className="rounded-md bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
                      <CalendarClock className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Debt & PayLater Schedules</p>
                      <p className="text-xs text-muted-foreground">Keep upcoming installments visible and planned.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5">
                    <div className="rounded-md bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
                      <PieChart className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Accurate Net Worth</p>
                      <p className="text-xs text-muted-foreground">Real liquid assets minus outstanding liabilities.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5">
                    <div className="rounded-md bg-violet-500/10 p-2 text-violet-600 dark:text-violet-400">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Zero Password Storage</p>
                      <p className="text-xs text-muted-foreground">Secure OAuth login directly via Google or Facebook.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Direct Sign-In Card */}
              <div className="lg:col-span-5">
                <Card className="border border-border bg-card shadow-sm">
                  <CardHeader className="space-y-1.5 pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Image
                        src="/logos/main-logo.png"
                        alt="Monetigia"
                        width={28}
                        height={28}
                        className="h-7 w-7 rounded"
                      />
                      <CardTitle className="text-xl font-bold font-heading">Sign In to Monetigia</CardTitle>
                    </div>
                    <CardDescription>
                      Access your personal accounts and transaction history.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Remember Me Checkbox */}
                    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
                      <input
                        id="remember-me"
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        disabled={isLoading}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                      />
                      <label htmlFor="remember-me" className="cursor-pointer text-xs font-medium text-foreground">
                        Keep me signed in on this device
                      </label>
                    </div>

                    {/* OAuth Action Buttons */}
                    <div className="space-y-2.5">
                      <Button
                        variant="default"
                        onClick={() => handleOAuthLogin("google")}
                        disabled={isLoading}
                        className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold flex items-center justify-center gap-2.5 transition-colors"
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <svg className="h-4 w-4" viewBox="0 0 24 24">
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
                        )}
                        Continue with Google
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() => handleOAuthLogin("facebook")}
                        disabled={isLoading}
                        className="h-11 w-full border-border bg-card hover:bg-muted font-semibold flex items-center justify-center gap-2.5 transition-colors"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#1877F2">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                        </svg>
                        Continue with Facebook
                      </Button>
                    </div>

                    <div className="relative py-1">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs">
                        <span className="bg-card px-2 text-muted-foreground">Mobile Device</span>
                      </div>
                    </div>

                    <Link href="/mobile-app" className="block w-full">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-10 w-full text-xs font-semibold flex items-center justify-center gap-2"
                      >
                        <Smartphone className="h-3.5 w-3.5" />
                        Download Android App (APK)
                      </Button>
                    </Link>
                  </CardContent>

                  <CardFooter className="pt-0">
                    <p className="text-center text-xs text-muted-foreground w-full">
                      New to Monetigia? Your account is initialized automatically on first sign in.
                    </p>
                  </CardFooter>
                </Card>
              </div>

            </div>
          </div>
        </section>

        {/* ─── Authentic Ledger Overview Demonstration ─── */}
        <section className="py-12 md:py-16 border-t border-border bg-muted/20">
          <div className="container mx-auto max-w-5xl px-4 sm:px-6">
            <div className="text-center space-y-2 mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold font-heading text-foreground">
                How Monetigia organizes your money
              </h2>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                No simulated graphics or empty placeholders. An honest sample of what your personal dashboard looks like.
              </p>
            </div>

            {/* Product Preview Card */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Total Net Worth</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">+14.2%</span>
                  </div>
                  <p className="text-xl font-bold font-mono tabular-nums text-foreground">₱113,330.00</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Cash, banks, and liabilities</p>
                </div>

                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Digital Wallets</span>
                    <span className="text-muted-foreground">GCash / Maya</span>
                  </div>
                  <p className="text-xl font-bold font-mono tabular-nums text-foreground">₱36,150.00</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Available liquid funds</p>
                </div>

                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Savings Accounts</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">4.5% p.a.</span>
                  </div>
                  <p className="text-xl font-bold font-mono tabular-nums text-foreground">₱82,500.00</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Emergency fund reserve</p>
                </div>

                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Active PayLater</span>
                    <span className="text-rose-500 font-medium">Due in 8 days</span>
                  </div>
                  <p className="text-xl font-bold font-mono tabular-nums text-rose-500">-₱5,320.00</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Shopee / Lazada installments</p>
                </div>
              </div>

              {/* Sample Wallet Order List */}
              <div className="rounded-lg border border-border bg-background divide-y divide-border">
                <div className="p-3 text-xs font-semibold text-muted-foreground flex justify-between items-center bg-muted/40">
                  <span>SAMPLE WALLET REGISTER</span>
                  <span>CURRENT BALANCE</span>
                </div>

                <div className="p-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold text-xs">
                      BPI
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">BPI Regular Savings</p>
                      <p className="text-xs text-muted-foreground">Bank Account · Main payroll</p>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-foreground">₱82,500.00</span>
                </div>

                <div className="p-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-blue-600/10 text-blue-500 flex items-center justify-center font-bold text-xs">
                      GC
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">GCash Wallet</p>
                      <p className="text-xs text-muted-foreground">Digital Wallet · Daily expenses</p>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-foreground">₱14,350.00</span>
                </div>

                <div className="p-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs">
                      MY
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Maya Savings</p>
                      <p className="text-xs text-muted-foreground">High Yield · 4.5% interest</p>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-foreground">₱21,800.00</span>
                </div>

                <div className="p-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-orange-500/10 text-orange-600 flex items-center justify-center font-bold text-xs">
                      SP
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">SPayLater</p>
                      <p className="text-xs text-muted-foreground">Liability · 3 remaining cutoffs</p>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-rose-500">-₱5,320.00</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Editorial Feature Walkthrough ─── */}
        <section className="py-16 md:py-24 border-t border-border">
          <div className="container mx-auto max-w-5xl px-4 sm:px-6">
            <div className="grid gap-12 md:grid-cols-3">
              <div className="space-y-3">
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Building2 className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold font-heading text-foreground">Custom Account Ordering</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Arrange your wallets however you think about them. Changes are remembered on your device and saved cleanly to your profile.
                </p>
              </div>

              <div className="space-y-3">
                <div className="h-9 w-9 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <CreditCard className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold font-heading text-foreground">No Surprise Installments</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Track pay-later accounts alongside cash. Separate debt from liquid net worth so you always know your true purchasing power.
                </p>
              </div>

              <div className="space-y-3">
                <div className="h-9 w-9 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold font-heading text-foreground">Fast, Private & Direct</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  No bank credentials or third-party screen scraping. All records remain encrypted and tied to your personal Supabase account.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ─── Professional Footer ─── */}
      <footer className="border-t border-border py-8 bg-background">
        <div className="container mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Image
              src="/logos/main-logo.png"
              alt="Monetigia Logo"
              width={20}
              height={20}
              className="h-5 w-5 rounded"
            />
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Monetigia. Personal financial ledger.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/mobile-app" className="hover:text-foreground transition-colors">
              Android App
            </Link>
            <span>·</span>
            <span>Philippine Peso (PHP)</span>
          </div>
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
