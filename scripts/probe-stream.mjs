/** What can this TV do for playing media from the laptop? */
import os from "node:os"; import path from "node:path"; import dgram from "node:dgram"; import http from "node:http";
import LGTV from "lgtv2";

const host = "192.168.1.220";

// ---------------------------------------------------------------- 1. SSDP
function ssdp(target, ms = 4000) {
  return new Promise((resolve) => {
    const found = [];
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (msg, rinfo) => {
      const text = msg.toString();
      if (rinfo.address !== host) return;
      const loc = /^LOCATION:\s*(.+)$/im.exec(text)?.[1]?.trim();
      const st = /^ST:\s*(.+)$/im.exec(text)?.[1]?.trim();
      if (loc && !found.some((f) => f.loc === loc)) found.push({ st, loc });
    });
    socket.bind(() => {
      const payload = Buffer.from(
        ["M-SEARCH * HTTP/1.1", "HOST: 239.255.255.250:1900", 'MAN: "ssdp:discover"', "MX: 2", `ST: ${target}`, "", ""].join("\r\n"),
      );
      socket.send(payload, 1900, "239.255.255.250");
      setTimeout(() => { try { socket.close(); } catch {} resolve(found); }, ms);
    });
  });
}

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, { timeout: 5000 }, (res) => {
    let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve(body));
  }).on("error", reject);
});

console.log("=== SSDP: MediaRenderer ===");
const renderers = await ssdp("urn:schemas-upnp-org:device:MediaRenderer:1");
console.log(renderers.length ? JSON.stringify(renderers, null, 2) : "none");

if (renderers.length) {
  const desc = await get(renderers[0].loc).catch((e) => `error: ${e.message}`);
  const services = [...desc.matchAll(/<serviceType>([^<]+)<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/g)]
    .map((m) => ({ type: m[1], control: m[2] }));
  console.log("friendlyName:", /<friendlyName>([^<]+)</.exec(desc)?.[1]);
  console.log("services:", JSON.stringify(services, null, 2));
}

console.log("\n=== SSDP: all root devices on the TV ===");
const all = await ssdp("upnp:rootdevice");
console.log(all.map((a) => a.loc).join("\n") || "none");

// ---------------------------------------------------------------- 2. SSAP
const tv = new LGTV({ host, verifyCert: "lg", keyFile: path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${host}`), timeout: 12000, reconnect: false });
const probe = async (label, uri, payload) => {
  try {
    const r = payload ? await tv.request(uri, payload) : await tv.request(uri);
    console.log(`OK   ${label}: ${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    console.log(`ERR  ${label}: ${e.errorText ?? e.message}`);
  }
};

tv.on("connect", async () => {
  console.log("\n=== SSAP media endpoints ===");
  await probe("media.viewer/open", "ssap://media.viewer/open", { uri: "http://example.com/x.mp4" });
  await probe("media.viewer/play", "ssap://media.viewer/play", {});
  await probe("system.launcher/open", "ssap://system.launcher/open", { target: "http://example.com/x.mp4" });
  await probe("photovideo launch", "ssap://com.webos.applicationManager/launch", { id: "com.webos.app.photovideo" });
  await probe("getAppState", "ssap://system.launcher/getAppState", { id: "com.webos.app.photovideo" });
  await tv.disconnect();
  process.exit(0);
});
tv.on("error", (e) => { console.error("ssap error:", e.message); process.exit(1); });
setTimeout(() => process.exit(1), 45000);
