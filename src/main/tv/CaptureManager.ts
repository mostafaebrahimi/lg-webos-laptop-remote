import { promises as fs } from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";

export interface CaptureResult {
  /** JPEG bytes as a data URL, ready for an <img src>. */
  dataUrl: string;
  bytes: number;
}

export interface RecordingResult {
  frames: number;
  frameDir: string;
  /** Set when ffmpeg was available and encoding succeeded. */
  videoPath?: string;
  durationMs: number;
}

/**
 * webOS 5.0 exposes a one-shot screen capture (`ssap://tv/executeOneShot`) but no
 * video recording service, so "recording" here is a timed burst of captures that
 * is encoded into an MP4 afterwards when ffmpeg is present.
 */
export class CaptureManager {
  private timer: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private frameDir: string | null = null;
  private startedAt = 0;
  private inFlight = false;

  constructor(
    private readonly capturesDir: string,
    private readonly takeShot: () => Promise<Buffer>,
    private readonly onProgress: (frames: number) => void,
  ) {}

  get recording(): boolean {
    return this.timer !== null;
  }

  get frameCount(): number {
    return this.frameIndex;
  }

  /** Download the TV's capture image. The TV serves it with a self-signed cert. */
  static download(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https:") ? https : http;
      const request = client.get(url, { rejectUnauthorized: false, timeout: 10_000 }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`The TV returned HTTP ${response.statusCode} for the capture image.`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      });
      request.on("timeout", () => request.destroy(new Error("Timed out downloading the capture image.")));
      request.on("error", reject);
    });
  }

  async single(): Promise<CaptureResult> {
    const buffer = await this.takeShot();
    return { dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`, bytes: buffer.length };
  }

  async saveTo(file: string): Promise<string> {
    const buffer = await this.takeShot();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    return file;
  }

  async start(fps: number, timestamp: string): Promise<void> {
    if (this.timer) throw new Error("A recording is already running.");
    const safeFps = Math.min(5, Math.max(1, Math.round(fps)));
    this.frameDir = path.join(this.capturesDir, `recording-${timestamp}`);
    await fs.mkdir(this.frameDir, { recursive: true });
    this.frameIndex = 0;
    this.startedAt = Date.now();

    const interval = Math.round(1000 / safeFps);
    this.timer = setInterval(() => {
      // Skip a tick rather than queueing when the TV is slower than the interval.
      if (this.inFlight) return;
      this.inFlight = true;
      void this.takeShot()
        .then(async (buffer) => {
          if (!this.frameDir) return;
          const name = `frame-${String(this.frameIndex).padStart(5, "0")}.jpg`;
          await fs.writeFile(path.join(this.frameDir, name), buffer);
          this.frameIndex += 1;
          this.onProgress(this.frameIndex);
        })
        .catch(() => {
          /* a dropped frame must not stop the recording */
        })
        .finally(() => {
          this.inFlight = false;
        });
    }, interval);
  }

  async stop(fps: number): Promise<RecordingResult> {
    if (!this.timer || !this.frameDir) throw new Error("No recording is running.");
    clearInterval(this.timer);
    this.timer = null;

    const frameDir = this.frameDir;
    const frames = this.frameIndex;
    const durationMs = Date.now() - this.startedAt;
    this.frameDir = null;
    this.onProgress(0);

    if (frames === 0) {
      await fs.rm(frameDir, { recursive: true, force: true });
      throw new Error("No frames were captured.");
    }

    const videoPath = await encodeVideo(frameDir, Math.min(5, Math.max(1, Math.round(fps))));
    return { frames, frameDir, videoPath, durationMs };
  }

  cancel(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.frameDir = null;
    this.frameIndex = 0;
  }
}

/** Encode the captured frames into an animated GIF, for sharing a short clip. */
export function encodeGif(frameDir: string, fps: number): Promise<string | undefined> {
  const output = path.join(frameDir, "recording.gif");
  return new Promise((resolve) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-framerate", String(fps),
        "-i", path.join(frameDir, "frame-%05d.jpg"),
        // A generated palette keeps colour banding out of the result.
        "-vf", "fps=" + fps + ",scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
        output,
      ],
      { stdio: "ignore" },
    );
    ffmpeg.on("error", () => resolve(undefined));
    ffmpeg.on("close", (code) => resolve(code === 0 ? output : undefined));
  });
}

/** Encode the captured frames with ffmpeg. Returns undefined when it is absent. */
function encodeVideo(frameDir: string, fps: number): Promise<string | undefined> {
  const output = path.join(frameDir, "recording.mp4");
  return new Promise((resolve) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-framerate", String(fps),
        "-i", path.join(frameDir, "frame-%05d.jpg"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        // H.264 requires even dimensions.
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        output,
      ],
      { stdio: "ignore" },
    );
    ffmpeg.on("error", () => resolve(undefined));
    ffmpeg.on("close", (code) => resolve(code === 0 ? output : undefined));
  });
}
