/** Verify layer switching on the real TV: type a$b, capture, then undo it. */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host="192.168.1.220"; const out=process.argv[2]??"/tmp/sym2.jpg"; const START=process.argv[3]??"letters"; const TEXT=process.argv[4]??"a$b";
const layers={
  letters:[
    ["1","2","3","4","5","6","7","8","9","0","#backspace"],
    ["q","w","e","r","t","y","u","i","o","p"],
    ["a","s","d","f","g","h","j","k","l","@","#shift"],
    ["z","x","c","v","b","n","m","_","-",".","#layer"]],
  symbols:[
    ["1","2","3","4","5","6","7","8","9","0","#backspace"],
    ["|","/","\\",";",":",",","-",'"',"'","`"],
    ["^","~","<",">","{","}","[","]","(",")"," "],
    ["+","=","#","%","&","?","$","*","@","!","#layer"]],
};
const SWITCH={row:3,col:10};
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dl=(u,f)=>new Promise((res,rej)=>https.get(u,{rejectUnauthorized:false},r=>{const s=fs.createWriteStream(f);r.pipe(s);s.on("finish",()=>s.close(()=>res(f)))}).on("error",rej));

tv.on("connect",async()=>{
  const p=await tv.getSocket("ssap://com.webos.service.networkinput/getPointerInputSocket");
  const tap=async n=>{p.send("button",{name:n});await wait(150);};
  const ok=async()=>{p.send("button",{name:"ENTER"});await wait(150);};
  let layer=START, pos={row:3,col:0};

  const moveTo=async(t)=>{
    const rows=layers[layer];
    const a=Math.min(pos.row,t.row), b=Math.max(pos.row,t.row);
    let narrow=Infinity; for(let i=a;i<=b;i++) narrow=Math.min(narrow,rows[i].length);
    const transit=Math.min(pos.col,narrow-1);
    while(pos.col>transit){await tap("LEFT");pos.col--;}
    while(pos.row>t.row){await tap("UP");pos.row--;}
    while(pos.row<t.row){await tap("DOWN");pos.row++;}
    while(pos.col>t.col){await tap("LEFT");pos.col--;}
    while(pos.col<t.col){await tap("RIGHT");pos.col++;}
  };
  const ensure=async(want)=>{ if(layer===want) return;
    await moveTo(SWITCH); await ok(); layer=want; pos={...SWITCH};
  };
  const locate=(c)=>{ for(const [id,rows] of Object.entries(layers))
    for(let r=0;r<rows.length;r++){const i=rows[r].indexOf(c); if(i!==-1) return {layer:id,row:r,col:i};} return null; };

  // home on the letters page
  for(let i=0;i<6;i++) await tap("DOWN");
  for(let i=0;i<13;i++) await tap("LEFT");
  layer=START; pos={row:3,col:0};

  for(const ch of TEXT){
    const t=locate(ch); await ensure(t.layer); await moveTo(t); await ok();
    console.log("typed",ch,"on",t.layer);
  }
  await ensure("letters");
  await wait(1200);
  await dl((await tv.request("ssap://tv/executeOneShot")).imageUri,out);
  console.log("captured:",out);

  // undo exactly what was typed
  await moveTo({row:0,col:10}); for(let i=0;i<TEXT.length;i++) await ok();
  console.log("removed",TEXT.length,"test characters; keyboard left on",layer);
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),120000);
