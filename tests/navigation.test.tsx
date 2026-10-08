import React, { Suspense, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NavigationProvider, useNavigation } from "@/components/layout/navigation-provider";
import { NavigationLink } from "@/components/layout/navigation-link";
import { LoadingBar } from "@/components/ui/loading-bar";

const router = vi.hoisted(() => ({ push: (_href: string) => {} }));
let mockPathname = "/";
const pathnameListeners = new Set<() => void>();
function setMockPathname(next: string) {
  mockPathname = next;
  pathnameListeners.forEach(listener => listener());
}

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => {
    const [, forceUpdate] = useState(0);
    React.useEffect(() => {
      const listener = () => forceUpdate(n => n + 1);
      pathnameListeners.add(listener);
      return () => { pathnameListeners.delete(listener); };
    }, []);
    return mockPathname;
  },
}));
vi.mock("next/link", () => ({ default: React.forwardRef<HTMLAnchorElement, any>(function Link(props, ref) { return <a {...props} ref={ref} />; }) }));
afterEach(() => {
  vi.useRealTimers();
  mockPathname = "/";
  pathnameListeners.clear();
  cleanup();
});

function RequestState() {
  const navigation = useNavigation();
  const request = navigation.mobileRequest;
  return <><span data-testid="request">{request ? `${request.href}:${request.phase}` : "none"}</span><button onClick={() => navigation.navigate("/goals")}>General navigation</button></>;
}

test("mobile intent survives timeout and older commits until the latest destination arrives", () => {
  vi.useFakeTimers();
  router.push = vi.fn();
  const view = render(<NavigationProvider><RequestState /><LoadingBar /><NavigationLink navigationSource="mobile" href="/transactions">Transactions</NavigationLink><NavigationLink navigationSource="mobile" href="/accounts">Wallets</NavigationLink></NavigationProvider>);
  fireEvent.click(screen.getByRole("link", { name: "Transactions" }));
  expect(screen.getByTestId("request").textContent).toBe("/transactions:loading");
  act(() => vi.advanceTimersByTime(4000));
  fireEvent.click(screen.getByRole("link", { name: "Wallets" }));
  act(() => vi.advanceTimersByTime(4000));
  expect(screen.getByTestId("request").textContent).toBe("/accounts:loading");
  act(() => setMockPathname("/transactions"));
  expect(screen.getByTestId("request").textContent).toBe("/accounts:loading");
  act(() => vi.advanceTimersByTime(3999));
  expect(screen.getByTestId("request").textContent).toBe("/accounts:loading");
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByTestId("request").textContent).toBe("/accounts:delayed");
  expect(screen.queryByRole("status")).toBeNull();
  expect(router.push).toHaveBeenCalledTimes(2);
  act(() => setMockPathname("/accounts"));
  expect(screen.getByTestId("request").textContent).toBe("none");
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("synchronous push errors retain failed mobile intent; explicit navigation and Back replace it", () => {
  vi.useFakeTimers();
  router.push = vi.fn(() => { throw new Error("push unavailable"); });
  const remove = vi.spyOn(window, "removeEventListener");
  const view = render(<NavigationProvider><RequestState /><NavigationLink navigationSource="mobile" href="/accounts">Wallets</NavigationLink></NavigationProvider>);
  fireEvent.click(screen.getByRole("link"));
  expect(screen.getByTestId("request").textContent).toBe("/accounts:failed");
  router.push = vi.fn();
  fireEvent.click(screen.getByRole("button", { name: "General navigation" }));
  expect(screen.getByTestId("request").textContent).toBe("none");
  fireEvent.click(screen.getByRole("link"));
  fireEvent(window, new PopStateEvent("popstate"));
  expect(screen.getByTestId("request").textContent).toBe("none");
  view.unmount();
  expect(remove.mock.calls.some(([name]) => name === "popstate")).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  remove.mockRestore();
});

test("an older synchronous exception cannot fail a newer mobile request", () => {
  vi.useFakeTimers();
  let navigate!: ReturnType<typeof useNavigation>["navigate"];
  function CaptureNavigation() { navigate = useNavigation().navigate; return <RequestState />; }
  router.push = vi.fn((href: string) => {
    if (href === "/transactions") {
      navigate("/accounts", { source: "mobile" });
      throw new Error("older push failed");
    }
  });
  render(<NavigationProvider><CaptureNavigation /></NavigationProvider>);
  act(() => navigate("/transactions", { source: "mobile" }));
  expect(screen.getByTestId("request").textContent).toBe("/accounts:loading");
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByTestId("request").textContent).toBe("/accounts:delayed");
});

