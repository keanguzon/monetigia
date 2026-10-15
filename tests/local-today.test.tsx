import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLocalToday } from "@/hooks/use-local-today";
import { periodContaining, toLocalDateString } from "@/lib/spending/periods";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("updates at local midnight across a month boundary", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 59));
  const { result } = renderHook(useLocalToday);
  expect(toLocalDateString(result.current)).toBe("2026-09-30");
  act(() => { vi.advanceTimersByTime(1000); });
  expect(toLocalDateString(result.current)).toBe("2026-10-01");
});

it("refreshes a throttled tab on focus and visibility return across cutoffs", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 15, 12));
  const { result } = renderHook(useLocalToday);
  act(() => { vi.setSystemTime(new Date(2026, 9, 16, 12)); window.dispatchEvent(new Event("focus")); });
  expect(periodContaining(result.current, "second_half").start).toBe("2026-10-16");
  act(() => { vi.setSystemTime(new Date(2026, 10, 1, 12)); document.dispatchEvent(new Event("visibilitychange")); });
  expect(toLocalDateString(result.current)).toBe("2026-11-01");
});

it("cleans up its timer and listeners on unmount", () => {
  vi.useFakeTimers();
  const windowRemove = vi.spyOn(window, "removeEventListener");
  const documentRemove = vi.spyOn(document, "removeEventListener");
  const { unmount } = renderHook(useLocalToday);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(windowRemove).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(documentRemove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
});

it.skipIf(process.env.TZ !== "America/Los_Angeles")("waits for the real local midnight across a 25-hour DST day", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 1));
  const { result } = renderHook(useLocalToday);
  act(() => { vi.advanceTimersByTime(24 * 60 * 60 * 1000); });
  expect(toLocalDateString(result.current)).toBe("2026-11-01");
  act(() => { vi.advanceTimersByTime(60 * 60 * 1000); });
  expect(toLocalDateString(result.current)).toBe("2026-11-02");
});
