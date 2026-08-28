/**
 * Normalise user input into a YouTube `contentTarget` value.
 *
 * Accepts a bare 11 character video id, a watch URL, a youtu.be short link, a
 * shorts link, an embed link, or free text (treated as a search query).
 */
export type YouTubeTarget =
  | { kind: "video"; videoId: string; contentTarget: string }
  | { kind: "search"; query: string; contentTarget: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (VIDEO_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return VIDEO_ID.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") {
    return null;
  }

  const v = url.searchParams.get("v");
  if (v && VIDEO_ID.test(v)) return v;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && ["shorts", "embed", "v", "live"].includes(segments[0])) {
    const id = segments[1];
    return VIDEO_ID.test(id) ? id : null;
  }
  return null;
}

export function normaliseYouTubeInput(input: string): YouTubeTarget | null {
  const value = input.trim();
  if (!value) return null;

  const videoId = extractVideoId(value);
  if (videoId) {
    return { kind: "video", videoId, contentTarget: `v=${videoId}` };
  }
  return { kind: "search", query: value, contentTarget: `q=${encodeURIComponent(value)}` };
}
