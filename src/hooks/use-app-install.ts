"use client";

import { useEffect, useRef, useState } from "react";

type InstallOutcome = { outcome: "accepted" | "dismissed" };

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallOutcome>;
};

function isIosSafari(userAgent: string, platform: string, touchPoints: number) {
  const isIos = /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === "MacIntel" && touchPoints > 1);
  const isSafari = /Safari/i.test(userAgent) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/i.test(userAgent);
  return isIos && isSafari;
}

export function useAppInstall() {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);
  const [promptAvailable, setPromptAvailable] = useState(false);
  const [promptPending, setPromptPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const deferredPrompt = useRef<DeferredInstallPrompt | null>(null);
  const installedRef = useRef(false);

  useEffect(() => {
    const displayMode = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const alreadyInstalled = displayMode || standalone;
    installedRef.current = alreadyInstalled;
    setInstalled(alreadyInstalled);
    setIosSafari(isIosSafari(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as DeferredInstallPrompt;
      setPromptAvailable(true);
      setStatus("");
      setError("");
    };

    const onAppInstalled = () => {
      installedRef.current = true;
      deferredPrompt.current = null;
      setPromptAvailable(false);
      setInstalled(true);
      setError("");
      setStatus("This app is installed on this device.");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    setReady(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const requestInstall = async () => {
    const prompt = deferredPrompt.current;
    if (!prompt || promptPending || installedRef.current) return;

    setPromptPending(true);
    setStatus("");
    setError("");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      deferredPrompt.current = null;
      setPromptAvailable(false);
      if (installedRef.current) return;
      setStatus(choice.outcome === "accepted"
        ? "Install prompt accepted. Follow any remaining browser steps."
        : "Install prompt dismissed. You can install later from the browser menu.");
    } catch {
      deferredPrompt.current = null;
      setPromptAvailable(false);
      if (!installedRef.current) {
        setError("Could not open the install prompt. Use your browser menu to install Monetigia.");
      }
    } finally {
      setPromptPending(false);
    }
  };

  return {
    ready,
    installed,
    iosSafari,
    promptAvailable: ready && promptAvailable && !installed,
    promptPending,
    status,
    error,
    requestInstall,
  };
}
