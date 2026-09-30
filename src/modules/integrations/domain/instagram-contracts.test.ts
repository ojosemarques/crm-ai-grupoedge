import { describe, expect, it } from "vitest";

import { instagramLocalInboundSchema } from "@/modules/integrations/domain/instagram-contracts";

describe("instagramLocalInboundSchema", () => {
  it("aceita Direct sem publicação e exige referência nos eventos públicos", () => {
    const base = { externalEventId: "instagram:event:001", username: "@politizai.teste", body: "Olá", occurredAt: "2026-09-30T12:00:00.000-03:00" };
    expect(instagramLocalInboundSchema.parse({ ...base, eventType: "DIRECT" }).publicationReference).toBeNull();
    expect(() => instagramLocalInboundSchema.parse({ ...base, eventType: "COMMENT" })).toThrow(/referência opaca/);
    expect(instagramLocalInboundSchema.parse({ ...base, eventType: "STORY_REPLY", publicationReference: "ig-media:123" }).eventType).toBe("STORY_REPLY");
  });
});
