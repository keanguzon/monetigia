export const REMEMBER_ME_KEY = "buko:remember-me";
export const TAB_SESSION_KEY = "buko:session-active";

export function getRememberMePreference(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(REMEMBER_ME_KEY) !== "0";
}

export function saveRememberMePreference(rememberMe: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "1" : "0");
  sessionStorage.setItem(TAB_SESSION_KEY, "1");
}

export function clearTabSessionMarker() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TAB_SESSION_KEY);
}
