/** Send text to whatever webOS field is focused, then capture. node scripts/type.mjs "text" out.jpg */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host = "192.168.1.220";
const text = process.argv[2] ?? "hello";
const out = process.argv[3] ?? "/tmp/typed.jpg";
const tv = new LGTV({ host, verifyCert: "lg", keyFile: path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${host}`), timeout: 15000, reconnect: false });
const wait = ms => new Promise(r => setTimeout(r, ms));
const dl = (u, f) => new Promise((res, rej) => https.get(u, { rejectUnauthorized: false }, r => { const s = fs.createWriteStream(f); r.pipe(s); s.on("finish", () => s.close(() => res(f))); }).on("error", rej));
tv.on("connect", async () => {
  const state = await new Promise(r => { tv.subscribe("ssap://com.webos.service.ime/registerRemoteKeyboard", (e, s) => r(e ? { err: e.message } : s)); setTimeout(() => r({ timeout: true }), 3000); });
  console.log("keyboard state:", JSON.stringify(state));
  console.log("insertText:", JSON.stringify(await tv.request("ssap://com.webos.service.ime/insertText", { text, replace: 0 })));
  await wait(2000);
  const s = await tv.request("ssap://tv/executeOneShot");
  await dl(s.imageUri, out); console.log("captured:", out);
  await tv.disconnect(); process.exit(0);
});
tv.on("error", e => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 40000);
