import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { nativeImage } from "electron";

export interface VerifyResult {
  /** The capture, so the user can always confirm with their own eyes. */
  dataUrl: string;
  /** Null when no OCR engine is installed. */
  matched: boolean | null;
  /** What OCR read, trimmed, when available. */
  readText?: string;
}

/**
 * Checks what actually landed on the TV after typing on an app's own keyboard.
 *
 * The capture is always returned so the result can be shown; when tesseract
 * happens to be installed the text is read back and compared as well. OCR is a
 * bonus, never a requirement - the app must work without it.
 */
export class TypingVerifier {
  private static ocrAvailable: boolean | null = null;

  static async hasOcr(): Promise<boolean> {
    if (TypingVerifier.ocrAvailable !== null) return TypingVerifier.ocrAvailable;
    TypingVerifier.ocrAvailable = await new Promise<boolean>((resolve) => {
      const probe = spawn("tesseract", ["--version"], { stdio: "ignore" });
      probe.on("error", () => resolve(false));
      probe.on("close", (code) => resolve(code === 0));
    });
    return TypingVerifier.ocrAvailable;
  }

  static async verify(image: Buffer, expected: string): Promise<VerifyResult> {
    const dataUrl = `data:image/jpeg;base64,${image.toString("base64")}`;
    if (!(await TypingVerifier.hasOcr())) return { dataUrl, matched: null };

    try {
      // Text fields sit above the keyboard, so only the top of the frame is read.
      const source = nativeImage.createFromBuffer(image);
      const { width, height } = source.getSize();
      const top = source.crop({ x: 0, y: 0, width, height: Math.floor(height * 0.62) });

      const file = path.join(os.tmpdir(), `tv-verify-${process.pid}-${Date.now()}.png`);
      await fs.writeFile(file, top.toPNG());
      const text = await runTesseract(file);
      await fs.rm(file, { force: true });

      const normalise = (value: string) => value.replace(/\s+/g, "").toLowerCase();
      return { dataUrl, matched: normalise(text).includes(normalise(expected)), readText: text.trim().slice(0, 400) };
    } catch {
      return { dataUrl, matched: null };
    }
  }
}

function runTesseract(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn("tesseract", [file, "stdout", "--psm", "6"]);
    let output = "";
    process.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    process.on("error", reject);
    process.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`tesseract exited ${code}`))));
  });
}
