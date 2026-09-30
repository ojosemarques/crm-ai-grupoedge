import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const code = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._~-]{0,119}$/);
export const pageTrackingBatchSchema = z.object({
  consent: z.literal(true),
  sessionPublicId: z.string().uuid(),
  origin: z.string().url().max(300),
  events: z.array(z.object({
    eventId: z.string().uuid(),
    kind: z.enum(["PAGE_VIEW", "CLICK", "ENGAGEMENT"]),
    occurredAt: z.string().datetime(),
    target: code.optional(),
    durationMs: z.number().int().min(0).max(300_000).optional(),
    utmCampaign: code.optional(),
    utmContent: code.optional(),
  }).strict().superRefine((event, ctx) => {
    if (event.kind === "CLICK" && !event.target) ctx.addIssue({ code: "custom", path: ["target"], message: "Clique exige alvo explícito." });
    if (event.kind === "ENGAGEMENT" && !event.durationMs) ctx.addIssue({ code: "custom", path: ["durationMs"], message: "Tempo ativo obrigatório." });
    if (event.kind !== "CLICK" && event.target) ctx.addIssue({ code: "custom", path: ["target"], message: "Alvo é exclusivo de cliques." });
    if (event.kind !== "ENGAGEMENT" && event.durationMs !== undefined) ctx.addIssue({ code: "custom", path: ["durationMs"], message: "Tempo é exclusivo de engajamento." });
  })).min(1).max(50),
}).strict();

export function verifyPageTrackingSignature(secret: string, rawBody: string, timestamp: string, signature: string, now: Date) {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time) || Math.abs(now.getTime() - time) > 300_000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
