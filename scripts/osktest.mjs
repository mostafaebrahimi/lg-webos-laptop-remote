/** Drive the app's on-screen keyboard for real: home, type, capture. */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host="192.168.1.220";
const text=process.argv[2]??"test";
const out=process.argv[3]??"/tmp/osk.jpg";
const delayMs=Number(process.argv[4]??150);

// Grid read off the real screen capture.
const rows=[
  ["1","2","3","4","5","6","7","8","9","0","#backspace"],
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l","@","#shift"],
  ["z","x","c","v","b","n","m","_","-",".","#symbols"],
];
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dl=(u,f)=>new Promise((res,rej)=>https.get(u,{rejectUnauthorized:false},r=>{const s=fs.createWriteStream(f);r.pipe(s);s.on("finish",()=>s.close(()=>res(f)))}).on("error",rej));
const locate=c=>{for(let r=0;r<rows.length;r++){const i=rows[r].indexOf(c);if(i!==-1)return{row:r,col:i};}return null;};

tv.on("connect",async()=>{
  const p=await tv.getSocket("ssap://com.webos.service.networkinput/getPointerInputSocket");
  const tap=async n=>{p.send("button",{name:n});await wait(delayMs);};
  const ok=async()=>{p.send("button",{name:"ENTER"});await wait(delayMs);};

  // home: bottom-left
  for(let i=0;i<rows.length+2;i++) await tap("DOWN");
  for(let i=0;i<13;i++) await tap("LEFT");
  let pos={row:rows.length-1,col:0};

  for(const ch of text){
    const t=locate(ch); if(!t){console.log("skip",ch);continue;}
    const first=Math.min(pos.row,t.row), last=Math.max(pos.row,t.row);
    let narrow=Infinity; for(let i=first;i<=last;i++) narrow=Math.min(narrow,rows[i].length);
    const transit=Math.min(pos.col,narrow-1);
    while(pos.col>transit){await tap("LEFT");pos.col--;}
    while(pos.row>t.row){await tap("UP");pos.row--;}
    while(pos.row<t.row){await tap("DOWN");pos.row++;}
    while(pos.col>t.col){await tap("LEFT");pos.col--;}
    while(pos.col<t.col){await tap("RIGHT");pos.col++;}
    await ok();
    console.log("typed",ch,"at",JSON.stringify(pos));
  }
  await wait(1200);
  await dl((await tv.request("ssap://tv/executeOneShot")).imageUri,out);
  console.log("captured:",out);
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),180000);
