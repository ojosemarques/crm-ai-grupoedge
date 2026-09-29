import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@/modules/auth/http/session-cookie";
import { proxy } from "@/proxy";

describe("proteção otimista de rotas", () => {
  it("redireciona uma URL protegida sem cookie", () => {
    const response = proxy(new NextRequest("http://localhost:3000/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(response.headers.get("content-security-policy")).toContain("nonce-");
  });

  it("deixa a validação definitiva para o servidor quando há cookie", () => {
    const request = new NextRequest("http://localhost:3000/", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-opaco` },
    });
    const response = proxy(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("permite login sem cookie e aplica CSP", () => {
    const response = proxy(new NextRequest("http://localhost:3000/login"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("não redireciona API sem sessão e mantém correlation ID seguro", () => {
    const response = proxy(new NextRequest("http://localhost:3000/api/health", {
      headers: { "x-correlation-id": "prod09.smoke.001" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-correlation-id")).toBe("prod09.smoke.001");
  });

  it("substitui correlation ID malformado", () => {
    const response = proxy(new NextRequest("http://localhost:3000/login", {
      headers: { "x-correlation-id": "<script>" },
    }));
    expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejeita host não confiável no ambiente remoto", () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("APP_TRUSTED_HOSTS", "crm-staging.example");
    const response = proxy(new NextRequest("https://host-invalido.example/login"));
    expect(response.status).toBe(421);
    vi.unstubAllEnvs();
  });
});
