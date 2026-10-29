import { z } from "zod";

export const TELEGRAM_CONNECTION_KEY = "telegram-carlos-lead-alerts";
export const TELEGRAM_CONFIG_VERSION = "telegram-lead-alerts/v1";
export const TELEGRAM_RECIPIENT_EMAIL = "carloshenrique@politizai.com";
export const TELEGRAM_LEAD_JOB_KIND = "TELEGRAM_AD_LEAD_ALERT_V1";

export const telegramBindingSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("PENDING"), recipientMemberId: z.string().uuid(), activationHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime() }).strict(),
  z.object({ state: z.literal("CONNECTED"), recipientMemberId: z.string().uuid(), chatId: z.string().regex(/^[1-9]\d{0,15}$/), telegramUserId: z.string().regex(/^[1-9]\d{0,15}$/) }).strict(),
]);

export const telegramLeadJobSchema = z.object({ kind: z.literal(TELEGRAM_LEAD_JOB_KIND), leadId: z.string().uuid(), recipientMemberId: z.string().uuid() }).strict();

export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z.object({
    message_id: z.number().int().nonnegative(), date: z.number().int().nonnegative(),
    chat: z.object({ id: z.number().int().safe(), type: z.string() }),
    from: z.object({ id: z.number().int().positive().safe(), is_bot: z.boolean() }).optional(),
    text: z.string().max(4096).optional(),
  }).optional(),
});

export function loadTelegramConfig(environment: Readonly<Record<string, string | undefined>> = process.env) {
  if (environment.TELEGRAM_ENABLED !== "true") return null;
  const token = z.string().regex(/^\d{6,15}:[A-Za-z0-9_-]{30,100}$/).parse(environment.TELEGRAM_BOT_TOKEN);
  const webhookSecret = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).parse(environment.TELEGRAM_WEBHOOK_SECRET);
  const url = new URL(z.string().url().parse(environment.APP_CANONICAL_URL));
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("TELEGRAM_CANONICAL_URL_INVALID");
  return { token, webhookSecret, origin: url.origin };
}

export function buildTelegramLeadAlert(input: Readonly<{ leadName: string; receivedAt: Date; timeZone: string }>) {
  const when = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone, dateStyle: "short", timeStyle: "short" }).format(input.receivedAt);
  return `🚨 Chegou um novo lead de anúncio!\n\nCarlos, há um novo lead para você abordar.\nNome: ${input.leadName}\nRecebido em: ${when} (${input.timeZone})\n\nAbra o CRM e inicie o contato agora.`;
}
