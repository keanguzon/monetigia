import React, { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavigationProvider, useNavigation } from "@/components/layout/navigation-provider";
import { DashboardLayoutClient } from "@/components/layout/dashboard-layout-client";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
let pathname = "/dashboard";
const listeners = new Set<() => void>();
function commit(path: string) { pathname = path; listeners.forEach(listener => listener()); }
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => pathname),
}));
vi.mock("next/link", () => ({ default: React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(function Link(props, ref) { return <a {...props} ref={ref} />; }) }));
vi.mock("@/components/layout/sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));

const assign = vi.fn();
function StartIntent({ href }: { href: string }) {
  const { navigate, refreshMobileDestination } = useNavigation();
  return <><button onClick={() => navigate(href, { source: "mobile" })}>Request path</button><button onClick={refreshMobileDestination}>Direct refresh boundary</button></>;
}
function App({ dialog = false, href }: { dialog?: boolean; href?: string }) {
  return <NavigationProvider navigateDocument={assign}>
    {href && <StartIntent href={href} />}
    <DashboardLayoutClient user={null}>
      <input aria-label="Unsaved draft" defaultValue="saved locally" />
      <button>Old page action</button>
      {dialog && <div role="dialog" aria-modal="true" aria-label="Draft dialog"><input aria-label="Dialog draft" defaultValue="keep me" /></div>}
    </DashboardLayoutClient>
  </NavigationProvider>;
}
beforeEach(() => {
  vi.useFakeTimers();
  pathname = "/dashboard";
  router.push.mockReset();
  router.refresh.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 375 });
});
afterEach(() => { cleanup(); listeners.clear(); vi.useRealTimers(); });

test("mobile skeleton replaces interactive old content through 7999ms, then offers explicit refresh", () => {
  render(<App />);
  const draft = screen.getByRole("textbox", { name: "Unsaved draft" });
  fireEvent.change(draft, { target: { value: "my draft" } });
  fireEvent.click(screen.getByRole("link", { name: "Transactions" }));
  expect(screen.getByRole("link", { name: "Transactions" }).getAttribute("data-active")).toBe("true");
  expect(screen.getByRole("heading", { name: "Transactions" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Old page action" })).toBeNull();
  expect(draft.closest("[data-mobile-route-content]")?.hasAttribute("inert")).toBe(true);
  expect(document.querySelector(".mobile-navigation-recovery .skeleton")).toBeTruthy();
  act(() => vi.advanceTimersByTime(7999));
  expect(screen.queryByRole("button", { name: "Refresh Transactions" })).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("heading", { name: "Can't load page" })).toBeNull();
  expect(screen.getByText("Taking longer than expected. Try refreshing.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Refresh Transactions" })).toBeTruthy();
  expect(document.querySelector(".mobile-navigation-recovery .skeleton")).toBeNull();
  expect(assign).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.refresh).not.toHaveBeenCalled();
  act(() => commit("/transactions"));
  expect(screen.queryByText("Taking longer than expected. Try refreshing.")).toBeNull();
  expect(screen.getByRole("button", { name: "Old page action" })).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Unsaved draft" }) as HTMLInputElement).value).toBe("my draft");
});

test("refresh opens latest requested same-origin query/hash once and exposes refreshing state", async () => {
  render(<App href="/accounts?view=all#balance" />);
  fireEvent.click(screen.getByRole("link", { name: "Transactions" }));
  fireEvent.click(screen.getByRole("button", { name: "Request path" }));
  act(() => vi.advanceTimersByTime(8000));
  vi.useRealTimers();
  const user = userEvent.setup();
  const refresh = screen.getByRole("button", { name: "Refresh Wallets" });
  refresh.focus();
  await user.keyboard("{Enter}");
  expect(assign).toHaveBeenCalledWith(`${window.location.origin}/accounts?view=all#balance`);
  fireEvent.click(refresh);
  expect(assign).toHaveBeenCalledTimes(1);
  expect(refresh.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByText("Refreshing Wallets…")).toBeTruthy();
  expect(router.refresh).not.toHaveBeenCalled();
});

test.each(["https://elsewhere.test/accounts", "/settings", "javascript:alert(1)"])("refresh rejects unapproved destination %s", (href) => {
  render(<App href={href} />);
  fireEvent.click(screen.getByRole("button", { name: "Request path" }));
  act(() => vi.advanceTimersByTime(8000));
  fireEvent.click(screen.getByRole("button", { name: "Direct refresh boundary" }));
  expect(assign).not.toHaveBeenCalled();
});

test("desktop exposes actual content while unresolved mobile intent survives breakpoint roundtrip", () => {
  render(<App />);
  const old = screen.getByRole("button", { name: "Old page action" });
  fireEvent.click(screen.getByRole("link", { name: "Wallets" }));
  window.innerWidth = 1280;
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("button", { name: "Old page action" })).toBe(old);
  expect(old.closest("[data-mobile-route-content]")?.hasAttribute("inert")).toBe(false);
  expect(screen.queryByRole("heading", { name: "Wallets" })).toBeNull();
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.queryByRole("heading", { name: "Can't load page" })).toBeNull();
  window.innerWidth = 375;
  fireEvent(window, new Event("resize"));
  expect(screen.getByText("Taking longer than expected. Try refreshing.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Wallets" }).getAttribute("data-active")).toBe("true");
});

test("a dialog opening during outstanding navigation stays mounted and usable, then recovery returns", async () => {
  const view = render(<App />);
  fireEvent.click(screen.getByRole("link", { name: "Goals" }));
  view.rerender(<App dialog />);
  await act(async () => { await Promise.resolve(); });
  const dialog = screen.getByRole("dialog", { name: "Draft dialog" });
  expect(dialog.closest("[inert]")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Dialog draft" }), { target: { value: "still usable" } });
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.queryByRole("button", { name: "Refresh Goals" })).toBeNull();
  view.rerender(<App />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole("button", { name: "Refresh Goals" })).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();
});

test("editable keyboard suppresses recovery and preserves the active form until dismissal", async () => {
  const viewport = new EventTarget() as EventTarget & { height: number; scale: number };
  viewport.height = 800;
  viewport.scale = 1;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  const view = render(<App />);
  const draft = screen.getByRole("textbox", { name: "Unsaved draft" });
  draft.focus();
  viewport.height = 400;
  act(() => viewport.dispatchEvent(new Event("resize")));
  view.rerender(<App href="/goals" />);
  fireEvent.click(screen.getByRole("button", { name: "Request path" }));
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.queryByRole("button", { name: "Refresh Goals" })).toBeNull();
  expect(draft.closest("[inert]")).toBeNull();
  draft.blur();
  act(() => viewport.dispatchEvent(new Event("resize")));
  expect(screen.getByRole("button", { name: "Refresh Goals" })).toBeTruthy();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
});

test("failed navigation shows short retry copy with an unboxed refresh icon action", () => {
  router.push.mockImplementationOnce(() => { throw new Error("Route failed"); });
  render(<App />);

  fireEvent.click(screen.getByRole("link", { name: "Transactions" }));

  expect(screen.getByRole("heading", { name: "Can't load page" })).toBeTruthy();
  expect(screen.getByText("Please try again.")).toBeTruthy();
  expect(screen.queryByText("Taking longer than expected. Try refreshing.")).toBeNull();
  const refresh = screen.getByRole("button", { name: "Refresh Transactions" });
  expect(refresh.querySelector("svg")?.getAttribute("width")).toBe("40");
  expect(refresh.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
});
