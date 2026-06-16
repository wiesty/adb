import { describe, expect, it } from "vitest";
import { pathSegment, toAsciiDomain, zoneKey } from "../../src/utils/path.js";

describe("safe path handling", () => {
  it("normalizes IDNs and keeps zone keys deterministic", () => {
    expect(toAsciiDomain("münich.example")).toBe("xn--mnich-kva.example");
    expect(zoneKey("Example.COM.", "ns.example")).toBe("example.com\u0000ns.example");
  });

  it("prevents traversal-like segments from leaking into object names", () => {
    const segment = pathSegment("../ä/../../secret", "zone");
    expect(segment).not.toContain("/");
    expect(segment).not.toContain("..");
    expect(segment).toMatch(/[a-f0-9]{12}$/);
  });
});
