import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assertLocalOnly } from "@/modules/leads/http/local-request-guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proteção dos simuladores locais", () => {
  it("aceita host loopback fora de produção", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => assertLocalOnly(new NextRequest("http://127.0.0.1:3000/api/local"))).not.toThrow();
  });

  it("não expõe o endpoint em host remoto ou produção", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => assertLocalOnly(new NextRequest("https://crm.example/api/local"))).toThrow("somente no ambiente local");

    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertLocalOnly(new NextRequest("http://localhost:3000/api/local"))).toThrow("somente no ambiente local");
  });
});
