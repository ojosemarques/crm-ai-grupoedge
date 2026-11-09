import { describe, expect, it } from "vitest";
import { isSellerAvailable, publicAgendaWindow, PUBLIC_AGENDA_SELLERS } from "./public-agenda";

describe("agenda pública", () => {
  it("abre no dia de Brasília, vira o mês e omite horários passados", () => {
    const { today, days, slots } = publicAgendaWindow(new Date("2026-11-01T00:15:00Z"));
    expect(today).toBe("2026-10-31");
    expect(days).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(slots.at(-1)?.endsAt.toISOString()).toBe("2026-11-02T21:30:00.000Z");
    expect(slots.filter((slot) => slot.day === "2026-11-01").map((slot) => slot.hour))
      .toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it("respeita a abertura de cada vendedor e qualquer sobreposição de 30 minutos", () => {
    const { slots } = publicAgendaWindow(new Date("2026-11-09T11:00:00Z"));
    const [nine, ten, eleven] = slots;
    expect(isSellerAvailable(nine!, PUBLIC_AGENDA_SELLERS["jhoncunha@politizai.com"], [])).toBe(true);
    expect(isSellerAvailable(ten!, PUBLIC_AGENDA_SELLERS["ederafael@politizai.com"], [])).toBe(false);
    expect(isSellerAvailable(eleven!, PUBLIC_AGENDA_SELLERS["ederafael@politizai.com"], [
      { startsAt: new Date("2026-11-09T14:29:00Z"), endsAt: new Date("2026-11-09T14:40:00Z") },
    ])).toBe(false);
    expect(isSellerAvailable(eleven!, 11, [
      { startsAt: new Date("2026-11-09T13:00:00Z"), endsAt: new Date("2026-11-09T14:00:00Z") },
      { startsAt: new Date("2026-11-09T14:30:00Z"), endsAt: new Date("2026-11-09T15:00:00Z") },
    ])).toBe(true);
  });

  it("não oferece um horário que já começou", () => {
    expect(publicAgendaWindow(new Date("2026-11-09T12:00:00Z")).slots[0]?.hour).toBe(10);
  });
});
