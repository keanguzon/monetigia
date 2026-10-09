"use client";

import { useEffect, useRef } from "react";
import { NavigationLink as Link } from "@/components/layout/navigation-link";
import { useNavigation } from "@/components/layout/navigation-provider";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Home,
  ArrowLeftRight,
  Wallet,
  Tags,
  Target,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/accounts", label: "Wallets", icon: Wallet },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  isCollapsed?: boolean;
  isDesktop?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({
  isOpen = false,
  onClose,
  isCollapsed = false,
  isDesktop = true,
  onCollapsedChange,
}: SidebarProps) {
  const pathname = usePathname();
  const { pendingHref } = useNavigation();
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    sidebarRef.current?.toggleAttribute("inert", !isDesktop && !isOpen);
  }, [isDesktop, isOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        ref={sidebarRef}
        aria-hidden={!isDesktop && !isOpen ? true : undefined}
        className={cn(
          "fixed left-0 top-0 z-50 h-screen border-r bg-card",
          "transition-[width,transform,background-color,border-color] duration-300 ease-in-out",
          "w-64",
          isCollapsed ? "lg:w-16" : "lg:w-64",
          "lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo + Close button on mobile */}
          <div className="flex h-16 items-center justify-between border-b px-4">
            <Link href="/dashboard" className="flex items-center space-x-2" onClick={onClose}>
              <Image src="/logos/main-logo.png" alt="Monetigia Logo" width={32} height={32} className="h-8 w-8 flex-shrink-0" />
              <span className={cn("text-xl font-bold transition-[opacity,color] duration-300 ease-in-out opacity-100", isCollapsed && "lg:hidden")}>Monetigia</span>
            </Link>
            {/* Close button - mobile only */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Close navigation"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                aria-busy={pendingHref === item.href}
                aria-label={isCollapsed ? item.label : undefined}
                onClick={onClose}
                className={cn(
                  "flex items-center rounded-lg px-3 py-2 text-sm font-medium",
                  "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  pendingHref === item.href && "bg-muted text-foreground",
                  isActive
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {pendingHref === item.href ? <Loader2 className={cn("h-5 w-5 mr-3 animate-spin motion-reduce:animate-none", isCollapsed && "lg:mr-0")} /> : <item.icon className={cn("h-5 w-5 mr-3 transition-[margin,color,fill] duration-200 ease-in-out", isCollapsed && "lg:mr-0")} />}
                <span className={cn("transition-[opacity,color] duration-300 ease-in-out opacity-100", isCollapsed && "lg:hidden")}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle - desktop only */}
        <div className="hidden border-t p-2 lg:block">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => onCollapsedChange?.(!isCollapsed)}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </aside>
    </>
  );
}
