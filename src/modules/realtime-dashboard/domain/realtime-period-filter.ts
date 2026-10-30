import { z } from "zod";

export const realtimePeriodLabels = {
  TODAY: "Hoje", YESTERDAY: "Ontem", THIS_WEEK: "Essa semana", LAST_WEEK: "Semana passada", CUSTOM: "Personalizado",
} as const;

export const realtimePeriodQuerySchema = z.object({
  periodPreset: z.enum(["TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "CUSTOM"]).default("TODAY"),
  periodFrom: z.union([z.literal(""), z.iso.date()]).default(""),
  periodTo: z.union([z.literal(""), z.iso.date()]).default(""),
}).strict().superRefine((query, context) => {
  if (query.periodPreset !== "CUSTOM") return;
  const days = (Date.parse(query.periodTo) - Date.parse(query.periodFrom)) / 86_400_000 + 1;
  if (!query.periodFrom || !query.periodTo || !Number.isFinite(days) || days < 1 || days > 366) {
    context.addIssue({ code: "custom", path: ["periodTo"], message: "Informe um intervalo válido de até 366 dias, com início anterior ou igual ao fim." });
  }
});

export type RealtimePeriodQuery = z.infer<typeof realtimePeriodQuerySchema>;
export type RealtimePeriodSelection = Readonly<{ preset: RealtimePeriodQuery["periodPreset"]; label: string }>;

export function readRealtimePeriodQuery(params: URLSearchParams): RealtimePeriodQuery {
  return realtimePeriodQuerySchema.parse({
    periodPreset: params.get("periodPreset") ?? undefined,
    periodFrom: params.get("periodFrom") ?? undefined,
    periodTo: params.get("periodTo") ?? undefined,
  });
}
