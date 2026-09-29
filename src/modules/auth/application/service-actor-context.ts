import type { ActorType, PrismaClient } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

export type AutomaticActorType = Extract<
  ActorType,
  "SYSTEM" | "AUTOMATION" | "AI_AGENT"
>;

export type ServiceActorContext = Readonly<{
  workspaceId: string;
  actorId: string;
  actorType: AutomaticActorType;
  actorKey: string;
}>;

export async function resolveServiceActorContext(
  workspaceId: string,
  actorId: string,
  expectedType: AutomaticActorType,
  database: PrismaClient = getDatabaseClient(),
): Promise<ServiceActorContext> {
  const actor = await database.actor.findFirst({
    where: {
      id: actorId,
      workspaceId,
      type: expectedType,
      userId: null,
    },
    select: { id: true, key: true, type: true },
  });

  if (!actor || actor.type === "HUMAN") {
    throw new ApplicationError("Ator automático inválido.", {
      code: "INVALID_SERVICE_ACTOR",
      statusCode: 403,
      expose: true,
    });
  }

  return Object.freeze({
    workspaceId,
    actorId: actor.id,
    actorType: actor.type,
    actorKey: actor.key,
  });
}
