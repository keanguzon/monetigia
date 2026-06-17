import type { Metadata } from "next";
import { Manrope, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import "./landing.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AuthSessionManager } from "@/components/providers/auth-session-manager";
import { Toaster } from "@/components/ui/toaster";
import { LoadingBar } from "@/components/ui/loading-bar";
import ThemeTransitionOverlay from "@/components/theme/ThemeTransitionOverlay";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });

export const metadata: Metadata = {
  title: "Monetigia - Money Tracker",
  description: "Trace the footprints of your wealth with Monetigia. A premium personal finance tracker designed for clarity and control.",
  keywords: ["money tracker", "finance", "expenses", "accounts", "categories"],
  icons: {
    icon: "/logos/main-logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${manrope.className} ${manrope.variable} ${bricolage.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          <AuthSessionManager />
          <LoadingBar />
          <ThemeTransitionOverlay />
          <div className="min-h-screen animate-fade-in">{children}</div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
