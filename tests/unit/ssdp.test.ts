import { describe, expect, it } from "vitest";
import { header } from "../../src/main/discovery/ssdp";
import { describeDriver, listDrivers, createDriver, DEFAULT_DRIVER_ID } from "../../src/main/tv/drivers/registry";

const SSDP_REPLY = [
  "HTTP/1.1 200 OK",
  "Location: http://192.168.1.220:2020/",
  "Cache-Control: max-age=1800",
  "Server: WebOS/4.1.0 UPnP/1.0",
  "USN: uuid:649dcbf2::urn:lge-com:service:webos-second-screen:1",
  "ST: urn:lge-com:service:webos-second-screen:1",
].join("\r\n");

describe("ssdp header parsing", () => {
  it("reads headers case-insensitively", () => {
    expect(header(SSDP_REPLY, "ST")).toBe("urn:lge-com:service:webos-second-screen:1");
    expect(header(SSDP_REPLY, "server")).toBe("WebOS/4.1.0 UPnP/1.0");
  });

  it("returns undefined for absent headers", () => {
    expect(header(SSDP_REPLY, "NOTPRESENT")).toBeUndefined();
  });
});

describe("driver registry", () => {
  it("defaults to webOS and can describe it", () => {
    expect(DEFAULT_DRIVER_ID).toBe("webos");
    const webos = describeDriver("webos");
    expect(webos.implemented).toBe(true);
    expect(webos.features.pointer).toBe(true);
  });

  it("lists brands that are declared but not implemented", () => {
    const samsung = listDrivers().find((driver) => driver.id === "samsung");
    expect(samsung?.implemented).toBe(false);
  });

  it("refuses to create a driver that has no implementation", () => {
    expect(() => createDriver("samsung")).toThrow(/not implemented/i);
    expect(() => createDriver("nonsense")).toThrow(/Unknown TV type/i);
  });

  it("every declared driver has the metadata the UI needs", () => {
    for (const driver of listDrivers()) {
      expect(driver.name.length).toBeGreaterThan(0);
      expect(driver.summary.length).toBeGreaterThan(0);
      expect(driver.setupHint.length).toBeGreaterThan(0);
    }
  });
});
