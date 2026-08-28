import { describe, expect, it } from "vitest";
import { clampDelta } from "../../src/main/tv/PointerSocketManager";

describe("clampDelta", () => {
  it("bounds runaway deltas in both directions", () => {
    expect(clampDelta(5000)).toBe(500);
    expect(clampDelta(-5000)).toBe(-500);
  });

  it("truncates to whole pixels", () => {
    expect(clampDelta(12.7)).toBe(12);
    expect(clampDelta(-12.7)).toBe(-12);
  });

  it("treats non-finite values as no movement", () => {
    expect(clampDelta(Number.NaN)).toBe(0);
    expect(clampDelta(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
