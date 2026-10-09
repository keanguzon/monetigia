import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  replace: vi.fn(),
  signInWithOAuth: vi.fn(),
  toast: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => {
  const router = { replace: mocks.replace };
  return { useRouter: () => router, useSearchParams: () => new URLSearchParams(mocks.search) };
});
vi.mock("next/link", () => ({
  default: ({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
}));
vi.mock("next/image", () => ({
  default: ({ priority: _priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => <img {...props} />,
}));
vi.mock("@/lib/supabase/client", () => {
  const client = {
    auth: {
      getSession: (...args: unknown[]) => mocks.getSession(...args),
      signInWithOAuth: (...args: unknown[]) => mocks.signInWithOAuth(...args),
    },
  };
  return { createClient: () => client };
});
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/ui/mode-toggle", () => ({ ModeToggle: () => null }));

import { LandingPage } from "@/components/landing/LandingPage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.search = "";
  localStorage.clear();
  sessionStorage.clear();
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  mocks.replace.mockReset();
  mocks.signInWithOAuth.mockReset();
  mocks.toast.mockReset();
});

afterEach(() => cleanup());

test("puts authentication in the hero without redundant navigation", () => {
  render(<LandingPage />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Know what you can spend.");
  for (const link of screen.getAllByRole("link")) {
    const href = link.getAttribute("href");
    if (href?.startsWith("#")) expect(document.getElementById(href.slice(1))).not.toBeNull();
  }
  expect(screen.getByText("Sample screen")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
  expect(screen.queryByText("Open Monetigia")).toBeNull();
  expect(screen.queryByText("See how it works")).toBeNull();
  expect(screen.queryByText("Your ledger starts here.")).toBeNull();
  expect(screen.getByRole("button", { name: "Start with Google" }).closest("section")?.getAttribute("aria-labelledby")).toBe("landing-title");
});

test("shows authentication failures and re-enables both providers", async () => {
  mocks.signInWithOAuth.mockResolvedValue({ error: { message: "Provider unavailable" } });
  render(<LandingPage />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start with Google" })));
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Provider unavailable" }));
  expect((screen.getByRole("button", { name: "Start with Google" }) as HTMLButtonElement).disabled).toBe(false);
});

test.each(["//example.com", "/\\example.com", "https://example.com"])("rejects unsafe return location %s", async redirect => {
  mocks.search = new URLSearchParams({ redirect }).toString();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "owner" } } } });
  render(<LandingPage />);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard"));
});

test("keeps a safe requested destination in OAuth and honors remember-me", async () => {
  mocks.search = "redirect=%2Faccounts%2Fdebt";
  mocks.signInWithOAuth.mockResolvedValue({ error: null });
  render(<LandingPage />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Keep me signed in on this device" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start with Google" })));
  expect(mocks.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: {
    redirectTo: `${window.location.origin}/auth/callback?redirect=%2Faccounts%2Fdebt`,
  } });
  expect(localStorage.getItem("monetigia:remember-me")).toBe("0");
});

test.each([
  ["Google", "google", "Start with Google", "Continue with Facebook", "Opening Google sign-in..."],
  ["Facebook", "facebook", "Continue with Facebook", "Start with Google", "Opening Facebook sign-in..."],
] as const)("marks only %s as pending while keeping both providers disabled", async (_name, provider, selectedLabel, otherLabel, pendingCopy) => {
  const signIn = deferred<{ error: null }>();
  mocks.signInWithOAuth.mockReturnValue(signIn.promise);

  render(<LandingPage />);

  const selectedButton = screen.getByRole("button", { name: selectedLabel }) as HTMLButtonElement;
  const otherButton = screen.getByRole("button", { name: otherLabel }) as HTMLButtonElement;
  fireEvent.click(selectedButton);

  try {
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider }));
    expect(selectedButton.disabled).toBe(true);
    expect(selectedButton.getAttribute("aria-busy")).toBe("true");
    expect(selectedButton.textContent).toContain(pendingCopy);
    expect(otherButton.disabled).toBe(true);
    expect(otherButton.getAttribute("aria-busy")).toBe("false");
    expect(otherButton.textContent).not.toContain("Opening");
  } finally {
    await act(async () => signIn.resolve({ error: null }));
  }

  expect(selectedButton.disabled).toBe(false);
  expect(selectedButton.getAttribute("aria-busy")).toBe("false");
  expect(otherButton.disabled).toBe(false);
});
