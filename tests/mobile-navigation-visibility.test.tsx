import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useMobileNavigationVisibility } from "@/hooks/use-mobile-navigation-visibility";

function setVisualViewport(height: number, scale = 1) {
  const viewport = Object.assign(new EventTarget(), { height, scale });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  return viewport;
}

function setLayoutHeight(height: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  Reflect.deleteProperty(window, "visualViewport");
  vi.unstubAllGlobals();
});

test("detects visible modal roots, ignores hidden roots, and restores after they unmount", async () => {
  const dialog = document.createElement("section");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  const { result } = renderHook(() => useMobileNavigationVisibility());
  expect(result.current.blockedByModal).toBe(true);

  dialog.setAttribute("aria-hidden", "true");
  await waitFor(() => expect(result.current.blockedByModal).toBe(false));
  dialog.remove();

  const customOverlay = document.createElement("div");
  customOverlay.setAttribute("data-mobile-nav-blocking", "");
  document.body.append(customOverlay);
  await waitFor(() => expect(result.current.blockedByModal).toBe(true));
  customOverlay.remove();
  await waitFor(() => expect(result.current.blockedByModal).toBe(false));
});

test("a More menu by itself does not block mobile navigation", () => {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);

  const { result } = renderHook(() => useMobileNavigationVisibility());
  expect(result.current.blockedByModal).toBe(false);
});

test("hides for a focused editable field when the visual viewport loses keyboard height", () => {
  setLayoutHeight(800);
  const viewport = setVisualViewport(550);
  const input = document.createElement("input");
  document.body.append(input);
  const { result } = renderHook(() => useMobileNavigationVisibility());

  act(() => {
    input.focus();
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(result.current.keyboardOpen).toBe(true);

  act(() => {
    input.blur();
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(result.current.keyboardOpen).toBe(false);
});

test("does not hide for pinch zoom or viewport loss without editable focus", () => {
  setLayoutHeight(800);
  const viewport = setVisualViewport(550, 2);
  const input = document.createElement("input");
  document.body.append(input);
  const { result, rerender } = renderHook(() => useMobileNavigationVisibility());

  act(() => {
    input.focus();
    viewport.dispatchEvent(new Event("resize"));
  });
  expect(result.current.keyboardOpen).toBe(false);

  input.blur();
  Object.assign(viewport, { scale: 1 });
  act(() => viewport.dispatchEvent(new Event("resize")));
  rerender();
  expect(result.current.keyboardOpen).toBe(false);
});

test("is safe when VisualViewport is unavailable", () => {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  const input = document.createElement("input");
  document.body.append(input);
  const { result } = renderHook(() => useMobileNavigationVisibility());

  expect(result.current.keyboardOpen).toBe(false);
  expect(() => input.focus()).not.toThrow();
  expect(result.current.keyboardOpen).toBe(false);
});

test("disconnects observers and removes viewport and focus listeners on unmount", () => {
  setLayoutHeight(800);
  const viewport = setVisualViewport(550);
  const removeViewportListener = vi.spyOn(viewport, "removeEventListener");
  const disconnect = vi.fn();
  class MockMutationObserver {
    observe = vi.fn();
    disconnect = disconnect;
    constructor(_callback: MutationCallback) {}
  }
  vi.stubGlobal("MutationObserver", MockMutationObserver);
  const removeDocumentListener = vi.spyOn(document, "removeEventListener");
  const { unmount } = renderHook(() => useMobileNavigationVisibility());

  unmount();

  expect(disconnect).toHaveBeenCalledOnce();
  expect(removeViewportListener).toHaveBeenCalledWith("resize", expect.any(Function));
  expect(removeViewportListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  expect(removeDocumentListener).toHaveBeenCalledWith("focusin", expect.any(Function));
  expect(removeDocumentListener).toHaveBeenCalledWith("focusout", expect.any(Function));
});
