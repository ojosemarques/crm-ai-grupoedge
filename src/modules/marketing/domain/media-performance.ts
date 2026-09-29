import { createHash } from "node:crypto";
import { z } from "zod";

export const MEDIA_IMPORT_MAX_BYTES = 512 * 1024;
export const MEDIA_IMPORT_MAX_ROWS = 2_000;
export const MEDIA_RULE_VERSION = "crm39-media-v1";
const key = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{1,119}$/);
const safeText = z.string().trim().min(1).max(200).refine((value) => !/^[=+@-]/.test(value), "Conteúdo semelhante a fórmula não é permitido.");
const nonNegative = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const mediaRowSchema = z.object({
  date: z.string().date(), channelKey: key, channelName: safeText,
  accountKey: key.optional(), accountName: safeText.optional(), campaignKey: key.optional(), campaignName: safeText.optional(),
  legacyCampaignId: z.string().uuid().optional(), adGroupKey: key.optional(), adGroupName: safeText.optional(), adKey: key.optional(), adName: safeText.optional(), creativeKey: key.optional(), creativeName: safeText.optional(), legacyCreativeId: z.string().uuid().optional(),
  currency: z.string().trim().toUpperCase().length(3).default("BRL"), timeZone: z.string().trim().min(3).max(80).default("America/Sao_Paulo"),
  spendCents: nonNegative, impressions: nonNegative, reach: nonNegative, clicks: nonNegative,
  linkClicks: nonNegative, landingPageViews: nonNegative, reportedLeads: nonNegative,
  reportedPurchases: nonNegative, reportedRevenueCents: nonNegative,
}).strict().refine((row) => row.reach <= row.impressions, { message: "Alcance maior que impressões exige revisão.", path: ["reach"] });

export type MediaRow = z.infer<typeof mediaRowSchema>;
export type ParsedMediaRow = Readonly<{ rowNumber: number; valid: boolean; value?: MediaRow; errors: string[] }>;

function cells(line: string): string[] {
  const result: string[] = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { result.push(current.trim()); current = ""; }
    else current += char;
  }
  result.push(current.trim());
  return result;
}

export function parseMarketingPerformanceCsv(csv: string): { hash: string; rows: ParsedMediaRow[] } {
  if (Buffer.byteLength(csv, "utf8") > MEDIA_IMPORT_MAX_BYTES) throw new Error("Arquivo excede 512 KiB.");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV precisa de cabeçalho e ao menos uma linha.");
  if (lines.length - 1 > MEDIA_IMPORT_MAX_ROWS) throw new Error("CSV excede 2.000 linhas.");
  const headers = cells(lines[0]!);
  const required = ["date","channelKey","channelName","spendCents","impressions","reach","clicks","linkClicks","landingPageViews","reportedLeads","reportedPurchases","reportedRevenueCents"];
  for (const name of required) if (!headers.includes(name)) throw new Error(`Coluna obrigatória ausente: ${name}.`);
  const rows = lines.slice(1).map((line, offset) => {
    const values = cells(line); const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] || undefined]));
    const parsed = mediaRowSchema.safeParse(raw);
    return parsed.success ? { rowNumber: offset + 2, valid: true, value: parsed.data, errors: [] } : { rowNumber: offset + 2, valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  });
  return { hash: createHash("sha256").update(csv).digest("hex"), rows };
}

export type MediaMetric = Readonly<{ key: string; label: string; value: number | null; unit: "BRL_CENTS" | "COUNT" | "BPS"; numerator: number; denominator: number | null; unavailableReason: string | null; interpretation: "POSITIVE" | "NEGATIVE" | "CONTEXT" }>;
const ratio = (key: string, label: string, numerator: number, denominator: number, scale: number, unit: MediaMetric["unit"], interpretation: MediaMetric["interpretation"]): MediaMetric => ({ key, label, value: denominator === 0 ? null : Math.round(numerator * scale / denominator), unit, numerator, denominator, unavailableReason: denominator === 0 ? "SEM_BASE" : null, interpretation });

export function calculateMediaMetrics(input: Readonly<{ spendCents: number; impressions: number; clicks: number; reportedLeads: number; qualified: number; opportunities: number; wins: number; attributedWonRevenueCents: number }>): MediaMetric[] {
  return [
    ratio("cpm", "CPM", input.spendCents, input.impressions, 1_000, "BRL_CENTS", "NEGATIVE"),
    ratio("ctr", "CTR", input.clicks, input.impressions, 10_000, "BPS", "POSITIVE"),
    ratio("cpc", "CPC", input.spendCents, input.clicks, 1, "BRL_CENTS", "NEGATIVE"),
    ratio("cpl", "CPL observado", input.spendCents, input.reportedLeads, 1, "BRL_CENTS", "NEGATIVE"),
    ratio("cost_per_qualified", "Custo por qualificado", input.spendCents, input.qualified, 1, "BRL_CENTS", "NEGATIVE"),
    ratio("cost_per_opportunity", "Custo por oportunidade", input.spendCents, input.opportunities, 1, "BRL_CENTS", "NEGATIVE"),
    ratio("media_cac", "CAC de mídia observado", input.spendCents, input.wins, 1, "BRL_CENTS", "NEGATIVE"),
    ratio("observed_roas", "ROAS observado", input.attributedWonRevenueCents, input.spendCents, 10_000, "BPS", "POSITIVE"),
  ];
}

export const mediaImportPreviewSchema = z.object({ fileName: safeText, csv: z.string().min(1).max(MEDIA_IMPORT_MAX_BYTES), idempotencyKey: z.string().trim().min(8).max(200) }).strict();
export const mediaImportConfirmSchema = z.object({ previewRunId: z.string().uuid(), idempotencyKey: z.string().trim().min(8).max(200) }).strict();
export const mediaImportRollbackSchema = z.object({ importRunId: z.string().uuid(), reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().trim().min(8).max(200) }).strict();
export const mediaBackfillSchema = z.object({ mode: z.enum(["DRY_RUN","EXECUTE"]), idempotencyKey: z.string().trim().min(8).max(200) }).strict();
export const mediaReconciliationSchema = z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date(), idempotencyKey: z.string().trim().min(8).max(200) }).strict().refine((v) => v.periodEnd > v.periodStart, { path: ["periodEnd"], message: "Período inválido." });
