import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const parseAuthorizationRequest = vi.fn();
const assertAuthorized = vi.fn();

vi.mock("@/modules/auth/http/authentication-guards", () => ({
  requireApiAuthentication: vi.fn().mockResolvedValue({
    actorId: "11111111-1111-4111-8111-111111111111",
    displayName: "Administrador",
    memberId: "22222222-2222-4222-8222-222222222222",
    userId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    workspaceName: "Politizai",
    workspaceSlug: "politizai",
  }),
}));

vi.mock("@/modules/users/permissions/authorization-service", () => ({
  getAuthorizationService: () => ({ assertAuthorized }),
}));

vi.mock("@/modules/prospecting/application/politizai-mcp-oauth-service", () => ({
  getPolitizaiMcpOAuthService: () => ({ parseAuthorizationRequest }),
}));

vi.mock("@/modules/prospecting/domain/politizai-mcp-config", () => ({
  getPolitizaiMcpPublicConfig: () => ({ issuer: new URL("https://crm.example") }),
}));

const authorization = {
  client_id: "https://chatgpt.com/oauth/client.json",
  code_challenge: "c".repeat(43),
  code_challenge_method: "S256" as const,
  redirect_uri: "https://chatgpt.com/connector/oauth/callback",
  resource: "https://crm.example/api/mcp/politizai",
  response_type: "code" as const,
  scopes: ["prospecting:read", "prospecting:research", "prospecting:review"],
  state: "oauth-state",
};

describe("GET /api/oauth/authorize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseAuthorizationRequest.mockReturnValue(authorization);
    assertAuthorized.mockResolvedValue(undefined);
  });

  it("aceita ui_locales enviado pelo ChatGPT sem repassá-lo ao contrato OAuth", async () => {
    const { GET } = await import("@/app/api/oauth/authorize/route");
    const response = await GET(new NextRequest(
      "https://crm.example/api/oauth/authorize?response_type=code&client_id=https%3A%2F%2Fchatgpt.com%2Foauth%2Fclient.json&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcallback&scope=prospecting%3Aread+prospecting%3Aresearch+prospecting%3Areview&code_challenge=ccccccccccccccccccccccccccccccccccccccccccc&code_challenge_method=S256&resource=https%3A%2F%2Fcrm.example%2Fapi%2Fmcp%2Fpolitizai&state=oauth-state&ui_locales=pt-BR",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Conectar o Dot à Politizai");
    expect(parseAuthorizationRequest).toHaveBeenCalledWith(expect.not.objectContaining({ ui_locales: "pt-BR" }));
  });
});
