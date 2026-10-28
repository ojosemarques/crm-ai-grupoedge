import { z } from "zod";

export const metaNativeResponseSchema = z.object({
  formName: z.string().min(1).max(200),
  answers: z.array(z.object({ questionKey: z.string().min(1).max(300), question: z.string().min(1).max(500), displayValue: z.string().max(2000) }).strict()).max(100),
}).strict();

export function metaNativeAnswers(form: { name?: unknown; questions?: unknown }, fields: Record<string, unknown>, fallbackName: string) {
  const questions = Array.isArray(form.questions) ? form.questions.slice(0, 100) as { key?: unknown; label?: unknown; type?: unknown }[] : [];
  return {
    formName: String(form.name || fallbackName).slice(0, 200),
    answers: questions.flatMap((question) => {
      const key = String(question.key ?? "");
      if (question.type !== "CUSTOM" || !key || key.length > 300 || /password|secret|token|authorization|cookie/i.test(key)) return [];
      const value = fields[key];
      if (value === undefined || value === null || !["string", "number", "boolean"].includes(typeof value)) return [];
      return [{ questionKey: key, question: String(question.label || key).slice(0, 500), displayValue: String(value).slice(0, 2000) }];
    }),
  };
}
