import type { LeadIntakeInput } from "@/modules/leads/application/lead-intake-service";
import {
  parseBrlToCents,
  type LeadEntryFields,
} from "@/modules/leads/domain/lead-entry-contracts";

export function toLeadIntakeInput(
  fields: LeadEntryFields,
  options: Readonly<{
    channel: LeadIntakeInput["channel"];
    idempotencyKey: string;
    rawPayload: Record<string, unknown>;
    formIdentifier?: string;
    pipelineId?: string;
  }>,
): LeadIntakeInput {
  const { budgetBrl, ...leadFields } = fields;

  return {
    ...leadFields,
    channel: options.channel,
    idempotencyKey: options.idempotencyKey,
    formIdentifier: options.formIdentifier,
    pipelineId: options.pipelineId,
    budgetCents: parseBrlToCents(budgetBrl),
    rawPayload: options.rawPayload,
  } as LeadIntakeInput;
}
