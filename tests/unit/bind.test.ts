import { describe, expect, it } from "vitest";
import { exportBind } from "../../src/bind/exporter.js";

describe("BIND exporter", () => {
  it("renders common records and escapes TXT", () => {
    const result = exportBind({
      origin: "münich.example",
      resourceRecords: [
        { name: "@", type: "A", value: "192.0.2.10", ttl: 300 },
        { name: "mail", type: "MX", value: "mail.example.com", pref: 10 },
        { name: "@", type: "TXT", value: 'hello "quoted" text' },
        { name: "_sip._tcp", type: "SRV", value: "10 20 5060 sip.example.com" }
      ]
    });
    expect(result.zoneFile).toContain("$ORIGIN xn--mnich-kva.example.");
    expect(result.zoneFile).toContain("@ 300 IN A 192.0.2.10");
    expect(result.zoneFile).toContain('IN TXT "hello \\"quoted\\" text"');
    expect(result.warnings).toEqual([]);
  });

  it("warns for unknown record types", () => {
    const result = exportBind({
      origin: "example.com",
      resourceRecords: [{ name: "@", type: "TYPE65534", value: "\\# 1 00" }]
    });
    expect(result.warnings[0]).toContain("unsupported");
    expect(result.zoneFile).toContain("; unsupported TYPE65534");
  });
});
