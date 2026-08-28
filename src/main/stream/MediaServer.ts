import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";

export interface ServedFile {
  url: string;
  sizeBytes: number;
}

/**
 * A deliberately small HTTP server: it exists only so the television can pull
 * one file, and it is the only listening socket this application ever opens.
 *
 * It is locked down in four ways:
 *  - bound to the one interface that faces the TV, never 0.0.0.0,
 *  - answers only the TV's own address,
 *  - serves exactly one file behind an unguessable random path,
 *  - stops the moment playback stops.
 */
export class MediaServer {
  private server: http.Server | null = null;
  private token = "";
  private file: string | null = null;
  private mimeType = "video/mp4";
  private size = 0;

  constructor(private readonly allowedClient: string) {}

  get running(): boolean {
    return this.server !== null;
  }

  get currentFile(): string | null {
    return this.file;
  }

  /** Start serving `file`, returning the URL the TV should fetch. */
  async serve(file: string, mimeType: string): Promise<ServedFile> {
    await this.stop();

    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("That is not a file.");

    this.file = file;
    this.mimeType = mimeType;
    this.size = stat.size;
    this.token = randomBytes(24).toString("hex");

    const address = localAddressFacing(this.allowedClient);
    if (!address) {
      throw new Error("No network interface on the TV's subnet was found, so it cannot reach this computer.");
    }

    const server = http.createServer((request, response) => this.handle(request, response));
    this.server = server;

    const port = await new Promise<number>((resolve, reject) => {
      server.on("error", reject);
      // Port 0 asks the OS for a free port.
      server.listen(0, address, () => {
        const info = server.address();
        if (info && typeof info === "object") resolve(info.port);
        else reject(new Error("The media server did not start."));
      });
    });

    return { url: `http://${address}:${port}/${this.token}`, sizeBytes: stat.size };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.file = null;
    this.token = "";
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
      // A stalled TV connection must not keep the socket open forever.
      setTimeout(resolve, 1500);
    });
  }

  private handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const remote = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (remote !== this.allowedClient) {
      response.writeHead(403).end();
      request.socket.destroy();
      return;
    }
    if (!this.file || request.url !== `/${this.token}`) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }

    const range = parseRange(request.headers.range, this.size);
    const headers: Record<string, string> = {
      "Content-Type": this.mimeType,
      "Accept-Ranges": "bytes",
      // DLNA renderers look for these before they will seek.
      "transferMode.dlna.org": "Streaming",
      "contentFeatures.dlna.org": "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
      Connection: "close",
    };

    if (!range) {
      headers["Content-Length"] = String(this.size);
      response.writeHead(200, headers);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(this.file).pipe(response);
      return;
    }

    headers["Content-Length"] = String(range.end - range.start + 1);
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${this.size}`;
    response.writeHead(206, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(this.file, { start: range.start, end: range.end }).pipe(response);
  }
}

/** `bytes=start-end`, clamped to the file. Seeking depends on getting this right. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  // A suffix range ("bytes=-500") asks for the last N bytes.
  if (rawStart === "") {
    const length = Math.min(Number(rawEnd), size);
    return length <= 0 ? null : { start: size - length, end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return null;
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  return end < start ? null : { start, end };
}

/** The local IPv4 address on the same /24 as the TV. */
export function localAddressFacing(target: string): string | null {
  const wanted = target.split(".").slice(0, 3).join(".");
  let fallback: string | null = null;

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      if (address.address.split(".").slice(0, 3).join(".") === wanted) return address.address;
      fallback ??= address.address;
    }
  }
  return fallback;
}
