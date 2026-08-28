/**
 * Validates PageDetector's fingerprint on real captures.
 * Run with: npx electron scripts/fingerprint-test.js <img> <img> ...
 */
const { app, nativeImage } = require("electron");
const fs = require("fs");

const GRID = 16;
function fingerprint(buffer) {
  const source = nativeImage.createFromBuffer(buffer);
  const { width, height } = source.getSize();
  const top = Math.floor(height * 0.62);
  const strip = source.crop({ x: 0, y: top, width, height: height - top });
  const small = strip.resize({ width: GRID, height: GRID, quality: "good" });
  const bitmap = small.toBitmap();
  const luma = [];
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    luma.push(0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2]);
  }
  const mean = luma.reduce((a, b) => a + b, 0) / luma.length;
  return luma.map((v) => (v > mean ? "1" : "0")).join("");
}
const distance = (a, b) => [...a].filter((c, i) => c !== b[i]).length;

app.whenReady().then(() => {
  const files = process.argv.slice(2).filter((a) => a.endsWith(".jpg") || a.endsWith(".png"));
  const prints = files.map((f) => ({ f: f.split("/").pop(), h: fingerprint(fs.readFileSync(f)) }));
  console.log("bits per fingerprint:", prints[0] ? prints[0].h.length : 0, "\n");
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      console.log(`${String(distance(prints[i].h, prints[j].h)).padStart(3)}  ${prints[i].f}  vs  ${prints[j].f}`);
    }
  }
  console.log("\nself-distance (must be 0):", distance(prints[0].h, prints[0].h));
  app.quit();
});
