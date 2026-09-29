import "dotenv/config";

import { randomUUID } from "node:crypto";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createContactBackfillService } from "@/modules/contacts/application/contact-backfill-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para o backfill de contatos.");
if (process.env.NODE_ENV === "production") throw new Error("Backfill local bloqueado com NODE_ENV=production.");
const parsedUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("O backfill CRM-33 só pode operar no PostgreSQL local conhecido.");
}
if (decodeURIComponent(parsedUrl.pathname.replace(/^\//, "")) !== "politizai_crm") {
  throw new Error("O backfill CRM-33 só pode operar no banco local politizai_crm.");
}
if ((parsedUrl.searchParams.get("schema") ?? "public") !== "public") {
  throw new Error("Use o executor de testes para schemas efêmeros; este comando exige o schema public local.");
}

const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="))?.split("=")[1] ?? "dry-run";
if (modeArgument !== "dry-run" && modeArgument !== "execute") {
  throw new Error("Use --mode=dry-run ou --mode=execute.");
}
const batchArgument = process.argv.find((argument) => argument.startsWith("--batch-size="))?.split("=")[1] ?? "100";
const batchSize = Number(batchArgument);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
  throw new Error("O batch size deve estar entre 1 e 500.");
}

const database = getDatabaseClient();
try {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE_SLUG } });
  const member = await database.workspaceMember.findFirstOrThrow({
    where: {
      workspaceId: workspace.id,
      user: { normalizedEmail: DEMO_USERS[0].email },
      status: "ACTIVE",
      deletedAt: null,
    },
    select: {
      id: true,
      userId: true,
      roleId: true,
      role: { select: { key: true, name: true } },
      user: { select: { displayName: true } },
    },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId: workspace.id, userId: member.userId, type: "HUMAN" },
  });
  const context: AuthenticatedContext = {
    sessionId: randomUUID(),
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  };
  const service = createContactBackfillService({
    database,
    authorization: createAuthorizationService({ database }),
    now: () => new Date(),
  });
  let run = await service.start(context, {
    mode: modeArgument === "execute" ? "EXECUTE" : "DRY_RUN",
    batchSize,
  });
  if (run.status === "PAUSED" || run.status === "FAILED") {
    run = await service.resume(context, { runId: run.id });
  }
  let batches = 0;
  while (run.status !== "SUCCEEDED") {
    if (batches >= 10_000) throw new Error("Limite defensivo de batches excedido.");
    run = await service.processBatch(context, { runId: run.id });
    batches += 1;
    process.stdout.write(
      `${JSON.stringify({ runId: run.id, mode: run.mode, status: run.status, processed: run.processedCount, eligible: run.eligibleCount, cursorLeadId: run.cursorLeadId })}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify({ result: run, batches })}\n`);
} finally {
  await database.$disconnect();
}
