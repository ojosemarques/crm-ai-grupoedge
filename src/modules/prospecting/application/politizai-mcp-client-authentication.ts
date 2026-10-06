import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import {
  getPolitizaiMcpPublicConfig,
  isAllowedPolitizaiMcpClientId,
} from "@/modules/prospecting/domain/politizai-mcp-config";

export const POLITIZAI_MCP_CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
export const POLITIZAI_MCP_TOKEN_AUTH_METHODS = ["private_key_jwt", "none"] as const;

const CHATGPT_JWKS_URI = new URL("https://chatgpt.com/oauth/jwks.json");
const CHATGPT_JWKS = createRemoteJWKSet(CHATGPT_JWKS_URI, {
  timeoutDuration: 5_000,
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
});

type ClientAuthenticatorOptions = Readonly<{
  keyResolver: JWTVerifyGetKey;
  now: () => Date;
  tokenEndpoint: () => string;
}>;

type ClientAuthenticationInput = Readonly<{
  clientId: string;
  clientAssertionType?: string;
  clientAssertion?: string;
}>;

function invalidClient(): never {
  throw new OAuthError(OAuthErrorCode.InvalidClient, "Cliente OAuth não autenticado.");
}

export function createPolitizaiMcpClientAuthenticator(options: ClientAuthenticatorOptions) {
  async function authenticate(input: ClientAuthenticationInput): Promise<Readonly<{ method: "none" | "private_key_jwt" }>> {
    if (!isAllowedPolitizaiMcpClientId(input.clientId)) invalidClient();

    const hasAssertionType = input.clientAssertionType !== undefined;
    const hasAssertion = input.clientAssertion !== undefined;
    if (!hasAssertionType && !hasAssertion) return Object.freeze({ method: "none" });
    if (
      input.clientAssertionType !== POLITIZAI_MCP_CLIENT_ASSERTION_TYPE
      || typeof input.clientAssertion !== "string"
      || input.clientAssertion.length === 0
    ) invalidClient();

    try {
      const verified = await jwtVerify(input.clientAssertion, options.keyResolver, {
        algorithms: ["RS256"],
        issuer: input.clientId,
        subject: input.clientId,
        audience: options.tokenEndpoint(),
        currentDate: options.now(),
        clockTolerance: 30,
        maxTokenAge: 5 * 60,
      });
      if (typeof verified.payload.jti !== "string" || verified.payload.jti.length < 8 || verified.payload.jti.length > 512) {
        invalidClient();
      }
      return Object.freeze({ method: "private_key_jwt" });
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      invalidClient();
    }
  }

  return Object.freeze({ authenticate });
}

let singleton: ReturnType<typeof createPolitizaiMcpClientAuthenticator> | undefined;

export function getPolitizaiMcpClientAuthenticator() {
  singleton ??= createPolitizaiMcpClientAuthenticator({
    keyResolver: CHATGPT_JWKS,
    now: () => new Date(),
    tokenEndpoint: () => getPolitizaiMcpPublicConfig().tokenEndpoint.href,
  });
  return singleton;
}
