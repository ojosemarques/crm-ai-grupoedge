import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { INSTAGRAM_CONTRACT_VERSION, instagramEventTypes, instagramLocalInboundSchema } from "@/modules/integrations/domain/instagram-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type OmnichannelPort = Pick<ReturnType<typeof getOmnichannelService>, "receiveLocal">;
type Options = Readonly<{ database: PrismaClient; omnichannel: OmnichannelPort; now: () => Date }>;

export function createInstagramService(options: Options) {
  const authorization = getAuthorizationService();
  const resource = (context: AuthenticatedContext) => ({ workspaceId: context.workspaceId, resourceType: "Conversation", resourceId: context.workspaceId, ownerMemberId: context.memberId });

  async function screen(context: AuthenticatedContext) {
    await authorization.assertAuthorized(context, PermissionKeys.INBOX_READ, resource(context));
    const [conversations, inbound, outbound, recent] = await Promise.all([
      options.database.conversation.count({ where: { workspaceId: context.workspaceId, channel: "INSTAGRAM_MESSAGING", deletedAt: null } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND", conversation: { channel: "INSTAGRAM_MESSAGING" } } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "OUTBOUND", conversation: { channel: "INSTAGRAM_MESSAGING" } } }),
      options.database.webhookInbox.findMany({ where: { workspaceId: context.workspaceId, payload: { path: ["channel"], equals: "INSTAGRAM_MESSAGING" } }, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, providerEventId: true, payload: true, status: true, receivedAt: true, messageId: true } }),
    ]);
    return {
      generatedAt: options.now().toISOString(),
      contractVersion: INSTAGRAM_CONTRACT_VERSION,
      mode: "LOCAL_SIMULATOR" as const,
      externalEgress: false as const,
      externalValidation: false as const,
      agentCapability: "NOT_VALIDATED" as const,
      supportedEventTypes: instagramEventTypes,
      decision: { status: "EXTERNAL_BLOCKED" as const, reason: "Conta Meta, app, permissões, webhook e trial da Clint não foram fornecidos nem homologados." },
      metrics: { conversations, inbound, outbound },
      recent: recent.map((item) => ({ ...item, receivedAt: item.receivedAt.toISOString() })),
      readiness: [
        { key: "INBOX_TRANSITION", status: "VALIDATED_LOCALLY" as const, detail: "Direct, comentário, menção e resposta a story entram no inbox canônico por fixtures." },
        { key: "META_PROVIDER", status: "EXTERNAL_BLOCKED" as const, detail: "Sem conta, app, token, webhook ou revisão de permissões Meta." },
        { key: "CLINT_AGENT", status: "NOT_TESTED" as const, detail: "Sem conta de avaliação da Clint; fontes públicas não comprovam equivalência operacional do agente no Instagram." },
      ],
    };
  }

  async function simulateInbound(context: AuthenticatedContext, raw: unknown) {
    const input = instagramLocalInboundSchema.parse(raw);
    return options.omnichannel.receiveLocal(context, {
      externalEventId: input.externalEventId,
      channel: "INSTAGRAM_MESSAGING",
      address: input.username.replace(/^@/, ""),
      body: input.body,
      subject: `Instagram ${input.eventType}`,
      occurredAt: input.occurredAt,
      scenario: "RECEIVED",
      metadata: {
        instagramEventType: input.eventType,
        ...(input.publicationReference ? { publicationReference: input.publicationReference } : {}),
        contractVersion: INSTAGRAM_CONTRACT_VERSION,
      },
    });
  }

  return Object.freeze({ screen, simulateInbound });
}

let service: ReturnType<typeof createInstagramService> | undefined;
export function getInstagramService() {
  service ??= createInstagramService({ database: getDatabaseClient(), omnichannel: getOmnichannelService(), now: () => new Date() });
  return service;
}
