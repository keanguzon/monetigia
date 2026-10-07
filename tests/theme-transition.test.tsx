import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useThemeTransition } from "@/hooks/use-theme-transition";

const state = vi.hoisted(() => ({ theme: "dark", setTheme: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme: () => state }));
import { ModeToggle } from "@/components/ui/mode-toggle";

function SettingsChoice() {
  const { applyTheme } = useThemeTransition();
  return <button onClick={() => applyTheme("light")}>Settings light</button>;
}

beforeEach(() => {
  vi.useFakeTimers();
  state.setTheme.mockReset();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("both controls prepare the root before applying the latest selection and clean up", () => {
  render(<><SettingsChoice /><ModeToggle /></>);
  fireEvent.click(screen.getByText("Settings light"));
  expect(document.documentElement.classList.contains("theme-transitioning")).toBe(true);
  expect(state.setTheme).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(16));
  expect(state.setTheme).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
  act(() => vi.advanceTimersByTime(32));
  expect(state.setTheme).toHaveBeenCalledExactlyOnceWith("system");
  act(() => vi.advanceTimersByTime(159));
  expect(document.documentElement.classList.contains("theme-transitioning")).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
});

test("unmount cancels pending work and removes the transition class", () => {
  const view = render(<SettingsChoice />);
  fireEvent.click(screen.getByText("Settings light"));
  view.unmount();
  act(() => vi.runAllTimers());
  expect(state.setTheme).not.toHaveBeenCalled();
  expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
});

test("reduced motion applies immediately without a transition", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  render(<SettingsChoice />);
  fireEvent.click(screen.getByText("Settings light"));
  expect(state.setTheme).toHaveBeenCalledExactlyOnceWith("light");
  expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
});

test("selecting the current theme leaves persistence and transition untouched", () => {
  state.theme = "light";
  render(<SettingsChoice />);
  fireEvent.click(screen.getByText("Settings light"));
  expect(state.setTheme).not.toHaveBeenCalled();
  expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
  state.theme = "dark";
});

test("unmounting an older caller does not cancel the other control's latest choice", () => {
  const settings = render(<SettingsChoice />);
  render(<ModeToggle />);
  fireEvent.click(screen.getByText("Settings light"));
  fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
  settings.unmount();
  act(() => vi.advanceTimersByTime(32));
  expect(state.setTheme).toHaveBeenCalledExactlyOnceWith("system");
  act(() => vi.advanceTimersByTime(160));
  expect(document.documentElement.classList.contains("theme-transitioning")).toBe(false);
});
