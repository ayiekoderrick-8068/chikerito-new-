import { describe, expect, it } from "vitest";
import { analyticsPreset, rangeLabel, shiftDays, startOfMonth, startOfYear } from "../src/analyticsPresets.js";

describe("analytics date presets", () => {
  const today = new Date("2026-08-18T15:30:00.000Z");

  it("shifts dates backward", () => expect(shiftDays("2026-08-18", -1)).toBe("2026-08-17"));
  it("shifts dates forward", () => expect(shiftDays("2026-08-18", 10)).toBe("2026-08-28"));
  it("crosses month boundaries", () => expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28"));
  it("crosses leap-day boundaries", () => expect(shiftDays("2024-03-01", -1)).toBe("2024-02-29"));
  it("finds the start of a month", () => expect(startOfMonth("2026-08-18")).toBe("2026-08-01"));
  it("finds the start of a year", () => expect(startOfYear("2026-08-18")).toBe("2026-01-01"));
  it("builds this-month range", () => expect(analyticsPreset("this-month", today)).toEqual({ from: "2026-08-01", to: "2026-08-18" }));
  it("builds an inclusive 30-day range", () => expect(analyticsPreset("last-30-days", today)).toEqual({ from: "2026-07-20", to: "2026-08-18" }));
  it("builds year-to-date range", () => expect(analyticsPreset("year-to-date", today)).toEqual({ from: "2026-01-01", to: "2026-08-18" }));
  it("builds all-time range", () => expect(analyticsPreset("all-time", today)).toEqual({ from: "", to: "" }));
  it("rejects unknown presets", () => expect(() => analyticsPreset("quarter", today)).toThrow("Unknown analytics preset"));
  it("labels all-time ranges", () => expect(rangeLabel({ from: null, to: null })).toBe("All time"));
  it("labels complete ranges", () => expect(rangeLabel({ from: "2026-01-01", to: "2026-01-31" })).toBe("2026-01-01 to 2026-01-31"));
  it("labels open-ended starts", () => expect(rangeLabel({ from: "2026-01-01", to: null })).toBe("Since 2026-01-01"));
  it("labels open-ended ends", () => expect(rangeLabel({ from: null, to: "2026-01-31" })).toBe("Through 2026-01-31"));
});
