import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { N8N_MAX_CAUSATION_DEPTH, N8N_SIGNATURE_TOLERANCE_SECONDS } from "@/modules/integrations/domain/n8n-contracts";

export function hashN8nToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function fingerprintN8nToken(token: string): string { return hashN8nToken(token).slice(0, 16); }
export function createEphemeralN8nToken(): string { return `n8n_local_${randomBytes(32).toString("base64url")}`; }
export function signN8nRequest(token: string, timestamp: string, nonce: string, idempotencyKey: string, rawBody: string): string {
  return createHmac("sha256", token).update(`${timestamp}.${nonce}.${idempotencyKey}.${rawBody}`).digest("hex");
}
export function verifyN8nRequest(input: Readonly<{ token: string; timestamp: string; nonce: string; idempotencyKey: string; rawBody: string; signature: string; now: Date }>): "VERIFIED" | "INVALID" | "EXPIRED" {
  const timestamp = new Date(input.timestamp);
  if (Number.isNaN(timestamp.getTime())) return "INVALID";
  if (Math.abs(input.now.getTime() - timestamp.getTime()) > N8N_SIGNATURE_TOLERANCE_SECONDS * 1_000) return "EXPIRED";
  const expected = Buffer.from(signN8nRequest(input.token, input.timestamp, input.nonce, input.idempotencyKey, input.rawBody), "hex");
  const supplied = Buffer.from(input.signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? "VERIFIED" : "INVALID";
}
export function assertCausationDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 0 || depth > N8N_MAX_CAUSATION_DEPTH) throw new Error("N8N_CAUSATION_DEPTH_EXCEEDED");
}
export function safeN8nPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeN8nPayload);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|authorization|cookie|phone|email|document)/i.test(key)).map(([key, entry]) => [key, safeN8nPayload(entry)]));
  if (typeof value === "string" && /(?:Bearer\s+|sk-|gh[pousr]_)[A-Za-z0-9_.-]+/i.test(value)) return "[REDACTED]";
  return value;
}
