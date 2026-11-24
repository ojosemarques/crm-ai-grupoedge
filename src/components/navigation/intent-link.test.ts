import { describe, expect, it } from "vitest";

import { resolveIntentPrefetch } from "./intent-link";

describe("prefetch de navegação por intenção", () => {
  it("não executa rotas dinâmicas em segundo plano", () => {
    expect(resolveIntentPrefetch()).toBe(false);
  });
});
