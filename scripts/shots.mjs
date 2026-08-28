/** Screenshot every tab at a given viewport width, via CDP. */
import WebSocket from "ws";
import fs from "fs";

const outDir = process.argv[2] ?? "/tmp";
const width = Number(process.argv[3] ?? 1400);
const height = Number(process.argv[4] ?? 900);

const targets = await (await fetch("http://localhost:9222/json")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

// Reconnect so the panels have real data.
const state = await evaluate(`return (await window.tvApi.getSnapshot()).state;`);
if (state !== "connected") {
  await evaluate(`return window.tvApi.connect({ host: "192.168.1.220", driverId: "webos" });`);
  for (let i = 0; i < 25; i++) {
    if ((await evaluate(`return (await window.tvApi.getSnapshot()).state;`)) === "connected") break;
    await wait(1000);
  }
}

const tabs = await evaluate(`return [...document.querySelectorAll(".tab")].map((t) => t.textContent);`);
for (let index = 0; index < tabs.length; index++) {
  await evaluate(`document.querySelectorAll(".tab")[${index}].click(); return true;`);
  await wait(1400);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${outDir}/tab-${tabs[index].toLowerCase()}.png`, Buffer.from(shot.result.data, "base64"));
  // Report anything overflowing its container horizontally.
  const overflow = await evaluate(`
    const bad = [];
    for (const el of document.querySelectorAll(".card, .livebar, .header, .content *")) {
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        bad.push((el.className || el.tagName) + " " + el.scrollWidth + ">" + el.clientWidth);
      }
    }
    return [...new Set(bad)].slice(0, 6);
  `);
  console.log(`${tabs[index]}: ${overflow.length ? "OVERFLOW " + overflow.join(" | ") : "clean"}`);
}
await send("Emulation.clearDeviceMetricsOverride");
ws.close(); process.exit(0);
