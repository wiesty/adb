import { domainToASCII } from "node:url";
import { sha256Hex } from "./hash.js";

export function toAsciiDomain(name: string): string {
  const trimmed = name.trim().replace(/\.$/, "");
  return domainToASCII(trimmed) || trimmed.toLowerCase();
}

export function zoneKey(origin: string, virtualNameServer?: string): string {
  return `${toAsciiDomain(origin)}\u0000${(virtualNameServer || "").trim().toLowerCase()}`;
}

export function pathSegment(input: string, fallback = "value"): string {
  const normalized = input.normalize("NFKC");
  const ascii = toAsciiDomain(normalized);
  const slug =
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/\.\.+/g, ".")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 80) || fallback;
  return `${slug}-${sha256Hex(normalized).slice(0, 12)}`;
}

export function safeJoinKey(...segments: string[]): string {
  return segments
    .map((segment) => {
      if (segment.includes("/") || segment.includes("\\") || segment === "." || segment === "..") {
        throw new Error(`unsafe object key segment: ${segment}`);
      }
      return segment;
    })
    .join("/");
}
