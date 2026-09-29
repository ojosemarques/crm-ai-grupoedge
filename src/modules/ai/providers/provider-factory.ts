import type { AIProvider } from "@/modules/ai/providers/ai-provider";
import { MockAIProvider } from "@/modules/ai/providers/mock-ai-provider";
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "@/modules/ai/providers/openai-compatible-provider";

export type AIProviderSelection =
  | Readonly<{ kind?: "mock" }>
  | Readonly<{
      kind: "openai-compatible";
      enabled: true;
      allowExternalEgress: true;
      options: OpenAICompatibleProviderOptions;
    }>;

export function createAIProvider(selection: AIProviderSelection = {}): AIProvider {
  if (selection.kind === "openai-compatible") {
    if (selection.enabled !== true || selection.allowExternalEgress !== true) {
      throw new Error("O provedor externo exige habilitação e autorização de egress explícitas.");
    }
    return new OpenAICompatibleProvider(selection.options);
  }
  return new MockAIProvider();
}
