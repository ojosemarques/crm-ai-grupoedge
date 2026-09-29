import type { AIAgentType } from "@/modules/ai/domain/ai-contracts";

import { auditAgentPrompt } from "./audit-agent";
import { callPreparationPrompt } from "./call-preparation";
import { conversationExtractorPrompt } from "./conversation-extractor";
import { managerCopilotPrompt } from "./manager-copilot";
import { nextBestActionPrompt } from "./next-best-action";
import { qualificationPrompt } from "./qualification";
import type { VersionedPrompt } from "./prompt-contract";

export const versionedPrompts = Object.freeze({
  QUALIFICATION: qualificationPrompt,
  CALL_PREPARATION: callPreparationPrompt,
  CONVERSATION_EXTRACTION: conversationExtractorPrompt,
  NEXT_BEST_ACTION: nextBestActionPrompt,
  MANAGER_COPILOT: managerCopilotPrompt,
  AUDIT_AGENT: auditAgentPrompt,
} satisfies Record<AIAgentType, VersionedPrompt>);

export function getVersionedPrompt(agent: AIAgentType): VersionedPrompt {
  return versionedPrompts[agent];
}

export type { VersionedPrompt } from "./prompt-contract";
