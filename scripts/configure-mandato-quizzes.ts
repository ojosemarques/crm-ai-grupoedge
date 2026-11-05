import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { createAcquisitionConnectionService } from "@/modules/acquisition-api/application/acquisition-connection-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { randomUUID } from "node:crypto";

// Explicit production URL and secrets are supplied by the operator, never embedded in this script.
if (process.env.APP_ENV !== "production" || !process.env.DATABASE_URL || process.env.CONFIRM_MANDATO_CONFIGURATION !== "politizai") throw new Error("Explicit production configuration required");
const url = new URL(process.env.DATABASE_URL);
if (["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Production target required");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL, { max: 3 }) });
(globalThis as typeof globalThis & { politizaiDatabaseClient?: PrismaClient }).politizaiDatabaseClient = database;
try {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, status: "ACTIVE", deletedAt: null, role: { key: "administrator" }, user: { status: "ACTIVE", deletedAt: null } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: member.userId, type: "HUMAN" } });
  const context: AuthenticatedContext = { sessionId: randomUUID(), workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId: workspace.id, name: "Anúncios", entityType: "LEAD", deletedAt: null }, include: { stages: { where: { type: "OPEN", deletedAt: null }, orderBy: { position: "asc" }, take: 1 } } });
  const service = createAcquisitionConnectionService(database);
  for (const quizId of ["chatmandato", "quizmandato"] as const) {
    const key = `site-${quizId}`, sourceKey = `quiz-${quizId}`;
    const secretReferenceKey = `ACQUISITION_${quizId.toUpperCase()}_HMAC_SECRET`;
    if (!process.env[secretReferenceKey] || process.env[secretReferenceKey]!.length < 32) throw new Error("Missing signing secret");
    const existing = await database.integrationConnection.findUnique({ where: { workspaceId_key: { workspaceId: workspace.id, key } }, include: { configVersions: { orderBy: { version: "desc" }, take: 1 } } });
    if (existing) {
      console.log(JSON.stringify({ quizId, connectionId: existing.id, status: existing.status, action: "EXISTING_REQUIRES_REVIEW" }));
      continue;
    }
    const source = await database.leadSource.findFirst({ where: { workspaceId: workspace.id, key: sourceKey, deletedAt: null } });
    if (!source) await database.leadSource.create({ data: { workspaceId: workspace.id, key: sourceKey, name: `Quiz · ${quizId === "chatmandato" ? "ChatMandato" : "QuizMandato"}`, type: "OTHER", createdByActorId: actor.id, updatedByActorId: actor.id } });
    const mapping = Object.fromEntries(["fullName", "phone", "jobTitle", "city", "stateCode", "interestSummary", "sessionPublicId", "landingUrl", "referrerUrl", "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"].map((field) => [field, field]));
    const result = await service.configure(context, { key, displayName: quizId === "chatmandato" ? "ChatMandato" : "QuizMandato", provider: "FORM", sourceKey, secretReferenceKey, mapping, externalQuiz: { quizId, pipelineId: pipeline.id, initialStageId: pipeline.stages[0]!.id }, definition: { name: quizId === "chatmandato" ? "ChatMandato" : "QuizMandato", canonicalUrl: `https://site.politizai.com/${quizId}` } });
    const activated = await service.command(context, { action: "ACTIVATE", connectionId: result.id, revision: 1 });
    console.log(JSON.stringify({ quizId, connectionId: result.id, status: "status" in activated ? activated.status : "UNKNOWN", pipeline: pipeline.name, stage: pipeline.stages[0]!.name }));
  }
} finally { await database.$disconnect(); }
