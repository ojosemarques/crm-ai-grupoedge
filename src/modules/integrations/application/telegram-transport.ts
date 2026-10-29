import { z } from "zod";

export class TelegramTransportError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly retryAfterSeconds?: number) {
    super(code);
    this.name = "TelegramTransportError";
  }
}

export class TelegramTransport {
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch) {}

  async send(input: Readonly<{ chatId: string; text: string; leadUrl?: string }>) {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ chat_id: input.chatId, text: input.text, link_preview_options: { is_disabled: true },
          ...(input.leadUrl ? { reply_markup: { inline_keyboard: [[{ text: "Abrir lead no CRM", url: input.leadUrl }]] } } : {}),
        }),
      });
    } catch { throw new TelegramTransportError("TELEGRAM_NETWORK_UNCERTAIN", true); }
    let payload: unknown;
    try {
      const raw = await response.text();
      if (raw.length > 65536) throw new Error("OVERSIZED");
      payload = JSON.parse(raw);
    } catch { throw new TelegramTransportError("TELEGRAM_RESPONSE_UNCERTAIN", true); }
    const result = z.object({ ok: z.boolean(), result: z.object({ message_id: z.number().int() }).optional(), parameters: z.object({ retry_after: z.number().int().positive().max(86400).optional() }).optional() }).safeParse(payload);
    if (!response.ok || !result.success || !result.data.ok || !result.data.result) {
      throw new TelegramTransportError(`TELEGRAM_HTTP_${response.status}`, response.status === 429 || response.status >= 500, result.success ? result.data.parameters?.retry_after : undefined);
    }
    return { messageId: result.data.result.message_id };
  }
}
