import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  clearSessionMarker: vi.fn(),
  signOut: vi.fn(),
  userResponses: [] as any[],
  profileResponses: [] as any[],
  defaultUser: null as any,
  updateResponse: null as any,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  client: null as any,
  fetch: vi.fn(),
  uploadResponse: null as any,
  displayMode: false,
  userAgent: "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36",
  goalData: null as any,
  restoreGoal: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("@/lib/session-preferences", () => ({ clearTabSessionMarker: mocks.clearSessionMarker }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mocks.theme, resolvedTheme: mocks.resolvedTheme, setTheme: mocks.setTheme }),
}));
vi.mock("@/hooks/use-goals", () => ({ useGoals: () => mocks.goalData }));
vi.mock("@/lib/refresh-financial-data", () => ({
  restoreArchivedGoalAndRefresh: (...args: unknown[]) => mocks.restoreGoal(...args),
}));

import SettingsPage from "@/app/(dashboard)/settings/page";

const userId = "10000000-0000-4000-8000-000000000001";
const currentUser = {
  id: userId,
  email: "avery@example.com",
  app_metadata: { provider: "email", providers: ["email"] },
};
const profile = {
  id: userId,
  name: "Avery Chen",
  email: "avery@example.com",
  avatar_url: "https://images.example.test/old-avatar.png",
};
const archivedGoalId = "20000000-0000-4000-8000-000000000002";
const restoreRequestId = "40000000-0000-4000-8000-000000000004";

function makeArchivedGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: archivedGoalId,
    goalId: archivedGoalId,
    user_id: userId,
    name: "Laptop",
    target_amount: "1250.00",
    current_amount: "500.00",
    target_date: null,
    color: null,
    icon: null,
    is_completed: true,
    status: "completed",
    review_state: "confirmed",
    completed_at: "2026-10-06T12:00:00.000Z",
    archived_at: "2026-10-08T12:00:00.000Z",
    is_priority: false,
    category: "Savings",
    allocation_per_cycle: "0.00",
    allocation_frequency: "monthly",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-10-08T12:00:00.000Z",
    reserved: "0.00",
    spent: "500.00",
    progressAmount: "500.00",
    remaining: "750.00",
    progressPercent: 40,
    walletReservations: [],
    legacyTaggedAmount: "0.00",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeBeforeInstallPrompt(options: {
  prompt?: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
} = {}) {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
  event.prompt = options.prompt ?? vi.fn().mockResolvedValue(undefined);
  event.userChoice = options.userChoice ?? Promise.resolve({ outcome: "accepted" });
  window.dispatchEvent(event);
  return event;
}

function makeFile(type: string, name = "portrait.bin", size = 3) {
  return new File([new Uint8Array(size)], name, { type });
}

function installResponse(path = `avatars/${userId}/portrait.webp`) {
  mocks.uploadResponse = {
    ok: true,
    json: vi.fn().mockResolvedValue({ path }),
  };
  mocks.fetch.mockResolvedValue(mocks.uploadResponse);
}

function renderSettings() {
  return render(<SettingsPage />);
}

