import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQuizAgendaToken } from "../domain/quiz-agenda-token";
import { bookPublicAgenda, listPublicAgenda } from "./public-agenda-service";

const setup = vi.hoisted(() => {
  const db = {
    integrationConnection: { findFirst: vi.fn() },
    marketingFormReceipt: { findMany: vi.fn() },
    marketingForm: { findFirst: vi.fn() },
    marketingFormVersion: { findUnique: vi.fn() },
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
  setup.db.marketingFormReceipt.findMany.mockResolvedValue([{ id: "receipt", marketingFormId: "form", marketingFormVersionId: "published", workspaceId: "workspace" }]);
  setup.db.marketingForm.findFirst.mockResolvedValue({ id: "form" });
  setup.db.marketingFormVersion.findUnique.mockResolvedValue({ definition: {} });
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
  it.each(["quizmandato", "chatmandato"] as const)("agenda %s e devolve a página de obrigado", async (quiz) => {
    const secret = "local-test-quiz-signing-secret";
    vi.stubEnv("ACQUISITION_TEST_QUIZ_SECRET", secret);
    setup.db.integrationConnection.findFirst.mockResolvedValue({ workspaceId: "workspace", secrets: [{ referenceKey: "ACQUISITION_TEST_QUIZ_SECRET" }] });
    const token = createQuizAgendaToken(quiz, receipt, new Date(), secret);
    try {
      const badToken = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
      await expect(bookPublicAgenda(badToken, { startsAt: morning })).rejects.toMatchObject({ statusCode: 404 });
      expect(setup.schedule).not.toHaveBeenCalled();
      await expect(listPublicAgenda(token)).resolves.toMatchObject({ booked: false });
      await expect(bookPublicAgenda(token, { startsAt: morning })).resolves.toEqual({
        booked: true, startsAt: morning, redirect: { kind: "URL", url: "https://site.politizai.com/obrigadoquiz" },
      });
      expect(setup.db.leadFormSubmission.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "workspace", id: receipt, formIdentifier: `site-${quiz}` }),
      }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

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

  it("só entrega o destino do WhatsApp depois de confirmar a reserva", async () => {
    setup.db.marketingFormVersion.findUnique.mockResolvedValue({
      definition: { redirects: { afterAgenda: { kind: "WHATSAPP", phone: "+5511999999999", message: "Olá, confirmei." } } },
    });
    await expect(listPublicAgenda(receipt)).resolves.not.toHaveProperty("redirect");
    expect(setup.db.marketingFormVersion.findUnique).not.toHaveBeenCalled();
    const confirmation = await bookPublicAgenda(receipt, { startsAt: morning });
    expect(confirmation).toMatchObject({
      booked: true,
      redirect: { kind: "WHATSAPP", url: "https://wa.me/5511999999999?text=Ol%C3%A1%2C+confirmei." },
    });
    expect(setup.db.marketingFormVersion.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_marketingFormId_id: { workspaceId: "workspace", marketingFormId: "form", id: "published" } },
    }));
    setup.db.meeting.findFirst.mockResolvedValue({
      createdByActorId: "system", title: "Reunião de diagnóstico", startsAt: new Date(morning), status: "SCHEDULED", deletedAt: null,
    });
    await expect(bookPublicAgenda(receipt, { startsAt: morning })).resolves.toEqual(confirmation);
    expect(setup.schedule).toHaveBeenCalledTimes(1);
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
