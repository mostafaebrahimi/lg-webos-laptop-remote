/** Press D-pad buttons, then capture, to see whether focus moves on this screen. */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host="192.168.1.220";
const buttons=(process.argv[2]??"RIGHT,RIGHT").split(",");
const out=process.argv[3]??"/tmp/dpad.jpg";
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dl=(u,f)=>new Promise((res,rej)=>https.get(u,{rejectUnauthorized:false},r=>{const s=fs.createWriteStream(f);r.pipe(s);s.on("finish",()=>s.close(()=>res(f)))}).on("error",rej));
tv.on("connect",async()=>{
  const p=await tv.getSocket("ssap://com.webos.service.networkinput/getPointerInputSocket");
  for(const b of buttons){ p.send("button",{name:b.trim()}); await wait(220); }
  await wait(1200);
  await dl((await tv.request("ssap://tv/executeOneShot")).imageUri,out);
  console.log("pressed",buttons.join(" "),"->",out);
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),40000);
