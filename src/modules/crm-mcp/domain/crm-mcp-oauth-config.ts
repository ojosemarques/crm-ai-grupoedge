import { z } from "zod";
import { crmMcpScopes } from "@/modules/crm-mcp/application/crm-mcp-authentication";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { ApplicationError } from "@/shared/core/errors/application-error";

export function getCrmMcpOAuthConfig() {
  const origin = getApplicationConfig().environment.canonicalUrl.origin;
  return {
    issuer: `${origin}/api/oauth/crm`, resource: `${origin}/api/mcp/crm`,
    resourceMetadata: `${origin}/.well-known/oauth-protected-resource/api/mcp/crm`,
    serverMetadata: `${origin}/.well-known/oauth-authorization-server/api/oauth/crm`,
    authorizationEndpoint: `${origin}/api/oauth/crm/authorize`,
    tokenEndpoint: `${origin}/api/oauth/crm/token`,
    registrationEndpoint: `${origin}/api/oauth/crm/register`,
    revocationEndpoint: `${origin}/api/oauth/crm/revoke`,
  };
}
export type CrmMcpOAuthConfig = ReturnType<typeof getCrmMcpOAuthConfig>;

export function getCrmMcpOAuthSecret(): string {
  const parsed = z.string().min(32).max(500).safeParse(process.env.CRM_MCP_OAUTH_SIGNING_SECRET);
  if (!parsed.success) throw new ApplicationError("OAuth do MCP do CRM não configurado.", { code: "CRM_MCP_OAUTH_UNAVAILABLE", statusCode: 503, expose: true });
  return parsed.data;
}

export function crmMcpOAuthMetadata(config = getCrmMcpOAuthConfig()) {
  return {
    issuer: config.issuer, authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint, registration_endpoint: config.registrationEndpoint,
    revocation_endpoint: config.revocationEndpoint,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"], scopes_supported: [...crmMcpScopes],
    authorization_response_iss_parameter_supported: true,
  };
}
export function crmMcpResourceMetadata(config = getCrmMcpOAuthConfig()) {
  return { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [...crmMcpScopes], bearer_methods_supported: ["header"], resource_name: "Grupo Edge CRM — leitura" };
}
export function crmMcpAuthChallenge(error?: "invalid_token" | "insufficient_scope", scope?: string) {
  const config = getCrmMcpOAuthConfig();
  return `Bearer realm="crm-mcp", resource_metadata="${config.resourceMetadata}"${error ? `, error="${error}"` : ""}${scope ? `, scope="${scope}"` : ""}`;
}
