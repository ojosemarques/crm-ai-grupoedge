import { describe, expect, it } from "vitest";

import { isPublicShellRoute, isStandaloneShellRoute } from "@/components/layout/app-shell-routes";

describe("rotas sem shell administrativo", () => {
  it.each(["/login", "/hub", "/tempo", "/tempo-real-publico", "/f", "/f/captacao-mandato"])("considera %s pública", (pathname) => {
    expect(isPublicShellRoute(pathname)).toBe(true);
  });

  it.each(["/", "/tempo/configuracao", "/tempo-interno", "/tempo-real", "/tempo-real-publico-interno", "/formularios", "/formularios/form-1", "/foo"])("não classifica %s como pública", (pathname) => {
    expect(isPublicShellRoute(pathname)).toBe(false);
  });

  it("oferece shell próprio apenas à rota privada exata sem torná-la pública", () => {
    expect(isStandaloneShellRoute("/tempo-real")).toBe(true);
    expect(isPublicShellRoute("/tempo-real")).toBe(false);
    expect(isStandaloneShellRoute("/tempo-real-interno")).toBe(false);
    expect(isStandaloneShellRoute("/tempo-real/configuracao")).toBe(false);
    expect(isStandaloneShellRoute("/tempo-real-publico")).toBe(true);
  });
});
