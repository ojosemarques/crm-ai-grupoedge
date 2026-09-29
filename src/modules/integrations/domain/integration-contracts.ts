import { z } from "zod";

export const LOCAL_MOCK_ADAPTER_KEY = "local-deterministic-v1";
export const LOCAL_MOCK_PROVIDER_KEY = "LOCAL_MOCK";
export const MAX_WEBHOOK_BYTES = 256 * 1024;
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export const localMockConfigurationSchema = z.object({
  mode: z.literal("LOCAL_DETERMINISTIC"),
  pageSize: z.number().int().min(1).max(100).default(25),
  fault: z
    .enum([
      "NONE",
      "TIMEOUT",
      "RATE_LIMIT",
      "TRANSIENT",
      "PERMANENT",
      "BEFORE_COMMIT",
      "AFTER_COMMIT",
      "OUT_OF_ORDER",
    ])
    .default("NONE"),
});

export const createConnectionSchema = z.object({
  displayName: z.string().trim().min(3).max(100),
  key: z.string().trim().regex(/^[a-z][a-z0-9-]{2,63}$/),
  config: localMockConfigurationSchema,
});

export const updateConnectionSchema = z.object({
  connectionId: z.string().uuid(),
  revision: z.number().int().positive(),
  displayName: z.string().trim().min(3).max(100),
  config: localMockConfigurationSchema,
});

export const connectionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("TEST"), connectionId: z.string().uuid() }),
  z.object({ action: z.literal("PAUSE"), connectionId: z.string().uuid(), revision: z.number().int().positive() }),
  z.object({ action: z.literal("ACTIVATE_LOCAL"), connectionId: z.string().uuid(), revision: z.number().int().positive() }),
  z.object({
    action: z.literal("LINK_SECRET_REFERENCE"),
    connectionId: z.string().uuid(),
    alias: z.string().trim().regex(/^[a-z][a-z0-9-]{2,40}$/),
    referenceKey: z.string().trim().regex(/^LOCAL_MOCK_[A-Z0-9_]{3,120}$/),
    present: z.boolean(),
  }),
  z.object({
    action: z.literal("RUN_SYNC"),
    connectionId: z.string().uuid(),
    direction: z.enum(["PULL", "PUSH"]),
    objectType: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
    correlationId: z.string().trim().min(8).max(120),
    leadId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("REPLAY"),
    connectionId: z.string().uuid(),
    targetKind: z.enum(["INBOX", "OUTBOX"]),
    targetId: z.string().uuid(),
    reason: z.string().trim().min(8).max(500),
  }),
]);

export const localWebhookEnvelopeSchema = z.object({
  nonce: z.string().trim().regex(/^[A-Za-z0-9_-]{16,160}$/),
  eventId: z.string().trim().regex(/^[A-Za-z0-9_.:-]{8,160}$/),
  eventType: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,100}$/),
  contractVersion: z.literal("1.0"),
  occurredAt: z.string().datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
});

export const mappingInputSchema = z.object({
  connectionId: z.string().uuid(),
  externalObjectType: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  externalId: z.string().trim().min(1).max(255),
  internalEntityType: z.enum(["CONTACT", "ACCOUNT", "LEAD", "OPPORTUNITY", "MEETING", "MESSAGE"]),
  internalEntityId: z.string().uuid(),
  externalVersion: z.string().trim().max(160).nullable().optional(),
  externalHash: z.string().trim().max(128).nullable().optional(),
}).strict();

export const resolveMappingConflictSchema = z.object({
  conflictId: z.string().uuid(),
  resolution: z.enum(["CONFIRMED", "REJECTED"]),
  reason: z.string().trim().min(8).max(500),
}).strict();

export const fieldMappingVersionSchema = z.object({
  connectionId: z.string().uuid(),
  objectType: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,63}$/),
  schemaVersion: z.string().trim().min(1).max(40),
  mapping: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length <= 100),
  precedence: z.object({
    policy: z.literal("HUMAN_WINS"),
    humanFields: z.array(z.string().trim().min(1).max(80)).max(100),
    externalFields: z.array(z.string().trim().min(1).max(80)).max(100),
  }).strict(),
}).strict();

export type LocalMockConfiguration = z.output<typeof localMockConfigurationSchema>;

export type AdapterErrorClassification = Readonly<{
  classification:
    | "TRANSIENT"
    | "PERMANENT"
    | "AUTHENTICATION"
    | "RATE_LIMIT"
    | "CONFIGURATION"
    | "PRIVACY_BLOCKED";
  code: string;
  safeMessage: string;
  retryAfterSeconds?: number;
}>;

export type IntegrationAdapterResult = Readonly<{
  capabilityLevel: "VALIDATED_LOCALLY";
  facts: ReadonlyArray<string>;
  nextCursor?: string;
  readCount?: number;
  createdCount?: number;
  ignoredCount?: number;
}>;

export interface IntegrationAdapter {
  readonly providerKey: string;
  readonly adapterKey: string;
  readonly capabilityLevel: "VALIDATED_LOCALLY";
  readonly capabilities: ReadonlyArray<"WEBHOOK_RECEIVE" | "SYNC_PULL" | "SYNC_PUSH" | "OBJECT_MAPPING">;
  validateConfiguration(input: unknown): LocalMockConfiguration;
  testLocal(config: LocalMockConfiguration): Promise<IntegrationAdapterResult>;
  normalizeInbound(input: unknown): Readonly<Record<string, unknown>>;
  pullPage(config: LocalMockConfiguration, cursor?: string): Promise<IntegrationAdapterResult>;
  push(config: LocalMockConfiguration, command: Readonly<Record<string, unknown>>): Promise<IntegrationAdapterResult>;
  classifyError(error: unknown): AdapterErrorClassification;
}
