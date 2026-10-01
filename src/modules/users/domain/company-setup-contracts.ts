import { z } from "zod";

export const companySetupSkippableStepSchema = z.enum(["TEAM", "INTEGRATIONS"]);
export type CompanySetupStepKey = "TEAM" | "PERMISSIONS" | "PIPELINE" | "CATEGORIES" | "GOALS" | "INTEGRATIONS";
export type CompanySetupStepState = "READY" | "ACTION_REQUIRED" | "OPTIONAL" | "SKIPPED";

export const companySetupCommandSchema = z.object({
  action: z.literal("SET_STEP_STATE"),
  stepKey: companySetupSkippableStepSchema,
  state: z.enum(["SKIPPED", "PENDING"]),
  idempotencyKey: z.string().uuid(),
  confirmed: z.literal(true),
}).strict();

export type CompanySetupStep = Readonly<{
  key: CompanySetupStepKey;
  title: string;
  description: string;
  detail: string;
  href: string;
  actionLabel: string;
  state: CompanySetupStepState;
  optional: boolean;
  canSkip: boolean;
}>;

export type CompanySetupScreen = Readonly<{
  workspace: Readonly<{ id: string; name: string; slug: string; timeZone: string }>;
  steps: readonly CompanySetupStep[];
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  requiredComplete: boolean;
  nextStepKey: CompanySetupStepKey | null;
}>;
