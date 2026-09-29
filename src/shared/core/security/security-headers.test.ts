import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, createStaticSecurityHeaders } from "@/shared/core/security/security-headers";

describe("headers seguros PROD-03", () => {
  it("gera CSP com nonce sem liberar script inline", () => {
    const policy = buildContentSecurityPolicy({ nonce: "nonce-seguro", https: true });
    expect(policy).toContain("script-src 'self' 'nonce-nonce-seguro' 'strict-dynamic'");
    expect(policy.split("; ").find((directive) => directive.startsWith("script-src"))).not.toContain("'unsafe-inline'");
    expect(policy.split("; ").find((directive) => directive.startsWith("style-src "))).not.toContain("'unsafe-inline'");
    expect(policy).toContain("style-src-attr 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("inclui HSTS somente para HTTPS", () => {
    expect(createStaticSecurityHeaders({ https: true })).toContainEqual(expect.objectContaining({ key: "Strict-Transport-Security" }));
    expect(createStaticSecurityHeaders({ https: false })).not.toContainEqual(expect.objectContaining({ key: "Strict-Transport-Security" }));
  });

  it("isola framing, recursos e capacidades sensíveis", () => {
    const headers = createStaticSecurityHeaders({ https: true });
    expect(headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    expect(headers).toContainEqual({ key: "Cross-Origin-Resource-Policy", value: "same-origin" });
    expect(headers).toContainEqual(expect.objectContaining({ key: "Permissions-Policy" }));
  });
});
