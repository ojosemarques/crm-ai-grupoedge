import type { VersionedPrompt } from "@/ai/prompts";
import type {
  AIAnalysisInput,
  AIAgentType,
} from "@/modules/ai/domain/ai-contracts";

export type AIProviderMode = "LOCAL_DETERMINISTIC" | "EXTERNAL";

export type AIProviderRequest = Readonly<{
  agent: AIAgentType;
  prompt: VersionedPrompt;
  input: AIAnalysisInput;
}>;

export type AIProviderResponse = Readonly<{
  output: unknown;
  model: string | null;
}>;

export interface AIProvider {
  readonly key: string;
  readonly mode: AIProviderMode;
  readonly engineVersion: string;
  generate(request: AIProviderRequest): Promise<AIProviderResponse>;
}

export type AIProviderErrorCode =
  | "PROVIDER_CONFIGURATION"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_AUTHENTICATION"
  | "PROVIDER_ACCESS_DENIED"
  | "PROVIDER_QUOTA_EXCEEDED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_MODEL_UNAVAILABLE"
  | "PROVIDER_OUTPUT_TRUNCATED"
  | "PROVIDER_REFUSAL"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_UNAVAILABLE";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;

  constructor(code: AIProviderErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AIProviderError";
    this.code = code;
  }
}
