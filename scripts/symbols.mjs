/** Open the !?# symbols layer of the Google keyboard and capture it. */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host="192.168.1.220"; const out=process.argv[2]??"/tmp/sym.jpg";
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dl=(u,f)=>new Promise((res,rej)=>https.get(u,{rejectUnauthorized:false},r=>{const s=fs.createWriteStream(f);r.pipe(s);s.on("finish",()=>s.close(()=>res(f)))}).on("error",rej));
tv.on("connect",async()=>{
  const p=await tv.getSocket("ssap://com.webos.service.networkinput/getPointerInputSocket");
  const tap=async n=>{p.send("button",{name:n});await wait(150);};
  // home: bottom-left of the grid
  for(let i=0;i<6;i++) await tap("DOWN");
  for(let i=0;i<13;i++) await tap("LEFT");
  // walk to the !?# key at row 3, col 10
  for(let i=0;i<10;i++) await tap("RIGHT");
  await tap("ENTER");
  await wait(1500);
  await dl((await tv.request("ssap://tv/executeOneShot")).imageUri,out);
  console.log("captured:",out);
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),60000);
