import { z } from "zod";

import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResponse,
} from "@/modules/ai/providers/ai-provider";
import { AIProviderError } from "@/modules/ai/providers/ai-provider";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OpenAICompatibleProviderOptions = Readonly<{
  endpoint: string;
  model: string;
  authorizationToken?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}>;

const responseSchema = z.object({
  choices: z.array(
    z.object({
      finish_reason: z.string().nullish(),
      message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
    }),
  ).min(1),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.string().nullish(), type: z.string().nullish() }),
});

const quotaErrorCodes = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

async function httpError(response: Response): Promise<AIProviderError> {
  if (response.status === 401) {
    return new AIProviderError("PROVIDER_AUTHENTICATION", "A credencial do provedor de IA foi recusada. Revise a integração.");
  }
  if (response.status === 403) {
    return new AIProviderError("PROVIDER_ACCESS_DENIED", "O provedor de IA negou acesso. Revise as permissões da integração.");
  }

  // Only machine-readable codes influence classification; provider messages can contain credentials or user data.
  const parsed = errorResponseSchema.safeParse(await response.json().catch(() => null));
  const code = parsed.success ? parsed.data.error.code : null;
  const type = parsed.success ? parsed.data.error.type : null;
  if (response.status === 429) {
    if ((code && quotaErrorCodes.has(code)) || type === "insufficient_quota") {
      return new AIProviderError("PROVIDER_QUOTA_EXCEEDED", "O provedor de IA está sem créditos ou atingiu o limite de uso. Revise o faturamento da integração.");
    }
    return new AIProviderError("PROVIDER_RATE_LIMITED", "O provedor de IA atingiu o limite temporário de solicitações. Aguarde e tente novamente.");
  }
  if (code === "model_not_found") {
    return new AIProviderError("PROVIDER_MODEL_UNAVAILABLE", "O modelo de IA configurado não está disponível para esta integração.");
  }
  return new AIProviderError("PROVIDER_HTTP_ERROR", `O provedor compatível respondeu HTTP ${response.status}.`);
}

function requiredOutputContract(agent: AIProviderRequest["agent"]) {
  return {
    agent,
    summary: "string",
    facts: [{ statement: "string", source: "string", evidence: "string|null" }],
    inferences: [{ statement: "string", basis: "string", confidence: "number 0..1" }],
    missingFields: ["field_key"],
    evidence: [{ id: "string", statement: "string", source: "string" }],
    pacto: [{
      dimension: "P|A|C|T|O",
      status: "NOT_INVESTIGATED|FAVORABLE|PARTIAL|UNFAVORABLE|DISQUALIFYING",
      evidenceIds: ["evidence_id"],
    }],
    questions: ["string"],
    score: "null|{value,reason,components[5]}",
    priority: "null|P1|P2|P3",
    action: "null|{title,reason,requiresConfirmation:true,message:string|null}",
    alternativeAction: "null|{title,reason,requiresConfirmation:true,message:string|null}",
    urgency: "LOW|MEDIUM|HIGH|IMMEDIATE",
    confidence: "number 0..1",
    risks: ["string"],
  };
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly key = "openai-compatible";
  readonly mode = "EXTERNAL" as const;
  readonly engineVersion: string;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #authorizationToken: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(options: OpenAICompatibleProviderOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new AIProviderError("PROVIDER_CONFIGURATION", "O endpoint deve usar HTTP ou HTTPS.");
    }
    if (!options.model.trim()) {
      throw new AIProviderError("PROVIDER_CONFIGURATION", "O modelo compatível não foi informado.");
    }
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new AIProviderError("PROVIDER_CONFIGURATION", "O timeout do provedor é inválido.");
    }

    this.#endpoint = endpoint.toString();
    this.#model = options.model.trim();
    this.#authorizationToken = options.authorizationToken;
    this.#timeoutMs = timeoutMs;
    this.#fetch = options.fetch ?? fetch;
    this.engineVersion = this.#model;
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    return this.generateJson({
      system: request.prompt.system,
      input: { input: request.input, requiredOutputContract: requiredOutputContract(request.agent) },
      temperature: 0,
    });
  }

  async generateJson(request: Readonly<{ system: string; input: unknown; maxOutputTokens?: number; temperature?: number }>): Promise<AIProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.#authorizationToken) {
        headers.authorization = `Bearer ${this.#authorizationToken}`;
      }
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.#model,
          // GPT-5.5 defaults to reasoning; sampling parameters are omitted for this model family.
          ...(request.temperature !== undefined && !/^gpt-5\.5(?:-|$)/.test(this.#model)
            ? { temperature: request.temperature } : {}),
          response_format: { type: "json_object" },
          ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
          messages: [
            { role: "system", content: request.system },
            {
              role: "user",
              content: JSON.stringify(request.input),
            },
          ],
        }),
      });
      if (!response.ok) {
        throw await httpError(response);
      }
      const envelope = responseSchema.safeParse(await response.json().catch(() => null));
      if (!envelope.success) {
        throw new AIProviderError("PROVIDER_INVALID_RESPONSE", "Envelope do provedor inválido.");
      }
      const choice = envelope.data.choices[0]!;
      if (choice.finish_reason === "length") {
        throw new AIProviderError("PROVIDER_OUTPUT_TRUNCATED", "A resposta da IA atingiu o limite de tamanho e ficou incompleta. Reduza o pedido e tente novamente.");
      }
      if (choice.finish_reason === "content_filter" || choice.message.refusal) {
        throw new AIProviderError("PROVIDER_REFUSAL", "O provedor de IA não pôde responder a este pedido. Reformule a solicitação.");
      }
      if (choice.finish_reason && choice.finish_reason !== "stop") {
        throw new AIProviderError("PROVIDER_INVALID_RESPONSE", "O provedor não concluiu uma resposta de texto.");
      }
      const content = choice.message.content;
      if (!content) {
        throw new AIProviderError("PROVIDER_INVALID_RESPONSE", "Resposta do provedor vazia.");
      }
      try {
        return { output: JSON.parse(content) as unknown, model: this.#model };
      } catch {
        throw new AIProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "O provedor não retornou JSON válido.",
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AIProviderError("PROVIDER_TIMEOUT", "O provedor excedeu o tempo limite.");
      }
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError("PROVIDER_UNAVAILABLE", "O provedor está indisponível.");
    } finally {
      clearTimeout(timeout);
    }
  }
}
