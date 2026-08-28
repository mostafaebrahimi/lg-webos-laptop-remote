import { spawn } from "node:child_process";
import path from "node:path";

/** What has to happen to a file before this TV can play it. */
export type PlayPlan = "direct" | "remux" | "transcode";

export interface MediaInfo {
  path: string;
  name: string;
  durationSeconds: number | null;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  plan: PlayPlan;
  /** Why that plan was chosen, shown in the UI. */
  reason: string;
  mimeType: string;
}

/**
 * Containers the TV's ConnectionManager advertises, mapped to the MIME type it
 * expects in the DLNA metadata.
 */
const CONTAINER_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  mkv: "video/x-matroska",
  avi: "video/avi",
  ts: "video/mp2t",
  m2ts: "video/mp2t",
  mts: "video/mts",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  wmv: "video/x-ms-wmv",
  asf: "video/x-ms-asf",
};

/** Codecs LG webOS decodes. Anything else has to be re-encoded. */
const VIDEO_OK = new Set(["h264", "hevc", "mpeg2video", "mpeg4", "vc1", "vp8", "vp9", "av1", "wmv3", "msmpeg4v3"]);
const AUDIO_OK = new Set(["aac", "ac3", "eac3", "mp3", "mp2", "flac", "vorbis", "opus", "pcm_s16le", "wmav2", "dts"]);

export async function probeMedia(file: string): Promise<MediaInfo> {
  const raw = await runFfprobe(file);
  const streams: any[] = raw.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");

  const extension = path.extname(file).replace(".", "").toLowerCase();
  const containerOk = extension in CONTAINER_MIME;
  const videoCodec = video?.codec_name ?? null;
  const audioCodec = audio?.codec_name ?? null;
  const videoOk = !videoCodec || VIDEO_OK.has(videoCodec);
  const audioOk = !audioCodec || AUDIO_OK.has(audioCodec);

  let plan: PlayPlan;
  let reason: string;
  if (videoOk && audioOk && containerOk) {
    plan = "direct";
    reason = "The TV accepts this container and both codecs — it streams untouched.";
  } else if (videoOk && audioOk) {
    plan = "remux";
    reason = `The codecs are fine but the TV does not accept .${extension || "?"} — repackaging into MKV, which is lossless and quick.`;
  } else {
    plan = "transcode";
    const bad = [!videoOk ? `video (${videoCodec})` : null, !audioOk ? `audio (${audioCodec})` : null]
      .filter(Boolean)
      .join(" and ");
    reason = `The TV cannot decode the ${bad}, so it has to be re-encoded. This is slow and loses some quality.`;
  }

  return {
    path: file,
    name: path.basename(file),
    durationSeconds: raw.format?.duration ? Number(raw.format.duration) : null,
    container: extension || "unknown",
    videoCodec,
    audioCodec,
    width: video?.width ?? null,
    height: video?.height ?? null,
    plan,
    reason,
    mimeType: plan === "direct" ? (CONTAINER_MIME[extension] ?? "video/mp4") : "video/x-matroska",
  };
}

function runFfprobe(file: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const probe = spawn("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      file,
    ]);
    let output = "";
    let error = "";
    probe.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    probe.stderr.on("data", (chunk: Buffer) => (error += chunk.toString()));
    probe.on("error", () => reject(new Error("ffprobe is not installed, so the file cannot be inspected.")));
    probe.on("close", (code) => {
      if (code !== 0) return reject(new Error(error.trim().slice(0, 200) || "ffprobe failed"));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("ffprobe returned something unreadable."));
      }
    });
  });
}
