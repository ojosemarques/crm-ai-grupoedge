import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/prospecting/domain/politizai-mcp-config", () => ({
  POLITIZAI_MCP_CLIENT_REGISTRATIONS: [
    { clientId: "https://chatgpt.com/oauth/client.json", redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect" },
  ],
  POLITIZAI_MCP_SCOPES: ["prospecting:read", "prospecting:research", "prospecting:review"],
  getPolitizaiMcpPublicConfig: () => ({
    issuer: new URL("https://crm.example"),
    authorizationEndpoint: new URL("https://crm.example/api/oauth/authorize"),
    tokenEndpoint: new URL("https://crm.example/api/oauth/token"),
    revocationEndpoint: new URL("https://crm.example/api/oauth/revoke"),
  }),
}));

describe("GET /.well-known/oauth-authorization-server", () => {
  it("anuncia identificação do emissor porque toda resposta de autorização inclui iss", async () => {
    const { GET } = await import("@/app/.well-known/oauth-authorization-server/route");
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      issuer: "https://crm.example",
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ["private_key_jwt", "none"],
    });
  });
});
