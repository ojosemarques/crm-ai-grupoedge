import { z } from "zod";

import { getApplicationConfig } from "@/shared/core/config/application-config";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const POLITIZAI_MCP_SCOPES = [
  "prospecting:read",
  "prospecting:research",
  "prospecting:review",
] as const;

export const POLITIZAI_MCP_CLIENT_ID = "https://chatgpt.com/oauth/client.json";
export const POLITIZAI_MCP_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
export const POLITIZAI_MCP_PATH = "/api/mcp/politizai";

export const PROSPECTING_SOURCE_SNAPSHOTS = Object.freeze({
  population: Object.freeze({
    edition: "IBGE_ESTIMATIVA_2026",
    hash: "6d512a1e48506fbbfa252ba407aabc2160b07329fa652411ef7d39bd63f49284",
    url: "https://ftp.ibge.gov.br/Estimativas_de_Populacao/Estimativas_2026/estimativa_dou_2026.xlsx",
    observedAt: "2026-10-06T03:25:00.000Z",
  }),
  election: Object.freeze({
    edition: "TSE_RESULTADOS_2024",
    hash: "7d35fe100079358368e79ffc98080c13fd4484eb67410baa614ca3f508d7c96a",
    url: "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2024.zip",
    observedAt: "2026-10-06T03:26:00.000Z",
  }),
});

const signingSecretSchema = z.string().min(32).max(500);

export type PolitizaiMcpPublicConfig = Readonly<{
  issuer: URL;
  resource: URL;
  resourceMetadataUrl: URL;
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  revocationEndpoint: URL;
}>;

export function getPolitizaiMcpPublicConfig(): PolitizaiMcpPublicConfig {
  const canonical = getApplicationConfig().environment.canonicalUrl;
  const issuer = new URL(canonical.origin);
  const resource = new URL(POLITIZAI_MCP_PATH, canonical);
  return Object.freeze({
    issuer,
    resource,
    resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource/api/mcp/politizai", canonical),
    authorizationEndpoint: new URL("/api/oauth/authorize", canonical),
    tokenEndpoint: new URL("/api/oauth/token", canonical),
    revocationEndpoint: new URL("/api/oauth/revoke", canonical),
  });
}

export function getPolitizaiMcpSigningSecret(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const parsed = signingSecretSchema.safeParse(environment.POLITIZAI_MCP_OAUTH_SIGNING_SECRET);
  if (!parsed.success) {
    throw new ApplicationError("A autenticação MCP não está configurada.", {
      code: "POLITIZAI_MCP_CONFIGURATION_UNAVAILABLE",
      statusCode: 503,
      expose: true,
    });
  }
  return parsed.data;
}

export function normalizeMcpScopes(raw: string | null | undefined): string[] {
  const requested = raw?.trim() ? raw.trim().split(/\s+/) : [...POLITIZAI_MCP_SCOPES];
  const unique = [...new Set(requested)];
  if (unique.length === 0 || unique.some((scope) => !POLITIZAI_MCP_SCOPES.includes(scope as typeof POLITIZAI_MCP_SCOPES[number]))) {
    throw new ApplicationError("Escopo OAuth inválido.", {
      code: "POLITIZAI_MCP_OAUTH_INVALID_SCOPE",
      statusCode: 400,
      expose: true,
    });
  }
  return unique;
}
