/** Records briefly on the real TV, then encodes MP4 and GIF. */
import WebSocket from "ws";
const targets = await (await fetch("http://localhost:9222/json")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Runtime.enable");

console.log("start:", JSON.stringify(await evaluate(`return await window.tvApi.startRecording(2);`)));
await wait(6000);
const stop = await evaluate(`return await window.tvApi.stopRecording(2);`);
console.log("stop:", JSON.stringify(stop.value ?? stop));
if (stop.ok) {
  const gif = await evaluate(`return await window.tvApi.exportGif(${JSON.stringify(stop.value.frameDir)}, 2);`);
  console.log("gif:", JSON.stringify(gif));
}
ws.close(); process.exit(0);
