import WebSocket from "ws";
const t = await (await fetch("http://localhost:9222/json")).json();
const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id=0; const p=new Map();
ws.on("message",(raw)=>{const m=JSON.parse(raw.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
const send=(method,params={})=>new Promise((res)=>{const i=++id;p.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(e)=>(await send("Runtime.evaluate",{expression:`(async () => { ${e} })()`,awaitPromise:true,returnByValue:true})).result?.result?.value;
await send("Runtime.enable");
await ev(`return await window.tvApi.streamStop();`);
for (const f of process.argv.slice(2)) {
  const r = await ev(`return await window.tvApi.analyseMedia(${JSON.stringify(f)});`);
  if (r.ok) console.log(`${f.split("/").pop().padEnd(22)} ${r.value.videoCodec}/${r.value.container} -> ${r.value.plan.toUpperCase()}`);
  else console.log(`${f.split("/").pop().padEnd(22)} ERROR ${r.error}`);
}
ws.close(); process.exit(0);
