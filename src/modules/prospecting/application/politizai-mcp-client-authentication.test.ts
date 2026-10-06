import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  POLITIZAI_MCP_CLIENT_ASSERTION_TYPE,
  createPolitizaiMcpClientAuthenticator,
} from "@/modules/prospecting/application/politizai-mcp-client-authentication";
import { POLITIZAI_MCP_CALLBACK_CLIENT_ID } from "@/modules/prospecting/domain/politizai-mcp-config";

const now = new Date("2026-10-06T14:00:00.000Z");
const tokenEndpoint = "https://crm.example/api/oauth/token";
let privateKey: CryptoKey;
let authenticator: ReturnType<typeof createPolitizaiMcpClientAuthenticator>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = "chatgpt-test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  authenticator = createPolitizaiMcpClientAuthenticator({
    keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    now: () => now,
    tokenEndpoint: () => tokenEndpoint,
  });
});

async function signAssertion(overrides: Readonly<{ issuer?: string; subject?: string; audience?: string }> = {}) {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "chatgpt-test-key" })
    .setIssuer(overrides.issuer ?? POLITIZAI_MCP_CALLBACK_CLIENT_ID)
    .setSubject(overrides.subject ?? POLITIZAI_MCP_CALLBACK_CLIENT_ID)
    .setAudience(overrides.audience ?? tokenEndpoint)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 120)
    .setJti("chatgpt-client-assertion-test")
    .sign(privateKey);
}

describe("autenticação do cliente OAuth Politizai", () => {
  it("valida private_key_jwt assinado para o client ID e token endpoint permitidos", async () => {
    await expect(authenticator.authenticate({
      clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID,
      clientAssertionType: POLITIZAI_MCP_CLIENT_ASSERTION_TYPE,
      clientAssertion: await signAssertion(),
    })).resolves.toEqual({ method: "private_key_jwt" });
  });

  it("rejeita assertion com audiência diferente", async () => {
    await expect(authenticator.authenticate({
      clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID,
      clientAssertionType: POLITIZAI_MCP_CLIENT_ASSERTION_TYPE,
      clientAssertion: await signAssertion({ audience: "https://outro.example/oauth/token" }),
    })).rejects.toMatchObject({ code: "invalid_client" });
  });

  it("mantém o cliente público sem assertion e rejeita parâmetros parciais", async () => {
    await expect(authenticator.authenticate({ clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID })).resolves.toEqual({ method: "none" });
    await expect(authenticator.authenticate({
      clientId: POLITIZAI_MCP_CALLBACK_CLIENT_ID,
      clientAssertionType: POLITIZAI_MCP_CLIENT_ASSERTION_TYPE,
    })).rejects.toMatchObject({ code: "invalid_client" });
  });
});
