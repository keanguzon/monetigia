"use client";

import { useState, useEffect, useRef } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { MobileNavigationRecovery } from "@/components/layout/mobile-navigation-recovery";
import { useNavigation } from "@/components/layout/navigation-provider";
import { useMobileNavigationVisibility } from "@/hooks/use-mobile-navigation-visibility";

interface DashboardLayoutClientProps {
  user: {
    email: string;
    name?: string;
    avatar_url?: string;
  } | null;
  children: React.ReactNode;
}

export function DashboardLayoutClient({ user, children }: DashboardLayoutClientProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const { mobileRequest } = useNavigation();
  const { blockedByModal, keyboardOpen } = useMobileNavigationVisibility();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [hasContentModal, setHasContentModal] = useState(false);
  const hideMobileContent = Boolean(mobileRequest) && !isDesktop && !blockedByModal && !keyboardOpen && !hasContentModal;

  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1024px)") : null;
    const handleResize = () => {
      setIsDesktop(query ? query.matches : window.innerWidth >= 1024);
    };

    handleResize();
    if (query) {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", handleResize);
        return () => query.removeEventListener("change", handleResize);
      }
      query.addListener(handleResize);
      return () => query.removeListener(handleResize);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const scan = () => {
      // Ignore this wrapper's recovery hiding so a newly opened inline dialog can restore its ancestor.
      const dialogs = content.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], [data-mobile-nav-blocking]');
      setHasContentModal(Array.from(dialogs).some((dialog) => {
        let node: Element | null = dialog;
        while (node && node !== content) {
          const style = window.getComputedStyle(node);
          if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true" ||
              style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
          node = node.parentElement;
        }
        return true;
      }));
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(content, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["role", "aria-modal", "hidden", "aria-hidden", "data-state", "data-mobile-nav-blocking", "style", "class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="dashboard-layout-shell min-h-screen bg-background" data-dashboard-shell>
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        isDesktop={isDesktop}
        onCollapsedChange={setIsSidebarCollapsed}
      />
      <div
        className={`transition-all duration-300 ${
          isSidebarCollapsed ? "lg:pl-16" : "lg:pl-64"
        }`}
      >
        <Header user={user} />
        <main className="dashboard-main p-4 md:p-6">
          <MobileNavigationRecovery suppressed={hasContentModal} />
          <div ref={(element) => {
            contentRef.current = element;
            element?.toggleAttribute("inert", hideMobileContent);
          }} data-mobile-route-content hidden={hideMobileContent}
            aria-hidden={hideMobileContent ? "true" : undefined}>
            {children}
          </div>
        </main>
      </div>
      <MobileNavigation />
    </div>
  );
}
