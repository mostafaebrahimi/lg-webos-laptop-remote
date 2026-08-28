/** Launch the webOS browser, type into it via the IME, and capture the result. */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host = "192.168.1.220";
const out = process.argv[2] ?? "/tmp/ime.jpg";
const tv = new LGTV({ host, verifyCert: "lg", keyFile: path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${host}`), timeout: 15000, reconnect: false });
const wait = ms => new Promise(r => setTimeout(r, ms));
const dl = (url, file) => new Promise((res, rej) => https.get(url, { rejectUnauthorized: false }, r => { const s = fs.createWriteStream(file); r.pipe(s); s.on("finish", () => s.close(() => res(file))); }).on("error", rej));

tv.on("connect", async () => {
  await tv.request("ssap://com.webos.applicationManager/launch", { id: "com.webos.app.browser" });
  console.log("browser launched, waiting…");
  await wait(9000);

  const kb = await new Promise(resolve => {
    tv.subscribe("ssap://com.webos.service.ime/registerRemoteKeyboard", (e, s) => resolve(e ? { err: e.message } : s));
    setTimeout(() => resolve({ timeout: true }), 4000);
  });
  console.log("keyboard state:", JSON.stringify(kb));

  const r = await tv.request("ssap://com.webos.service.ime/insertText", { text: "hello from laptop", replace: 0 });
  console.log("insertText:", JSON.stringify(r));
  await wait(2500);

  const shot = await tv.request("ssap://tv/executeOneShot");
  await dl(shot.imageUri, out);
  console.log("captured:", out);
  await tv.disconnect(); process.exit(0);
});
tv.on("error", e => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 60000);
