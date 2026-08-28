import { describe, expect, it } from "vitest";
import { extractVideoId, normaliseYouTubeInput } from "../../src/main/util/youtube";

describe("extractVideoId", () => {
  const id = "dQw4w9WgXcQ";
  it.each([
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `m.youtube.com/watch?v=${id}`,
  ])("extracts from %s", (input) => {
    expect(extractVideoId(input)).toBe(id);
  });

  it("rejects non-YouTube and free text", () => {
    expect(extractVideoId("https://vimeo.com/12345")).toBeNull();
    expect(extractVideoId("cat videos")).toBeNull();
    expect(extractVideoId("")).toBeNull();
  });
});

describe("normaliseYouTubeInput", () => {
  it("builds a v= target for a video", () => {
    expect(normaliseYouTubeInput("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      kind: "video",
      videoId: "dQw4w9WgXcQ",
      contentTarget: "v=dQw4w9WgXcQ",
    });
  });

  it("builds an encoded q= target for free text", () => {
    const result = normaliseYouTubeInput("lo-fi beats");
    expect(result).toEqual({ kind: "search", query: "lo-fi beats", contentTarget: "q=lo-fi%20beats" });
  });

  it("returns null for empty input", () => {
    expect(normaliseYouTubeInput("   ")).toBeNull();
  });
});
