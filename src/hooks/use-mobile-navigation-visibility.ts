"use client";

import { useEffect, useState } from "react";

function isEditableTarget(target: Element | null): boolean {
  if (target instanceof HTMLInputElement) {
    return !target.disabled && !target.readOnly && ![
      "button",
      "checkbox",
      "image",
      "radio",
      "reset",
      "submit",
      "hidden",
    ].includes(target.type);
  }

  if (target instanceof HTMLTextAreaElement) {
    return !target.disabled && !target.readOnly;
  }

  if (target instanceof HTMLElement) {
    const editableHost = target.closest("[contenteditable]");
    return Boolean(editableHost && editableHost.getAttribute("contenteditable") !== "false");
  }

  return false;
}

function isHidden(node: Element): boolean {
  let current: Element | null = node;

  while (current) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") {
      return true;
    }

    if (current instanceof HTMLElement) {
      const styles = window.getComputedStyle(current);
      if (styles.display === "none" || styles.visibility === "hidden" || styles.visibility === "collapse") {
        return true;
      }
    }

    current = current.parentElement;
  }

  return false;
}

export function useMobileNavigationVisibility(): { blockedByModal: boolean; keyboardOpen: boolean } {
  const [blockedByModal, setBlockedByModal] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const scan = () => {
      const modalRoots = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], [data-mobile-nav-blocking]'
      );
      setBlockedByModal(Array.from(modalRoots).some((node) => !isHidden(node)));
    };

    if (typeof MutationObserver === "undefined") {
      scan();
      return;
    }

    const observer = new MutationObserver(scan);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["role", "aria-modal", "hidden", "aria-hidden", "data-state", "data-mobile-nav-blocking"],
      childList: true,
      subtree: true,
    });
    scan();

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      setKeyboardOpen(false);
      return;
    }

    const update = () => {
      const viewportLoss = window.innerHeight - viewport.height;
      const scaleIsUnchanged = Math.abs(viewport.scale - 1) <= 0.05;
      setKeyboardOpen(
        isEditableTarget(document.activeElement) && scaleIsUnchanged && viewportLoss > 120
      );
    };

    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    update();

    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return { blockedByModal, keyboardOpen };
}
