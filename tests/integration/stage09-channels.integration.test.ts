import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOmnichannelService } from "@/modules/communications/application/omnichannel-service";
import { createInstagramService } from "@/modules/integrations/application/instagram-service";
import { createStage09ReadinessService } from "@/modules/integrations/application/stage09-readiness-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage09 requires an ephemeral test schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2036-03-01T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database)).workspaceId;
  admin = await context("admin@demo.politizai.local");
});
afterAll(async () => database.$disconnect());

describe("Etapa 09 — canais e evidências locais", () => {
  it("transiciona Direct, comentário, menção e story reply para o inbox sem casar handle com telefone", async () => {
    const omnichannel = createOmnichannelService({ database, authorization, now: () => now });
    const instagram = createInstagramService({ database, omnichannel, now: () => now });
    const types = ["DIRECT", "COMMENT", "MENTION", "STORY_REPLY"] as const;
    for (const [index, eventType] of types.entries()) {
      await instagram.simulateInbound(admin, {
        externalEventId: `instagram:stage09:${index}`,
        eventType,
        username: "5511999990001",
        body: `Mensagem ${eventType}`,
        publicationReference: eventType === "DIRECT" ? null : `ig-media:${index}`,
        occurredAt: new Date(now.getTime() + index * 1_000).toISOString(),
      });
    }
    const conversations = await database.conversation.findMany({ where: { workspaceId, channel: "INSTAGRAM_MESSAGING" }, include: { messages: true, identityReviews: true } });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ leadId: null, contactPointId: null, opportunityId: null });
    expect(conversations[0]!.messages).toHaveLength(4);
    expect(conversations[0]!.identityReviews.length).toBeGreaterThan(0);
    const inbox = await database.webhookInbox.findMany({ where: { workspaceId, payload: { path: ["channel"], equals: "INSTAGRAM_MESSAGING" } }, orderBy: { externalOccurredAt: "asc" } });
    expect(inbox.map((item) => (item.payload as { metadata: { instagramEventType: string } }).metadata.instagramEventType)).toEqual(types);
    await expect(instagram.screen(admin)).resolves.toMatchObject({ mode: "LOCAL_SIMULATOR", externalEgress: false, externalValidation: false, agentCapability: "NOT_VALIDATED", metrics: { conversations: 1, inbound: 4 } });
  });

  it("expõe decisão por canal sem promover prova local a homologação externa", async () => {
    const screen = await createStage09ReadinessService({ database, now: () => now }).screen(admin);
    expect(screen.channels.map((item) => item.key)).toEqual(["EMAIL", "TELEPHONY", "CALENDAR", "VIDEO", "INSTAGRAM"]);
    expect(screen.channels.every((item) => item.externalEgress === false && item.externalValidation === false && item.homologated === false && item.decision.status === "EXTERNAL_BLOCKED")).toBe(true);
  });
});
