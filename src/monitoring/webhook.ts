import type { Logger } from "./logger.js";
import { sanitizeError } from "../security/redact.js";

export async function sendAlert(
  webhookUrl: string | undefined,
  logger: Logger,
  payload: Record<string, unknown>
): Promise<void> {
  if (!webhookUrl) return;
  try {
    const body = JSON.stringify({
      schemaVersion: 1,
      emittedAt: new Date().toISOString(),
      ...payload
    });
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    if (!res.ok) logger.warn({ status: res.status }, "alert webhook returned non-success status");
  } catch (error) {
    logger.warn({ error: sanitizeError(error) }, "alert webhook failed");
  }
}
