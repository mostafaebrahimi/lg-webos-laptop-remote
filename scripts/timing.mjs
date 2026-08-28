import os from "node:os"; import path from "node:path"; import https from "node:https"; import LGTV from "lgtv2";
const host="192.168.1.220";
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const get=(url)=>new Promise((res,rej)=>https.get(url,{rejectUnauthorized:false},r=>{const c=[];r.on("data",d=>c.push(d));r.on("end",()=>res(Buffer.concat(c)))}).on("error",rej));
tv.on("connect",async()=>{
  for(let i=0;i<3;i++){const t=Date.now();const s=await tv.request("ssap://tv/executeOneShot");const buf=await get(s.imageUri);console.log(`shot ${i+1}: ${Date.now()-t}ms, ${buf.length} bytes`);}
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),40000);
