import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookPublicAgenda, listPublicAgenda } from "./public-agenda-service";

const setup = vi.hoisted(() => {
  const db = {
    marketingFormReceipt: { findMany: vi.fn() },
    marketingForm: { findFirst: vi.fn() },
    leadFormSubmission: { findFirst: vi.fn() },
    actor: { findFirst: vi.fn() },
    workspaceMember: { findMany: vi.fn() },
    googleCalendarAccount: { findMany: vi.fn() },
    meeting: { findFirst: vi.fn(), findMany: vi.fn() },
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { db, google: vi.fn(), lockCloser: vi.fn(), schedule: vi.fn() };
});
vi.mock("@/shared/core/database/client", () => ({ getDatabaseClient: () => setup.db }));
vi.mock("@/modules/integrations/application/google-calendar-worker-service", () => ({
  createGoogleCalendarWorkerService: () => ({ readBusyIntervals: setup.google }),
}));
vi.mock("@/modules/meetings/application/meeting-service", () => ({
  lockCloser: setup.lockCloser,
  getMeetingService: () => ({ scheduleFromPublicForm: setup.schedule }),
}));

const receipt = "9d34182c-f008-4e11-8aa0-4ed8d73f7693";
const jhon = "jhon";
const ede = "ede";
const morning = "2026-11-09T12:00:00.000Z";
const shared = "2026-11-09T14:00:00.000Z";
const interval = { startsAt: new Date(morning), endsAt: new Date("2026-11-09T14:30:00Z") };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T11:50:00Z"));
  setup.db.marketingFormReceipt.findMany.mockResolvedValue([{ id: "receipt", marketingFormId: "form", workspaceId: "workspace" }]);
  setup.db.marketingForm.findFirst.mockResolvedValue({ id: "form" });
  setup.db.leadFormSubmission.findFirst.mockResolvedValue({ leadId: "lead", normalizedEmail: "lead@example.com" });
  setup.db.actor.findFirst.mockResolvedValue({ id: "system" });
  setup.db.workspaceMember.findMany.mockResolvedValue([
    { id: jhon, user: { normalizedEmail: "jhoncunha@politizai.com" } },
    { id: ede, user: { normalizedEmail: "ederafael@politizai.com" } },
  ]);
  setup.db.googleCalendarAccount.findMany.mockResolvedValue([{ memberId: jhon }, { memberId: ede }]);
  setup.google.mockResolvedValue([]);
  setup.db.meeting.findFirst.mockResolvedValue(null);
  setup.db.meeting.findMany.mockResolvedValue([]);
  setup.db.$transaction.mockImplementation((run) => run(setup.db));
  setup.schedule.mockResolvedValue({ meetingId: "meeting" });
});

describe("reserva pelo formulário", () => {
  it("nega um recibo inexistente antes de consultar o Google", async () => {
    setup.db.marketingFormReceipt.findMany.mockResolvedValue([]);
    await expect(listPublicAgenda(receipt)).rejects.toMatchObject({ statusCode: 404 });
    expect(setup.google).not.toHaveBeenCalled();
  });

  it("oculta o horário ocupado no Google quando o outro vendedor ainda não atende", async () => {
    setup.google.mockImplementation(async ({ memberId }) => memberId === jhon ? [interval] : []);
    const data = await listPublicAgenda(receipt);
    expect(data.today).toBe("2026-11-09");
    expect(data.slots.some(({ startsAt }) => startsAt === morning)).toBe(false);
    expect(data.slots.some(({ startsAt }) => startsAt === shared)).toBe(true);
  });

  it("omite um vendedor se o Google falhar, sem presumir que está livre", async () => {
    setup.google.mockImplementation(async ({ memberId }) => {
      if (memberId === jhon) throw new Error("unavailable");
      return [];
    });
    const data = await listPublicAgenda(receipt);
    expect(data.slots.some(({ startsAt }) => startsAt === morning)).toBe(false);
    expect(data.slots.some(({ startsAt }) => startsAt === shared)).toBe(true);
  });

  it("revalida a ocupação do CRM sob o lock e rejeita sem reservar", async () => {
    setup.db.meeting.findMany.mockResolvedValue([{ ...interval, ownerMemberId: jhon }]);
    await expect(bookPublicAgenda(receipt, { startsAt: morning })).rejects.toMatchObject({ statusCode: 409 });
    expect(setup.lockCloser).toHaveBeenCalledWith(setup.db, "workspace", jhon);
    expect(setup.schedule).not.toHaveBeenCalled();
  });

  it("escolhe o outro vendedor em um horário compartilhado e bloqueia repetição do lead", async () => {
    setup.db.auditLog.findFirst.mockResolvedValue({ changes: { closerId: jhon } });
    await expect(bookPublicAgenda(receipt, { startsAt: shared })).resolves.toEqual({ booked: true, startsAt: shared });
    expect(setup.schedule).toHaveBeenCalledWith(setup.db, expect.objectContaining({ actorId: "system" }), expect.objectContaining({ closerId: ede, leadId: "lead" }));
    expect(setup.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ changes: { closerId: ede } }) }));
    setup.db.meeting.findFirst.mockResolvedValue({ id: "meeting" });
    await expect(bookPublicAgenda(receipt, { startsAt: morning })).resolves.toEqual({ booked: true });
    expect(setup.schedule).toHaveBeenCalledTimes(1);
  });
});
