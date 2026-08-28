/**
 * Move the TV cursor to an absolute position and click.
 * Coordinates are given in the 960x540 capture space and scaled to the TV's
 * 1920x1080 pointer space. Absolute positioning is emulated by slamming the
 * cursor into the top-left corner first (relative moves clamp at the edge).
 */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host="192.168.1.220";
const [,, xs, ys, out] = process.argv;
const x = Number(xs) * 2, y = Number(ys) * 2;
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dl=(u,f)=>new Promise((res,rej)=>https.get(u,{rejectUnauthorized:false},r=>{const s=fs.createWriteStream(f);r.pipe(s);s.on("finish",()=>s.close(()=>res(f)))}).on("error",rej));

tv.on("connect",async()=>{
  const p=await tv.getSocket("ssap://com.webos.service.networkinput/getPointerInputSocket");
  // wake the cursor
  p.send("move",{dx:5,dy:5,down:0}); await wait(500);
  // slam to origin
  for(let i=0;i<8;i++){p.send("move",{dx:-400,dy:-400,down:0}); await wait(45);}
  await wait(500);
  // walk to target in <=400px steps
  let dx=x, dy=y;
  while(dx>0||dy>0){const sx=Math.min(400,dx), sy=Math.min(400,dy); p.send("move",{dx:sx,dy:sy,down:0}); dx-=sx; dy-=sy; await wait(45);}
  await wait(800);
  await dl((await tv.request("ssap://tv/executeOneShot")).imageUri, out.replace(".jpg","-before.jpg"));
  p.send("click");
  await wait(1500);
  await dl((await tv.request("ssap://tv/executeOneShot")).imageUri, out);
  console.log("clicked at capture coords", xs, ys, "->", out);
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),60000);
