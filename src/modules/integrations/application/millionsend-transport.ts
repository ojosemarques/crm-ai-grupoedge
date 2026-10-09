import { z } from "zod";

import type { EmailSendCommand, EmailTransportAdapter, EmailTransportResult } from "@/modules/integrations/application/email-transport";

const MILLIONSEND_API_ORIGIN = "https://api.millionsend.com";
const responseSchema = z.object({ id: z.string().trim().min(3).max(500) }).passthrough();

export class MillionSendExternalDisabledError extends Error {
  readonly code = "MILLIONSEND_EXTERNAL_EGRESS_DISABLED";

  constructor() {
    super("O envio externo pela MillionSend está desativado.");
    this.name = "MillionSendExternalDisabledError";
  }
}
export class MillionSendProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly outcomeUncertain: boolean;

  constructor(status: number) {
    super(`A MillionSend respondeu com HTTP ${status}.`);
    this.name = "MillionSendProviderError";
    this.code = `MILLIONSEND_HTTP_${status}`;
    this.retryable = status === 408 || status === 429;
    this.outcomeUncertain = status === 409 || status >= 500;
  }
}

export class MillionSendTransport implements EmailTransportAdapter {
  readonly externalEgress: boolean;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: Readonly<{ externalEgress?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number }> = {}) {
    this.externalEgress = options.externalEgress === true;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 12_000, 30_000));
  }

  async send(command: EmailSendCommand, apiKey?: string): Promise<EmailTransportResult> {
    if (!this.externalEgress) throw new MillionSendExternalDisabledError();
    if (!apiKey?.startsWith("ms_") || apiKey.length < 12) throw new Error("MILLIONSEND_API_KEY_MISSING");

    const response = await this.#fetch(`${MILLIONSEND_API_ORIGIN}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": command.idempotencyKey,
      },
      body: JSON.stringify({
        from: command.from,
        to: command.to,
        subject: command.subject,
        text: command.text,
        ...(command.html ? { html: command.html } : {}),
        ...(command.replyTo ? { reply_to: command.replyTo } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    const raw = await response.text();
    if (raw.length > 64 * 1024) throw new Error("MILLIONSEND_RESPONSE_TOO_LARGE");
    if (!response.ok) throw new MillionSendProviderError(response.status);

    const payload = responseSchema.parse(JSON.parse(raw));
    return {
      providerMessageId: payload.id,
      requestId: response.headers.get("x-request-id") ?? payload.id,
      acceptedAt: new Date(),
      simulated: false,
    };
  }
}
