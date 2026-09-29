import { z } from "zod";

export const TELEMETRY_CONTRACT_VERSION = "telemetry.v1" as const;
export const OPERATIONS_API_VERSION = "operations.v1" as const;

const boundedText = z.string().trim().min(1).max(160);

export const operationsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(50).default(25),
  tab: z.enum(["observability", "security", "privacy", "resilience"]).default("observability"),
}).strict();

export const telemetryEnvelopeSchema = z.object({
  contractVersion: z.literal(TELEMETRY_CONTRACT_VERSION),
  kind: z.enum(["LOG", "METRIC", "TRACE", "SECURITY"]),
  operation: boundedText.regex(/^[a-z0-9_.:-]+$/i),
  outcome: z.enum(["SUCCESS", "ERROR", "DENIED", "BLOCKED"]),
  durationMs: z.number().int().min(0).max(86_400_000).nullable().optional(),
  value: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(32).nullable().optional(),
  correlationId: z.string().trim().min(8).max(160),
  requestId: z.string().trim().max(160).nullable().optional(),
  jobId: z.string().uuid().nullable().optional(),
  outboxEventId: z.string().uuid().nullable().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  occurredAt: z.coerce.date(),
}).strict();

export const alertActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("EVALUATE_ALERTS"), data: z.object({ correlationId: z.string().trim().min(8).max(160) }).strict() }).strict(),
  z.object({ action: z.literal("ACKNOWLEDGE_ALERT"), data: z.object({ alertId: z.string().uuid(), reason: z.string().trim().min(3).max(1000), revision: z.number().int().positive() }).strict() }).strict(),
  z.object({ action: z.literal("RESOLVE_ALERT"), data: z.object({ alertId: z.string().uuid(), reason: z.string().trim().min(3).max(1000), revision: z.number().int().positive() }).strict() }).strict(),
  z.object({ action: z.literal("CREATE_INCIDENT"), data: z.object({ alertId: z.string().uuid(), title: z.string().trim().min(3).max(160), impact: z.string().trim().min(3).max(1000), owner: z.string().trim().min(2).max(120), reason: z.string().trim().min(3).max(1000), idempotencyKey: z.string().trim().min(8).max(160) }).strict() }).strict(),
  z.object({ action: z.literal("TRANSITION_INCIDENT"), data: z.object({ incidentId: z.string().uuid(), toStatus: z.enum(["INVESTIGATING", "MITIGATED", "RESOLVED"]), note: z.string().trim().min(3).max(1000), revision: z.number().int().positive() }).strict() }).strict(),
  z.object({ action: z.literal("CREATE_DSR"), data: z.object({ leadId: z.string().uuid(), type: z.enum(["ACCESS", "CORRECTION", "PORTABILITY", "RESTRICTION", "OPPOSITION", "REVOCATION", "DELETION"]), categoryIds: z.array(z.string().uuid()).min(1).max(20), reason: z.string().trim().min(3).max(1000), idempotencyKey: z.string().trim().min(8).max(160) }).strict() }).strict(),
  z.object({ action: z.literal("PREVIEW_DESTRUCTION"), data: z.object({ requestId: z.string().uuid(), reason: z.string().trim().min(3).max(1000), idempotencyKey: z.string().trim().min(8).max(160) }).strict() }).strict(),
  z.object({ action: z.literal("RUN_RETENTION_CHECKPOINT"), data: z.object({ idempotencyKey: z.string().trim().min(8).max(160), batchSize: z.number().int().min(1).max(200).default(50) }).strict() }).strict(),
]);

export type TelemetryEnvelope = z.infer<typeof telemetryEnvelopeSchema>;
export type OperationsAction = z.infer<typeof alertActionSchema>;
export type OperationsListQuery = z.infer<typeof operationsListQuerySchema>;
