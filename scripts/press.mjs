/** Press a sequence of buttons (optionally launch an app first), then capture. */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host="192.168.1.220";
const [,, buttonList, out, launchId] = process.argv;
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dl=(u,f)=>new Promise((res,rej)=>https.get(u,{rejectUnauthorized:false},r=>{const s=fs.createWriteStream(f);r.pipe(s);s.on("finish",()=>s.close(()=>res(f)))}).on("error",rej));
tv.on("connect",async()=>{
  if(launchId){ await tv.request("ssap://com.webos.applicationManager/launch",{id:launchId}); await wait(8000); }
  if(buttonList && buttonList!=="-"){
    const p=await tv.getSocket("ssap://com.webos.service.networkinput/getPointerInputSocket");
    for(const b of buttonList.split(",")){ p.send("button",{name:b.trim()}); await wait(400); }
  }
  await wait(1800);
  await dl((await tv.request("ssap://tv/executeOneShot")).imageUri,out);
  console.log("captured:",out);
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),90000);
