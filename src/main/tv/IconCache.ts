import { CaptureManager } from "./CaptureManager";

const MAX_ENTRIES = 200;
const MAX_BYTES = 512 * 1024;

/**
 * TV icons are served over https on port 3001 with LG's self-signed certificate,
 * which the renderer refuses to load. The main process fetches them instead and
 * hands the renderer inline data URLs. Results are cached for the session.
 */
export class IconCache {
  private readonly cache = new Map<string, string | null>();

  /** Returns a data URL, or undefined when the icon could not be fetched. */
  async get(url: string | undefined): Promise<string | undefined> {
    if (!url || !/^https?:\/\//i.test(url)) return undefined;

    const cached = this.cache.get(url);
    if (cached !== undefined) return cached ?? undefined;

    try {
      const buffer = await CaptureManager.download(url);
      if (buffer.length > MAX_BYTES) throw new Error("icon too large");
      const dataUrl = `data:${mimeFor(url)};base64,${buffer.toString("base64")}`;
      this.remember(url, dataUrl);
      return dataUrl;
    } catch {
      // Remember the failure so a broken icon is not refetched on every refresh.
      this.remember(url, null);
      return undefined;
    }
  }

  /** Resolve many icons at once; a slow or broken icon never blocks the others. */
  async getMany(urls: Array<string | undefined>): Promise<Array<string | undefined>> {
    return Promise.all(urls.map((url) => this.get(url)));
  }

  clear(): void {
    this.cache.clear();
  }

  private remember(url: string, value: string | null): void {
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(url, value);
  }
}

function mimeFor(url: string): string {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".webp")) return "image/webp";
  return "image/png";
}
