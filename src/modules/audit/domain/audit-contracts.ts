import { z } from "zod";

export const actorTypes = ["HUMAN", "SYSTEM", "AUTOMATION", "AI_AGENT"] as const;
export const auditOrigins = ["API", "DOMAIN", "SYSTEM", "AUTOMATION", "AI", "SEED"] as const;
export const processViolationTypes = [
  "LEAD_WITHOUT_OPERATIONAL_OWNER",
  "SLA_VIOLATED",
  "LEAD_WITHOUT_ATTEMPT",
  "PACTO_INCOMPLETE",
  "MEETING_WITHOUT_BRIEFING",
  "OPPORTUNITY_WITHOUT_NEXT_ACTION",
  "LEAD_WITHOUT_NEXT_ACTION",
  "LEAD_STAGNANT",
  "INCOHERENT_STAGE_CHANGE",
  "LOST_OPPORTUNITY_WITHOUT_REASON",
] as const;
export const processViolationSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const processViolationStatuses = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;

export type ProcessViolationTypeValue = (typeof processViolationTypes)[number];
export type ProcessViolationSeverityValue = (typeof processViolationSeverities)[number];

const optionalFilter = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => value === "" ? undefined : value, z.enum(values).optional());
const page = z.coerce.number().int().min(1).catch(1);

export const auditQuerySchema = z.object({
  auditSearch: z.string().trim().max(100).catch(""),
  auditActorType: optionalEnum(actorTypes),
  auditActorId: optionalFilter,
  auditOrigin: optionalEnum(auditOrigins),
  auditAction: optionalFilter,
  auditEntityType: optionalFilter,
  auditFrom: optionalFilter,
  auditTo: optionalFilter,
  auditPage: page,
  violationSearch: z.string().trim().max(100).catch(""),
  violationType: optionalEnum(processViolationTypes),
  violationSeverity: optionalEnum(processViolationSeverities),
  violationStatus: optionalEnum(processViolationStatuses),
  violationPage: page,
});

export const processViolationActionSchema = z.object({
  action: z.enum(["ACKNOWLEDGE", "RESOLVE"]),
  reason: z.string().trim().max(500).optional(),
  expectedUpdatedAt: z.coerce.date(),
}).superRefine((value, context) => {
  if (value.action === "RESOLVE" && (!value.reason || value.reason.length < 3)) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Informe o motivo da resolução." });
  }
});

export const processViolationLabels: Readonly<Record<ProcessViolationTypeValue, string>> = Object.freeze({
  LEAD_WITHOUT_OPERATIONAL_OWNER: "Lead sem responsável operacional",
  SLA_VIOLATED: "SLA imediato violado",
  LEAD_WITHOUT_ATTEMPT: "Lead sem tentativa humana",
  PACTO_INCOMPLETE: "PACTO incompleto",
  MEETING_WITHOUT_BRIEFING: "Reunião sem briefing mínimo",
  OPPORTUNITY_WITHOUT_NEXT_ACTION: "Oportunidade sem próxima ação",
  LEAD_WITHOUT_NEXT_ACTION: "Lead sem próxima ação",
  LEAD_STAGNANT: "Lead parado",
  INCOHERENT_STAGE_CHANGE: "Mudança incoerente de etapa",
  LOST_OPPORTUNITY_WITHOUT_REASON: "Oportunidade perdida sem motivo válido",
});

export function slaViolationSeverity(seconds: number): ProcessViolationSeverityValue {
  if (seconds > 180) return "CRITICAL";
  if (seconds > 60) return "HIGH";
  return "LOW";
}

export function processViolationHref(input: Readonly<{
  leadId: string | null;
  meetingId: string | null;
  opportunityId: string | null;
}>): string | null {
  if (input.meetingId) return `/agenda/reunioes/${input.meetingId}`;
  if (input.leadId) return `/leads/${input.leadId}/historico`;
  return input.opportunityId ? `/oportunidades?opportunityId=${input.opportunityId}` : null;
}

export type AuditScreen = Readonly<{
  generatedAt: string;
  timeZone: string;
  capabilities: Readonly<{ canManage: boolean }>;
  filters: Readonly<{
    auditSearch: string;
    auditActorType: string;
    auditActorId: string;
    auditOrigin: string;
    auditAction: string;
    auditEntityType: string;
    auditFrom: string;
    auditTo: string;
    auditPage: number;
    violationSearch: string;
    violationType: string;
    violationSeverity: string;
    violationStatus: string;
    violationPage: number;
  }>;
  filterOptions: Readonly<{
    actors: readonly Readonly<{ id: string; name: string; type: string }>[];
    actions: readonly string[];
    entityTypes: readonly string[];
  }>;
  audit: Readonly<{
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    items: readonly Readonly<{
      id: string;
      action: string;
      entityType: string;
      entityId: string;
      entityLabel: string;
      href: string | null;
      occurredAt: string;
      origin: string;
      reason: string | null;
      actor: Readonly<{ id: string; name: string; type: string }>;
      before: unknown;
      after: unknown;
      details: unknown;
      requestId: string | null;
      automationRunId: string | null;
      aiInsightId: string | null;
    }>[];
  }>;
  violations: Readonly<{
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    items: readonly Readonly<{
      id: string;
      type: ProcessViolationTypeValue;
      title: string;
      severity: ProcessViolationSeverityValue;
      status: string;
      evidenceSummary: string;
      evidence: unknown;
      detectedAt: string;
      lastDetectedAt: string;
      updatedAt: string;
      acknowledgedAt: string | null;
      acknowledgedBy: string | null;
      resolvedAt: string | null;
      resolvedBy: string | null;
      resolutionReason: string | null;
      href: string | null;
      entityLabel: string;
    }>[];
  }>;
  summary: Readonly<{
    open: number;
    acknowledged: number;
    critical: number;
    byType: readonly Readonly<{ type: ProcessViolationTypeValue; label: string; count: number }>[];
  }>;
  reconciliation: Readonly<{
    stalled: Readonly<{ dashboardCount: number; activeFindings: number; reconciled: boolean }>;
    withoutNextAction: Readonly<{ dashboardCount: number; activeFindings: number; reconciled: boolean }>;
  }>;
}>;
