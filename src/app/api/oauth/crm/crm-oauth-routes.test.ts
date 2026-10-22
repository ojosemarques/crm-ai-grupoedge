import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { AuthenticationRequiredError } from "@/modules/auth/domain/auth-errors";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/api/mcp/crm/route";
import { GET as authorizationMetadata } from "@/app/.well-known/oauth-authorization-server/api/oauth/crm/route";
import { GET as authorizeGET, POST as authorizePOST } from "./authorize/route";
import { POST as registerPOST } from "./register/route";
import { POST as tokenPOST } from "./token/route";
import { POST as revokePOST } from "./revoke/route";
import { proxy } from "@/proxy";

const mocks = vi.hoisted(() => ({ register: vi.fn(), parseAuthorizationRequest: vi.fn(), createConsent: vi.fn(), validateConsent: vi.fn(), createAuthorizationCode: vi.fn(), exchangeAuthorizationCode: vi.fn(), refreshAccessToken: vi.fn(), revoke: vi.fn(), authenticate: vi.fn(), authorize: vi.fn(), rate: vi.fn() }));
vi.mock("@/modules/crm-mcp/application/crm-mcp-oauth-service", () => ({ getCrmMcpOAuthService: () => mocks }));
vi.mock("@/modules/auth/http/authentication-guards", () => ({ requireApiAuthentication: mocks.authenticate }));
vi.mock("@/modules/users/permissions/authorization-service", () => ({ getAuthorizationService: () => ({ assertAuthorized: mocks.authorize }) }));
vi.mock("@/shared/core/config/application-config", () => ({ getApplicationConfig: () => ({ environment: { canonicalUrl: new URL("https://crm.example") } }) }));
vi.mock("@/shared/core/http/request-hardening", async (original) => ({ ...await original<typeof import("@/shared/core/http/request-hardening")>(), enforceRateLimit: mocks.rate, requestClientKey: () => "test-ip" }));
const authorization = { response_type: "code", client_id: "registered-client", redirect_uri: "https://client.example/callback", resource: "https://crm.example/api/mcp/crm", scopes: ["crm:read"], state: "csrf-client-state", clientName: "<OpenBot>", code_challenge: "v".repeat(43), code_challenge_method: "S256", refreshAllowed: true };
const authPath = `/api/oauth/crm/authorize?${new URLSearchParams({ response_type: "code", client_id: authorization.client_id, redirect_uri: authorization.redirect_uri, resource: authorization.resource, code_challenge: authorization.code_challenge, code_challenge_method: "S256", state: authorization.state })}`;
function formRequest(path: string, data: Record<string, string>, origin = "https://crm.example") {
  return new NextRequest(`https://crm.example${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin, host: "crm.example" }, body: new URLSearchParams(data).toString() });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.parseAuthorizationRequest.mockResolvedValue(authorization);
  mocks.authenticate.mockResolvedValue({ workspaceId: "workspace", workspaceSlug: "test", displayName: "Administrador", sessionId: "private-session" });
  mocks.createConsent.mockResolvedValue("signed-consent");
  mocks.createAuthorizationCode.mockResolvedValue("one-use-code");
});

describe("CRM OAuth HTTP discovery and DCR", () => {
  it("publishes separate CRM resource/server metadata with a DCR endpoint", async () => {
    const resource = await resourceMetadata().json(); const server = await authorizationMetadata().json();
    expect(resource.authorization_servers).toEqual(["https://crm.example/api/oauth/crm"]);
    expect(server.registration_endpoint).toBe("https://crm.example/api/oauth/crm/register");
    expect(JSON.stringify({ resource, server })).not.toContain("private-session");
    expect(JSON.stringify({ resource, server })).not.toContain("client_secret");
  });
  it.each(["/.well-known/oauth-protected-resource/api/mcp/crm", "/.well-known/oauth-authorization-server/api/oauth/crm"])("does not redirect public metadata %s to login", (path) => {
    expect(proxy(new NextRequest(`https://crm.example${path}`)).headers.get("location")).toBeNull();
  });
  it("returns 201 for dynamic public registration without setting cookies", async () => {
    mocks.register.mockResolvedValue({ client_id: "public-client", token_endpoint_auth_method: "none", redirect_uris: [authorization.redirect_uri] });
    const response = await registerPOST(new Request("https://crm.example/api/oauth/crm/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [authorization.redirect_uri] }) }));
    expect(response.status).toBe(201); expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).not.toHaveProperty("client_secret");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects registration bodies over 8 KiB without invoking the service", async () => {
    const response = await registerPOST(new Request("https://crm.example/api/oauth/crm/register", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(9000) }));
    expect(response.status).toBe(400); expect(mocks.register).not.toHaveBeenCalled();
  });
});

