/** Drive the app's own Stream feature end to end, against the real TV. */
import WebSocket from "ws";
const file = process.argv[2];
const targets = await (await fetch("http://localhost:9222/json")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

await send("Runtime.enable");

// connect first
if ((await evaluate(`return (await window.tvApi.getSnapshot()).state;`)) !== "connected") {
  await evaluate(`return window.tvApi.connect({ host: "192.168.1.220", driverId: "webos" });`);
  for (let i = 0; i < 25; i++) { if ((await evaluate(`return (await window.tvApi.getSnapshot()).state;`)) === "connected") break; await wait(1000); }
}

const analysis = await evaluate(`return await window.tvApi.analyseMedia(${JSON.stringify(file)});`);
check("file analysed", analysis.ok === true, analysis.ok ? `${analysis.value.videoCodec}/${analysis.value.audioCodec} → ${analysis.value.plan}` : analysis.error);
check("h264+aac mp4 recognised as direct play", analysis.value?.plan === "direct");

const started = await evaluate(`return await window.tvApi.streamStart(${JSON.stringify(file)});`);
check("stream started", started.ok === true, started.error ?? "");

await wait(5000);
let status = await evaluate(`return await window.tvApi.getStreamStatus();`);
check("TV reports playing", status.phase === "playing", `${status.phase} · ${status.message}`);
check("position advances", (status.positionSeconds ?? 0) > 0, `t=${status.positionSeconds}`);
check("server is live while playing", status.serving === true);

const before = status.positionSeconds ?? 0;
const seek = await evaluate(`return await window.tvApi.streamSeek(60);`);
await wait(4000);
status = await evaluate(`return await window.tvApi.getStreamStatus();`);
check(
  "seek jumps the TV forward",
  seek.ok === true && (status.positionSeconds ?? 0) >= 58 && (status.positionSeconds ?? 0) > before + 30,
  `${before}s → ${status.positionSeconds}s`,
);

await evaluate(`return await window.tvApi.streamPause();`);
await wait(1500);
status = await evaluate(`return await window.tvApi.getStreamStatus();`);
check("pause works", status.phase === "paused", status.phase);

await evaluate(`return await window.tvApi.streamResume();`);
await wait(1500);
check("resume works", (await evaluate(`return (await window.tvApi.getStreamStatus()).phase;`)) === "playing");

await evaluate(`return await window.tvApi.streamStop();`);
await wait(1500);
status = await evaluate(`return await window.tvApi.getStreamStatus();`);
check("stop closes the server", status.serving === false && status.phase === "idle", `${status.phase}/serving=${status.serving}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} stream checks passed`);
ws.close(); process.exit(failed.length ? 1 : 0);
