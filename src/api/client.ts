import { setTimeout as sleep } from "node:timers/promises";
import type { AppConfig } from "../config/config.js";
import { sanitizeError } from "../security/redact.js";
import { toAsciiDomain } from "../utils/path.js";
import { AutoDnsAuthError, AutoDnsHttpError, AutoDnsTimeoutError } from "./errors.js";
import { RateLimiter } from "./rateLimiter.js";
import { AutoDnsResponseSchema, type AutoDnsZoneResponse } from "./schemas.js";

export interface ApiAttempt {
  method: string;
  path: string;
  attempt: number;
  durationMs: number;
  status?: number;
  error?: string;
}

export interface AutoDnsClientOptions {
  onAttempt?: (attempt: ApiAttempt) => void;
  fetchImpl?: typeof fetch;
}

export class AutoDnsClient {
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: Pick<
      AppConfig,
      | "AUTODNS_BASE_URL"
      | "AUTODNS_USERNAME"
      | "AUTODNS_PASSWORD"
      | "AUTODNS_CONTEXT"
      | "AUTODNS_USER_AGENT"
      | "BACKUP_REQUESTS_PER_SECOND"
      | "BACKUP_REQUEST_TIMEOUT_MS"
      | "BACKUP_MAX_RETRIES"
    >,
    private readonly options: AutoDnsClientOptions = {}
  ) {
    this.limiter = new RateLimiter(config.BACKUP_REQUESTS_PER_SECOND);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listZones(offset: number, limit: number): Promise<AutoDnsZoneResponse> {
    const keys = [
      "created",
      "updated",
      "virtualNameServer",
      "domainsafe",
      "name",
      "comment",
      "action",
      "primary",
      "changed"
    ];
    const qs = new URLSearchParams();
    for (const key of keys) qs.append("keys[]", key);
    return this.request("POST", `/zone/_search?${qs.toString()}`, {
      view: { offset, limit, children: true },
      orders: [{ key: "name", type: "ASC" }]
    });
  }

  async getZoneInfo(origin: string, virtualNameServer: string): Promise<AutoDnsZoneResponse> {
    const zoneName = toAsciiDomain(origin);
    const path = `/zone/${encodeURIComponent(zoneName)}/${encodeURIComponent(virtualNameServer)}`;
    return this.request("GET", path);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<AutoDnsZoneResponse> {
    const maxAttempts = this.config.BACKUP_MAX_RETRIES + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      try {
        const response = await this.limiter.schedule(() =>
          this.fetchWithTimeout(method, path, body)
        );
        const responseBody = await response.text();
        this.options.onAttempt?.({
          method,
          path: path.split("?")[0] || path,
          attempt,
          durationMs: Date.now() - started,
          status: response.status
        });
        if (response.status === 401 || response.status === 403) {
          throw new AutoDnsAuthError(response.status, responseBody);
        }
        if (!response.ok) {
          const error = new AutoDnsHttpError(
            `AutoDNS request failed with status ${response.status}`,
            response.status,
            responseBody
          );
          if (this.shouldRetryStatus(response.status) && attempt < maxAttempts) {
            await this.backoff(attempt);
            continue;
          }
          throw error;
        }
        return AutoDnsResponseSchema.parse(JSON.parse(responseBody));
      } catch (error) {
        lastError = error;
        this.options.onAttempt?.({
          method,
          path: path.split("?")[0] || path,
          attempt,
          durationMs: Date.now() - started,
          error: String((sanitizeError(error).message as string | undefined) ?? error)
        });
        if (error instanceof AutoDnsAuthError) throw error;
        const retryable =
          error instanceof AutoDnsTimeoutError ||
          error instanceof TypeError ||
          error instanceof SyntaxError ||
          (error instanceof AutoDnsHttpError && this.shouldRetryStatus(error.status));
        if (!retryable || attempt >= maxAttempts) throw error;
        await this.backoff(attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchWithTimeout(method: string, path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.BACKUP_REQUEST_TIMEOUT_MS);
    try {
      const basic = Buffer.from(
        `${this.config.AUTODNS_USERNAME}:${this.config.AUTODNS_PASSWORD}`,
        "utf8"
      ).toString("base64");
      return await this.fetchImpl(this.buildUrl(path), {
        method,
        signal: controller.signal,
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": this.config.AUTODNS_USER_AGENT,
          "X-Domainrobot-Context": this.config.AUTODNS_CONTEXT
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw new AutoDnsTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private shouldRetryStatus(status: number): boolean {
    return [429, 502, 503, 504].includes(status);
  }

  private buildUrl(path: string): URL {
    return new URL(`${this.config.AUTODNS_BASE_URL.replace(/\/+$/, "")}${path}`);
  }

  private async backoff(attempt: number): Promise<void> {
    const base = Math.min(30000, 250 * 2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * base * 0.25);
    await sleep(base + jitter);
  }
}
