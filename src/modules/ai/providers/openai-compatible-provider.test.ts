import { describe, expect, it, vi } from "vitest";

import { AIProviderError } from "@/modules/ai/providers/ai-provider";
import { OpenAICompatibleProvider } from "@/modules/ai/providers/openai-compatible-provider";

const request = { system: "Retorne JSON.", input: { question: "Resumo" }, maxOutputTokens: 12_000, temperature: 0 };
const secret = "sensitive-provider-body-and-credential";

function providerWithResponse(response: Response) {
  return new OpenAICompatibleProvider({
    endpoint: "https://provider.invalid/v1/chat/completions",
    model: "gpt-5.5",
    fetch: async () => response,
  });
}

describe("compatibilidade e falhas seguras do provedor de IA", () => {
  it.each(["gpt-5.5", "gpt-5.5-2026-04-23"])("usa Chat Completions com limite de tokens e sem temperature em %s", async (model) => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model,
        max_completion_tokens: 12_000,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: "Retorne JSON." }, { role: "user", content: JSON.stringify(request.input) }],
      });
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("max_tokens");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"answer":"ok"}', refusal: null } }] });
    });
    const provider = new OpenAICompatibleProvider({
      endpoint: "https://provider.invalid/v1/chat/completions", model, timeoutMs: 60_000, fetch: fetchMock,
    });
    await expect(provider.generateJson(request)).resolves.toEqual({ output: { answer: "ok" }, model });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserva temperature e envelopes compatíveis de outros provedores", async () => {
    const provider = new OpenAICompatibleProvider({
      endpoint: "https://provider.invalid/v1/chat/completions", model: "local-test",
      fetch: async (_input, init) => {
        expect(JSON.parse(String(init?.body)).temperature).toBe(0);
        return Response.json({ choices: [{ message: { content: "{}" } }] });
      },
    });
    await expect(provider.generateJson(request)).resolves.toMatchObject({ output: {} });
  });

  it.each([
    [401, "invalid_api_key", null, "PROVIDER_AUTHENTICATION"],
    [403, null, null, "PROVIDER_ACCESS_DENIED"],
    [429, "insufficient_quota", null, "PROVIDER_QUOTA_EXCEEDED"],
    [429, "credit_balance_exhausted", null, "PROVIDER_QUOTA_EXCEEDED"],
    [429, "organization_spend_limit_exceeded", null, "PROVIDER_QUOTA_EXCEEDED"],
    [429, "project_spend_limit_exceeded", null, "PROVIDER_QUOTA_EXCEEDED"],
    [429, "organization_usage_limit_exceeded", null, "PROVIDER_QUOTA_EXCEEDED"],
    [429, null, "insufficient_quota", "PROVIDER_QUOTA_EXCEEDED"],
    [429, "rate_limit_exceeded", "rate_limit_error", "PROVIDER_RATE_LIMITED"],
    [429, "slow_down", "rate_limit_error", "PROVIDER_RATE_LIMITED"],
    [404, "model_not_found", null, "PROVIDER_MODEL_UNAVAILABLE"],
    [404, null, null, "PROVIDER_HTTP_ERROR"],
    [503, null, null, "PROVIDER_HTTP_ERROR"],
  ] as const)("classifica HTTP %s / %s sem expor resposta externa", async (status, code, type, expectedCode) => {
    const provider = providerWithResponse(Response.json({ error: { code, type, message: secret } }, { status }));
    const error = await provider.generateJson(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).toMatchObject({ code: expectedCode });
    expect(String(error)).not.toContain(secret);
    expect(error).not.toHaveProperty("cause");
  });

  it.each([null, '{"answer":', '{"answer":"looks complete"}'])("rejeita saída truncada mesmo quando o conteúdo é %s", async (content) => {
    const provider = providerWithResponse(Response.json({ choices: [{ finish_reason: "length", message: { content } }] }));
    await expect(provider.generateJson(request)).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_TRUNCATED" });
  });

  it.each([
    { finish_reason: "content_filter", message: { content: null } },
    { finish_reason: "stop", message: { content: null, refusal: secret } },
  ])("classifica bloqueio ou recusa sem expor seu conteúdo", async (choice) => {
    const provider = providerWithResponse(Response.json({ choices: [choice] }));
    const error = await provider.generateJson(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "PROVIDER_REFUSAL" });
    expect(String(error)).not.toContain(secret);
  });

  it.each([
    new Response(secret),
    Response.json({ choices: [{ finish_reason: "stop", message: { content: secret } }] }),
    Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: "{}" } }] }),
  ])("rejeita envelope/JSON inválido ou resposta não finalizada sem causa sensível", async (response) => {
    const error = await providerWithResponse(response).generateJson(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "PROVIDER_INVALID_RESPONSE" });
    expect(String(error)).not.toContain(secret);
    expect(error).not.toHaveProperty("cause");
  });

  it("não expõe detalhes de erro de rede", async () => {
    const provider = new OpenAICompatibleProvider({
      endpoint: "https://provider.invalid/v1/chat/completions", model: "gpt-5.5",
      fetch: async () => { throw new Error(secret); },
    });
    const error = await provider.generateJson(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(String(error)).not.toContain(secret);
    expect(error).not.toHaveProperty("cause");
  });

  it("preserva timeout durante a leitura da resposta", async () => {
    const provider = new OpenAICompatibleProvider({
      endpoint: "https://provider.invalid/v1/chat/completions", model: "gpt-5.5", timeoutMs: 100,
      fetch: async (_input, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error(secret)));
        },
      })),
    });
    await expect(provider.generateJson(request)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
});
