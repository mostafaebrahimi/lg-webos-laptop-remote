import { promises as fs } from "node:fs";
import path from "node:path";
import { AppSettings, DEFAULT_SETTINGS, Snippet } from "@shared/types";

/**
 * Small atomic JSON store for non-secret settings. Pairing keys are handled by
 * lgtv2's own key file and never pass through here.
 */
export class SettingsRepository {
  private readonly file: string;
  private cache: AppSettings = { ...DEFAULT_SETTINGS };
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, "settings.json");
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.cache = sanitise({ ...DEFAULT_SETTINGS, ...parsed });
    } catch {
      this.cache = { ...DEFAULT_SETTINGS };
    }
    return this.cache;
  }

  get(): AppSettings {
    return this.cache;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.cache = sanitise({ ...this.cache, ...patch });
    const snapshot = JSON.stringify(this.cache, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(tmp, snapshot, "utf8");
      await fs.rename(tmp, this.file);
    });
    await this.writeChain;
    return this.cache;
  }
}

function sanitise(settings: AppSettings): AppSettings {
  return {
    ...settings,
    host: String(settings.host ?? "").trim().slice(0, 255),
    mac: String(settings.mac ?? "").trim().slice(0, 32),
    keyRepeatMs: clamp(Number(settings.keyRepeatMs) || DEFAULT_SETTINGS.keyRepeatMs, 40, 1000),
    volumeStep: clamp(Number(settings.volumeStep) || DEFAULT_SETTINGS.volumeStep, 1, 10),
    shortcutsEnabled: Boolean(settings.shortcutsEnabled),
    experimentalButtons: Boolean(settings.experimentalButtons),
    okMode: ["enter", "click", "both"].includes(settings.okMode)
      ? settings.okMode
      : DEFAULT_SETTINGS.okMode,
    pointerSensitivity: clamp(Number(settings.pointerSensitivity) || DEFAULT_SETTINGS.pointerSensitivity, 0.25, 3),
    scrollSensitivity: clamp(Number(settings.scrollSensitivity) || DEFAULT_SETTINGS.scrollSensitivity, 0.25, 3),
    invertScrollY: Boolean(settings.invertScrollY),
    liveTyping: Boolean(settings.liveTyping),
    favouriteApps: Array.isArray(settings.favouriteApps)
      ? settings.favouriteApps.filter((id) => typeof id === "string").slice(0, 50)
      : [],
    driverId: typeof settings.driverId === "string" && settings.driverId ? settings.driverId : DEFAULT_SETTINGS.driverId,
    profiles: Array.isArray(settings.profiles)
      ? settings.profiles
          .filter((profile) => profile && typeof profile.id === "string" && typeof profile.host === "string")
          .slice(0, 20)
      : [],
    activeProfileId: String(settings.activeProfileId ?? "").slice(0, 64),
    globalShortcuts: Boolean(settings.globalShortcuts),
    oskLayoutId: String(settings.oskLayoutId || DEFAULT_SETTINGS.oskLayoutId).slice(0, 40),
    oskDelayMs: clamp(Number(settings.oskDelayMs) || DEFAULT_SETTINGS.oskDelayMs, 80, 600),
    oskLayer: String(settings.oskLayer || DEFAULT_SETTINGS.oskLayer).slice(0, 40),
    scenes: Array.isArray(settings.scenes) ? settings.scenes.slice(0, 20) : [],
    snippets: normaliseSnippets(settings.snippets),
  };
}

/**
 * Snippets used to be plain strings. Older settings files are migrated to the
 * metadata form, marked non-secret because that is what they always were.
 */
function normaliseSnippets(value: unknown): Snippet[] {
  if (!Array.isArray(value)) return [];
  const snippets: Snippet[] = [];
  for (const entry of value.slice(0, 30)) {
    if (typeof entry === "string" && entry.length > 0) {
      snippets.push({ id: `legacy-${snippets.length}-${entry.slice(0, 12)}`, label: entry, secret: false, value: entry });
    } else if (entry && typeof entry === "object" && typeof (entry as Snippet).id === "string") {
      const snippet = entry as Snippet;
      snippets.push({
        id: snippet.id.slice(0, 64),
        label: String(snippet.label ?? "").slice(0, 60) || "snippet",
        secret: Boolean(snippet.secret),
        value: snippet.secret ? undefined : String(snippet.value ?? "").slice(0, 500),
      });
    }
  }
  return snippets;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
