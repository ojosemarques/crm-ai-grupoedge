import { z } from "zod";

import {
  WHATSAPP_DEFAULT_GRAPH_API_VERSION,
  WHATSAPP_GRAPH_API_VERSION_ALLOWLIST,
} from "@/modules/integrations/domain/whatsapp-contracts";

const responseSchema = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) }).passthrough();

export type WhatsAppTransportResult = Readonly<{ externalMessageId: string; requestId: string | null }>;
export type WhatsAppSendCommand = Readonly<{
  graphApiVersion?: (typeof WHATSAPP_GRAPH_API_VERSION_ALLOWLIST)[number];
  phoneNumberId: string;
  recipient: string;
  body: string;
  idempotencyKey: string;
}>;

export interface WhatsAppTransport {
  readonly externalEgress: boolean;
  sendText(command: WhatsAppSendCommand, accessToken: string): Promise<WhatsAppTransportResult>;
}

export class WhatsAppExternalDisabledError extends Error {
  readonly code = "WHATSAPP_EXTERNAL_EGRESS_DISABLED";
  constructor() {
    super("O transporte externo do WhatsApp está desativado. Use o simulador local.");
    this.name = "WhatsAppExternalDisabledError";
  }
}

export class WhatsAppCloudApiTransport implements WhatsAppTransport {
  readonly externalEgress: boolean;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: Readonly<{ externalEgress?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number }> = {}) {
    this.externalEgress = options.externalEgress === true;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 12_000, 30_000));
  }

  async sendText(command: WhatsAppSendCommand, accessToken: string): Promise<WhatsAppTransportResult> {
    if (!this.externalEgress) throw new WhatsAppExternalDisabledError();
    const version = command.graphApiVersion ?? WHATSAPP_DEFAULT_GRAPH_API_VERSION;
    if (!WHATSAPP_GRAPH_API_VERSION_ALLOWLIST.includes(version)) throw new Error("WHATSAPP_GRAPH_VERSION_NOT_ALLOWLISTED");
    if (!/^\d{5,40}$/.test(command.phoneNumberId) || !/^\d{8,20}$/.test(command.recipient)) throw new Error("WHATSAPP_EXTERNAL_IDENTIFIER_INVALID");
    if (!accessToken.trim()) throw new Error("WHATSAPP_ACCESS_TOKEN_MISSING");
    const response = await this.#fetch(`https://graph.facebook.com/${version}/${command.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "X-Idempotency-Key": command.idempotencyKey },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: command.recipient, type: "text", text: { preview_url: false, body: command.body } }),
      redirect: "error",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const raw = await response.text();
    if (raw.length > 64 * 1024) throw new Error("WHATSAPP_RESPONSE_TOO_LARGE");
    if (!response.ok) throw new Error(`WHATSAPP_PROVIDER_HTTP_${response.status}`);
    const payload = responseSchema.parse(JSON.parse(raw));
    return { externalMessageId: payload.messages[0]!.id, requestId: response.headers.get("x-fb-trace-id") };
  }
}

export class LocalWhatsAppTransport implements WhatsAppTransport {
  readonly externalEgress = false;
  async sendText(command: WhatsAppSendCommand): Promise<WhatsAppTransportResult> {
    const suffix = command.idempotencyKey.replace(/[^A-Za-z0-9]/g, "").slice(-24) || "local";
    return { externalMessageId: `wamid.local.${suffix}`, requestId: `local:${suffix}` };
  }
}

export const whatsappExternalTransport = new WhatsAppCloudApiTransport();
export const localWhatsAppTransport = new LocalWhatsAppTransport();
