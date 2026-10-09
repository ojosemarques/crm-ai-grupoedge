import { randomBytes } from "node:crypto";

import { signOpenDotRequest } from "@/modules/prospecting/domain/open-dot-policy";

type OpenDotHttpClientOptions = Readonly<{
  baseUrl: string;
  clientId: string;
  secret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}>;

export class OpenDotHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`A API Open-Dot respondeu com HTTP ${status}.`);
    this.name = "OpenDotHttpError";
    this.status = status;
  }
}
export function createOpenDotHttpClient(options: OpenDotHttpClientOptions) {
  const baseUrl = new URL(options.baseUrl);
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  if (options.clientId.length < 3 || options.secret.length < 32) throw new Error("OPEN_DOT_CLIENT_CONFIGURATION_INVALID");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 12_000, 30_000));

  return Object.freeze({
    async post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
      if (!path.startsWith("/api/integrations/open-dot/v1/")) throw new Error("OPEN_DOT_PATH_NOT_ALLOWLISTED");
      const rawBody = JSON.stringify(body);
      const timestamp = now().toISOString();
      const nonce = randomBytes(24).toString("base64url");
      const signature = signOpenDotRequest({ secret: options.secret, method: "POST", path, timestamp, nonce, rawBody });
      const response = await fetchImpl(new URL(path, baseUrl).toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-Open-Dot-Client-Id": options.clientId,
          "X-Open-Dot-Timestamp": timestamp,
          "X-Open-Dot-Nonce": nonce,
          "X-Open-Dot-Signature": signature,
        },
        body: rawBody,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      if (raw.length > 256 * 1024) throw new Error("OPEN_DOT_RESPONSE_TOO_LARGE");
      if (!response.ok) throw new OpenDotHttpError(response.status);
      return JSON.parse(raw) as T;
    },
  });
}
