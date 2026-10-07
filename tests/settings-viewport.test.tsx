import { describe, expect, test, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Manrope: () => ({ className: "manrope", variable: "--font-manrope" }),
  Bricolage_Grotesque: () => ({ className: "bricolage", variable: "--font-bricolage" }),
}));
vi.mock("@/app/globals.css", () => ({}));
vi.mock("@/app/landing.css", () => ({}));

import { viewport } from "@/app/layout";

describe("Settings viewport accessibility", () => {
  test("leaves browser zoom available for users who need magnification", () => {
    expect(viewport.maximumScale).toBeUndefined();
    expect(viewport.userScalable).toBeUndefined();
  });
});
