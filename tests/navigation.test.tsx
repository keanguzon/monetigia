import React, { Suspense, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NavigationProvider } from "@/components/layout/navigation-provider";
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
  mockPathname = "/";
  pathnameListeners.clear();
  cleanup();
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
  expect(screen.getByRole("status").textContent).toBe("Loading page");
  expect(screen.getByRole("heading").textContent).toBe("/");
  fireEvent.click(screen.getByRole("link", { name: "Goals" }));
  await act(async () => { release(); await waiting; });
  expect(screen.getByRole("heading").textContent).toBe("/goals");
  expect(screen.queryByRole("status")).toBeNull();
});

test("cancelled link clicks never start navigation", () => {
  const push = vi.fn();
  router.push = push;
  render(<NavigationProvider><LoadingBar /><NavigationLink href="/accounts" onClick={event => event.preventDefault()}>Wallets</NavigationLink></NavigationProvider>);
  fireEvent.click(screen.getByRole("link"));
  expect(push).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});