describe("CRM OAuth login, consent and token routes", () => {
  it("requires an authenticated CRM session before showing consent", async () => {
    mocks.authenticate.mockRejectedValue(new AuthenticationRequiredError());
    const response = await authorizeGET(new NextRequest(`https://crm.example${authPath}`));
    expect(response.status).toBe(307); expect(response.headers.get("location")).toContain("/login?next=");
    expect(mocks.createAuthorizationCode).not.toHaveBeenCalled();
  });
  it("shows escaped client identity, workspace, callback and scope without a machine token", async () => {
    const response = await authorizeGET(new NextRequest(`https://crm.example${authPath}`));
    const html = await response.text();
    expect(response.status).toBe(200); expect(html).toContain("&lt;OpenBot&gt;"); expect(html).toContain(authorization.redirect_uri);
    expect(html).toContain("consent_token"); expect(html).toContain("crm:read"); expect(html).not.toContain("private-session");
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), "integrations.manage", expect.objectContaining({ workspaceId: "workspace" }));
  });
  it("requires valid session-bound consent and returns a one-use code, client state and issuer", async () => {
    const response = await authorizePOST(formRequest(authPath, { decision: "allow", consent_token: "signed-consent" }));
    expect(response.status).toBe(303);
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.origin).toBe("https://client.example"); expect(redirect.searchParams.get("code")).toBe("one-use-code");
    expect(redirect.searchParams.get("state")).toBe("csrf-client-state"); expect(redirect.searchParams.get("iss")).toBe("https://crm.example/api/oauth/crm");
    expect(mocks.validateConsent).toHaveBeenCalledWith("signed-consent", expect.anything(), authorization);
  });
  it("does not issue a code after consent denial or an invalid consent signature", async () => {
    const denial = await authorizePOST(formRequest(authPath, { decision: "deny", consent_token: "signed-consent" }));
    expect(new URL(denial.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    expect(mocks.createAuthorizationCode).not.toHaveBeenCalled();
    mocks.validateConsent.mockRejectedValueOnce(new OAuthError(OAuthErrorCode.InvalidRequest, "invalid consent"));
    expect((await authorizePOST(formRequest(authPath, { decision: "allow", consent_token: "wrong" }))).status).toBe(400);
    expect(mocks.createAuthorizationCode).not.toHaveBeenCalled();
  });
  it("rejects cross-origin consent posts", async () => {
    expect((await authorizePOST(formRequest("/api/oauth/crm/authorize", { decision: "allow", consent_token: "signed-consent" }, "https://attacker.example"))).status).toBe(400);
    expect(mocks.createAuthorizationCode).not.toHaveBeenCalled();
  });
  it("exchanges and refreshes tokens without accepting a client secret", async () => {
    mocks.exchangeAuthorizationCode.mockResolvedValue({ access_token: "short-lived", expires_in: 600 });
    const data = { grant_type: "authorization_code", client_id: "registered-client", resource: authorization.resource, code: "code", code_verifier: "v".repeat(64), redirect_uri: authorization.redirect_uri };
    const response = await tokenPOST(formRequest("/api/oauth/crm/token", data));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining({ clientId: "registered-client", codeVerifier: "v".repeat(64), resource: authorization.resource }));
    expect((await tokenPOST(formRequest("/api/oauth/crm/token", { ...data, client_secret: "not-accepted" }))).status).toBe(401);
    mocks.refreshAccessToken.mockResolvedValue({ access_token: "new-short-lived" });
    expect((await tokenPOST(formRequest("/api/oauth/crm/token", { grant_type: "refresh_token", client_id: "registered-client", resource: authorization.resource, refresh_token: "old-refresh" }))).status).toBe(200);
  });
  it("normalizes unexpected token errors without returning credentials or internal messages", async () => {
    mocks.exchangeAuthorizationCode.mockRejectedValue(new Error("private-value-do-not-expose"));
    const response = await tokenPOST(formRequest("/api/oauth/crm/token", { grant_type: "authorization_code", client_id: "registered-client", resource: authorization.resource, code: "code", code_verifier: "v".repeat(64), redirect_uri: authorization.redirect_uri }));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private-value-do-not-expose");
  });
  it("supports revocation without exposing token contents in the response", async () => {
    const response = await revokePOST(formRequest("/api/oauth/crm/revoke", { client_id: "registered-client", token: "opaque-refresh" }));
    expect(response.status).toBe(200); expect(await response.text()).toBe("");
  });
});
