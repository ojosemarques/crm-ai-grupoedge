import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const quizIdSchema = z.enum(["chatmandato", "quizmandato"]);
const tokenPattern = /^(chatmandato|quizmandato)\.([a-f0-9-]{36})\.(\d{13})\.([a-f0-9]{64})$/;
const lifetimeMs = 72 * 60 * 60_000;

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(`politizai:quiz-agenda:v1:${value}`).digest("hex");
}

export function createQuizAgendaToken(quiz: z.infer<typeof quizIdSchema>, submissionId: string, completedAt: Date, secret: string) {
  const value = `${quiz}.${submissionId}.${completedAt.getTime() + lifetimeMs}`;
  return `${value}.${signature(value, secret)}`;
}

export function parseQuizAgendaToken(token: string) {
  const match = tokenPattern.exec(token);
  if (!match) return null;
  const [, quiz, submissionId, expiresAt] = match;
  const parsed = quizIdSchema.safeParse(quiz);
  return parsed.success && z.uuid().safeParse(submissionId).success
    ? { quiz: parsed.data, submissionId: submissionId!, expiresAt: Number(expiresAt) }
    : null;
}

export function verifyQuizAgendaToken(token: string, secret: string, now: Date) {
  const parsed = parseQuizAgendaToken(token);
  if (!parsed || parsed.expiresAt <= now.getTime() || parsed.expiresAt > now.getTime() + lifetimeMs + 300_000) return null;
  const lastDot = token.lastIndexOf(".");
  return timingSafeEqual(Buffer.from(token.slice(lastDot + 1)), Buffer.from(signature(token.slice(0, lastDot), secret))) ? parsed : null;
}
