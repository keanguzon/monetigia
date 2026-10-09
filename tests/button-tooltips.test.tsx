import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ButtonTooltips } from "@/components/ui/button-tooltips";
import Tooltip from "@/components/ui/tooltip";

afterEach(cleanup);

test("button hints use one styled tooltip on hover and keyboard focus", () => {
  render(<><ButtonTooltips /><button data-tooltip="Select all">Select</button></>);
  const button = screen.getByRole("button");
  expect(button.hasAttribute("title")).toBe(false);
  fireEvent.pointerOver(button);
  expect(screen.getByRole("tooltip").textContent).toBe("Select all");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focusIn(button);
  expect(screen.getByRole("tooltip").textContent).toBe("Select all");
  fireEvent.focusOut(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("existing multiline hints use the same tooltip without a duplicate", () => {
  render(<><ButtonTooltips /><Tooltip content={"Delete transaction\nRevert balances"}><button>Delete</button></Tooltip></>);
  fireEvent.pointerOver(screen.getByRole("button"));
  expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  expect(screen.getByRole("tooltip").textContent).toBe("Delete transaction\nRevert balances");
});
