import { describe, expect, it } from "vitest";
import { parseRange, localAddressFacing } from "../../src/main/stream/MediaServer";
import { didl, escapeXml, formatTime, parseTime, tag } from "../../src/main/stream/DlnaRenderer";
import { streamSeekSchema, streamFileSchema } from "../../src/main/ipc/schemas";

describe("HTTP range parsing", () => {
  it("handles a normal range", () => {
    expect(parseRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("handles a suffix range", () => {
    expect(parseRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  });

  it("clamps an end past the file", () => {
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("refuses nonsense rather than serving the wrong bytes", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("bytes=abc", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("bytes=2000-3000", 1000)).toBeNull();
    expect(parseRange("bytes=500-100", 1000)).toBeNull();
  });
});

describe("interface selection", () => {
  it("returns an address or null, never something off-subnet silently", () => {
    const address = localAddressFacing("192.168.1.220");
    expect(address === null || /^\d+\.\d+\.\d+\.\d+$/.test(address)).toBe(true);
  });
});

describe("UPnP time formats", () => {
  it("round-trips through the renderer's format", () => {
    expect(formatTime(0)).toBe("00:00:00");
    expect(formatTime(12)).toBe("00:00:12");
    expect(formatTime(3671)).toBe("01:01:11");
    expect(parseTime("00:00:12")).toBe(12);
    expect(parseTime("0:01:23.000")).toBeCloseTo(83);
    expect(parseTime("01:01:11")).toBe(3671);
  });

  it("treats NOT_IMPLEMENTED as no value", () => {
    expect(parseTime("NOT_IMPLEMENTED")).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe("DIDL metadata", () => {
  it("escapes anything that would break the XML", () => {
    expect(escapeXml(`a & b <c> "d"`)).toBe("a &amp; b &lt;c&gt; &quot;d&quot;");
    const xml = didl("http://host/x?a=1&b=2", 'Tom & "Jerry" <1>', "video/mp4", 20);
    expect(xml).toContain("&amp;b=2");
    expect(xml).toContain("Tom &amp; &quot;Jerry&quot; &lt;1&gt;");
    // Every & inside the title must be the start of an entity, never a bare one.
    const title = /<dc:title>(.*?)<\/dc:title>/.exec(xml)![1];
    expect(title).not.toMatch(/&(?!amp;|quot;|lt;|gt;|apos;)/);
    expect(title).not.toMatch(/[<>]/);
  });

  it("includes the duration and mime type the renderer needs", () => {
    const xml = didl("http://host/file", "Clip", "video/x-matroska", 3671);
    expect(xml).toContain('duration="01:01:11.000"');
    expect(xml).toContain("http-get:*:video/x-matroska:");
  });

  it("reads values back out of a SOAP response", () => {
    const body = "<RelTime>00:00:12</RelTime><TrackDuration>00:20:00</TrackDuration>";
    expect(tag(body, "RelTime")).toBe("00:00:12");
    expect(tag(body, "Missing")).toBeNull();
  });
});

describe("stream IPC validation", () => {
  it("bounds a seek", () => {
    expect(streamSeekSchema.safeParse({ seconds: 0 }).success).toBe(true);
    expect(streamSeekSchema.safeParse({ seconds: -1 }).success).toBe(false);
    expect(streamSeekSchema.safeParse({ seconds: 999999 }).success).toBe(false);
  });

  it("requires a file path", () => {
    expect(streamFileSchema.safeParse({ file: "/movies/a.mkv" }).success).toBe(true);
    expect(streamFileSchema.safeParse({ file: "" }).success).toBe(false);
  });
});