test("general navigation keeps the original pending watchdog without mobile recovery", () => {
  vi.useFakeTimers();
  router.push = vi.fn();
  render(<NavigationProvider><RequestState /><LoadingBar /></NavigationProvider>);
  fireEvent.click(screen.getByRole("button", { name: "General navigation" }));
  expect(screen.getByTestId("request").textContent).toBe("none");
  expect(screen.getByRole("status").textContent).toBe("Loading page");
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.queryByRole("status")).toBeNull();
});

test.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])("ignored mobile click %j never creates a request", (modifiers) => {
  router.push = vi.fn();
  render(<NavigationProvider><RequestState /><NavigationLink navigationSource="mobile" href="/accounts">Wallets</NavigationLink></NavigationProvider>);
  window.addEventListener("click", event => event.preventDefault(), { once: true });
  fireEvent.click(screen.getByRole("link"), modifiers);
  expect(screen.getByTestId("request").textContent).toBe("none");
  expect(router.push).not.toHaveBeenCalled();
});

test("pending indicator appears before suspended destination renders and clears after latest navigation", async () => {
  let release!: () => void;
  let ready = false;
  const waiting = new Promise<void>(resolve => { release = () => { ready = true; resolve(); }; });
  function Page({ path }: { path: string }) {
    if (path !== "/" && !ready) throw waiting;
    React.useEffect(() => {
      setMockPathname(path);
    }, [path]);
    return <h1>{path}</h1>;
  }
  function App() {
    const [path, setPath] = useState("/");
    router.push = (href: string) => {
      setPath(href);
    };
    return <NavigationProvider><LoadingBar /><NavigationLink href="/accounts">Wallets</NavigationLink><NavigationLink href="/goals">Goals</NavigationLink><Suspense fallback={<p>Loading destination</p>}><Page path={path} /></Suspense></NavigationProvider>;
  }
  render(<App />);
  fireEvent.click(screen.getByRole("link", { name: "Wallets" }));
  const loadingBar = screen.getByRole("status");
  expect(loadingBar.textContent).toBe("Loading page");
  expect(loadingBar.classList.contains("loading-bar-track")).toBe(true);
  expect(loadingBar.classList.contains("overflow-hidden")).toBe(true);
  const loadingSegment = loadingBar.querySelector(".loading-bar-segment");
  expect(loadingSegment).not.toBeNull();
  expect(loadingSegment?.classList.contains("w-full")).toBe(true);
  expect(loadingSegment?.classList.contains("animate-pulse")).toBe(true);
  expect(loadingSegment?.classList.contains("motion-reduce:animate-none")).toBe(true);
  expect(screen.getByRole("heading").textContent).toBe("/");
  fireEvent.click(screen.getByRole("link", { name: "Goals" }));
  await act(async () => { release(); await waiting; });
  expect(screen.getByRole("heading").textContent).toBe("/goals");
  expect(screen.queryByRole("status")).toBeNull();
});

test("cancelled link clicks never start navigation", () => {
  const push = vi.fn();
  router.push = push;
  render(<NavigationProvider><RequestState /><LoadingBar /><NavigationLink navigationSource="mobile" href="/accounts" onClick={event => event.preventDefault()}>Wallets</NavigationLink></NavigationProvider>);
  fireEvent.click(screen.getByRole("link"));
  expect(push).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByTestId("request").textContent).toBe("none");
});
