const secretKeyPattern = /(authorization|password|secret|token|access[_-]?key|webhook|session)/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = secretKeyPattern.test(key) ? "[REDACTED]" : redact(entry);
  }
  return out;
}

export function sanitizeHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries =
    headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [key, value] of entries) out[key] = secretKeyPattern.test(key) ? "[REDACTED]" : value;
  return out;
}

export function sanitizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return redact({ name: error.name, message: error.message, stack: error.stack }) as Record<
      string,
      unknown
    >;
  }
  return redact({ error }) as Record<string, unknown>;
}
