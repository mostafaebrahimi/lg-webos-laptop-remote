import os from "node:os"; import path from "node:path"; import https from "node:https"; import LGTV from "lgtv2";
const host="192.168.1.220";
const tv=new LGTV({host,verifyCert:"lg",keyFile:path.join(os.homedir(),".config","lg-webos-laptop-remote","pairing",`keyfile-${host}`),timeout:15000,reconnect:false});
const dl=u=>new Promise((res,rej)=>https.get(u,{rejectUnauthorized:false},r=>{if(r.statusCode!==200){r.resume();return rej(new Error("HTTP "+r.statusCode));}const c=[];r.on("data",d=>c.push(d));r.on("end",()=>res(Buffer.concat(c)))}).on("error",rej));
tv.on("connect",async()=>{
  const r=await tv.request("ssap://com.webos.applicationManager/listLaunchPoints");
  let ok=0,fail=0;
  for(const p of r.launchPoints){
    try{const b=await dl(p.icon);ok++;console.log(`OK   ${String(p.title).padEnd(26)} ${b.length} bytes`);}
    catch(e){fail++;console.log(`FAIL ${String(p.title).padEnd(26)} ${e.message}`);}
  }
  console.log(`\nicons: ${ok} ok, ${fail} failed`);
  await tv.disconnect();process.exit(0);
});
tv.on("error",e=>{console.error(e.message);process.exit(1)});
setTimeout(()=>process.exit(1),40000);
