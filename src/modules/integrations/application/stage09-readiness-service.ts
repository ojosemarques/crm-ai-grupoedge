import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

export function createStage09ReadinessService(options: Options) {
  const authorization = getAuthorizationService();
  async function screen(context: AuthenticatedContext) {
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_MANAGE, { workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: context.workspaceId });
    const [emailInbound, emailOutbound, emailErrors, emailReplies, phoneInbound, phoneOutbound, phoneErrors, phoneReplies, calendarInbound, calendarOutbound, calendarErrors, calendarReplies, instagramInbound, instagramOutbound, instagramErrors, instagramReplies, meetingOutcomes] = await Promise.all([
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND", conversation: { channel: "EMAIL" } } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "OUTBOUND", conversation: { channel: "EMAIL" } } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, status: { in: ["SOFT_BOUNCE", "HARD_BOUNCE", "FAILED_TRANSIENT", "FAILED_PERMANENT", "REJECTED"] }, conversation: { channel: "EMAIL" } } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, status: "REPLIED", conversation: { channel: "EMAIL" } } }),
      options.database.phoneCall.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND" } }),
      options.database.phoneCall.count({ where: { workspaceId: context.workspaceId, direction: "OUTBOUND" } }),
      options.database.phoneCall.count({ where: { workspaceId: context.workspaceId, status: { in: ["FAILED", "BUSY", "NO_ANSWER"] } } }),
      options.database.phoneCall.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND", status: { in: ["ANSWERED", "COMPLETED"] } } }),
      options.database.calendarSyncEvent.count({ where: { workspaceId: context.workspaceId, direction: "PULL" } }),
      options.database.calendarSyncEvent.count({ where: { workspaceId: context.workspaceId, direction: "PUSH" } }),
      options.database.calendarSyncEvent.count({ where: { workspaceId: context.workspaceId, status: { in: ["FAILED_PERMANENT", "RETRY_PENDING"] } } }),
      options.database.calendarSyncEvent.count({ where: { workspaceId: context.workspaceId, direction: "PULL", operation: { in: ["UPDATE", "RESCHEDULE"] }, status: "APPLIED" } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND", conversation: { channel: "INSTAGRAM_MESSAGING" } } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "OUTBOUND", conversation: { channel: "INSTAGRAM_MESSAGING" } } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, status: { in: ["FAILED_TRANSIENT", "FAILED_PERMANENT", "REJECTED"] }, conversation: { channel: "INSTAGRAM_MESSAGING" } } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND", replyToMessageId: { not: null }, conversation: { channel: "INSTAGRAM_MESSAGING" } } }),
      options.database.meeting.count({ where: { workspaceId: context.workspaceId, status: { in: ["COMPLETED", "NO_SHOW", "CANCELLED"] }, deletedAt: null } }),
    ]);
    const channel = (key: string, label: string, proofs: { inbound: number; outbound: number; error: number; reply: number }, readiness: readonly { key: string; status: "VALIDATED_LOCALLY" | "EXTERNAL_BLOCKED" | "NOT_TESTED"; detail: string }[]) => ({
      key, label, mode: "LOCAL_SIMULATOR" as const, externalEgress: false as const, externalValidation: false as const,
      homologated: false as const, decision: { status: "EXTERNAL_BLOCKED" as const, reason: "Credenciais, conta sandbox e evidência real do provider não estão disponíveis." }, proofs, readiness,
    });
    return {
      generatedAt: options.now().toISOString(),
      channels: [
        channel("EMAIL", "E-mail", { inbound: emailInbound, outbound: emailOutbound, error: emailErrors, reply: emailReplies }, [
          { key: "LOCAL_FLOW", status: "VALIDATED_LOCALLY", detail: "Inbound, outbound, bounce, reply e descadastro possuem cenários locais." },
          { key: "GOOGLE_MICROSOFT", status: "EXTERNAL_BLOCKED", detail: "OAuth, domínio e webhooks Google/Microsoft não foram homologados." },
        ]),
        channel("TELEPHONY", "Telefonia", { inbound: phoneInbound, outbound: phoneOutbound, error: phoneErrors, reply: phoneReplies }, [
          { key: "LOCAL_CALLS", status: "VALIDATED_LOCALLY", detail: "Chamadas, status, falha, cancelamento e disposição possuem simulador local." },
          { key: "RECORDING", status: "EXTERNAL_BLOCKED", detail: "Gravação e transcrição de chamada permanecem desativadas sem política e retenção aprovadas." },
        ]),
        channel("CALENDAR", "Agenda", { inbound: calendarInbound, outbound: calendarOutbound, error: calendarErrors, reply: calendarReplies }, [
          { key: "LOCAL_SYNC", status: "VALIDATED_LOCALLY", detail: "Convite, atualização, cancelamento, conflito e replay são exercitáveis localmente." },
          { key: "GOOGLE_MICROSOFT", status: "EXTERNAL_BLOCKED", detail: "OAuth e calendário real não foram homologados." },
        ]),
        channel("VIDEO", "Videoconferência", { inbound: 0, outbound: 0, error: 0, reply: meetingOutcomes }, [
          { key: "MEETING_OUTCOME", status: meetingOutcomes > 0 ? "VALIDATED_LOCALLY" : "NOT_TESTED", detail: "Resultado e próxima ação são fatos locais ligados à reunião." },
          { key: "VIDEO_PROVIDER", status: "EXTERNAL_BLOCKED", detail: "Nenhum Google Meet, Teams ou outro provider foi conectado." },
        ]),
        channel("INSTAGRAM", "Instagram", { inbound: instagramInbound, outbound: instagramOutbound, error: instagramErrors, reply: instagramReplies }, [
          { key: "EVENT_TYPES", status: "VALIDATED_LOCALLY", detail: "Direct, comentário, menção e resposta a story entram no inbox por fixtures." },
          { key: "META_PROVIDER", status: "EXTERNAL_BLOCKED", detail: "Conta, permissões, webhook e trial do agente não foram homologados." },
        ]),
      ],
    };
  }
  return Object.freeze({ screen });
}

let service: ReturnType<typeof createStage09ReadinessService> | undefined;
export function getStage09ReadinessService() {
  service ??= createStage09ReadinessService({ database: getDatabaseClient(), now: () => new Date() });
  return service;
}
