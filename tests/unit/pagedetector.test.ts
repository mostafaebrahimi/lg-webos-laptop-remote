import { describe, expect, it } from "vitest";
import { PageDetector } from "../../src/main/tv/keyboards/PageDetector";

/**
 * The fingerprinting itself needs Electron's image decoder, so these cover the
 * pure comparison logic. Real captures were measured separately: two captures of
 * the same keyboard page scored 0, different screens scored 44 to 167 out of 256.
 */
describe("PageDetector.distance", () => {
  it("is zero for identical fingerprints", () => {
    expect(PageDetector.distance("1010", "1010")).toBe(0);
  });

  it("counts differing bits", () => {
    expect(PageDetector.distance("1111", "1010")).toBe(2);
    expect(PageDetector.distance("0000", "1111")).toBe(4);
  });

  it("treats mismatched lengths as incomparable", () => {
    expect(PageDetector.distance("101", "1010")).toBe(Number.POSITIVE_INFINITY);
  });
});
