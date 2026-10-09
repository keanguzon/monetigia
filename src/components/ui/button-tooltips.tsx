"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ButtonTooltips() {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    function show(event: Event) {
      if (typeof PointerEvent !== "undefined" && event instanceof PointerEvent && event.pointerType === "touch") return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tooltip]") : null;
      if (!target) { setTooltip(null); return; }
      const text = target.dataset.tooltip;
      if (!text) { setTooltip(null); return; }
      const rect = target.getBoundingClientRect();
      setTooltip({ text, x: Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2)), y: rect.top });
    }
    function hide() { setTooltip(null); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") hide(); }
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("click", hide);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("click", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!tooltip) return null;
  return createPortal(<div role="tooltip" className="pointer-events-none fixed z-[100] max-w-[calc(100vw-1rem)] -translate-x-1/2 whitespace-pre-line rounded bg-slate-900 px-2 py-1 text-center text-xs text-white shadow-lg" style={{ left: tooltip.x, top: Math.max(8, tooltip.y - 8), transform: tooltip.y > 64 ? "translate(-50%, -100%)" : "translate(-50%, 0)" }}>{tooltip.text}</div>, document.body);
}
