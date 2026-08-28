import path from "node:path";
import { EventEmitter } from "node:events";
import type { MediaInfo } from "./MediaProbe";
import { probeMedia } from "./MediaProbe";
import { MediaServer } from "./MediaServer";
import { Transcoder } from "./Transcoder";
import { DlnaRenderer, type RendererDescription } from "./DlnaRenderer";
import { sanitiseError } from "../util/errors";

export type StreamPhase = "idle" | "analysing" | "preparing" | "starting" | "playing" | "paused" | "error";

export interface StreamStatus {
  phase: StreamPhase;
  message: string;
  file: string | null;
  media: MediaInfo | null;
  /** 0..1 while converting. */
  prepareRatio: number | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  rendererName: string | null;
  /** True while this app has a listening socket open. */
  serving: boolean;
}

/**
 * Plays a file from this computer on the television.
 *
 * The file is served over HTTP to the TV alone, and the TV is told to fetch it
 * over UPnP AVTransport — the same mechanism desktop players use for "play on
 * TV". The TV does the decoding, so there is no quality loss for formats it
 * already understands.
 */
export class StreamManager extends EventEmitter {
  private server: MediaServer | null = null;
  private transcoder: Transcoder | null = null;
  private renderer: DlnaRenderer | null = null;
  private description: RendererDescription | null = null;
  private poll: NodeJS.Timeout | null = null;
  private status: StreamStatus = emptyStatus();

  constructor(private readonly workDir: string) {
    super();
  }

  getStatus(): StreamStatus {
    return this.status;
  }

  /** Inspect a file and say what will happen to it, without starting anything. */
  async analyse(file: string): Promise<MediaInfo> {
    this.patch({ phase: "analysing", message: `Inspecting ${path.basename(file)}…`, file });
    try {
      const media = await probeMedia(file);
      this.patch({ phase: "idle", message: media.reason, media });
      return media;
    } catch (error) {
      const { message } = sanitiseError(error);
      this.patch({ phase: "error", message });
      throw new Error(message);
    }
  }

  async start(host: string, file: string): Promise<void> {
    await this.stop();

    try {
      const media = this.status.media?.path === file ? this.status.media : await this.analyse(file);

      // Find the TV's own media renderer.
      this.patch({ phase: "starting", message: "Looking for the TV's media renderer…", file, media });
      this.description ??= await DlnaRenderer.discover(host);
      if (!this.description) {
        throw new Error(
          "The TV did not answer as a media renderer. Check that it is on the same network and that DLNA is not disabled.",
        );
      }
      this.renderer = new DlnaRenderer(this.description);

      // Convert first when the TV cannot play the file as it stands.
      let servedPath = file;
      if (media.plan !== "direct") {
        this.transcoder = new Transcoder(this.workDir);
        this.patch({
          phase: "preparing",
          message: media.plan === "remux" ? "Repackaging for the TV…" : "Re-encoding for the TV…",
          prepareRatio: 0,
        });
        servedPath = await this.transcoder.prepare(file, media.plan, media.durationSeconds, (progress) =>
          this.patch({ prepareRatio: progress.ratio }),
        );
      }

      // Serve it to the TV and nothing else.
      this.server = new MediaServer(host);
      const served = await this.server.serve(servedPath, media.mimeType);
      this.patch({ phase: "starting", message: "Handing the file to the TV…", serving: true, prepareRatio: null });

      await this.renderer.setUri(served.url, media.name, media.mimeType, media.durationSeconds);
      await this.renderer.play();

      this.patch({
        phase: "playing",
        message: `Playing on ${this.renderer.name}`,
        rendererName: this.renderer.name,
        durationSeconds: media.durationSeconds,
      });
      this.startPolling();
    } catch (error) {
      const { message } = sanitiseError(error);
      await this.stop();
      this.patch({
        phase: "error",
        message: message.includes("refused Play")
          ? `${message} — if the TV is asking to allow this device, accept the prompt on screen and try again.`
          : message,
      });
      throw new Error(message);
    }
  }

  async pause(): Promise<void> {
    await this.renderer?.pause();
    this.patch({ phase: "paused", message: "Paused" });
  }

  async resume(): Promise<void> {
    await this.renderer?.play();
    this.patch({ phase: "playing", message: "Playing" });
  }

  async seek(seconds: number): Promise<void> {
    await this.renderer?.seek(seconds);
    this.patch({ positionSeconds: seconds });
  }

  async stop(): Promise<void> {
    this.stopPolling();
    try {
      await this.renderer?.stop();
    } catch {
      // The TV may already have dropped the session.
    }
    this.renderer = null;
    this.transcoder?.cancel();
    await this.transcoder?.cleanup();
    this.transcoder = null;
    await this.server?.stop();
    this.server = null;
    this.patch({
      phase: "idle",
      message: "Stopped",
      serving: false,
      positionSeconds: null,
      prepareRatio: null,
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.poll = setInterval(() => {
      void this.renderer
        ?.position()
        .then((position) => {
          const finished = position.state === "STOPPED" || position.state === "NO_MEDIA_PRESENT";
          this.patch({
            positionSeconds: position.position,
            durationSeconds: position.duration ?? this.status.durationSeconds,
            phase: position.state === "PAUSED_PLAYBACK" ? "paused" : finished ? "idle" : "playing",
            message: finished ? "Finished" : this.status.message,
          });
          if (finished) void this.stop();
        })
        .catch(() => undefined);
    }, 2000);
  }

  private stopPolling(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  private patch(patch: Partial<StreamStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.status);
  }
}

export function emptyStatus(): StreamStatus {
  return {
    phase: "idle",
    message: "Nothing playing",
    file: null,
    media: null,
    prepareRatio: null,
    positionSeconds: null,
    durationSeconds: null,
    rendererName: null,
    serving: false,
  };
}
