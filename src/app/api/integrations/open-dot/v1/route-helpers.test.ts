import { describe, expect, it } from "vitest";

import { openDotRateLimitNamespace } from "@/app/api/integrations/open-dot/v1/route-helpers";
import { openDotScopeSchema } from "@/modules/prospecting/domain/prospecting-contracts";

describe("Open-Dot route hardening", () => {
  it("gera um namespace compartilhado válido e estável para cada escopo", () => {
    const namespaces = openDotScopeSchema.options.map(openDotRateLimitNamespace);

    expect(new Set(namespaces).size).toBe(openDotScopeSchema.options.length);
    for (const namespace of namespaces) {
      expect(namespace).toMatch(/^[a-z0-9][a-z0-9:_-]{0,79}$/);
      expect(namespace).not.toContain("/");
    }
  });
});
