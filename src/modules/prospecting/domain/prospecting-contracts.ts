import { createHash } from "node:crypto";

import { z } from "zod";

import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";

export const PROSPECTING_CONTRACT_VERSION = "political-prospect/v1" as const;
export const OPEN_DOT_MAX_BODY_BYTES = 256 * 1024;
export const OPEN_DOT_SIGNATURE_TOLERANCE_SECONDS = 300;
export const PROSPECTING_TIME_ZONE = "America/Sao_Paulo";
export const PROSPECTING_DAILY_CAPACITY = 75;
export const PROSPECTING_DEFAULT_RESERVE_PERCENT = 10;

export const openDotScopeSchema = z.enum([
  "RESEARCH_WRITE",
  "RESEARCH_REVIEW",
  "RESEARCH_READ",
  "EMAIL_CLAIM",
  "EMAIL_RECEIPT",
  "EMAIL_EVENT_WRITE",
]);

export type OpenDotScopeValue = z.infer<typeof openDotScopeSchema>;

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T12:00:00.000Z`)), "Data inválida.");

const brazilianStateSchema = z.enum([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

const contactScopeSchema = z.enum(["POLITICIAN", "ADVISOR", "OFFICE"]);
const roleSchema = z.enum(["MAYOR", "COUNCILOR"]);
const sourceTypeSchema = z.enum([
  "IBGE",
  "TSE",
  "CITY_HALL",
  "CITY_COUNCIL",
  "OFFICIAL_GAZETTE",
  "INSTITUTIONAL_PROFILE",
]);

const populationEditionSchema = z
  .string()
  .trim()
  .min(4)
  .max(120)
  .refine(
    (value) => /^IBGE(?:[_ -]ESTIMATIVA)?[_ -]2026$/i.test(value),
    "Use a edição populacional oficial do IBGE de 2026.",
  );

const electionEditionSchema = z
  .string()
  .trim()
  .max(120)
  .refine(
    (value) => /^TSE[_ -]RESULTADOS?[_ -]2024$/i.test(value),
    "Use o snapshot oficial de resultados do TSE de 2024.",
  );

function publicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|::1$|fc|fd)/i.test(host)) return false;
    const parts = host.split(".").map(Number);
    if (parts.length === 4 && parts.every(Number.isInteger)) {
      if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return false;
      if (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function officialSourceDomain(type: z.infer<typeof sourceTypeSchema>, value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (type === "IBGE") return isHostOrSubdomain(host, "ibge.gov.br");
    if (type === "TSE") return isHostOrSubdomain(host, "tse.jus.br");
    if (type === "CITY_HALL" || type === "OFFICIAL_GAZETTE") {
      return host === "gov.br" || host.endsWith(".gov.br");
    }
    if (type === "CITY_COUNCIL") {
      return host === "gov.br" || host.endsWith(".gov.br") || host === "leg.br" || host.endsWith(".leg.br");
    }
    return true;
  } catch {
    return false;
  }
}

export const prospectCandidateSourceSchema = z.object({
  field: z.enum(["role", "population", "phone", "email", "instagram", "mandate"]),
  type: sourceTypeSchema,
  url: z.string().trim().max(2_000).refine(publicHttpsUrl, "A fonte deve ser uma URL HTTPS pública."),
  observedAt: z.string().datetime({ offset: true }),
  contactScope: contactScopeSchema.optional(),
  originalValue: z.string().trim().max(2_000).optional(),
  normalizedValue: z.string().trim().max(2_000).optional(),
  validationMethod: z.string().trim().min(3).max(160).default("OFFICIAL_SOURCE_CHECK"),
}).strict().superRefine((value, context) => {
  if (!officialSourceDomain(value.type, value.url)) {
    context.addIssue({ code: "custom", path: ["url"], message: "O domínio não corresponde ao tipo de fonte oficial informado." });
  }
  if (value.type === "IBGE" && value.field !== "population") {
    context.addIssue({ code: "custom", path: ["field"], message: "A fonte IBGE só pode comprovar a população." });
  }
  if (value.type === "TSE") {
    if (value.field !== "role") {
      context.addIssue({ code: "custom", path: ["field"], message: "A fonte TSE 2024 só pode comprovar a identidade eleitoral." });
    }
    const sourceVersion = `${value.url} ${value.validationMethod}`;
    if (!sourceVersion.includes("2024")) {
      context.addIssue({ code: "custom", path: ["validationMethod"], message: "A fonte eleitoral deve identificar os resultados oficiais do TSE de 2024." });
    }
  }
});

export const prospectCandidateInputSchema = z.object({
  schemaVersion: z.literal(PROSPECTING_CONTRACT_VERSION),
  idempotencyKey: idempotencyKeySchema,
  batchId: z.string().uuid(),
  externalIdentityKey: z.string().trim().min(8).max(240).regex(/^[A-Za-z0-9_.:-]+$/),
  politician: z.object({
    name: z.string().trim().min(3).max(200),
    role: roleSchema,
    term: z.string().trim().regex(/^\d{4}-\d{4}$/),
    mandateStatus: z.enum(["CURRENT", "INCONCLUSIVE"]),
    mandateVerifiedAt: z.string().datetime({ offset: true }),
  }).strict(),
  municipality: z.object({
    ibgeCode: z.string().regex(/^\d{7}$/),
    name: z.string().trim().min(2).max(160),
    stateCode: brazilianStateSchema,
    population: z.number().int().min(30_000).max(20_000_000),
    populationEdition: populationEditionSchema,
  }).strict(),
  contact: z.object({
    phone: z.string().trim().min(8).max(80),
    phoneScope: contactScopeSchema,
    email: z.string().trim().toLowerCase().email().max(320),
    emailScope: contactScopeSchema,
    instagram: z.string().trim().min(2).max(160).nullable().default(null),
    instagramScope: contactScopeSchema.nullable().default(null),
  }).strict().superRefine((value, context) => {
    if (value.instagram && !value.instagramScope) {
      context.addIssue({ code: "custom", path: ["instagramScope"], message: "O escopo do Instagram é obrigatório quando o perfil é informado." });
    }
    if (!value.instagram && value.instagramScope) {
      context.addIssue({ code: "custom", path: ["instagramScope"], message: "Não informe escopo sem perfil do Instagram." });
    }
  }),
  sources: z.array(prospectCandidateSourceSchema).min(4).max(40),
  agentVersion: z.string().trim().min(1).max(120),
  promptVersion: z.string().trim().min(1).max(120),
}).strict().superRefine((value, context) => {
  const phone = normalizePhone(value.contact.phone);
  if (!phone.success) {
    context.addIssue({ code: "custom", path: ["contact", "phone"], message: phone.message });
  }
  const requiredFields = ["role", "mandate", "population", "phone", "email"] as const;
  for (const field of requiredFields) {
    if (!value.sources.some((source) => source.field === field)) {
      context.addIssue({ code: "custom", path: ["sources"], message: `Falta fonte verificável para ${field}.` });
    }
  }
  const officialRoleTypes = value.politician.role === "MAYOR"
    ? new Set(["CITY_HALL", "OFFICIAL_GAZETTE"])
    : new Set(["CITY_COUNCIL", "OFFICIAL_GAZETTE"]);
  if (!value.sources.some((source) => (source.field === "role" || source.field === "mandate") && officialRoleTypes.has(source.type))) {
    context.addIssue({ code: "custom", path: ["sources"], message: "O mandato atual exige fonte oficial municipal compatível com o cargo." });
  }
  if (!value.sources.some((source) => source.field === "population" && source.type === "IBGE")) {
    context.addIssue({ code: "custom", path: ["sources"], message: "A população exige fonte do IBGE." });
  }
  if (!value.sources.some((source) => source.field === "role" && source.type === "TSE")) {
    context.addIssue({ code: "custom", path: ["sources"], message: "A identidade eleitoral exige o resultado oficial do TSE de 2024 como fonte histórica." });
  }
});

export type ProspectCandidateInput = z.infer<typeof prospectCandidateInputSchema>;

export const researchBatchInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  horizonStart: isoDateSchema,
  horizonEnd: isoDateSchema,
  sourcePopulationEdition: populationEditionSchema,
  sourcePopulationHash: z.string().trim().regex(/^[a-f0-9]{64}$/),
  sourcePopulationImportedAt: z.string().datetime({ offset: true }),
  sourceElectionEdition: electionEditionSchema,
  sourceElectionHash: z.string().trim().regex(/^[a-f0-9]{64}$/),
  sourceElectionImportedAt: z.string().datetime({ offset: true }),
  agentVersion: z.string().trim().min(1).max(120),
  promptVersion: z.string().trim().min(1).max(120),
}).strict().superRefine((value, context) => {
  const durationDays = (Date.parse(`${value.horizonEnd}T12:00:00.000Z`) - Date.parse(`${value.horizonStart}T12:00:00.000Z`)) / 86_400_000;
  if (durationDays !== 29) context.addIssue({ code: "custom", path: ["horizonEnd"], message: "O lote deve cobrir exatamente 30 dias corridos." });
});

export const researchBatchCompletionSchema = z.object({
  status: z.enum(["COMPLETED", "CANCELLED", "FAILED"]),
}).strict();

export const candidateReviewInputSchema = z.object({
  status: z.enum(["READY", "REVIEW_REQUIRED", "REJECTED"]),
  reasonCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  expectedRevision: z.number().int().positive(),
  sourceDecisions: z.array(z.object({
    sourceId: z.string().uuid(),
    status: z.enum(["VALID", "INVALID"]),
  }).strict()).max(40).default([]),
}).strict();

export const emailClaimInputSchema = z.object({
  limit: z.number().int().min(1).max(25).default(10),
  leaseSeconds: z.number().int().min(30).max(300).default(120),
}).strict();

export const emailReceiptInputSchema = z.object({
  outcome: z.enum(["SENT", "FAILED", "RECONCILIATION_REQUIRED"]),
  providerMessageId: z.string().trim().min(3).max(500).optional(),
  providerThreadId: z.string().trim().min(1).max(500).optional(),
  errorCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,79}$/).optional(),
  retryable: z.boolean().default(false),
  occurredAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.outcome === "SENT" && !value.providerMessageId) {
    context.addIssue({ code: "custom", path: ["providerMessageId"], message: "O ID real do provedor é obrigatório para confirmar envio." });
  }
  if (value.outcome === "FAILED" && !value.errorCode) {
    context.addIssue({ code: "custom", path: ["errorCode"], message: "O código de erro é obrigatório na falha." });
  }
  if (value.retryable && value.outcome !== "FAILED") {
    context.addIssue({ code: "custom", path: ["retryable"], message: "Somente uma falha pode ser marcada para retry." });
  }
});

export const emailEventInputSchema = z.object({
  externalEventId: z.string().trim().min(3).max(240),
  providerMessageId: z.string().trim().min(3).max(500),
  type: z.enum(["DELIVERED", "REPLIED", "BOUNCED", "COMPLAINT", "UNSUBSCRIBED"]),
  occurredAt: z.string().datetime({ offset: true }),
  automaticReply: z.boolean().default(false),
  metadata: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).default({}),
}).strict();

export const openDotHeadersSchema = z.object({
  clientId: z.string().trim().regex(/^[a-z][a-z0-9-]{2,63}$/),
  timestamp: z.string().datetime({ offset: true }),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,160}$/),
  signature: z.string().regex(/^sha256=[a-f0-9]{64}$/),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export function candidateFingerprint(value: ProspectCandidateInput): string {
  const phone = normalizePhone(value.contact.phone);
  return createHash("sha256").update(JSON.stringify({
    identity: value.externalIdentityKey,
    role: value.politician.role,
    term: value.politician.term,
    municipality: value.municipality.ibgeCode,
    phone: phone.success ? phone.normalizedPhone : value.contact.phone,
    email: value.contact.email,
  })).digest("hex");
}

export function canonicalSourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}
