import { promises as fs } from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

/**
 * Values that must never be written in the clear or handed to the renderer:
 * snippet contents that the user marked secret, such as a password typed onto a
 * TV. Encryption is delegated to the OS keyring through Electron's safeStorage.
 *
 * If the platform has no keyring, storing a secret is refused outright rather
 * than silently falling back to plaintext.
 */
export class SecretStore {
  private readonly file: string;
  private cache: Record<string, string> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, "secrets.json");
  }

  static available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async set(id: string, value: string): Promise<void> {
    if (!SecretStore.available()) {
      throw new Error(
        "This system has no secure keyring available, so secret snippets cannot be stored. Save it as a normal snippet only if you accept it being readable on disk.",
      );
    }
    const store = await this.load();
    store[id] = safeStorage.encryptString(value).toString("base64");
    await this.persist(store);
  }

  async get(id: string): Promise<string | null> {
    const store = await this.load();
    const encoded = store[id];
    if (!encoded) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encoded, "base64"));
    } catch {
      // Written under a different keyring, or the keyring changed.
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    const store = await this.load();
    if (!(id in store)) return;
    delete store[id];
    await this.persist(store);
  }

  /** Drop anything whose metadata no longer exists. */
  async retain(ids: string[]): Promise<void> {
    const store = await this.load();
    const keep = new Set(ids);
    let changed = false;
    for (const id of Object.keys(store)) {
      if (!keep.has(id)) {
        delete store[id];
        changed = true;
      }
    }
    if (changed) await this.persist(store);
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async persist(store: Record<string, string>): Promise<void> {
    this.cache = store;
    const snapshot = JSON.stringify(store);
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tmp, this.file);
      await fs.chmod(this.file, 0o600).catch(() => undefined);
    });
    await this.writeChain;
  }
}
