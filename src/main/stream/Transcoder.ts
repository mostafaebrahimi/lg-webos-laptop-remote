import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PlayPlan } from "./MediaProbe";

export interface PrepareProgress {
  /** 0..1, or null while ffmpeg has not reported a timestamp yet. */
  ratio: number | null;
  seconds: number;
}

/**
 * Prepares a file the TV cannot play as it stands.
 *
 * A remux rewrites the container and copies the streams untouched — quick and
 * lossless. A transcode re-encodes, which is slow, so the caller gets progress
 * and can cancel. Either way the output is a complete file on disk, because
 * serving a live ffmpeg pipe would break byte ranges and therefore seeking.
 */
export class Transcoder {
  private process: ChildProcess | null = null;
  private cancelled = false;

  constructor(private readonly workDir: string) {}

  get running(): boolean {
    return this.process !== null;
  }

  cancel(): void {
    this.cancelled = true;
    this.process?.kill("SIGKILL");
    this.process = null;
  }

  async prepare(
    input: string,
    plan: PlayPlan,
    durationSeconds: number | null,
    onProgress: (progress: PrepareProgress) => void,
  ): Promise<string> {
    if (plan === "direct") return input;

    this.cancelled = false;
    await fs.mkdir(this.workDir, { recursive: true });
    const output = path.join(this.workDir, `prepared-${path.parse(input).name}.mkv`);

    const args =
      plan === "remux"
        ? ["-y", "-i", input, "-c", "copy", "-map", "0", output]
        : [
            "-y",
            "-i", input,
            // H.264 + AAC in MKV is the safest combination this TV lists.
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-map", "0:v:0", "-map", "0:a:0?",
            output,
          ];

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", ["-progress", "pipe:2", "-nostats", ...args]);
      this.process = ffmpeg;

      let stderr = "";
      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr = (stderr + text).slice(-4000);
        // -progress writes `out_time_us=123456789` lines.
        const match = /out_time_us=(\d+)/.exec(text);
        if (match) {
          const seconds = Number(match[1]) / 1_000_000;
          onProgress({ seconds, ratio: durationSeconds ? Math.min(1, seconds / durationSeconds) : null });
        }
      });

      ffmpeg.on("error", () => reject(new Error("ffmpeg is not installed, so this file cannot be converted.")));
      ffmpeg.on("close", (code) => {
        this.process = null;
        if (this.cancelled) return reject(new Error("Conversion cancelled."));
        if (code === 0) return resolve();
        const detail = /(Error|Invalid|Unknown|No such)[^\n]*/i.exec(stderr)?.[0] ?? `ffmpeg exited ${code}`;
        reject(new Error(detail.slice(0, 200)));
      });
    });

    return output;
  }

  /** Remove files this class created; never the user's original. */
  async cleanup(): Promise<void> {
    await fs.rm(this.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
