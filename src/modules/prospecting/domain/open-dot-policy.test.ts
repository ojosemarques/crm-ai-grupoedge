import { describe, expect, it } from "vitest";

import { authenticateOpenDotRequest, signOpenDotRequest } from "@/modules/prospecting/domain/open-dot-policy";

const client = {
  clientId: "research-agent",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  scopes: ["RESEARCH_WRITE", "RESEARCH_READ"] as ("RESEARCH_WRITE" | "RESEARCH_READ")[],
  currentSecret: "current-secret-with-at-least-thirty-two-characters",
  previousSecret: "previous-secret-with-at-least-thirty-two-characters",
};

function request(secret = client.currentSecret) {
  const timestamp = "2026-10-05T15:00:00.000Z";
  const nonce = "nonce_12345678901234567890";
  const rawBody = "{\"batch\":1}";
  const signature = signOpenDotRequest({ secret, method: "POST", path: "/api/integrations/open-dot/v1/candidates", timestamp, nonce, rawBody });
  return { clients: [client], clientId: client.clientId, requiredScope: "RESEARCH_WRITE" as const, method: "POST", path: "/api/integrations/open-dot/v1/candidates", timestamp, nonce, rawBody, signature, now: new Date("2026-10-05T15:01:00.000Z") };
}

describe("política de assinatura Open-Dot", () => {
  it("aceita segredo atual e anterior durante rotação", () => {
    expect(authenticateOpenDotRequest(request()).clientId).toBe(client.clientId);
    expect(authenticateOpenDotRequest(request(client.previousSecret)).clientId).toBe(client.clientId);
  });

  it("nega assinatura alterada, escopo ausente e relógio fora da janela", () => {
    expect(() => authenticateOpenDotRequest({ ...request(), signature: `sha256=${"0".repeat(64)}` })).toThrowError(/inválida/i);
    expect(() => authenticateOpenDotRequest({ ...request(), requiredScope: "EMAIL_CLAIM" })).toThrowError(/escopo/i);
    expect(() => authenticateOpenDotRequest({ ...request(), now: new Date("2026-10-05T16:00:00.000Z") })).toThrowError(/janela temporal/i);
  });
});
