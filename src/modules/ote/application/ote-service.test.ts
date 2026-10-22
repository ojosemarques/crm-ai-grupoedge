import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOteService } from "./ote-service";

const context = { workspaceId: "workspace", memberId: "seller", userId: "user", roleId: "role", actorId: "actor", displayName: "Vendedor" } as AuthenticatedContext;
const now = new Date("2027-01-01T12:00:00Z");
function fixture(kind = "ANNUAL_MONTHLY") {
  const database = {
    workspaceMember: { findFirst: vi.fn().mockResolvedValue({ role: { key: "closer" } }) },
    actor: { findFirst: vi.fn().mockResolvedValue({ id: "actor" }) },
    workspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ timeZone: "America/Sao_Paulo" }) },
    otePlan: { findFirst: vi.fn().mockResolvedValue({ role: "CLOSER", label: "Plano", effectiveMonth: "2026-10", fixedCents: 370000n, quotaCents: 6000000n, bonusCents: 120000n, meetingQuota: 20, salesQuota: 4 }) },
    opportunity: { findMany: vi.fn().mockResolvedValue([{ id: "sale", name: "Venda", closedAt: new Date("2026-10-01T15:00:00Z"), ownerMemberId: "seller" }]) },
    oteSale: { findMany: vi.fn().mockResolvedValue([{ opportunityId: "sale", sellerMemberId: "seller", kind, acvCents: 6000000n, selfSourced: false }]) },
    commercialContract: { findMany: vi.fn().mockResolvedValue([{ id: "contract", opportunityId: "sale" }]) },
    subscription: { findMany: vi.fn().mockResolvedValue([{ contractId: "contract", status: "ACTIVE", startsAt: new Date("2026-10-01"), endsAt: null, cancellationEffectiveAt: null }]) },
    invoice: { findMany: vi.fn().mockResolvedValue([{ id: "invoice", contractId: "contract", totalCents: 500000n, paidCents: 500000n, dueAt: new Date("2026-10-01"), status: "PAID" }]) },
    payment: { findMany: vi.fn().mockResolvedValue([{ invoiceId: "invoice", amountCents: 500000n }]) },
  };
  const service = createOteService({ database: database as never, authorization: {} as never, now: () => now });
  return { database, service };
}
describe("elegibilidade OTE a partir de fatos financeiros", () => {
  it("consulta somente o dono e recebimentos confirmados, sem estorno e sem datas futuras", async () => {
    const { database, service } = fixture();
    const screen = await service.screen(context, { month: "2026-10" });
    expect(screen.summary?.eligibleCents).toBe("360000");
    expect(database.otePlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace", memberId: "seller", effectiveMonth: { lte: "2026-10" } } }));
    expect(database.opportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace", ownerMemberId: "seller", closedAt: { gte: new Date("2026-10-01T03:00:00Z"), lt: new Date("2026-11-01T03:00:00Z"), lte: now } }) }));
    expect(database.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace", status: "CONFIRMED", reversedAt: null, occurredAt: { lte: now } }) }));
  });
  it("bloqueia liberação sem recebimento, com inadimplência ou assinatura inativa", async () => {
    for (const reason of ["no-payment", "overdue", "inactive"]) {
      const { database, service } = fixture();
      if (reason === "no-payment") database.payment.findMany.mockResolvedValue([]);
      if (reason === "overdue") database.invoice.findMany.mockResolvedValue([{ id: "invoice", contractId: "contract", totalCents: 500000n, paidCents: 0n, dueAt: new Date("2026-12-01"), status: "OPEN" }]);
      if (reason === "inactive") database.subscription.findMany.mockResolvedValue([{ contractId: "contract", status: "CHURNED", startsAt: new Date("2026-10-01"), endsAt: null, cancellationEffectiveAt: null }]);
      const screen = await service.screen(context, { month: "2026-10" });
      expect(screen.summary?.commissionCents).toBe("360000");
      expect(screen.summary?.eligibleCents).toBe("0");
    }
  });
  it("comissiona antecipado apenas pelo recebido e exige ativação", async () => {
    const { database, service } = fixture("ANNUAL_UPFRONT");
    expect((await service.screen(context, { month: "2026-10" })).summary).toMatchObject({ commissionCents: "40000", eligibleCents: "40000" });
    database.subscription.findMany.mockResolvedValue([]);
    expect((await service.screen(context, { month: "2026-10" })).summary?.eligibleCents).toBe("0");
  });
  it("não bloqueia projeto recebido por ausência de assinatura recorrente", async () => {
    const { database, service } = fixture("PROJECT");
    database.subscription.findMany.mockResolvedValue([]);
    expect((await service.screen(context, { month: "2026-10" })).summary).toMatchObject({ newAcvCents: "0", commissionCents: "25000", eligibleCents: "25000", bonusCents: "0" });
  });
});