beforeEach(() => {
  mocks.theme = "dark";
  mocks.resolvedTheme = "dark";
  mocks.setTheme.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.clearSessionMarker.mockReset();
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.userResponses = [];
  mocks.profileResponses = [{ data: profile, error: null }];
  mocks.defaultUser = currentUser;
  mocks.updateResponse = { data: { id: userId }, error: null };
  mocks.updates = [];
  mocks.displayMode = false;
  mocks.userAgent = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";
  mocks.goalData = {
    userId,
    financeSnapshot: { goals: [] },
    isLoading: false,
    isError: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  mocks.restoreGoal.mockReset().mockResolvedValue({
    saved: { operationId: restoreRequestId, transactionIds: [], replayed: false },
    refreshError: null,
  });
  mocks.fetch.mockReset();
  installResponse();

  mocks.client = {
    auth: {
      getUser: vi.fn(async () => mocks.userResponses.shift() ?? { data: { user: mocks.defaultUser }, error: null }),
      signOut: (...args: unknown[]) => mocks.signOut(...args),
    },
    from: vi.fn((table: string) => {
      let isUpdate = false;
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        update: vi.fn((values: Record<string, unknown>) => {
          isUpdate = true;
          mocks.updates.push({ table, values });
          return builder;
        }),
        maybeSingle: vi.fn(() => Promise.resolve(isUpdate
          ? mocks.updateResponse
          : mocks.profileResponses.shift() ?? { data: profile, error: null })),
        single: vi.fn(() => Promise.resolve(isUpdate
          ? mocks.updateResponse
          : mocks.profileResponses.shift() ?? { data: profile, error: null })),
      };
      return builder;
    }),
    storage: {
      from: vi.fn(() => ({
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.example.test/${path}` } })),
      })),
    },
  };

  vi.stubGlobal("fetch", mocks.fetch);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(display-mode: standalone)" && mocks.displayMode,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(window.navigator, "standalone", { configurable: true, value: false });
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: mocks.userAgent });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settings page", () => {
  test("shows a settings-shaped loading state while the profile is loading", async () => {
    const loading = deferred<{ data: typeof profile; error: null }>();
    mocks.profileResponses = [loading.promise];

    renderSettings();

    expect(screen.getByRole("status", { name: "Loading settings" })).toBeTruthy();
    loading.resolve({ data: profile, error: null });
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Avery Chen");
  });

  test("shows a profile error and lets the person retry loading", async () => {
    const user = userEvent.setup();
    mocks.profileResponses = [
      { data: null, error: { message: "Profile query failed" } },
      { data: profile, error: null },
    ];

    renderSettings();

    expect((await screen.findByRole("alert")).textContent).toMatch(/profile.*could not load/i);
    expect(await screen.findByRole("radio", { name: "Light" })).toBeTruthy();
    expect(screen.getByText(/browser menu.*install/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /retry loading profile/i }));
    expect((await screen.findByLabelText("Name") as HTMLInputElement).value).toBe("Avery Chen");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("saves a changed name and reports success only after a returned user row", async () => {
    const user = userEvent.setup();
    renderSettings();

    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Avery Rivera");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(/profile saved/i);
    expect(mocks.updates).toContainEqual({ table: "users", values: { name: "Avery Rivera" } });
  });

  test("keeps the typed name and shows an error when saving fails", async () => {
    const user = userEvent.setup();
    mocks.updateResponse = { data: null, error: { message: "Write failed" } };
    renderSettings();

    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Avery Rivera");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not save.*write failed/i);
    expect((name as HTMLInputElement).value).toBe("Avery Rivera");
    expect(screen.queryByText(/profile saved/i)).toBeNull();
  });

  test("does not report a successful name save if the update matched no profile row", async () => {
    const user = userEvent.setup();
    mocks.updateResponse = { data: null, error: null };
    renderSettings();

    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not save.*profile.*not found/i);
    expect(screen.queryByText(/profile saved/i)).toBeNull();
  });

  test("keeps the profile form from claiming a save when the session has expired", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByLabelText("Name");
    mocks.userResponses = [{ data: { user: null }, error: null }];

    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/sign in again/i);
    expect(screen.queryByText(/profile saved/i)).toBeNull();
  });

  test("shows the signed-in email and actual provider as read-only account details", async () => {
    renderSettings();

    const email = await screen.findByLabelText("Email");
    expect((email as HTMLInputElement).value).toBe("avery@example.com");
    expect((email as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText(/signed in with/i).parentElement?.textContent).toContain("Email");
    expect(screen.queryByText(/all accounts use oauth/i)).toBeNull();
  });

  test.each([
    ["image/png", "portrait.png", "png"],
    ["image/jpeg", "portrait.jpg", "jpg"],
    ["image/gif", "portrait.gif", "gif"],
    ["image/webp", "portrait.webp", "webp"],
  ])("uploads a %s photo inside the signed-in user's folder", async (mime, filename, extension) => {
    const user = userEvent.setup();
    installResponse(`avatars/${userId}/saved.${extension}`);
    renderSettings();

    const input = await screen.findByLabelText("Profile photo");
    const clickPicker = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: /choose profile photo/i }));
    expect(clickPicker).toHaveBeenCalledOnce();
    clickPicker.mockRestore();

    fireEvent.change(input, { target: { files: [makeFile(mime, filename)] } });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());

    const request = mocks.fetch.mock.calls[0][1] as RequestInit;
    const body = request.body as FormData;
    expect(body.get("path")).toMatch(new RegExp(`^avatars/${userId}/[^/]+\\.${extension}$`));
    expect(body.get("file")).toBeInstanceOf(File);
    expect((input as HTMLInputElement).value).toBe("");
  });

  test("rejects photo types the avatar endpoint does not accept", async () => {
    const user = userEvent.setup();
    renderSettings();

    const input = await screen.findByLabelText("Profile photo");
    fireEvent.change(input, { target: { files: [makeFile("image/svg+xml", "avatar.svg")] } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/png, jpeg, gif, or webp/i);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("");
  });

  test("rejects photos larger than the endpoint's 2 MB limit", async () => {
    renderSettings();

    const input = await screen.findByLabelText("Profile photo");
    fireEvent.change(input, { target: { files: [makeFile("image/png", "large.png", 2 * 1024 * 1024 + 1)] } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/2 mb/i);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("");
  });

  test("keeps the existing photo when an upload fails", async () => {
    mocks.uploadResponse = { ok: false, json: vi.fn().mockResolvedValue({ error: "Upload failed" }) };
    mocks.fetch.mockResolvedValue(mocks.uploadResponse);
    renderSettings();

    const input = await screen.findByLabelText("Profile photo");
    fireEvent.change(input, { target: { files: [makeFile("image/png", "new.png")] } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/upload failed/i);
    expect(screen.getByAltText("Avery Chen profile photo").getAttribute("src")).toBe(profile.avatar_url);
    expect((input as HTMLInputElement).value).toBe("");
  });

  test("keeps the existing photo when the profile row rejects the uploaded photo URL", async () => {
    mocks.updateResponse = { data: null, error: { message: "Profile update failed" } };
    renderSettings();

    const input = await screen.findByLabelText("Profile photo");
    fireEvent.change(input, { target: { files: [makeFile("image/png", "new.png")] } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/profile update failed/i);
    expect(screen.getByAltText("Avery Chen profile photo").getAttribute("src")).toBe(profile.avatar_url);
  });

  test("locks profile and photo actions while a profile update is pending", async () => {
    const user = userEvent.setup();
    const update = deferred<{ data: { id: string }; error: null }>();
    mocks.updateResponse = update.promise;
    renderSettings();

    await screen.findByLabelText("Name");
    const save = screen.getByRole("button", { name: /save profile/i });
    await user.click(save);

    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /choose profile photo/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.updates).toHaveLength(1);
    update.resolve({ data: { id: userId }, error: null });
    expect((await screen.findByRole("status")).textContent).toMatch(/profile saved/i);
  });

  test("offers Light, Dark, and System using the shared theme provider", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const flushFrames = () => act(() => {
      frames.shift()?.(0);
      frames.shift()?.(16);
    });
    const user = userEvent.setup();
    renderSettings();

    const light = await screen.findByRole("radio", { name: "Light" });
    const dark = screen.getByRole("radio", { name: "Dark" });
    const system = screen.getByRole("radio", { name: "System" });
    expect(light).toBeTruthy();
    expect(dark).toBeTruthy();
    expect(system).toBeTruthy();

    await user.click(system);
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(true);
    expect(mocks.setTheme).not.toHaveBeenCalled();
    flushFrames();
    expect(mocks.setTheme).toHaveBeenCalledWith("system");
    await user.click(light);
    flushFrames();
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
  });

  test("explains browser-menu installation when no native prompt is offered", async () => {
    renderSettings();

    expect(await screen.findByText(/browser menu.*install/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install monetigia/i })).toBeNull();
  });

  test("uses a deferred native install prompt and reports acceptance", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "Settings" });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = makeBeforeInstallPrompt({ prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });

    expect(event.defaultPrevented).toBe(true);
    await user.click(await screen.findByRole("button", { name: /install monetigia/i }));

    expect(prompt).toHaveBeenCalledOnce();
    expect((await screen.findByRole("status")).textContent).toMatch(/install prompt accepted/i);
  });

  test("reports a dismissed install prompt without claiming the app was installed", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "Settings" });
    makeBeforeInstallPrompt({ userChoice: Promise.resolve({ outcome: "dismissed" }) });

    await user.click(await screen.findByRole("button", { name: /install monetigia/i }));

    expect((await screen.findByRole("status")).textContent).toMatch(/prompt dismissed/i);
    expect(screen.queryByText(/this app is installed/i)).toBeNull();
  });

  test("shows a useful fallback when the native install prompt throws", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "Settings" });
    makeBeforeInstallPrompt({ prompt: vi.fn().mockRejectedValue(new Error("Prompt unavailable")) });

    await user.click(await screen.findByRole("button", { name: /install monetigia/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not open.*browser menu/i);
  });

  test("uses Share then Add to Home Screen instructions in iOS Safari", async () => {
    mocks.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1";
    Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: mocks.userAgent });
    renderSettings();

    expect(await screen.findByText(/safari.*share.*add to home screen/i)).toBeTruthy();
  });

  test("marks the app installed after the platform fires appinstalled", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "Settings" });
    makeBeforeInstallPrompt();
    expect(await screen.findByRole("button", { name: /install monetigia/i })).toBeTruthy();

    window.dispatchEvent(new Event("appinstalled"));

    expect(await screen.findByText(/this app is installed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install monetigia/i })).toBeNull();
  });

  test("recognizes an app already running in standalone display mode", async () => {
    mocks.displayMode = true;
    renderSettings();

    expect(await screen.findByText(/this app is installed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install monetigia/i })).toBeNull();
  });

  test("keeps the sign-out button pending and shows the server error on failure", async () => {
    const user = userEvent.setup();
    const signOut = deferred<{ error: { message: string } }>();
    mocks.signOut.mockReturnValue(signOut.promise);
    renderSettings();

    const button = await screen.findByRole("button", { name: /sign out/i });
    await user.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    signOut.resolve({ error: { message: "Network is unavailable" } });

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not sign out.*network is unavailable/i);
    expect(mocks.clearSessionMarker).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test("clears the tab marker and redirects after a successful sign-out", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/login"));
    expect(mocks.clearSessionMarker).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  test("explains PHP goal progress, reservations, credit exclusion, and online-only financial actions", async () => {
    renderSettings();

    expect(await screen.findByText(/version 1\.1\.0/i)).toBeTruthy();
    expect(screen.getByText(/philippine peso.*php/i)).toBeTruthy();
    expect(screen.getByText(/actual.*recorded balance.*reserved.*assigned.*available.*actual minus reserved/i)).toBeTruthy();
    expect(screen.getByText(/active goals.*reserved.*spent/i)).toBeTruthy();
    expect(screen.getByText(/credit cards.*excluded/i)).toBeTruthy();
    expect(screen.getByText(/reserving money.*keeps it in the wallet/i)).toBeTruthy();
    expect(screen.getByText(/require an internet connection.*not queued offline/i)).toBeTruthy();
  });

  test("shows archived-goal loading, empty, and retryable error states", async () => {
    mocks.goalData.isLoading = true;
    const loadingView = renderSettings();
    expect(await screen.findByRole("status", { name: /loading archived goals/i })).toBeTruthy();
    loadingView.unmount();

    mocks.goalData.isLoading = false;
    mocks.goalData.financeSnapshot = { goals: [] };
    const view = renderSettings();
    expect(await screen.findByRole("heading", { name: "Archived goals" })).toBeTruthy();
    expect(screen.getByText(/no archived goals/i)).toBeTruthy();

    view.unmount();
    mocks.goalData.isError = new Error("Snapshot unavailable");
    const errorView = renderSettings();
    expect((await screen.findByRole("alert")).textContent).toMatch(/archived goals could not load/i);
    await userEvent.setup().click(screen.getByRole("button", { name: /retry loading archived goals/i }));
    expect(mocks.goalData.refresh).toHaveBeenCalledOnce();
    errorView.unmount();
  });

  test("catches a failed archive-load retry and keeps the action available", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    mocks.goalData.isError = new Error("Snapshot unavailable");
    mocks.goalData.refresh.mockReturnValue(pending.promise);
    renderSettings();

    const retry = await screen.findByRole("button", { name: /retry loading archived goals/i });
    await user.click(retry);
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    pending.reject(new Error("Still unavailable"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/still unavailable/i));
    expect((retry as HTMLButtonElement).disabled).toBe(false);
  });

  test("reports a session lookup error instead of showing empty archived goals", async () => {
    mocks.goalData.userId = null;
    mocks.goalData.financeSnapshot = undefined;
    mocks.goalData.isError = new Error("Session lookup failed");
    renderSettings();

    expect((await screen.findByRole("alert")).textContent).toMatch(/session could not be checked/i);
    expect(screen.queryByText(/no archived goals/i)).toBeNull();
  });

  test("renders archived goal details from the signed-in finance snapshot and restores without reopening", async () => {
    const user = userEvent.setup();
    mocks.goalData.financeSnapshot = { goals: [makeArchivedGoal()] };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(restoreRequestId);
    renderSettings();

    expect(await screen.findByRole("heading", { name: "Archived goals" })).toBeTruthy();
    expect(screen.getByText("Laptop")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("PHP 1,250.00")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /restore laptop/i }));

    expect(mocks.restoreGoal).toHaveBeenCalledWith(restoreRequestId, archivedGoalId, expect.any(Function));
    expect((await screen.findByRole("status")).textContent).toMatch(/laptop moved back to goals.*completed.*spending history/i);
    expect(mocks.client.from.mock.calls.map(([table]: [string]) => table)).not.toContain("goals");
  });

  test("retries an uncertain restore with the same request identifier", async () => {
    const user = userEvent.setup();
    mocks.goalData.financeSnapshot = { goals: [makeArchivedGoal()] };
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(restoreRequestId);
    mocks.restoreGoal
      .mockRejectedValueOnce(Object.assign(new Error("Connection dropped"), { outcome: "unknown" }))
      .mockResolvedValueOnce({ saved: { operationId: restoreRequestId, transactionIds: [], replayed: true }, refreshError: null });
    renderSettings();

    await user.click(await screen.findByRole("button", { name: /restore laptop/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not confirm.*retry.*same request/i);
    await user.click(screen.getByRole("button", { name: /retry restore laptop/i }));

    expect(mocks.restoreGoal).toHaveBeenCalledTimes(2);
    expect(mocks.restoreGoal.mock.calls[1][0]).toBe(mocks.restoreGoal.mock.calls[0][0]);
    expect(mocks.restoreGoal.mock.calls[1][1]).toBe(archivedGoalId);
    expect((await screen.findByRole("status")).textContent).toMatch(/laptop moved back to goals/i);
  });

  test("keeps unknown restores and feedback scoped to the signed-in user", async () => {
    const user = userEvent.setup();
    const originalData = mocks.goalData;
    const goal = makeArchivedGoal();
    const secondUserId = "10000000-0000-4000-8000-000000000009";
    const secondGoalId = "20000000-0000-4000-8000-000000000009";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(restoreRequestId);
    mocks.goalData.financeSnapshot = { goals: [goal] };
    mocks.restoreGoal
      .mockRejectedValueOnce(Object.assign(new Error("Connection dropped"), { outcome: "unknown" }))
      .mockResolvedValueOnce({ saved: { operationId: restoreRequestId, transactionIds: [], replayed: true }, refreshError: null });
    const view = renderSettings();

    await user.click(await screen.findByRole("button", { name: /restore laptop/i }));
    expect(await screen.findByText(/laptop: we could not confirm/i)).toBeTruthy();

    mocks.goalData = {
      ...originalData,
      userId: secondUserId,
      financeSnapshot: { goals: [makeArchivedGoal({ id: secondGoalId, goalId: secondGoalId, user_id: secondUserId, name: "Trip", status: "cancelled", is_completed: false, completed_at: null })] },
    };
    view.rerender(<SettingsPage />);
    expect(await screen.findByText("Trip")).toBeTruthy();
    expect(screen.queryByText(/laptop: we could not confirm/i)).toBeNull();
    expect(screen.queryByText("Laptop")).toBeNull();

    mocks.goalData = originalData;
    view.rerender(<SettingsPage />);
    await user.click(await screen.findByRole("button", { name: /retry restore laptop/i }));
    expect(mocks.restoreGoal.mock.calls[1][0]).toBe(restoreRequestId);
    expect((await screen.findByRole("status")).textContent).toMatch(/laptop moved back to goals/i);
  });

  test("prevents a second restore while the first request is pending", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ saved: { operationId: string; transactionIds: []; replayed: false }; refreshError: null }>();
    mocks.goalData.financeSnapshot = { goals: [makeArchivedGoal()] };
    mocks.restoreGoal.mockReturnValue(pending.promise);
    renderSettings();

    const restore = await screen.findByRole("button", { name: /restore laptop/i });
    await user.click(restore);
    expect((restore as HTMLButtonElement).disabled).toBe(true);
    await user.click(restore);
    expect(mocks.restoreGoal).toHaveBeenCalledOnce();
    pending.resolve({ saved: { operationId: restoreRequestId, transactionIds: [], replayed: false }, refreshError: null });
    expect((await screen.findByRole("status")).textContent).toMatch(/laptop moved back to goals/i);
  });

  test("reports a saved restore separately when refreshing finance data fails", async () => {
    const user = userEvent.setup();
    mocks.goalData.financeSnapshot = { goals: [makeArchivedGoal()] };
    mocks.restoreGoal.mockResolvedValue({
      saved: { operationId: restoreRequestId, transactionIds: [], replayed: false },
      refreshError: new Error("Snapshot unavailable"),
    });
    renderSettings();

    await user.click(await screen.findByRole("button", { name: /restore laptop/i }));
    expect((await screen.findByRole("status")).textContent).toMatch(/laptop moved back to goals/i);
    expect(screen.getByRole("alert").textContent).toMatch(/restore was saved.*could not refresh/i);
    expect(screen.queryByRole("button", { name: /restore laptop/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /restore laptop/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /retry refreshing archived goals/i }));
    expect(mocks.goalData.refresh).toHaveBeenCalledOnce();
  });
});
