import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticate = vi.fn();
const exchangeAuthorizationCode = vi.fn();
const refreshAccessToken = vi.fn();

vi.mock("@/modules/prospecting/application/politizai-mcp-client-authentication", () => ({
  getPolitizaiMcpClientAuthenticator: () => ({ authenticate }),
}));

vi.mock("@/modules/prospecting/application/politizai-mcp-oauth-service", () => ({
  getPolitizaiMcpOAuthService: () => ({ exchangeAuthorizationCode, refreshAccessToken }),
}));

describe("POST /api/oauth/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue({ method: "private_key_jwt" });
    exchangeAuthorizationCode.mockResolvedValue({
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: 600,
      refresh_token: "refresh-token",
      scope: "prospecting:read",
    });
  });

  it("autentica o client assertion antes de trocar o código", async () => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "https://chatgpt.com/oauth/7q5u9EYDB8WK/client.json",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: "signed-client-assertion",
      code: "authorization-code",
      code_verifier: "v".repeat(64),
      redirect_uri: "https://chatgpt.com/connector/oauth/7q5u9EYDB8WK",
      resource: "https://crm.example/api/mcp/politizai",
    });
    const { POST } = await import("@/app/api/oauth/token/route");
    const response = await POST(new NextRequest("https://crm.example/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));

    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith({
      clientId: "https://chatgpt.com/oauth/7q5u9EYDB8WK/client.json",
      clientAssertionType: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      clientAssertion: "signed-client-assertion",
    });
    expect(exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  });
});
