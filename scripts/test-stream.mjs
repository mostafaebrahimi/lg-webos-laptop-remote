/** Push a local file to the TV over DLNA and prove it plays. */
import http from "node:http"; import dgram from "node:dgram"; import fs from "node:fs";
import { networkInterfaces } from "node:os"; import { randomBytes } from "node:crypto";
import https from "node:https"; import os from "node:os"; import path from "node:path";
import LGTV from "lgtv2";

const TV = "192.168.1.220";
const file = process.argv[2];
const shotOut = process.argv[3] ?? "/tmp/stream.jpg";
const size = fs.statSync(file).size;

const localIp = Object.values(networkInterfaces()).flat()
  .find((a) => a && a.family === "IPv4" && !a.internal && a.address.startsWith("192.168.1."))?.address;
console.log("serving from", localIp, "to", TV);

// ---- tiny one-file server, TV-only, random path, Range support -------------
const token = randomBytes(16).toString("hex");
const server = http.createServer((req, res) => {
  const remote = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (remote !== TV) { console.log("blocked", remote); res.writeHead(403).end(); return; }
  if (req.url !== `/${token}`) { res.writeHead(404).end(); return; }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
    "transferMode.dlna.org": "Streaming",
    "contentFeatures.dlna.org": "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000" };
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    console.log(`  range ${start}-${end}`);
    res.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
    if (req.method !== "HEAD") fs.createReadStream(file, { start, end }).pipe(res); else res.end();
  } else {
    console.log(`  full request (${req.method})`);
    res.writeHead(200, { ...headers, "Content-Length": size });
    if (req.method !== "HEAD") fs.createReadStream(file).pipe(res); else res.end();
  }
});
const port = await new Promise((r) => server.listen(0, localIp, () => r(server.address().port)));
const url = `http://${localIp}:${port}/${token}`;
console.log("url:", url);

// ---- discover the renderer -------------------------------------------------
const location = await new Promise((resolve) => {
  const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
  s.on("message", (msg, ri) => { if (ri.address === TV) { const l = /^LOCATION:\s*(.+)$/im.exec(msg.toString())?.[1]?.trim(); if (l) { try { s.close(); } catch {} resolve(l); } } });
  s.bind(() => { s.send(Buffer.from(["M-SEARCH * HTTP/1.1","HOST: 239.255.255.250:1900",'MAN: "ssdp:discover"',"MX: 2","ST: urn:schemas-upnp-org:device:MediaRenderer:1","",""].join("\r\n")), 1900, "239.255.255.250");
    setTimeout(() => { try { s.close(); } catch {} resolve(null); }, 4000); });
});
const get = (u) => new Promise((res, rej) => http.get(u, { agent: false }, (r) => { let b=""; r.on("data",(c)=>b+=c); r.on("end",()=>res(b)); }).on("error", rej));
const desc = await get(location);
const base = new URL(location).origin;
const control = /<serviceType>urn:schemas-upnp-org:service:AVTransport:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/.exec(desc)[1];
console.log("renderer:", /<friendlyName>([^<]+)</.exec(desc)?.[1]);

const soap = (action, args) => new Promise((resolve, reject) => {
  const body = Object.entries(args).map(([k, v]) => `<${k}>${String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</${k}>`).join("");
  const env = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">${body}</u:${action}></s:Body></s:Envelope>`;
  const u = new URL(control, base);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", agent: false,
    headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPACTION: `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`, "Content-Length": Buffer.byteLength(env), Connection: "close" } },
    (r) => { let b=""; r.on("data",(c)=>b+=c); r.on("end",()=>resolve({ status: r.statusCode, body: b })); });
  req.on("error", reject); req.write(env); req.end();
});

const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>Test clip</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0" duration="00:00:20.000">${url}</res></item></DIDL-Lite>`;

console.log("\nSetAVTransportURI:", (await soap("SetAVTransportURI", { InstanceID: 0, CurrentURI: url, CurrentURIMetaData: didl })).status);
console.log("Play:", (await soap("Play", { InstanceID: 0, Speed: 1 })).status);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 4; i++) {
  await wait(2500);
  const pos = await soap("GetPositionInfo", { InstanceID: 0 });
  const info = await soap("GetTransportInfo", { InstanceID: 0 });
  const t = (x, n) => new RegExp(`<${n}[^>]*>([^<]*)</${n}>`).exec(x)?.[1];
  console.log(`  t=${t(pos.body,"RelTime")} / ${t(pos.body,"TrackDuration")}  state=${t(info.body,"CurrentTransportState")}`);
}

// seek test
console.log("\nSeek to 00:00:12:", (await soap("Seek", { InstanceID: 0, Unit: "REL_TIME", Target: "00:00:12" })).status);
await wait(2500);
const pos2 = await soap("GetPositionInfo", { InstanceID: 0 });
console.log("  after seek:", /<RelTime[^>]*>([^<]*)</.exec(pos2.body)?.[1]);

// capture the TV to prove it is on screen
const tv = new LGTV({ host: TV, verifyCert: "lg", keyFile: path.join(os.homedir(), ".config", "lg-webos-laptop-remote", "pairing", `keyfile-${TV}`), timeout: 12000, reconnect: false });
await new Promise((res) => { tv.on("connect", res); tv.on("error", res); });
const shot = await tv.request("ssap://tv/executeOneShot");
await new Promise((res, rej) => https.get(shot.imageUri, { rejectUnauthorized: false }, (r) => { const w = fs.createWriteStream(shotOut); r.pipe(w); w.on("finish", () => w.close(res)); }).on("error", rej));
console.log("captured:", shotOut);

await wait(1500);
console.log("Stop:", (await soap("Stop", { InstanceID: 0 })).status);
server.close();
await tv.disconnect();
process.exit(0);
