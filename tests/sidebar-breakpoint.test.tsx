import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));
vi.mock("next/image", () => ({ default: (props: any) => <img {...props} /> }));
vi.mock("@/components/layout/navigation-provider", () => ({ useNavigation: () => ({ pendingHref: null, navigate: vi.fn() }) }));
vi.mock("@/components/layout/navigation-link", () => ({
  NavigationLink: ({ navigationSource, ...props }: any) => {
    void navigationSource;
    return <a {...props} />;
  },
}));
vi.mock("@/components/layout/header", () => ({ Header: () => <header>Header</header> }));
import { DashboardLayoutClient } from "@/components/layout/dashboard-layout-client";
afterEach(cleanup);

test("desktop collapse survives a mobile breakpoint round trip with five direct destinations", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
  render(<DashboardLayoutClient user={null}>Content</DashboardLayoutClient>);
  fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
  const sidebar = within(document.querySelector("aside")!);
  expect(sidebar.getByText("Wallets")).toBeTruthy();
  expect(sidebar.getByRole("link", { name: "Dashboard" }).querySelector("svg")?.classList.contains("lucide-home")).toBe(true);
  expect(screen.queryByRole("navigation", { name: "Primary mobile navigation" })).toBeNull();

  window.innerWidth = 375;
  fireEvent(window, new Event("resize"));
  const mobileNav = screen.getByRole("navigation", { name: "Primary mobile navigation" });
  expect(mobileNav.querySelectorAll("a").length).toBe(5);
  expect(within(mobileNav).getByRole("link", { name: "Categories" })).toBeTruthy();
  expect(within(mobileNav).queryByRole("button")).toBeNull();
  expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Close navigation" })).toBeNull();
  expect(document.querySelector(".bg-black\\/50")).toBeNull();
  expect(document.querySelector("aside")?.hasAttribute("inert")).toBe(true);

  window.innerWidth = 1280;
  fireEvent(window, new Event("resize"));
  expect(screen.queryByRole("navigation", { name: "Primary mobile navigation" })).toBeNull();
  expect(screen.getByRole("button", { name: "Expand navigation" })).toBeTruthy();
  expect(document.querySelector("aside")?.hasAttribute("inert")).toBe(false);
});
