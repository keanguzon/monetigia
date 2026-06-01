"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { ModeToggle } from "@/components/ui/mode-toggle";
import {
  Loader2,
  ShieldCheck,
  Sparkles,
  Zap,
  ArrowRight,
  Wallet,
  BarChart3,
  Shield,
  Target,
  TrendingUp,
  Smartphone,
  Landmark,
  CreditCard,
  Lock,
} from "lucide-react";
import { getRememberMePreference, saveRememberMePreference } from "@/lib/session-preferences";
import { Aurora } from "./Aurora";
import { BlurText } from "./BlurText";
import { useTheme } from "next-themes";

const DARK_COLORS = ["#22c589", "#139a67", "#022416"];
const LIGHT_COLORS = ["#a7f3d0", "#34d399", "#16a36f"];

function sanitizeRedirect(raw: string | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\") || raw.includes("://")) return fallback;
  return raw;
}

function LandingPageInner() {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  
  const { resolvedTheme } = useTheme();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const supabase = createClient();

  const isDark = !mounted ? true : resolvedTheme === "dark";
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"));

  useEffect(() => {
    setMounted(true);
    setRememberMe(getRememberMePreference());
  }, []);

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
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-300 overflow-x-hidden relative select-none">
      {/* ─── Aurora Background ─── */}
      <div className="absolute inset-0 w-full h-full min-h-screen z-0 overflow-hidden pointer-events-none">
        <Aurora
          colorStops={isDark ? DARK_COLORS : LIGHT_COLORS}
          amplitude={0.8}
          blend={0.35}
          speed={0.3}
          className={`absolute inset-0 h-full w-full pointer-events-none transition-all duration-500 ${
            isDark ? "opacity-60 mix-blend-screen" : "opacity-[0.22] mix-blend-multiply"
          }`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      </div>

      {/* ─── Header ─── */}
      <header
        className={`fixed top-0 z-50 w-full transition-all duration-300 ${
          scrolled ? "bg-background/80 backdrop-blur-xl border-b border-border/40 shadow-lg shadow-primary/5" : "bg-transparent"
        }`}
      >
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-8">
          <Link href="/" className="flex items-center space-x-2 group">
            <Image
              src="/logos/main-logo.png"
              alt="Buko Juice Logo"
              width={32}
              height={32}
              className="h-8 w-8 transition-transform duration-300 group-hover:scale-110"
            />
            <span className="text-xl font-black tracking-tight text-foreground">
              Buko Juice
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <ModeToggle />
            <a href="#cockpit">
              <Button size="sm" className="text-sm bg-primary text-primary-foreground hover:bg-primary/90 font-bold transition-all duration-200 shadow-lg shadow-primary/20">
                Sign In
              </Button>
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1 relative z-10">
        {/* ─── Hero Section (Split-screen on desktop) ─── */}
        <section className="relative flex items-center justify-center pt-28 pb-0">
          <div className="container mx-auto px-4 md:px-8 grid gap-8 items-center md:grid-cols-12 max-w-6xl">
            
            {/* Left Column: Premium Monospace Tag & "Buko Juice." Brand reveal */}
            <div className="md:col-span-7 flex flex-col justify-center text-left space-y-6">
              {/* Minimal Monospace Secure Indicator */}
              <div className="font-mono text-primary tracking-widest text-[10px] uppercase font-bold">
                [ OAUTH SECURE ACCESS · NO PASSWORD DATABASE TO LEAK ]
              </div>

              {mounted ? (
                <div className="space-y-4">
                  <BlurText
                    text="Track Your Money"
                    className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tighter text-foreground leading-none font-heading"
                    staggerDelay={0.06}
                  />
                  <div className="text-xl sm:text-2xl font-black tracking-tight text-primary">
                    Own your money. Every single peso.
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tighter text-foreground leading-none font-heading">
                    Track Your Money
                  </h1>
                  <div className="text-xl sm:text-2xl font-black tracking-tight text-primary">
                    Own your money. Every single peso.
                  </div>
                </div>
              )}

              <p className="text-base sm:text-lg leading-relaxed text-muted-foreground max-w-xl">
                See where your money goes. Manage multiple financial accounts, wallets, and debts seamlessly with automated visual reports.
              </p>

              {/* Dynamic Feature Badges */}
              <div className="grid gap-3 sm:grid-cols-2 max-w-md">
                {[
                  "Multi-wallet consolidation",
                  "Consolidated cashflow views",
                  "Direct Supabase protection",
                  "Visual spending patterns",
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-sm text-foreground bg-card/40 border border-border/80 rounded-lg p-2.5 backdrop-blur-sm shadow-sm h-full"
                  >
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Inline Glass Auth Card */}
            <div id="cockpit" className="md:col-span-5 flex items-center justify-center md:pt-14">
              <Card className="w-full border-border/40 bg-card/85 text-card-foreground shadow-2xl shadow-primary/5 backdrop-blur-xl">
                <CardHeader className="space-y-2 text-center pb-4">
                  <div className="mb-2 flex justify-center">
                    <Link href="/" className="flex items-center gap-2 transition-transform duration-200 hover:scale-105">
                      <Image src="/logos/main-logo.png" alt="Buko Juice Logo" width={40} height={40} className="h-10 w-10" />
                      <span className="text-2xl font-black tracking-tight text-foreground">Buko Juice</span>
                    </Link>
                  </div>
                  <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
                </CardHeader>

                <CardContent className="space-y-6">
                  {/* Keep me signed in checkbox */}
                  <div className="space-y-3 rounded-xl border border-border/80 bg-background/50 p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Session preference</p>
                    <div className="flex items-center space-x-2">
                      <input
                        id="remember-me"
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        disabled={isLoading}
                        className="h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary cursor-pointer"
                      />
                      <label htmlFor="remember-me" className="cursor-pointer text-sm text-foreground/80 font-medium">
                        Keep me signed in on this device
                      </label>
                    </div>
                  </div>

                  {/* Provider buttons */}
                  <div className="space-y-3">
                    <Button
                      variant="default"
                      onClick={() => handleOAuthLogin("google")}
                      disabled={isLoading}
                      className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold flex items-center justify-center gap-2 transition-all duration-200"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
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
                      className="h-11 w-full border-border bg-background hover:bg-muted font-bold flex items-center justify-center gap-2 transition-all duration-200 text-foreground"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#1877F2">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                      Continue with Facebook
                    </Button>
                  </div>

                  <p className="text-center text-xs text-muted-foreground leading-normal">
                    New here? Your account will be created automatically on your first login.
                  </p>
                </CardContent>

                <CardFooter className="flex flex-col space-y-2 pb-6">
                  <p className="text-center text-xs text-muted-foreground/60 font-medium">
                    Secured by Supabase JWT. Redirect protection active.
                  </p>
                </CardFooter>
              </Card>
            </div>

          </div>
        </section>

        {/* ─── Mock Dashboard Visual Section (PULLED UP TO ZERO OUT THE VOID) ─── */}
        <section className="relative pt-4 pb-12 z-10">
          <div className="container mx-auto px-4 md:px-8 max-w-4xl text-center">
            <div className="relative w-full max-w-4xl">
              <div className="rounded-xl border border-border bg-card/80 backdrop-blur-sm p-4 sm:p-8 shadow-2xl overflow-hidden w-full max-w-[90vw] mx-auto">
                {/* Mock dashboard top bar */}
                <div className="flex items-center gap-2 mb-6">
                  <div className="h-3 w-3 rounded-full bg-red-400/70" />
                  <div className="h-3 w-3 rounded-full bg-yellow-400/70" />
                  <div className="h-3 w-3 rounded-full bg-green-400/70" />
                  <div className="ml-4 h-4 w-48 rounded-full bg-muted" />
                </div>

                {/* Mock stat cards */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { label: "Total Balance", value: "₱125,430.00", change: "+12.5%", up: true },
                    { label: "Monthly Savings", value: "₱15,200.00", change: "+8.2%", up: true },
                    { label: "Expenses", value: "₱32,150.00", change: "-3.1%", up: false },
                  ].map((stat, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-background/50 p-2 sm:p-4 flex flex-col justify-center text-left"
                    >
                      <p className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">{stat.label}</p>
                      <p className="text-xs sm:text-lg font-bold mt-1 text-foreground truncate">{stat.value}</p>
                      <p className={`text-[10px] sm:text-xs mt-0.5 sm:mt-1 font-semibold ${stat.up ? "text-primary" : "text-rose-500"}`}>
                        {stat.change}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Mock chart lines */}
                <div className="h-24 sm:h-48 rounded-lg border border-border bg-background/30 flex items-end px-2 sm:px-4 pb-2 sm:pb-4 gap-1 sm:gap-1.5 overflow-hidden w-full">
                  {[40, 55, 35, 65, 50, 70, 45, 80, 60, 75, 90, 68, 85, 72, 95, 78, 88, 70, 82, 92].map(
                    (h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t bg-primary/40"
                        style={{
                          height: `${h}%`,
                        }}
                      />
                    )
                  )}
                </div>
              </div>

              {/* Glow under the card */}
              <div
                className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-16 rounded-full pointer-events-none"
                style={{ background: "radial-gradient(ellipse, rgba(34, 197, 137, 0.15) 0%, transparent 70%)" }}
              />
            </div>
          </div>
        </section>

        {/* ─── Minimal Feature Section ─── */}
        <section className="relative py-20 border-t border-border/40">
          <div className="container mx-auto px-4 md:px-8 max-w-5xl">
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Simple tools for <span className="text-primary">your money</span>
              </h2>
              <p className="text-muted-foreground text-base max-w-md mx-auto">
                Automated trackers, visual charts, and multi-wallet balance consolidation in one workspace.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Wallet,
                  title: "Multiple Wallets",
                  desc: "Cash, bank accounts, credit cards, and e-wallets aggregated together.",
                },
                {
                  icon: BarChart3,
                  title: "Visual Reports",
                  desc: "Clear charts and transaction trends over customized ranges.",
                },
                {
                  icon: Shield,
                  title: "Secure & Private",
                  desc: "Bypasses credentials by authenticating securely via Google and Facebook OAuth.",
                },
                {
                  icon: Target,
                  title: "Budget Goals",
                  desc: "Define custom spend categories and keep balances matching targets.",
                },
                {
                  icon: TrendingUp,
                  title: "Trends Over Time",
                  desc: "Evaluate spending velocity and net income movements smoothly.",
                },
                {
                  icon: Smartphone,
                  title: "Adaptive View",
                  desc: "Responsive cockpit designed for mobile, tablet, and desktop viewports.",
                },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-card/30 p-6 flex flex-col hover:border-primary/20 transition-all duration-200 backdrop-blur-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-bold text-lg">{feature.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 border-t border-border py-8 bg-background">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex items-center gap-2">
            <Image
              src="/logos/main-logo.png"
              alt="Buko Juice Logo"
              width={20}
              height={20}
              className="h-5 w-5"
            />
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} Buko Juice Money Tracker.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Powered by Next.js & Supabase.
          </p>
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
