import { describe, expect, it } from "vitest";

import { initializeMetaPixel, trackMetaLead, type MetaPixelWindow } from "@/app/f/[slug]/meta-pixel";

function target() {
  return { location: { href: "https://example.test/f/forms-mandato" } } as MetaPixelWindow;
}

describe("Meta Pixel do formulário público", () => {
  it("inicializa o pixel e registra PageView uma única vez por URL", () => {
    const windowLike = target();
    expect(initializeMetaPixel(windowLike, "26525824360406160")).toBe(true);
    expect(initializeMetaPixel(windowLike, "26525824360406160")).toBe(true);
    expect(windowLike.fbq?.queue).toEqual([
      ["init", "26525824360406160"],
      ["track", "PageView"],
    ]);
  });

  it("registra Lead confirmado uma única vez com o eventID de deduplicação", () => {
    const windowLike = target();
    const eventId = "a".repeat(64);
    expect(trackMetaLead(windowLike, "26525824360406160", eventId)).toBe(true);
    expect(trackMetaLead(windowLike, "26525824360406160", eventId)).toBe(true);
    expect(windowLike.fbq?.queue).toEqual([
      ["init", "26525824360406160"],
      ["track", "Lead", {}, { eventID: eventId }],
    ]);
  });

  it("recusa identificadores inválidos sem criar a fila global", () => {
    const windowLike = target();
    expect(initializeMetaPixel(windowLike, "pixel-invalido")).toBe(false);
    expect(trackMetaLead(windowLike, "26525824360406160", "evento-invalido")).toBe(false);
    expect(windowLike.fbq).toBeUndefined();
  });
});
