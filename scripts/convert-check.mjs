import WebSocket from "ws";
const file = process.argv[2];
const t = await (await fetch("http://localhost:9222/json")).json();
const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id=0; const p=new Map();
ws.on("message",(raw)=>{const m=JSON.parse(raw.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
const send=(method,params={})=>new Promise((res)=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(e)=>(await send("Runtime.evaluate",{expression:`(async () => { ${e} })()`,awaitPromise:true,returnByValue:true})).result?.result?.value;
const wait=(ms)=>new Promise((r)=>setTimeout(r,ms));
await send("Runtime.enable");
await ev(`return await window.tvApi.streamStop();`);
const started = ev(`return await window.tvApi.streamStart(${JSON.stringify(file)});`);
for (let i = 0; i < 14; i++) {
  await wait(1500);
  const s = await ev(`return await window.tvApi.getStreamStatus();`);
  console.log(`  ${s.phase.padEnd(10)} ratio=${s.prepareRatio === null ? "-" : Math.round(s.prepareRatio*100)+"%"} t=${s.positionSeconds ?? "-"}  ${s.message.slice(0,60)}`);
  if (s.phase === "playing" && (s.positionSeconds ?? 0) > 1) break;
  if (s.phase === "error") break;
}
console.log("start result:", JSON.stringify(await started));
await wait(1000);
await ev(`return await window.tvApi.streamStop();`);
ws.close(); process.exit(0);
