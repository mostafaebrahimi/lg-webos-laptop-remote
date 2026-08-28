import { describe, expect, it } from "vitest";
import { chunkText, codePointLength } from "../../src/main/util/text";

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("hello", 10)).toEqual(["hello"]);
    expect(chunkText("", 10)).toEqual([]);
  });

  it("splits on code point boundaries", () => {
    expect(chunkText("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
  });

  it("never splits a surrogate pair", () => {
    // Each emoji is two UTF-16 units but one code point.
    const text = "😀😀😀";
    const chunks = chunkText(text, 2);
    expect(chunks).toEqual(["😀😀", "😀"]);
    for (const chunk of chunks) {
      expect(chunk).toEqual([...chunk].join(""));
    }
  });

  it("preserves Persian text unchanged when joined", () => {
    const persian = "سلام دنیا";
    expect(chunkText(persian, 3).join("")).toBe(persian);
  });

  it("rejects a non-positive size", () => {
    expect(() => chunkText("abc", 0)).toThrow(RangeError);
  });
});

describe("codePointLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect("😀".length).toBe(2);
    expect(codePointLength("😀")).toBe(1);
    expect(codePointLength("سلام")).toBe(4);
  });
});
