/** Capture one TV screenshot and save it locally. node scripts/shot.mjs [host] [out] */
import os from "node:os";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import LGTV from "lgtv2";

const host = process.argv[2] ?? "192.168.1.220";
const out = process.argv[3] ?? "/tmp/tv-capture.jpg";
const keyFile = path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${host}`);
const tv = new LGTV({ host, verifyCert: "lg", keyFile, timeout: 15000, reconnect: false });

const download = (url, file) =>
  new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    client
      .get(url, { rejectUnauthorized: false }, (response) => {
        if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
        const stream = fs.createWriteStream(file);
        response.pipe(stream);
        stream.on("finish", () => stream.close(() => resolve(file)));
      })
      .on("error", reject);
  });

tv.on("connect", async () => {
  const result = await tv.request("ssap://tv/executeOneShot");
  console.log("imageUri:", result.imageUri);
  await download(result.imageUri, out);
  console.log("saved:", out, fs.statSync(out).size, "bytes");
  await tv.disconnect();
  process.exit(0);
});
tv.on("error", (e) => { console.error("error:", e.message); process.exit(1); });
setTimeout(() => { console.error("timeout"); process.exit(1); }, 30000);
