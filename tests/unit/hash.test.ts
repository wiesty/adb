import { describe, expect, it } from "vitest";
import { canonicalZonePayload, gzipJson, gunzipJson, sha256Hex } from "../../src/utils/hash.js";

describe("hashing and gzip", () => {
  it("roundtrips gzip JSON and hashes bytes", () => {
    const gz = gzipJson({ hello: "world" });
    expect(gunzipJson(gz)).toEqual({ hello: "world" });
    expect(sha256Hex(gz)).toHaveLength(64);
  });

  it("ignores volatile transaction fields for content hashes", () => {
    const a = canonicalZonePayload({
      stid: "one",
      data: [{ origin: "example.com", resourceRecords: [] }]
    });
    const b = canonicalZonePayload({
      stid: "two",
      data: [{ origin: "example.com", resourceRecords: [] }]
    });
    expect(a).toBe(b);
  });
});
