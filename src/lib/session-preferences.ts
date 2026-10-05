export const REMEMBER_ME_KEY = "monetigia:remember-me";
export const TAB_SESSION_KEY = "monetigia:session-active";

export const REMEMBER_ME_COOKIE = "monetigia-remember-me";
export const TAB_SESSION_COOKIE = "monetigia-tab-session";

export function getRememberMePreference(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(REMEMBER_ME_KEY) !== "0";
}

export function saveRememberMePreference(rememberMe: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "1" : "0");
  sessionStorage.setItem(TAB_SESSION_KEY, "1");

  // Keep cookies in sync for server and middleware access
  const maxAge = 60 * 60 * 24 * 365; // 1 year
  document.cookie = `${REMEMBER_ME_COOKIE}=${rememberMe ? "1" : "0"}; path=/; max-age=${maxAge}; SameSite=Lax`;
  document.cookie = `${TAB_SESSION_COOKIE}=1; path=/; SameSite=Lax`;
}

export function clearTabSessionMarker() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TAB_SESSION_KEY);
  document.cookie = `${TAB_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

