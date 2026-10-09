import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiAuthentication = vi.fn();
const createTask = vi.fn();
const schedule = vi.fn();

vi.mock("@/modules/auth/http/authentication-guards", () => ({ requireApiAuthentication }));
vi.mock("@/modules/activities/application/operational-history-service", () => ({
  getOperationalHistoryService: () => ({ createTask }),
}));
vi.mock("@/modules/meetings/application/meeting-service", () => ({
  getMeetingService: () => ({ schedule }),
}));

const leadId = "11111111-1111-4111-8111-111111111111";
const closerId = "22222222-2222-4222-8222-222222222222";
const context = { actorId: "actor-a", workspaceId: "workspace-a" };

function request(data: Record<string, unknown>) {
  return new NextRequest(`https://crm.example/api/leads/${leadId}/operations`, {
    method: "POST",
    headers: { origin: "https://crm.example", "content-type": "application/json" },
    body: JSON.stringify({ action: "CREATE_TASK", data }),
  });
}

describe("criação de tarefa no card do lead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiAuthentication.mockResolvedValue(context);
    createTask.mockResolvedValue({ id: "task-a" });
    schedule.mockResolvedValue({ meetingId: "meeting-a", taskId: "task-a" });
  });

  it("agenda reunião pelo serviço oficial e não cria tarefa avulsa", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({
      kind: "MEETING",
      title: "Diagnóstico",
      description: "Preparar proposta",
      priority: "MEDIUM",
      startsAtLocal: "2035-02-11T15:00",
      durationMinutes: 30,
      closerId,
    }), { params: Promise.resolve({ leadId }) });

    expect(response.status).toBe(200);
    expect(schedule).toHaveBeenCalledWith(context, {
      leadId,
      closerId,
      title: "Diagnóstico",
      startsAtLocal: "2035-02-11T15:00",
      durationMinutes: 30,
      observation: "Preparar proposta",
      taskPriority: "MEDIUM",
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("mantém outros tipos como tarefas comuns", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ kind: "CALL", title: "Ligar", dueAt: "2035-02-11T15:00:00.000Z" }), { params: Promise.resolve({ leadId }) });
    expect(response.status).toBe(200);
    expect(createTask).toHaveBeenCalledWith(context, expect.objectContaining({ leadId, kind: "CALL" }));
    expect(schedule).not.toHaveBeenCalled();
  });

  it("rejeita origem externa antes de criar reunião", async () => {
    const { POST } = await import("./route");
    const response = await POST(new NextRequest(`https://crm.example/api/leads/${leadId}/operations`, {
      method: "POST",
      headers: { origin: "https://external.example", "content-type": "application/json" },
      body: JSON.stringify({ action: "CREATE_TASK", data: { kind: "MEETING" } }),
    }), { params: Promise.resolve({ leadId }) });
    expect(response.status).toBe(403);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("não cria tarefa avulsa quando o agendamento é negado", async () => {
    const { ApplicationError } = await import("@/shared/core/errors/application-error");
    schedule.mockRejectedValueOnce(new ApplicationError("Sem permissão para agendar.", { code: "FORBIDDEN", statusCode: 403, expose: true }));
    const { POST } = await import("./route");
    const response = await POST(request({ kind: "MEETING", title: "Diagnóstico", closerId, startsAtLocal: "2035-02-11T15:00", durationMinutes: 30 }), { params: Promise.resolve({ leadId }) });
    expect(response.status).toBe(403);
    expect(createTask).not.toHaveBeenCalled();
  });
});
