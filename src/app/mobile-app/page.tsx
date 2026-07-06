"use client";

import Link from "next/link";
import Image from "next/image";
import QRCode from "react-qr-code";
import { Download, ChevronLeft, ShieldCheck, Smartphone, Zap, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Aurora } from "@/components/landing/Aurora";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const DARK_COLORS = ["#22c589", "#139a67", "#022416"];
const LIGHT_COLORS = ["#a7f3d0", "#34d399", "#16a36f"];
const APK_URL = "https://github.com/keanguzon/monetigia-mobile/releases/latest/download/monetigia.apk";

export default function MobileAppPage() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  
  useEffect(() => setMounted(true), []);
  const isDark = !mounted ? true : resolvedTheme === "dark";

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
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/20" />
      </div>

      {/* ─── Header ─── */}
      <header className="relative z-50 w-full bg-transparent pt-6">
        <div className="container mx-auto flex h-16 items-center px-4 md:px-8">
          <Link href="/" className="flex items-center space-x-2 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-5 w-5" />
            <span className="font-semibold text-sm">Back to Home</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 relative z-10 container mx-auto px-4 md:px-8 py-12 max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-2 items-start">
          
          {/* Left Column: Hero & Info */}
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm text-primary font-medium">
                <Smartphone className="h-4 w-4" />
                <span>Available for Android</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tighter text-foreground leading-tight font-heading">
                Trace your wealth from anywhere.
              </h1>
              <p className="text-lg text-muted-foreground max-w-md">
                Monitor your balances, manage transactions, and stick to your budget securely from your phone.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <a href={APK_URL} className="w-full sm:w-auto">
                <Button size="lg" className="w-full h-14 px-8 bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-lg flex items-center gap-2 shadow-lg shadow-primary/20">
                  <Download className="h-5 w-5" />
                  Download APK
                </Button>
              </a>
            </div>

            {/* Feature Highlights */}
            <div className="grid gap-4 sm:grid-cols-2 pt-6 border-t border-border/40">
              <div className="space-y-2">
                <ShieldCheck className="h-6 w-6 text-primary" />
                <h3 className="font-bold">OAuth Secured</h3>
                <p className="text-sm text-muted-foreground">Sign in securely via Google or Facebook. No passwords stored.</p>
              </div>
              <div className="space-y-2">
                <Zap className="h-6 w-6 text-primary" />
                <h3 className="font-bold">Instant Sync</h3>
                <p className="text-sm text-muted-foreground">Changes made on your phone reflect instantly on the web.</p>
              </div>
            </div>
          </div>

          {/* Right Column: QR Code & OTA Card */}
          <div className="space-y-6">
            <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-2xl overflow-hidden">
              <CardHeader className="border-b border-border/40 bg-muted/30 pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  Quick Install
                </CardTitle>
                <CardDescription>Scan this QR code with your phone's camera to download directly.</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center py-8">
                <div className="bg-white p-4 rounded-xl shadow-inner">
                  <QRCode 
                    value={APK_URL}
                    size={200}
                    level="H"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/40 bg-card/60 backdrop-blur-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Code2 className="h-5 w-5 text-primary" />
                  In-App OTA Updates
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  APK releases are for native changes. We use <strong>Over-The-Air (OTA) updates</strong> for standard improvements.
                </p>
                <div className="space-y-2 text-sm border-l-2 border-primary/40 pl-4">
                  <p className="font-medium text-foreground">How updates work:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
                    <li>App checks for updates on launch.</li>
                    <li>New code bundles download silently in the background.</li>
                    <li>The next time you open the app, it runs the new code!</li>
                  </ol>
                </div>
                <div className="rounded bg-muted/50 p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  You never have to download a new APK unless we add new native features!
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </main>
    </div>
  );
}
