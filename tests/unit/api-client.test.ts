import { describe, expect, it, vi } from "vitest";
import { AutoDnsClient } from "../../src/api/client.js";
import { AutoDnsAuthError } from "../../src/api/errors.js";

const baseConfig = {
  AUTODNS_BASE_URL: "https://api.autodns.test/v1",
  AUTODNS_USERNAME: "user",
  AUTODNS_PASSWORD: "pass",
  AUTODNS_CONTEXT: "4",
  AUTODNS_USER_AGENT: "test/1",
  BACKUP_REQUESTS_PER_SECOND: 100,
  BACKUP_REQUEST_TIMEOUT_MS: 1000,
  BACKUP_MAX_RETRIES: 1
};

describe("AutoDnsClient", () => {
  it("uses Basic Auth, context, keys and offset pagination", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
    );
    const client = new AutoDnsClient(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await client.listZones(500, 250);
    const calls = fetchImpl.mock.calls as unknown as Array<[URL, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(String(url)).toContain("/v1/zone/_search?");
    expect(String(url)).toContain("keys%5B%5D=created");
    expect((init as RequestInit).headers).toMatchObject({
      "X-Domainrobot-Context": "4",
      "user-agent": "test/1"
    });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      view: { offset: 500, limit: 250 }
    });
  });

  it("encodes IDN zone names for detail requests", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ origin: "münich.example" }] }), { status: 200 })
    );
    const client = new AutoDnsClient(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await client.getZoneInfo("münich.example", "ns/virtual");
    const calls = fetchImpl.mock.calls as unknown as Array<[URL, RequestInit]>;
    expect(String(calls[0]![0])).toContain("/zone/xn--mnich-kva.example/ns%2Fvirtual");
  });

  it("aborts the run on 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const client = new AutoDnsClient(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(client.listZones(0, 1)).rejects.toBeInstanceOf(AutoDnsAuthError);
  });
});
