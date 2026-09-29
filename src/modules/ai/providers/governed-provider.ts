import type { AIProvider, AIProviderRequest, AIProviderResponse } from "@/modules/ai/providers/ai-provider";
import { AIProviderError } from "@/modules/ai/providers/ai-provider";

export type AIProviderPolicy = Readonly<{
  timeoutMs: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedCostCents: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
}>;

type Clock = Readonly<{ now: () => number }>;

export class GovernedAIProvider implements AIProvider {
  readonly key: string;
  readonly mode;
  readonly engineVersion: string;
  readonly #calls: number[] = [];
  #consecutiveFailures = 0;
  #circuitOpenedAt: number | null = null;

  constructor(
    private readonly provider: AIProvider,
    private readonly policy: AIProviderPolicy,
    private readonly clock: Clock = { now: () => Date.now() },
  ) {
    this.key = provider.key;
    this.mode = provider.mode;
    this.engineVersion = provider.engineVersion;
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const now = this.clock.now();
    const inputTokens = Math.ceil(JSON.stringify(request.input).length / 4);
    if (inputTokens > this.policy.maxInputTokens) {
      throw new AIProviderError("PROVIDER_CONFIGURATION", "A entrada excedeu o orçamento de tokens aprovado.");
    }
    if (this.policy.maxEstimatedCostCents < 0) {
      throw new AIProviderError("PROVIDER_CONFIGURATION", "O orçamento de custo aprovado é inválido.");
    }
    while (this.#calls[0] !== undefined && this.#calls[0] <= now - 60_000) this.#calls.shift();
    if (this.#calls.length >= this.policy.rateLimitPerMinute) {
      throw new AIProviderError("PROVIDER_UNAVAILABLE", "Limite local de execuções de IA atingido.");
    }
    if (this.#circuitOpenedAt !== null) {
      if (now - this.#circuitOpenedAt < this.policy.circuitResetMs) {
        throw new AIProviderError("PROVIDER_UNAVAILABLE", "Circuit breaker do provedor está aberto.");
      }
      this.#circuitOpenedAt = null;
      this.#consecutiveFailures = 0;
    }
    this.#calls.push(now);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.policy.maxRetries; attempt += 1) {
      try {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const response = await Promise.race([
          this.provider.generate(request),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new AIProviderError("PROVIDER_TIMEOUT", "O provedor excedeu o timeout governado.")), this.policy.timeoutMs);
          }),
        ]).finally(() => {
          if (timeout) clearTimeout(timeout);
        });
        const outputTokens = Math.ceil(JSON.stringify(response.output).length / 4);
        if (outputTokens > this.policy.maxOutputTokens) {
          throw new AIProviderError("PROVIDER_INVALID_RESPONSE", "A saída excedeu o orçamento de tokens aprovado.");
        }
        this.#consecutiveFailures = 0;
        return response;
      } catch (error) {
        lastError = error;
        this.#consecutiveFailures += 1;
        if (this.#consecutiveFailures >= this.policy.circuitFailureThreshold) {
          this.#circuitOpenedAt = this.clock.now();
        }
      }
    }
    throw lastError instanceof AIProviderError
      ? lastError
      : new AIProviderError("PROVIDER_UNAVAILABLE", "O provedor falhou após a política de retry.", lastError);
  }
}
