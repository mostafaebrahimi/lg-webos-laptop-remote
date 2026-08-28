/** Launch YouTube with a search deep link, then capture the screen to see what happened. */
import os from "node:os";
import path from "node:path";
import https from "node:https";
import fs from "node:fs";
import LGTV from "lgtv2";

const host = "192.168.1.220";
const keyFile = path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${host}`);
const tv = new LGTV({ host, verifyCert: "lg", keyFile, timeout: 15000, reconnect: false });
const query = process.argv[2] ?? "tom and jerry";
const out = process.argv[3] ?? "/tmp/tv-deeplink.jpg";

const download = (url, file) =>
  new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const s = fs.createWriteStream(file);
      res.pipe(s);
      s.on("finish", () => s.close(() => resolve(file)));
    }).on("error", reject);
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

tv.on("connect", async () => {
  try {
    const res = await tv.request("ssap://com.webos.applicationManager/launch", {
      id: "youtube.leanback.v4",
      params: { contentTarget: `q=${encodeURIComponent(query)}` },
    });
    console.log("launch:", JSON.stringify(res));
  } catch (e) {
    console.log("launch ERR:", e.errorText ?? e.message);
  }
  await wait(6000);
  const shot = await tv.request("ssap://tv/executeOneShot");
  await download(shot.imageUri, out);
  console.log("captured:", out);
  await tv.disconnect();
  process.exit(0);
});
tv.on("error", (e) => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 40000);
