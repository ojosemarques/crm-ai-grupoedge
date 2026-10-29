import { describe, expect, it, vi } from "vitest";
import { TelegramTransport, TelegramTransportError } from "./telegram-transport";
import { loadTelegramConfig, buildTelegramLeadAlert } from "../domain/telegram-contracts";
import { verifyTelegramWebhookSecret } from "./telegram-lead-alert-service";

const env = { TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: `123456789:${"a".repeat(35)}`, TELEGRAM_WEBHOOK_SECRET: "w".repeat(40), APP_CANONICAL_URL: "https://crm.example.test" };

describe("Telegram: transporte e fronteiras", () => {
  it("envia texto sem interpretar dados do lead e inclui o botão autenticado do CRM", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 100 } }), { status: 200 }));
    await expect(new TelegramTransport(env.TELEGRAM_BOT_TOKEN, fetcher).send({ chatId: "12345", text: "Lead <teste>", leadUrl: "https://crm.example.test/leads/teste/historico" })).resolves.toEqual({ messageId: 100 });
    const request = fetcher.mock.calls[0]![1];
    expect(JSON.parse(request.body)).toEqual({ chat_id: "12345", text: "Lead <teste>", link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [[{ text: "Abrir lead no CRM", url: "https://crm.example.test/leads/teste/historico" }]] } });
    expect(request.redirect).toBe("error");
  });

  it("respeita o prazo de retry da plataforma sem incluir a resposta do provedor no erro", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "dados privados", parameters: { retry_after: 20 } }), { status: 429 }));
    await expect(new TelegramTransport(env.TELEGRAM_BOT_TOKEN, fetcher).send({ chatId: "12345", text: "teste" })).rejects.toMatchObject({ code: "TELEGRAM_HTTP_429", retryable: true, retryAfterSeconds: 20, message: "TELEGRAM_HTTP_429" });
  });

  it.each([400, 403])("trata HTTP %s como falha permanente", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status }));
    await expect(new TelegramTransport(env.TELEGRAM_BOT_TOKEN, fetcher).send({ chatId: "12345", text: "teste" })).rejects.toMatchObject({ retryable: false });
  });

  it("não propaga URL com token em exceções de rede", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`));
    const error = await new TelegramTransport(env.TELEGRAM_BOT_TOKEN, fetcher).send({ chatId: "12345", text: "teste" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramTransportError);
    expect(String(error)).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });

  it("valida o segredo do webhook antes de aceitar dados", () => {
    expect(() => verifyTelegramWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET, env)).not.toThrow();
    for (const secret of [null, "outro", "x".repeat(40)]) expect(() => verifyTelegramWebhookSecret(secret, env)).toThrow("Webhook não autorizado.");
  });

  it("desativa sem credenciais e recusa origem insegura", () => {
    expect(loadTelegramConfig({})).toBeNull();
    expect(() => loadTelegramConfig({ ...env, APP_CANONICAL_URL: "http://crm.example.test" })).toThrow();
  });

  it("identifica o recebimento no fuso do workspace", () => {
    const text = buildTelegramLeadAlert({ leadName: "Contato de teste", receivedAt: new Date("2035-02-20T15:00:00Z"), timeZone: "America/Sao_Paulo" });
    expect(text).toContain("Carlos, há um novo lead");
    expect(text).toContain("20/02/2035, 12:00");
    expect(text).not.toContain("http");
  });
});
