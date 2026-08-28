/**
 * Focus a real webOS text field first (pointer to the browser URL bar, click),
 * then type through the IME. Captures before and after.
 */
import os from "node:os"; import path from "node:path"; import https from "node:https"; import fs from "node:fs"; import LGTV from "lgtv2";
const host = "192.168.1.220";
const dir = process.argv[2] ?? "/tmp";
const tv = new LGTV({ host, verifyCert: "lg", keyFile: path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${host}`), timeout: 15000, reconnect: false });
const wait = ms => new Promise(r => setTimeout(r, ms));
const dl = (url, file) => new Promise((res, rej) => https.get(url, { rejectUnauthorized: false }, r => { const s = fs.createWriteStream(file); r.pipe(s); s.on("finish", () => s.close(() => res(file))); }).on("error", rej));
const shot = async (name) => { const s = await tv.request("ssap://tv/executeOneShot"); await dl(s.imageUri, path.join(dir, name)); console.log("captured", name); };

tv.on("connect", async () => {
  const p = await tv.getSocket("ssap://com.webos.service.networkinput/getPointerInputSocket");
  console.log("pointer socket open");

  // Slam the cursor into the top-left corner, then walk to the URL bar.
  for (let i = 0; i < 6; i++) { p.send("move", { dx: -500, dy: -500, down: 0 }); await wait(60); }
  await wait(400);
  for (let i = 0; i < 2; i++) { p.send("move", { dx: 340, dy: 0, down: 0 }); await wait(60); }
  p.send("move", { dx: 0, dy: 48, down: 0 });
  await wait(900);
  await shot("focus-before-click.jpg");

  p.send("click");
  await wait(2500);
  await shot("focus-after-click.jpg");

  const kb = await new Promise(resolve => {
    tv.subscribe("ssap://com.webos.service.ime/registerRemoteKeyboard", (e, s) => resolve(e ? { err: e.message } : s));
    setTimeout(() => resolve({ timeout: true }), 3000);
  });
  console.log("keyboard state:", JSON.stringify(kb));

  const r = await tv.request("ssap://com.webos.service.ime/insertText", { text: "hello from my laptop", replace: 0 });
  console.log("insertText:", JSON.stringify(r));
  await wait(2500);
  await shot("focus-after-type.jpg");

  await tv.disconnect(); process.exit(0);
});
tv.on("error", e => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 70000);
