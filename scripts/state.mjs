/** Report foreground app + IME focus state, and capture the screen. */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host="192.168.1.220"; const out=process.argv[2]??"/tmp/state.jpg";
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const dl=(u,f)=>new Promise((res,rej)=>https.get(u,{rejectUnauthorized:false},r=>{const s=fs.createWriteStream(f);r.pipe(s);s.on("finish",()=>s.close(()=>res(f)))}).on("error",rej));
tv.on("connect",async()=>{
  console.log("foreground:",JSON.stringify(await tv.request("ssap://com.webos.applicationManager/getForegroundAppInfo")));
  const kb=await new Promise(r=>{tv.subscribe("ssap://com.webos.service.ime/registerRemoteKeyboard",(e,s)=>r(e?{err:e.message}:s));setTimeout(()=>r({timeout:true}),3500);});
  console.log("keyboard:",JSON.stringify(kb));
  const s=await tv.request("ssap://tv/executeOneShot"); await dl(s.imageUri,out); console.log("captured:",out);
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),30000);
