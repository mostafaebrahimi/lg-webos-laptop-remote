import http from "node:http";
import dgram from "node:dgram";

const AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
const RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1";

export interface RendererDescription {
  baseUrl: string;
  friendlyName: string;
  avTransportControl: string;
  renderingControl: string | null;
}

export interface PlaybackPosition {
  /** Seconds, or null when the renderer has not reported one yet. */
  position: number | null;
  duration: number | null;
  /** PLAYING, PAUSED_PLAYBACK, STOPPED, TRANSITIONING, NO_MEDIA_PRESENT. */
  state: string;
}

/**
 * Talks UPnP AVTransport to the television's own media renderer — the standard
 * "push a file to the TV" mechanism, and the only one that also gives seeking
 * and position back.
 */
export class DlnaRenderer {
  constructor(private readonly description: RendererDescription) {}

  get name(): string {
    return this.description.friendlyName;
  }

  /** Find the renderer a TV advertises over SSDP. */
  static async discover(host: string, timeoutMs = 4000): Promise<RendererDescription | null> {
    const location = await new Promise<string | null>((resolve) => {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      let done = false;
      const finish = (value: string | null) => {
        if (done) return;
        done = true;
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        resolve(value);
      };

      socket.on("error", () => finish(null));
      socket.on("message", (message, remote) => {
        if (remote.address !== host) return;
        const found = /^LOCATION:\s*(.+)$/im.exec(message.toString())?.[1]?.trim();
        if (found) finish(found);
      });

      socket.bind(() => {
        const payload = Buffer.from(
          [
            "M-SEARCH * HTTP/1.1",
            "HOST: 239.255.255.250:1900",
            'MAN: "ssdp:discover"',
            "MX: 2",
            "ST: urn:schemas-upnp-org:device:MediaRenderer:1",
            "",
            "",
          ].join("\r\n"),
        );
        socket.send(payload, 1900, "239.255.255.250");
        setTimeout(() => finish(null), timeoutMs);
      });
    });

    if (!location) return null;
    const xml = await httpGet(location);
    const control = (service: string) =>
      new RegExp(`<serviceType>${service}</serviceType>[\\s\\S]*?<controlURL>([^<]+)</controlURL>`).exec(xml)?.[1] ?? null;

    const avTransportControl = control(AV_TRANSPORT);
    if (!avTransportControl) return null;

    return {
      baseUrl: new URL(location).origin,
      friendlyName: /<friendlyName>([^<]+)</.exec(xml)?.[1] ?? "TV",
      avTransportControl,
      renderingControl: control(RENDERING_CONTROL),
    };
  }

  async setUri(url: string, title: string, mimeType: string, durationSeconds: number | null): Promise<void> {
    // Renderers are much happier with DIDL-Lite metadata than a bare URL.
    const metadata = didl(url, title, mimeType, durationSeconds);
    await this.send(AV_TRANSPORT, this.description.avTransportControl, "SetAVTransportURI", {
      InstanceID: "0",
      CurrentURI: url,
      CurrentURIMetaData: metadata,
    });
  }

  play(): Promise<string> {
    return this.send(AV_TRANSPORT, this.description.avTransportControl, "Play", { InstanceID: "0", Speed: "1" });
  }

  pause(): Promise<string> {
    return this.send(AV_TRANSPORT, this.description.avTransportControl, "Pause", { InstanceID: "0" });
  }

  stop(): Promise<string> {
    return this.send(AV_TRANSPORT, this.description.avTransportControl, "Stop", { InstanceID: "0" });
  }

  seek(seconds: number): Promise<string> {
    return this.send(AV_TRANSPORT, this.description.avTransportControl, "Seek", {
      InstanceID: "0",
      Unit: "REL_TIME",
      Target: formatTime(seconds),
    });
  }

  async position(): Promise<PlaybackPosition> {
    const [positionInfo, transportInfo] = await Promise.all([
      this.send(AV_TRANSPORT, this.description.avTransportControl, "GetPositionInfo", { InstanceID: "0" }),
      this.send(AV_TRANSPORT, this.description.avTransportControl, "GetTransportInfo", { InstanceID: "0" }),
    ]);

    return {
      position: parseTime(tag(positionInfo, "RelTime")),
      duration: parseTime(tag(positionInfo, "TrackDuration")),
      state: tag(transportInfo, "CurrentTransportState") ?? "UNKNOWN",
    };
  }

  private send(service: string, controlUrl: string, action: string, args: Record<string, string>): Promise<string> {
    const body = Object.entries(args)
      .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
      .join("");
    const envelope =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
      `<s:Body><u:${action} xmlns:u="${service}">${body}</u:${action}></s:Body></s:Envelope>`;

    const url = new URL(controlUrl, this.description.baseUrl);
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: "POST",
          timeout: 8000,
          // The TV answers every request with `Connection: close`. Node keeps
          // sockets alive by default, so without this the next call reuses a
          // socket the TV has already dropped and fails with a hang-up.
          agent: false,
          headers: {
            "Content-Type": 'text/xml; charset="utf-8"',
            SOAPACTION: `"${service}#${action}"`,
            "Content-Length": Buffer.byteLength(envelope),
            Connection: "close",
          },
        },
        (response) => {
          let text = "";
          response.on("data", (chunk: Buffer) => (text += chunk.toString()));
          response.on("end", () => {
            if (response.statusCode && response.statusCode >= 400) {
              const detail = /<errorDescription>([^<]+)</.exec(text)?.[1] ?? `HTTP ${response.statusCode}`;
              reject(new Error(`The TV refused ${action}: ${detail}`));
            } else {
              resolve(text);
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error(`The TV did not answer ${action} in time.`)));
      request.on("error", reject);
      request.write(envelope);
      request.end();
    });
  }
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { timeout: 6000, agent: false, headers: { Connection: "close" } }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => (body += chunk.toString()));
        response.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

export function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml);
  return match ? match[1] : null;
}

/** "00:01:23" and "0:01:23.000" both appear in the wild. */
export function parseTime(value: string | null): number | null {
  if (!value || value === "NOT_IMPLEMENTED") return null;
  const parts = value.split(":").map((part) => Number.parseFloat(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? null;
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Minimal DIDL-Lite item describing the file being pushed. */
export function didl(url: string, title: string, mimeType: string, durationSeconds: number | null): string {
  const duration = durationSeconds ? ` duration="${formatTime(durationSeconds)}.000"` : "";
  const xml =
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">` +
    `<item id="0" parentID="-1" restricted="1">` +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<upnp:class>object.item.videoItem</upnp:class>` +
    `<res protocolInfo="http-get:*:${mimeType}:DLNA.ORG_OP=01;DLNA.ORG_CI=0"${duration}>${escapeXml(url)}</res>` +
    `</item></DIDL-Lite>`;
  return xml;
}
