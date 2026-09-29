import type {
  AutomationActionType,
  AutomationTriggerType,
  Prisma,
} from "@/generated/prisma/client";
import { z } from "zod";

const conditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
]);

const automationConditionSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/),
    operator: z.enum(["EQUALS", "NOT_EQUALS", "IN", "EXISTS"]),
    value: conditionValueSchema.optional(),
  })
  .strict()
  .superRefine((condition, context) => {
    if (condition.operator !== "EXISTS" && condition.value === undefined) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "A condição exige um valor.",
      });
    }
  });

export const automationConditionsSchema = z
  .object({
    all: z.array(automationConditionSchema).max(25).default([]),
  })
  .strict();

export const automationActionConfigSchema = z
  .record(z.string().min(1).max(100), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 50_000, {
    message: "A configuração da ação excede o limite permitido.",
  });

export type AutomationConditions = z.infer<typeof automationConditionsSchema>;

export type InternalAutomationEvent = Readonly<{
  workspaceId: string;
  triggerType: AutomationTriggerType;
  idempotencyKey: string;
  occurredAt: Date;
  payload: Readonly<Record<string, unknown>>;
  triggeredByActorId?: string;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
}>;

export type AutomationActionExecution = Readonly<{
  workspaceId: string;
  automationRunId: string;
  automationRuleId: string;
  ruleVersion: number;
  actionType: AutomationActionType;
  actionConfig: Readonly<Record<string, unknown>>;
  eventPayload: Readonly<Record<string, unknown>>;
  effectIdempotencyKey: string;
  actorId: string;
  now: Date;
}>;

export type AutomationActionExecutor = Readonly<{
  execute: (
    transaction: Prisma.TransactionClient,
    execution: AutomationActionExecution,
  ) => Promise<Readonly<Record<string, unknown>>>;
}>;

export type PublishedAutomation = Readonly<{
  ruleId: string;
  runId: string;
  jobId: string;
  idempotencyKey: string;
  duplicated: boolean;
}>;

export type PublicationResult = Readonly<{
  matchedRules: number;
  scheduled: readonly PublishedAutomation[];
}>;

export type WorkerExecutionResult = Readonly<
  | { status: "IDLE" }
  | {
      status: "SUCCEEDED" | "FAILED" | "CANCELLED";
      jobId: string;
      runId: string;
      attemptNumber: number;
      errorCode?: string;
    }
  | {
      status: "RETRY_SCHEDULED";
      jobId: string;
      runId: string;
      attemptNumber: number;
      nextRunAt: Date;
      errorCode: string;
    }
>;
