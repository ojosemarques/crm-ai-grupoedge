import { describe, expect, it } from "vitest";

import { resolveIntentPrefetch } from "./intent-link";

describe("prefetch de navegação por intenção", () => {
  it("não consulta a rota quando o link apenas entra no viewport", () => {
    expect(resolveIntentPrefetch(false)).toBe(false);
  });

  it("restaura o prefetch padrão somente após intenção do usuário", () => {
    expect(resolveIntentPrefetch(true)).toBeNull();
  });

  it("mantém o prefetch desabilitado quando solicitado explicitamente", () => {
    expect(resolveIntentPrefetch(true, true)).toBe(false);
  });
});
