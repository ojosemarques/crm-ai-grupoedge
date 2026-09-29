import { describe, expect, it, vi } from "vitest";

import {
  createExpiredSessionCookie,
  createSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/modules/auth/http/session-cookie";

describe("cookie de sessão", () => {
  it("é HttpOnly, SameSite e limitado à aplicação", () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");

    expect(createSessionCookie("token", expiresAt)).toMatchObject({
      name: SESSION_COOKIE_NAME,
      value: "token",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      priority: "high",
      expires: expiresAt,
    });
  });

  it("expira o cookie no logout", () => {
    expect(createExpiredSessionCookie()).toMatchObject({
      value: "",
      maxAge: 0,
      expires: new Date(0),
    });
  });

  it("respeita o transporte local mesmo com build de produção", async () => {
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_SECURE", "false");
    expect(createSessionCookie("token", new Date())).toMatchObject({ secure: false });
    vi.unstubAllEnvs();
  });

  it("exige configuração segura em staging", () => {
    expect(createSessionCookie("token", new Date(), {
      APP_ENV: "staging",
      SESSION_COOKIE_HTTP_ONLY: "true",
      SESSION_COOKIE_SAME_SITE: "lax",
      SESSION_COOKIE_SECURE: "true",
    })).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
    expect(() => createSessionCookie("token", new Date(), {
      APP_ENV: "production",
      SESSION_COOKIE_SECURE: "false",
    })).toThrow(/SESSION_COOKIE_SECURE/);
  });
});
