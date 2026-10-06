import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@/modules/auth/http/session-cookie";
import { proxy } from "@/proxy";

describe("proteção otimista de rotas", () => {
  it("libera somente o script público de analytics para instalação nas páginas", () => {
    const script = proxy(new NextRequest("http://localhost:3000/politizai-analytics.js"));
    expect(script.status).toBe(200);
    expect(script.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    const other = proxy(new NextRequest("http://localhost:3000/private.js"));
    expect(other.status).toBe(307);
    expect(other.headers.get("Cross-Origin-Resource-Policy")).toBeNull();
  });
  it("redireciona uma URL protegida sem cookie", () => {
    const response = proxy(new NextRequest("http://localhost:3000/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2F");
    expect(response.headers.get("content-security-policy")).toContain("nonce-");
  });

  it("preserva caminho e query internos para retomar o fluxo após o login", () => {
    const response = proxy(new NextRequest("http://localhost:3000/oauth/authorize?client_id=dot&state=abc"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Ddot%26state%3Dabc",
    );
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

  it("aceita somente a URL única do deployment informada pela Vercel para o cron", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("APP_TRUSTED_HOSTS", "crm.example");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "crm-deploy-team.vercel.app");

    const cron = proxy(new NextRequest("https://crm-deploy-team.vercel.app/api/internal/worker/tick"));
    const other = proxy(new NextRequest("https://outro-deploy.vercel.app/api/internal/worker/tick"));

    expect(cron.status).toBe(200);
    expect(other.status).toBe(421);
    vi.unstubAllEnvs();
  });
});
