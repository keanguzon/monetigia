"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useThemeTransition } from "@/hooks/use-theme-transition";
import Image from "next/image";
import appPackage from "../../../../package.json";
import { Button } from "@/components/ui/button";
import { ArchivedGoalsSection } from "@/components/settings/ArchivedGoalsSection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppInstall } from "@/hooks/use-app-install";
import { clearTabSessionMarker } from "@/lib/session-preferences";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";

type ProfileData = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type ThemeChoice = "light" | "dark" | "system";

const avatarExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const sectionClass = "grid gap-5 px-5 py-6 sm:px-7 sm:py-7 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8";
const sectionTitleClass = "font-heading text-lg font-bold tracking-tight text-foreground";
const sectionDescriptionClass = "max-w-xs text-sm leading-relaxed text-muted-foreground";

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function providerLabel(value: string) {
  const labels: Record<string, string> = {
    email: "Email",
    password: "Password",
    google: "Google",
    facebook: "Facebook",
    apple: "Apple",
    github: "GitHub",
  };
  return labels[value.toLowerCase()] ?? value;
}

function SettingsSkeleton() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 pb-[calc(3rem+env(safe-area-inset-bottom))]" data-no-press-motion="">
      <div className="space-y-2">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div role="status" aria-label="Loading settings" className="overflow-hidden rounded-xl border border-border/80 bg-card divide-y divide-border/70">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className={sectionClass}>
            <div className="space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-40 max-w-full" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-11 w-full" />
              {row === 0 && <Skeleton className="h-11 w-32" />}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { theme, applyTheme } = useThemeTransition();
  const install = useAppInstall();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileActionLock = useRef(false);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [signedInEmail, setSignedInEmail] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [mounted, setMounted] = useState(false);

  const profileActionBusy = savingProfile || uploadingPhoto;

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError("");
    setProfileStatus("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const user = authData?.user;
      if (authError || !user) {
        throw new Error("Your session ended. Sign in again to load your profile.");
      }

      setSignedInEmail(user.email ?? "");
      const metadata = user.app_metadata as { provider?: unknown; providers?: unknown } | undefined;
      const providerValues = Array.isArray(metadata?.providers)
        ? metadata.providers
        : metadata?.provider
          ? [metadata.provider]
          : [];
      const nextProviders = providerValues
        .filter((provider): provider is string => typeof provider === "string" && provider.length > 0);
      if (typeof metadata?.provider === "string" && metadata.provider && !nextProviders.includes(metadata.provider)) {
        nextProviders.push(metadata.provider);
      }
      setProviders(Array.from(new Set(nextProviders)));

      const { data, error } = await supabase
        .from("users")
        .select("id, name, email, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The profile record was not found.");

      const nextProfile = data as ProfileData;
      setProfile(nextProfile);
      setName(nextProfile.name ?? "");
    } catch (error) {
      setProfileError(`Profile details could not load. ${errorMessage(error, "Check your connection and try again.")}`);
    } finally {
      setProfileLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (profileActionLock.current || !profile) return;

    profileActionLock.current = true;
    setSavingProfile(true);
    setProfileError("");
    setProfileStatus("");
    const submittedName = name;
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const user = authData?.user;
      if (authError || !user) {
        throw new Error("Your session expired. Sign in again before saving your profile.");
      }

      const { data, error } = await supabase
        .from("users")
        .update({ name: submittedName })
        .eq("id", user.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (data?.id !== user.id) {
        throw new Error("The profile record was not found. Reload it and try again.");
      }

      setProfile((current) => current ? { ...current, name: submittedName } : current);
      setProfileStatus("Profile saved.");
    } catch (error) {
      setProfileError(`Could not save your profile. ${errorMessage(error, "Try again.")}`);
    } finally {
      profileActionLock.current = false;
      setSavingProfile(false);
    }
  };

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const resetInput = () => { input.value = ""; };
    if (!file) {
      resetInput();
      return;
    }

    if (profileActionLock.current) {
      setProfileError("Wait for the current profile change to finish before choosing another photo.");
      resetInput();
      return;
    }
    if (!avatarExtensions[file.type]) {
      setProfileError("Choose a PNG, JPEG, GIF, or WebP image.");
      setProfileStatus("");
      resetInput();
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError("Choose an image no larger than 2 MB.");
      setProfileStatus("");
      resetInput();
      return;
    }

    profileActionLock.current = true;
    setUploadingPhoto(true);
    setProfileError("");
    setProfileStatus("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const user = authData?.user;
      if (authError || !user) {
        throw new Error("Your session expired. Sign in again before changing your photo.");
      }

      const extension = avatarExtensions[file.type];
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", `avatars/${user.id}/${filename}`);

      const response = await fetch("/api/user/upload-avatar", { method: "POST", body: formData });
      const uploadData = await response.json();
      if (!response.ok) throw new Error(uploadData.error || "The photo could not be uploaded.");
      if (typeof uploadData.path !== "string" || !uploadData.path.startsWith(`avatars/${user.id}/`)) {
        throw new Error("The upload returned an invalid photo path.");
      }

      const { data: publicData } = supabase.storage.from("profiles").getPublicUrl(uploadData.path);
      if (!publicData?.publicUrl) throw new Error("The uploaded photo could not be opened.");

      const { data, error } = await supabase
        .from("users")
        .update({ avatar_url: publicData.publicUrl })
        .eq("id", user.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (data?.id !== user.id) {
        throw new Error("The profile record was not found. The photo was not applied.");
      }

      setProfile((current) => current ? { ...current, avatar_url: publicData.publicUrl } : current);
      setProfileStatus("Profile photo updated.");
    } catch (error) {
      setProfileError(`Could not update your profile photo. ${errorMessage(error, "Try again.")}`);
    } finally {
      resetInput();
      profileActionLock.current = false;
      setUploadingPhoto(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setAccountError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      clearTabSessionMarker();
      router.push("/login");
      router.refresh();
    } catch (error) {
      setAccountError(`Could not sign out. ${errorMessage(error, "Try again.")}`);
    } finally {
      setSigningOut(false);
    }
  };

  if (profileLoading) return <SettingsSkeleton />;

  const email = signedInEmail || profile?.email || "";

  return (
    <main className="mx-auto max-w-4xl space-y-6 pb-[calc(3rem+env(safe-area-inset-bottom))]" data-no-press-motion="">
      <header className="space-y-1">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Settings</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">Your profile, appearance, and app setup.</p>
      </header>

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground divide-y divide-border/70">
        <section aria-labelledby="profile-heading" className={sectionClass}>
          <div className="space-y-1">
            <h2 id="profile-heading" className={sectionTitleClass}>Profile</h2>
            <p className={sectionDescriptionClass}>Edit your name and profile photo.</p>
          </div>
          <div className="min-w-0 space-y-5">
            {profile ? (
              <form className="space-y-5" onSubmit={(event) => void handleSaveProfile(event)}>
                <div className="flex flex-wrap items-center gap-4 sm:gap-5">
                  <div
                    role={profile.avatar_url ? undefined : "img"}
                    aria-label={profile.avatar_url ? undefined : `Profile photo for ${name || "your account"}`}
                    className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-foreground/50 bg-primary/10 font-heading text-lg font-bold text-foreground sm:h-20 sm:w-20"
                  >
                    {profile.avatar_url
                      ? <Image src={profile.avatar_url} alt={`${name || "Account"} profile photo`} width={80} height={80} sizes="(min-width: 640px) 80px, 64px" unoptimized className="h-full w-full object-cover" />
                      : <span aria-hidden="true">{name ? getInitials(name) : "ME"}</span>}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={profileActionBusy}
                      onClick={() => fileInputRef.current?.click()}
                      className="h-11 min-w-11 border-foreground/50 px-4"
                    >
                      {uploadingPhoto ? "Uploading photo…" : "Choose profile photo"}
                    </Button>
                    <input
                      ref={fileInputRef}
                      aria-label="Profile photo"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="sr-only"
                      tabIndex={-1}
                      disabled={profileActionBusy}
                      onChange={(event) => void handlePhotoChange(event)}
                    />
                    <p className="text-sm text-muted-foreground">PNG, JPEG, GIF, or WebP. Maximum 2 MB.</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="profile-name">Name</Label>
                    <Input
                      id="profile-name"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your name"
                      disabled={profileActionBusy}
                      className="h-11 border-foreground/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-email">Email</Label>
                    <Input id="profile-email" type="email" value={email} readOnly className="h-11 border-foreground/50 text-foreground" />
                  </div>
                </div>

                {providers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Signed in with</p>
                    <div className="flex flex-wrap gap-2">
                      {providers.map((provider) => (
                        <span key={provider} className="inline-flex min-h-11 items-center rounded-md border border-foreground/50 px-3 text-sm text-foreground">
                          {providerLabel(provider)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={profileActionBusy}
                  className="h-11 min-w-32 bg-primary text-slate-950 hover:bg-primary/90 focus-visible:ring-primary"
                >
                  {savingProfile ? "Saving…" : "Save profile"}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Profile editing is unavailable until your profile loads.</p>
            )}

            {profileError && (
              <div role="alert" className="space-y-3 rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-700 dark:border-red-300 dark:bg-red-950 dark:text-red-300">
                <p>{profileError}</p>
                <Button type="button" variant="outline" disabled={profileLoading || profileActionBusy} onClick={() => void loadProfile()} className="h-11 border-foreground/50">
                  Retry loading profile
                </Button>
              </div>
            )}
            {profileStatus && <p role="status" className="text-sm font-medium text-foreground">{profileStatus}</p>}
          </div>
        </section>

        <section aria-labelledby="appearance-heading" className={sectionClass}>
          <div className="space-y-1">
            <h2 id="appearance-heading" className={sectionTitleClass}>Appearance</h2>
            <p className={sectionDescriptionClass}>Choose the theme used across Monetigia.</p>
          </div>
          <div>
            {mounted ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-foreground">Theme</legend>
                <div role="radiogroup" aria-label="Appearance" className="flex flex-wrap gap-2">
                  {(["light", "dark", "system"] as ThemeChoice[]).map((choice) => (
                    <label
                      key={choice}
                      className={`flex min-h-11 min-w-[6.5rem] cursor-pointer items-center gap-2 rounded-md border px-3 text-sm text-foreground transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${theme === choice ? "border-primary bg-primary/10" : "border-foreground/50"}`}
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={choice}
                        checked={theme === choice}
                        onChange={() => applyTheme(choice)}
                        className="h-4 w-4 accent-primary"
                      />
                      {choice[0].toUpperCase() + choice.slice(1)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p role="status" aria-label="Loading appearance preference" className="flex h-11 items-center text-sm text-muted-foreground">
                Loading appearance preference…
              </p>
            )}
          </div>
        </section>

        <ArchivedGoalsSection />

        <section aria-labelledby="install-heading" className={sectionClass}>
          <div className="space-y-1">
            <h2 id="install-heading" className={sectionTitleClass}>Install Monetigia</h2>
            <p className={sectionDescriptionClass}>Add a shortcut to your device when your browser supports it.</p>
          </div>
          <div className="space-y-3">
            {!install.ready ? (
              <p role="status" aria-label="Checking install options" className="text-sm text-muted-foreground">Checking install options…</p>
            ) : install.installed ? (
              <p role="status" className="text-sm font-medium text-foreground">This app is installed on this device.</p>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-foreground">
                  {install.iosSafari
                    ? "In Safari, tap Share, then Add to Home Screen."
                    : "Open your browser menu and choose Install app or Add to Home Screen when that option is available."}
                </p>
                {install.promptAvailable && (
                  <Button
                    type="button"
                    disabled={install.promptPending}
                    onClick={() => void install.requestInstall()}
                    className="h-11 min-w-36 bg-primary text-slate-950 hover:bg-primary/90 focus-visible:ring-primary"
                  >
                    {install.promptPending ? "Opening install prompt…" : "Install Monetigia"}
                  </Button>
                )}
              </>
            )}
            {install.status && !install.installed && <p role="status" className="text-sm text-foreground">{install.status}</p>}
            {install.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{install.error}</p>}
          </div>
        </section>

        <section aria-labelledby="account-heading" className={sectionClass}>
          <div className="space-y-1">
            <h2 id="account-heading" className={sectionTitleClass}>Account</h2>
            <p className={sectionDescriptionClass}>End this signed-in session on this device.</p>
          </div>
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
              className="h-11 min-w-32 border-foreground/50 text-foreground"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
            {accountError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{accountError}</p>}
          </div>
        </section>

        <section aria-labelledby="about-heading" className={sectionClass}>
          <div className="space-y-1">
            <h2 id="about-heading" className={sectionTitleClass}>About &amp; money rules</h2>
            <p className={sectionDescriptionClass}>How balances and goal progress work.</p>
          </div>
          <div className="space-y-4 text-sm leading-relaxed text-foreground">
            <p className="font-medium">Monetigia · Version {appPackage.version} · Philippine peso (PHP)</p>
            <ul className="space-y-3">
              <li>Actual is a wallet’s recorded balance. Reserved is money assigned to goals. Available equals Actual minus Reserved.</li>
              <li>Active goals count both reserved and spent amounts toward progress. Completed goals count only spent amounts.</li>
              <li>Goal reservations use active PHP wallets. Credit cards are excluded.</li>
              <li>Reserving money keeps it in the wallet but makes it unavailable for other spending. Spending from a goal counts against its reserved funds.</li>
              <li>Financial changes require an internet connection and are not queued offline.</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
