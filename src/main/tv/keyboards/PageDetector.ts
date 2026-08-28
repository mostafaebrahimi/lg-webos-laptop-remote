import { promises as fs } from "node:fs";
import path from "node:path";
import { nativeImage } from "electron";

const GRID = 16;
const MATCH_THRESHOLD = 28;
const AMBIGUITY_MARGIN = 8;

export interface PageMatch {
  layer: string;
  distance: number;
  confident: boolean;
}

/**
 * Works out which page of an app's on-screen keyboard is showing.
 *
 * The TV reports nothing about its own keyboard, so the only signal is what is
 * on screen. A capture of the keyboard strip is reduced to a perceptual hash and
 * compared with hashes learned earlier, once, per layout and page.
 */
export class PageDetector {
  private readonly file: string;
  /** `${layoutId}:${layerId}` -> hash */
  private prints: Record<string, string> | null = null;

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, "keyboard-pages.json");
  }

  /**
   * Perceptual hash of the bottom of the frame, where the keyboard lives.
   * Downscaled hard so anti-aliasing, the highlighted key and the text above the
   * keyboard cannot swing the result.
   */
  static fingerprint(image: Buffer): string {
    const source = nativeImage.createFromBuffer(image);
    const { width, height } = source.getSize();
    if (width === 0 || height === 0) throw new Error("The capture could not be decoded.");

    // The keyboard occupies roughly the bottom third of every layout seen so far.
    const strip = source.crop({
      x: 0,
      y: Math.floor(height * 0.62),
      width,
      height: height - Math.floor(height * 0.62),
    });

    const small = strip.resize({ width: GRID, height: GRID, quality: "good" });
    const bitmap = small.toBitmap(); // BGRA

    const luma: number[] = [];
    for (let index = 0; index + 3 < bitmap.length; index += 4) {
      luma.push(0.114 * bitmap[index] + 0.587 * bitmap[index + 1] + 0.299 * bitmap[index + 2]);
    }
    const mean = luma.reduce((total, value) => total + value, 0) / luma.length;

    let bits = "";
    for (const value of luma) bits += value > mean ? "1" : "0";
    return bits;
  }

  static distance(a: string, b: string): number {
    if (a.length !== b.length) return Number.POSITIVE_INFINITY;
    let total = 0;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) total += 1;
    }
    return total;
  }

  async learn(layoutId: string, layer: string, image: Buffer): Promise<void> {
    const prints = await this.load();
    prints[`${layoutId}:${layer}`] = PageDetector.fingerprint(image);
    await this.persist(prints);
  }

  async forget(layoutId: string): Promise<void> {
    const prints = await this.load();
    for (const key of Object.keys(prints)) {
      if (key.startsWith(`${layoutId}:`)) delete prints[key];
    }
    await this.persist(prints);
  }

  async known(layoutId: string): Promise<string[]> {
    const prints = await this.load();
    return Object.keys(prints)
      .filter((key) => key.startsWith(`${layoutId}:`))
      .map((key) => key.slice(layoutId.length + 1));
  }

  /**
   * The closest learned page, or null when nothing is close enough or two pages
   * are too similar to call apart.
   */
  async detect(layoutId: string, image: Buffer): Promise<PageMatch | null> {
    const prints = await this.load();
    const hash = PageDetector.fingerprint(image);

    const scored = Object.entries(prints)
      .filter(([key]) => key.startsWith(`${layoutId}:`))
      .map(([key, value]) => ({ layer: key.slice(layoutId.length + 1), distance: PageDetector.distance(hash, value) }))
      .sort((a, b) => a.distance - b.distance);

    if (scored.length === 0) return null;
    const best = scored[0];
    if (best.distance > MATCH_THRESHOLD) return { ...best, confident: false };

    const runnerUp = scored[1];
    const decisive = !runnerUp || runnerUp.distance - best.distance >= AMBIGUITY_MARGIN;
    return { ...best, confident: decisive };
  }

  private async load(): Promise<Record<string, string>> {
    if (this.prints) return this.prints;
    try {
      this.prints = JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, string>;
    } catch {
      this.prints = {};
    }
    return this.prints;
  }

  private async persist(prints: Record<string, string>): Promise<void> {
    this.prints = prints;
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(prints, null, 2), "utf8");
    await fs.rename(tmp, this.file);
  }
}
