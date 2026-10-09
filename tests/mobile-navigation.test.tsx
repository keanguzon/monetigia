import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigationState = vi.hoisted(() => ({
  pathname: "/dashboard",
  pendingHref: null as string | null,
  mobileRequest: null as null | { id: number; href: string; phase: "loading" | "delayed" | "failed" },
  navigate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => navigationState.pathname }));
vi.mock("@/components/layout/navigation-provider", () => ({
  useNavigation: () => ({ ...navigationState, mobileRefreshing: false, refreshMobileDestination: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(function Link(props, ref) {
    return <a {...props} ref={ref} />;
  }),
}));

import { MobileNavigation } from "@/components/layout/mobile-navigation";

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 375 });
  navigationState.pathname = "/dashboard";
  navigationState.pendingHref = null;
  navigationState.mobileRequest = null;
  navigationState.navigate.mockReset();
});

afterEach(cleanup);

test("nested debt route keeps Wallets selected", () => {
  navigationState.pathname = "/accounts/debt";
  render(<MobileNavigation />);
  expect(screen.getByRole("link", { name: "Wallets" }).getAttribute("aria-current")).toBe("page");
});

test("renders five direct routes in display order", () => {
  render(<MobileNavigation />);
  const nav = screen.getByRole("navigation", { name: "Primary mobile navigation" });
  const links = Array.from(nav.querySelectorAll("a"));

  expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
    "Dashboard",
    "Transactions",
    "Wallets",
    "Goals",
    "Categories",
  ]);
  expect(nav.querySelector(".mobile-navigation-label")).toBeNull();
  expect(within(nav).getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
  expect(within(nav).getByRole("link", { name: "Transactions" }).getAttribute("href")).toBe("/transactions");
  expect(within(nav).getByRole("link", { name: "Wallets" }).getAttribute("href")).toBe("/accounts");
  expect(within(nav).getByRole("link", { name: "Goals" }).getAttribute("href")).toBe("/goals");
  expect(within(nav).getByRole("link", { name: "Categories" }).getAttribute("href")).toBe("/categories");
  expect(within(nav).getByRole("link", { name: "Dashboard" }).querySelector("svg")?.classList.contains("lucide-home")).toBe(true);
  expect(within(nav).queryByRole("button")).toBeNull();
});

test("marks the committed destination and colors only its icon", () => {
  const { rerender } = render(<MobileNavigation />);

  const dashboard = screen.getByRole("link", { name: "Dashboard" });
  expect(dashboard.getAttribute("aria-current")).toBe("page");
  expect(dashboard.querySelector("svg")?.classList.contains("mobile-navigation-icon-active")).toBe(true);
  expect(within(dashboard).queryByText("Dashboard")).toBeNull();
  expect(screen.getByRole("link", { name: "Transactions" }).getAttribute("aria-current")).toBeNull();

  navigationState.pathname = "/categories";
  rerender(<MobileNavigation />);
  const categories = screen.getByRole("link", { name: "Categories" });
  expect(categories.getAttribute("aria-current")).toBe("page");
  expect(categories.querySelector("svg")?.classList.contains("mobile-navigation-icon-active")).toBe(true);
  expect(within(categories).queryByText("Categories")).toBeNull();
  expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
});

test("navigates directly from Categories to its route", async () => {
  const user = userEvent.setup();
  render(<MobileNavigation />);

  await user.click(screen.getByRole("link", { name: "Categories" }));

  expect(navigationState.navigate).toHaveBeenCalledWith("/categories", { source: "mobile" });
});

test("keeps destination glyphs while exposing busy state and loading feedback", () => {
  const { rerender } = render(<MobileNavigation />);
  const transactions = screen.getByRole("link", { name: "Transactions" });
  const normalIconClass = transactions.querySelector("svg")?.getAttribute("class");
  navigationState.pendingHref = "/transactions";
  rerender(<MobileNavigation />);

  expect(transactions.getAttribute("aria-busy")).toBe("true");
  expect(within(transactions).getByRole("status").textContent).toBe("Loading Transactions");
  expect(transactions.querySelector("svg")?.getAttribute("class")).toBe(normalIconClass);
  expect(transactions.querySelector("svg")?.classList.contains("mobile-navigation-icon-pending")).toBe(false);
});

test("keeps Categories' glyph while its direct destination is pending", () => {
  const { rerender } = render(<MobileNavigation />);
  const categories = screen.getByRole("link", { name: "Categories" });
  const normalIconClass = categories.querySelector("svg")?.getAttribute("class");

  navigationState.pendingHref = "/categories";
  rerender(<MobileNavigation />);

  expect(categories.getAttribute("aria-busy")).toBe("true");
  expect(within(categories).getByRole("status").textContent).toBe("Loading Categories");
  expect(categories.querySelector("svg")?.getAttribute("class")).toBe(normalIconClass);
});

test("uses NavigationLink for normal clicks and leaves modified clicks to the browser", async () => {
  render(<MobileNavigation />);
  const transactions = screen.getByRole("link", { name: "Transactions" });

  fireEvent.click(transactions);
  expect(navigationState.navigate).toHaveBeenCalledWith("/transactions", { source: "mobile" });

  navigationState.navigate.mockClear();
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
    let preventedByNavigationLink: boolean | undefined;
    const suppressJSDOMNavigation = (clickEvent: Event) => {
      preventedByNavigationLink = clickEvent.defaultPrevented;
      clickEvent.preventDefault();
    };
    window.addEventListener("click", suppressJSDOMNavigation, { once: true });
    transactions.dispatchEvent(event);
    expect(preventedByNavigationLink).toBe(false);
  }
  expect(navigationState.navigate).not.toHaveBeenCalled();

  const categories = screen.getByRole("link", { name: "Categories" });
  let preventedByNavigationLink: boolean | undefined;
  const suppressJSDOMNavigation = (event: Event) => {
    preventedByNavigationLink = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener("click", suppressJSDOMNavigation, { once: true });
  categories.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
  expect(preventedByNavigationLink).toBe(false);
  expect(navigationState.navigate).not.toHaveBeenCalled();
});

test("requested highlight moves before committed current-page semantics and stays when delayed", () => {
  const { rerender } = render(<MobileNavigation />);
  navigationState.mobileRequest = { id: 1, href: "/accounts?view=all", phase: "loading" };
  rerender(<MobileNavigation />);
  const wallets = screen.getByRole("link", { name: "Wallets" });
  expect(wallets.getAttribute("data-active")).toBe("true");
  expect(wallets.getAttribute("aria-current")).toBeNull();
  expect(wallets.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("data-active")).toBeNull();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toBe("Loading Wallets");
  navigationState.mobileRequest = { ...navigationState.mobileRequest, phase: "delayed" };
  rerender(<MobileNavigation />);
  expect(wallets.getAttribute("data-active")).toBe("true");
  expect(wallets.getAttribute("aria-busy")).toBeNull();
  expect(wallets.getAttribute("aria-describedby")).toBeTruthy();
});

test("shows when the viewport changes from desktop to mobile", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
  const { rerender } = render(<MobileNavigation />);
  expect(screen.queryByRole("navigation", { name: "Primary mobile navigation" })).toBeNull();

  window.innerWidth = 375;
  fireEvent(window, new Event("resize"));
  rerender(<MobileNavigation />);
  await waitFor(() => expect(screen.getByRole("link", { name: "Categories" })).toBeTruthy());
});
