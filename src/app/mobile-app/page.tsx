"use client";

import Link from "next/link";
import QRCode from "react-qr-code";
import { Download, ChevronLeft, ShieldCheck, Smartphone, Zap, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModeToggle } from "@/components/ui/mode-toggle";

const APK_URL = "https://github.com/keanguzon/monetigia-mobile/releases/latest/download/monetigia.apk";

export default function MobileAppPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-200">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Back to Home</span>
          </Link>
          <ModeToggle />
        </div>
      </header>

      <main className="flex-1 landing-surface-radial py-12 md:py-16">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-2 items-start">
            
            {/* Left Column: Hero & Info */}
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Smartphone className="h-3.5 w-3.5" />
                <span>Available for Android</span>
              </div>

              <div className="space-y-3">
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight font-heading text-foreground leading-tight">
                  Trace your wealth from anywhere.
                </h1>
                <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
                  Monitor multi-wallet balances, record transactions on the go, and track SpayLater installment dates directly from your smartphone.
                </p>
              </div>

              <div className="pt-2">
                <a href={APK_URL} className="inline-block w-full sm:w-auto">
                  <Button size="lg" className="w-full sm:w-auto h-12 px-6 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold flex items-center justify-center gap-2">
                    <Download className="h-4 w-4" />
                    <span>Download APK Directly</span>
                  </Button>
                </a>
              </div>

              {/* Feature Highlights */}
              <div className="grid gap-4 sm:grid-cols-2 pt-6 border-t border-border">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <span>OAuth Secured</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Sign in securely via Google or Facebook. No banking passwords are ever stored.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                    <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span>Instant Cloud Sync</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Changes made on your phone reflect in real time on the web dashboard.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: QR Code & OTA Card */}
            <div className="space-y-6">
              <Card className="border border-border bg-card shadow-sm">
                <CardHeader className="border-b border-border bg-muted/20 pb-4">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-primary" />
                    <span>Quick Install</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Scan with your mobile camera to begin downloading the APK.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center py-6">
                  <div className="bg-white p-3 rounded-lg border border-border/80 shadow-sm">
                    <QRCode value={APK_URL} size={180} level="H" />
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border bg-card shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Code2 className="h-4 w-4 text-primary" />
                    <span>Over-The-Air (OTA) Updates</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    The mobile app supports automatic in-app updates. When bug fixes or feature improvements are released, the app updates automatically in the background.
                  </p>
                  <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2 border border-border">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>You only need to re-download if a new native Android release is required.</span>
                  </div>
                </CardContent>
              </Card>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
