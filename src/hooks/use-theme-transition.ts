"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

// Both controls coordinate one transition so an older request cannot end a newer fade.
let pending: { cancel: () => void } | null = null;

export function useThemeTransition() {
  const themeState = useTheme();
  const owned = useRef<(() => void) | null>(null);
  useEffect(() => () => owned.current?.(), []);

  const applyTheme = (choice: string) => {
    const hadPending = pending !== null;
    pending?.cancel();
    if (choice === themeState.theme && !hadPending) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      themeState.setTheme(choice);
      return;
    }

    const root = document.documentElement;
    let frame: number | null = null;
    let timer: number | null = null;
    const request = { cancel: () => {
      if (pending !== request) return;
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
      root.classList.remove("theme-transitioning");
      pending = null;
    } };
    pending = request;
    owned.current = request.cancel;
    root.classList.add("theme-transitioning");
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        frame = null;
        themeState.setTheme(choice);
        timer = window.setTimeout(request.cancel, 160);
      });
    });
  };

  return { ...themeState, applyTheme };
}
