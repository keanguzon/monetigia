"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

interface DashboardLayoutClientProps {
  user: {
    email: string;
    name?: string;
    avatar_url?: string;
  } | null;
  children: React.ReactNode;
}

export function DashboardLayoutClient({ user, children }: DashboardLayoutClientProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    let desktop = window.innerWidth >= 1024;
    setIsDesktop(desktop);
    const handleResize = () => {
      const nextDesktop = window.innerWidth >= 1024;
      if (nextDesktop !== desktop) {
        setIsSidebarOpen(false);
        desktop = nextDesktop;
        setIsDesktop(nextDesktop);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        isDesktop={isDesktop}
        onCollapsedChange={setIsSidebarCollapsed}
      />
      <div
        className={`transition-all duration-300 ${
          isSidebarCollapsed ? "lg:pl-16" : "lg:pl-64"
        }`}
      >
        <Header user={user} onMenuClick={() => setIsSidebarOpen(true)} />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
