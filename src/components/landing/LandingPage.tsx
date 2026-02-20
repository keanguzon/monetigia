"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { ScrollReveal } from "./ScrollReveal";
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  Globe,
  Landmark,
  Lock,
  PiggyBank,
  Shield,
  Smartphone,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ─── Animated Background (video-like moving blobs) ─── */}
      <div className="landing-bg-animation">
        <div className="landing-bg-blob landing-bg-blob-1" />
        <div className="landing-bg-blob landing-bg-blob-2" />
        <div className="landing-bg-blob landing-bg-blob-3" />
        {/* Subtle moving gradient lines */}
        <div className="landing-gradient-line" style={{ top: "20%" }} />
        <div className="landing-gradient-line" style={{ top: "50%", animationDelay: "3s" }} />
        <div className="landing-gradient-line" style={{ top: "80%", animationDelay: "6s" }} />
      </div>

      {/* ─── Header ─── */}
      <header
        className={`fixed top-0 z-50 w-full transition-all duration-300 ${scrolled
          ? "bg-background/80 backdrop-blur-xl shadow-sm"
          : "bg-transparent"
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
            <span className="text-lg sm:text-xl font-bold tracking-tight">
              Buko Juice
            </span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <ModeToggle />
            <Link href="/login" className="hidden sm:inline">
              <Button variant="ghost" size="sm" className="text-sm">
                Sign In
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm" className="text-sm landing-btn-glow">
                Get Started
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 relative z-10">
        {/* ─── Hero Section ─── */}
        <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden pt-16">
          {/* Background: grid pattern + radial glow */}
          <div className="landing-grid-bg absolute inset-0" />
          <div className="absolute inset-0 landing-hero-glow" />

          {/* Floating orbs */}
          <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full bg-primary/10 blur-[120px] landing-float-slow" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-primary/5 blur-[150px] landing-float-slower" />

          <div className="container relative mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 text-center">
            {/* Badge */}
            <ScrollReveal delay={0} duration={600}>
              <div
                className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium backdrop-blur-sm shadow-sm"
                style={{
                  backgroundColor: isDark ? '#022c15' : '#e8f5e3',
                  border: `1px solid ${isDark ? '#15803d' : '#86efac'}`,
                  color: isDark ? '#4ade80' : '#15803d',
                }}
              >
                <Zap className="h-4 w-4" />
                <span>Money tracking made simple</span>
              </div>
            </ScrollReveal>

            {/* Heading */}
            <ScrollReveal delay={100} duration={800}>
              <h1 className="text-4xl font-bold tracking-tight sm:text-6xl md:text-7xl lg:text-8xl">
                Track your{" "}
                <span className="landing-gradient-text">money</span>
              </h1>
            </ScrollReveal>

            <ScrollReveal delay={200} duration={800}>
              <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl leading-relaxed">
                See where your money goes. Manage all your financial wallets in one place.
              </p>
            </ScrollReveal>

            {/* CTA Buttons */}
            <ScrollReveal delay={300} duration={600}>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link href="/register">
                  <Button size="lg" className="gap-2 h-12 px-8 text-base landing-btn-glow">
                    Start for Free <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 px-8 text-base border-border/50 hover:bg-accent/50"
                  >
                    Sign In
                  </Button>
                </Link>
              </div>
            </ScrollReveal>

            {/* Hero visual — mock dashboard card */}
            <ScrollReveal delay={400} duration={1000} distance={50}>
              <div className="relative mt-8 w-full max-w-4xl">
                <div className="landing-card-glow rounded-xl border bg-card/80 backdrop-blur-sm p-4 sm:p-8 shadow-2xl overflow-hidden w-full max-w-[90vw] mx-auto">
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
                        className="rounded-lg border bg-background/50 p-2 sm:p-4 landing-stat-shimmer flex flex-col justify-center"
                        style={{ animationDelay: `${i * 200}ms` }}
                      >
                        <p className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">{stat.label}</p>
                        <p className="text-xs sm:text-lg font-bold mt-1 truncate">{stat.value}</p>
                        <p className={`text-[10px] sm:text-xs mt-0.5 sm:mt-1 ${stat.up ? "text-primary" : "text-destructive"}`}>
                          {stat.change}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Mock chart lines */}
                  <div className="h-24 sm:h-48 rounded-lg border bg-background/30 flex items-end px-2 sm:px-4 pb-2 sm:pb-4 gap-1 sm:gap-1.5 overflow-hidden w-full">
                    {[40, 55, 35, 65, 50, 70, 45, 80, 60, 75, 90, 68, 85, 72, 95, 78, 88, 70, 82, 92].map(
                      (h, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-t bg-primary/60 landing-bar-grow"
                          style={{
                            height: `${h}%`,
                            animationDelay: `${600 + i * 60}ms`,
                          }}
                        />
                      )
                    )}
                  </div>
                </div>

                {/* Glow under the card */}
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-16 bg-primary/20 blur-[60px] rounded-full" />
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* ─── Features Section ─── */}
        <section className="relative py-24 md:py-32">
          <div className="absolute inset-0 landing-section-glow" />
          <div className="container relative mx-auto px-4 md:px-8">
            <ScrollReveal>
              <div className="mx-auto max-w-2xl text-center mb-16">
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                  Simple tools for{" "}
                  <span className="landing-gradient-text">your money</span>
                </h2>
                <p className="mt-4 text-muted-foreground text-lg">
                  Everything you need, nothing you don't.
                </p>
              </div>
            </ScrollReveal>

            <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Wallet,
                  title: "Multiple Wallets",
                  desc: "Cash, bank accounts, credit cards, and e-wallets in one place.",
                },
                {
                  icon: BarChart3,
                  title: "Visual Reports",
                  desc: "Charts and graphs that help you understand your spending.",
                },
                {
                  icon: Shield,
                  title: "Secure & Private",
                  desc: "Your data is encrypted and never shared.",
                },
                {
                  icon: Target,
                  title: "Budget Goals",
                  desc: "Set spending limits and track your progress.",
                },
                {
                  icon: TrendingUp,
                  title: "Trends Over Time",
                  desc: "See how your money moves over weeks and months.",
                },
                {
                  icon: Smartphone,
                  title: "Works Everywhere",
                  desc: "Use it on your phone, tablet, or computer.",
                },
              ].map((feature, i) => (
                <ScrollReveal key={i} delay={i * 80} duration={600}>
                  <div className="group relative rounded-xl border bg-card/50 p-6 transition-all duration-300 hover:bg-card hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1 landing-feature-card">
                    <div className="landing-feature-card-border" />
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary/20">
                      <feature.icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-semibold text-lg">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                      {feature.desc}
                    </p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Highlight: Financial Wallets ─── */}
        <section className="relative py-24 md:py-32 overflow-hidden">
          <div className="absolute inset-0 landing-grid-bg opacity-50" />
          <div className="container relative mx-auto px-4 md:px-8">
            <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
              <ScrollReveal direction="left">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-primary mb-4">
                    <Landmark className="h-3 w-3" />
                    Financial Wallets
                  </div>
                  <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                    All your wallets.{" "}
                    <span className="landing-gradient-text">One place.</span>
                  </h2>
                  <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
                    See all your money at once. Track transfers between wallets.
                    Keep everything balanced.
                  </p>
                  <div className="mt-8 flex gap-4">
                    <Link href="/register">
                      <Button className="gap-2 landing-btn-glow">
                        Get Started <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal direction="right" delay={200}>
                <div className="landing-card-glow rounded-xl border bg-card/80 backdrop-blur-sm p-6 shadow-xl">
                  <div className="space-y-3">
                    {[
                      { name: "Main Savings", type: "Bank", amount: "₱85,230.00", icon: Landmark, color: "text-blue-500" },
                      { name: "Cash Wallet", type: "Cash", amount: "₱12,450.00", icon: Wallet, color: "text-green-500" },
                      { name: "Credit Card", type: "Credit", amount: "₱-8,200.00", icon: CreditCard, color: "text-orange-500" },
                      { name: "My E-Wallet", type: "E-Wallet", amount: "₱5,950.00", icon: Smartphone, color: "text-purple-500" },
                    ].map((acc, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg border bg-background/50 px-4 py-3 transition-colors hover:bg-background/80"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`${acc.color}`}>
                            <acc.icon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{acc.name}</p>
                            <p className="text-xs text-muted-foreground">{acc.type}</p>
                          </div>
                        </div>
                        <p className="text-sm font-semibold">{acc.amount}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* ─── Highlight: Security ─── */}
        <section className="relative py-24 md:py-32">
          <div className="absolute inset-0 landing-section-glow" />
          <div className="container relative mx-auto px-4 md:px-8">
            <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
              <ScrollReveal direction="left" delay={100} className="order-2 lg:order-1">
                <div className="landing-card-glow rounded-xl border bg-card/80 backdrop-blur-sm p-8 shadow-xl text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
                    <Lock className="h-10 w-10 text-primary" />
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-4">
                    {[
                      { label: "Encryption", value: "AES-256" },
                      { label: "Auth", value: "Supabase" },
                      { label: "Data Sharing", value: "Never" },
                      { label: "Uptime", value: "99.9%" },
                    ].map((item, i) => (
                      <div key={i} className="rounded-lg border bg-background/50 p-3">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="text-sm font-bold mt-1">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal direction="right" className="order-1 lg:order-2">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-primary mb-4">
                    <Shield className="h-3 w-3" />
                    Security
                  </div>
                  <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                    Your data is{" "}
                    <span className="landing-gradient-text">safe.</span>
                  </h2>
                  <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
                    Your information is encrypted and stored securely. We never
                    share or sell your data.
                  </p>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* ─── Stats Section ─── */}
        <section className="relative py-24 md:py-32 overflow-hidden">
          <div className="absolute inset-0 landing-grid-bg opacity-40" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[150px]" />

          <div className="container relative mx-auto px-4 md:px-8">
            <ScrollReveal>
              <div className="mx-auto max-w-2xl text-center mb-16">
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                  Free to use.{" "}
                  <span className="landing-gradient-text">No limits.</span>
                </h2>
                <p className="mt-4 text-muted-foreground text-lg">
                  Track as much or as little as you want.
                </p>
              </div>
            </ScrollReveal>

            <div className="mx-auto grid max-w-4xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { value: "Free", label: "No hidden fees" },
                { value: "∞", label: "Unlimited transactions" },
                { value: "5+", label: "Account types" },
                { value: "24/7", label: "Always accessible" },
              ].map((stat, i) => (
                <ScrollReveal key={i} delay={i * 100}>
                  <div className="text-center">
                    <p className="text-4xl sm:text-5xl font-bold landing-gradient-text">
                      {stat.value}
                    </p>
                    <p className="mt-2 text-muted-foreground text-sm">
                      {stat.label}
                    </p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* ─── CTA Section ─── */}
        <section className="relative py-24 md:py-32">
          <div className="container mx-auto px-4 md:px-8">
            <ScrollReveal>
              <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border bg-card/80 backdrop-blur-sm">
                <div className="absolute inset-0 landing-cta-gradient" />
                <div className="relative px-8 py-16 sm:px-16 sm:py-20 text-center">
                  <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                    Start tracking today
                  </h2>
                  <p className="mt-4 text-muted-foreground text-lg max-w-xl mx-auto">
                    Create your free account and see where your money goes.
                  </p>
                  <div className="mt-8 flex flex-wrap justify-center gap-4">
                    <Link href="/register">
                      <Button size="lg" className="gap-2 h-12 px-8 text-base landing-btn-glow">
                        Create Free Account <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 border-t py-8 md:py-0">
        <div className="container mx-auto flex flex-col items-center justify-center gap-2 px-4 md:h-20 md:px-8">
          <div className="flex items-center gap-2">
            <Image
              src="/logos/main-logo.png"
              alt="Buko Juice Logo"
              width={20}
              height={20}
              className="h-5 w-5"
            />
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Buko Juice. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
