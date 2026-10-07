import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  replace: vi.fn(),
  signInWithOAuth: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
}));
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => mocks.getSession(...args),
      signInWithOAuth: (...args: unknown[]) => mocks.signInWithOAuth(...args),
    },
  }),
}));
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
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  mocks.replace.mockReset();
  mocks.signInWithOAuth.mockReset();
  mocks.toast.mockReset();
});

afterEach(() => cleanup());

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
