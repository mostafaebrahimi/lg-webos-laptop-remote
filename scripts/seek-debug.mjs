import WebSocket from "ws";
const file = process.argv[2];
const t = await (await fetch("http://localhost:9222/json")).json();
const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id = 0; const p = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
const send = (method, params={}) => new Promise((res) => { const i=++id; p.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: `(async () => { ${e} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Runtime.enable");

await ev(`return await window.tvApi.streamStop();`);
console.log("start:", JSON.stringify(await ev(`return await window.tvApi.streamStart(${JSON.stringify(file)});`)));
for (let i = 0; i < 5; i++) { await wait(2000); console.log("  t =", await ev(`return (await window.tvApi.getStreamStatus()).positionSeconds;`)); }

console.log("seek -> 60:", JSON.stringify(await ev(`return await window.tvApi.streamSeek(60);`)));
for (let i = 0; i < 5; i++) { await wait(2000); console.log("  t =", await ev(`return (await window.tvApi.getStreamStatus()).positionSeconds;`)); }
await ev(`return await window.tvApi.streamStop();`);
ws.close(); process.exit(0);
