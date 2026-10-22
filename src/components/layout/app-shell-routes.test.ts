import { describe, expect, it } from "vitest";

import { isPublicShellRoute } from "@/components/layout/app-shell-routes";

describe("rotas sem shell administrativo", () => {
  it.each(["/login", "/hub", "/tempo-real-publico", "/f", "/f/captacao-mandato"])("considera %s pública", (pathname) => {
    expect(isPublicShellRoute(pathname)).toBe(true);
  });

  it.each(["/", "/tempo-real", "/tempo-real-publico-interno", "/formularios", "/formularios/form-1", "/foo"])("mantém %s no shell", (pathname) => {
    expect(isPublicShellRoute(pathname)).toBe(false);
  });
});
