import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { AdapterErrorClassification } from "@/modules/integrations/domain/integration-contracts";

const SECRET_KEY_PATTERN = /(?:authorization|api[-_]?key|token|secret|password|cookie|signature)/i;

export class LocalAdapterFault extends Error {
  constructor(
    readonly failure: AdapterErrorClassification,
  ) {
    super(failure.safeMessage);
    this.name = "LocalAdapterFault";
  }
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitive(entry),
      ]),
    );
  }
  if (typeof value === "string" && /(bearer\s+|gh[pousr]_|sk-)[A-Za-z0-9_.-]+/i.test(value)) {
    return "[REDACTED]";
  }
  return value;
}

export function safeError(error: unknown): AdapterErrorClassification {
  if (error instanceof LocalAdapterFault) return error.failure;
  return {
    classification: "TRANSIENT",
    code: "INTEGRATION_UNEXPECTED_FAILURE",
    safeMessage: "Falha controlada na integração local.",
  };
}

export function calculateRetryDelaySeconds(
  attempt: number,
  baseSeconds = 5,
  retryAfterSeconds?: number,
): number {
  if (retryAfterSeconds !== undefined) return Math.max(1, Math.min(retryAfterSeconds, 3_600));
  const exponential = Math.min(baseSeconds * 2 ** Math.max(0, attempt - 1), 3_600);
  const deterministicJitter = (attempt * 17) % Math.max(1, Math.ceil(exponential * 0.2));
  return exponential + deterministicJitter;
}

export function signLocalWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyLocalWebhookSignature(input: Readonly<{
  secret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  now: Date;
  toleranceSeconds: number;
}>): "VERIFIED" | "INVALID" | "EXPIRED" {
  const timestamp = new Date(input.timestamp);
  if (Number.isNaN(timestamp.getTime())) return "INVALID";
  if (Math.abs(input.now.getTime() - timestamp.getTime()) > input.toleranceSeconds * 1_000) return "EXPIRED";
  const expected = signLocalWebhook(input.secret, input.timestamp, input.rawBody);
  const supplied = Buffer.from(input.signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (supplied.length !== wanted.length) return "INVALID";
  return timingSafeEqual(supplied, wanted) ? "VERIFIED" : "INVALID";
}
