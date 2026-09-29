import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { InvalidRequestOriginError } from "@/modules/auth/domain/auth-errors";
import {
  assertSameOrigin,
  getRequestMetadata,
} from "@/modules/auth/http/request-security";

describe("segurança das requisições de autenticação", () => {
  it("aceita origem local idêntica e normaliza metadados", () => {
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      headers: {
        origin: "http://localhost:3000",
        "user-agent": "navegador-de-teste",
        "x-forwarded-for": "127.0.0.1, 10.0.0.1",
      },
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
    expect(getRequestMetadata(request)).toEqual({
      ipAddress: "127.0.0.1",
      userAgent: "navegador-de-teste",
    });
  });

  it("rejeita origem cruzada e descarta IP inválido", () => {
    const request = new NextRequest("http://localhost:3000/api/auth/login", {
      headers: {
        origin: "https://site-malicioso.example",
        "x-forwarded-for": "valor-invalido",
      },
    });

    expect(() => assertSameOrigin(request)).toThrow(InvalidRequestOriginError);
    expect(getRequestMetadata(request).ipAddress).toBeNull();
  });

  it("exige allowlists explícitas e HTTPS em staging", () => {
    const request = new NextRequest("https://crm-politizai-staging.example.com/api/auth/login", {
      headers: {
        host: "crm-politizai-staging.example.com",
        origin: "https://crm-politizai-staging.example.com",
        "x-forwarded-proto": "https",
      },
    });
    const environment = {
      APP_ENV: "staging",
      APP_TRUSTED_HOSTS: "crm-politizai-staging.example.com",
      APP_TRUSTED_ORIGINS: "https://crm-politizai-staging.example.com",
    };
    expect(() => assertSameOrigin(request, environment)).not.toThrow();
    expect(() => assertSameOrigin(request, { ...environment, APP_TRUSTED_ORIGINS: "https://outro.example" })).toThrow(InvalidRequestOriginError);
  });
});
