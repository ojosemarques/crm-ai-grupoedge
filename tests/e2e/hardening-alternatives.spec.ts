import { enterDemoCompany } from "./helpers/company-hub";
import { createHash, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { PrismaClient } from "@/generated/prisma/client";
import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { browserRequest } from "./support/browser-request";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for hardening E2E tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString) });

test.afterAll(async () => database.$disconnect());

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

function saoPauloDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function uniquePhone(label: string): string {
  const hex = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hex.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, "0");
  return `+55119${suffix}`;
}

test("seed demonstra no-show, desqualificação, opt-out, ausência de próxima ação e falha de automação", async ({ page }) => {
  const workspace = await database.workspace.findUniqueOrThrow({
    where: { slug: DEMO_WORKSPACE_SLUG },
    select: { id: true },
  });
  const [noShow, disqualified, optedOut, withoutNextAction] = await Promise.all([
    database.meeting.findFirstOrThrow({
      where: { workspaceId: workspace.id, status: "NO_SHOW", deletedAt: null },
      include: { lead: { select: { fullName: true } } },
    }),
    database.lead.findFirstOrThrow({
      where: {
        workspaceId: workspace.id,
        status: "DISQUALIFIED",
        deletedAt: null,
      },
      select: { fullName: true },
    }),
    database.lead.findFirstOrThrow({
      where: { workspaceId: workspace.id, contactPreference: "DO_NOT_CONTACT", deletedAt: null },
      select: { id: true, fullName: true },
    }),
    database.lead.findFirstOrThrow({
      where: { workspaceId: workspace.id, status: "OPEN", nextActionTaskId: null, deletedAt: null },
      select: { fullName: true },
    }),
  ]);

  await login(page);
  await page.goto(`/agenda?view=day&date=${saoPauloDate(noShow.startsAt)}`);
  const meeting = page.locator("li").filter({ hasText: noShow.title });
  await expect(meeting).toContainText(noShow.lead.fullName);
  await expect(meeting).toContainText("No-show");

  await page.goto(`/leads?q=${encodeURIComponent(disqualified.fullName)}`);
  await expect(page.getByRole("row").filter({ hasText: disqualified.fullName })).toContainText("Desqualificado");

  await page.goto(`/leads?q=${encodeURIComponent(withoutNextAction.fullName)}`);
  await expect(page.getByRole("row").filter({ hasText: withoutNextAction.fullName })).toContainText("Sem próxima ação");

  await page.goto(`/leads/${optedOut.id}/historico`);
  await expect(page.getByText("Não contatar: tentativas de contato estão bloqueadas no serviço de domínio.")).toBeVisible();

  await page.goto("/automacoes?status=FAILED");
  await expect(page.getByRole("cell", { name: "Falha", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Falha controlada para inspeção local.").first()).toBeVisible();
});

test("entrada sem SDR disponível usa a Fila Geral e mantém tarefa, SLA e auditoria", async ({ page }) => {
  const workspace = await database.workspace.findUniqueOrThrow({
    where: { slug: DEMO_WORKSPACE_SLUG },
    select: { id: true },
  });
  const sdrs = await database.workspaceMember.findMany({
    where: {
      workspaceId: workspace.id,
      deletedAt: null,
      teamMemberships: { some: { function: "SDR", deletedAt: null } },
    },
    select: {
      id: true,
      leadReceivingPausedAt: true,
      leadReceivingPauseReason: true,
      leadReceivingPausedByActorId: true,
    },
  });
  const systemActor = await database.actor.findUniqueOrThrow({
    where: { workspaceId_key: { workspaceId: workspace.id, key: "system" } },
    select: { id: true },
  });
  await database.workspaceMember.updateMany({
    where: { id: { in: sdrs.map(({ id }) => id) } },
    data: {
      leadReceivingPausedAt: new Date(),
      leadReceivingPauseReason: "Cenário isolado CRM-30",
      leadReceivingPausedByActorId: systemActor.id,
    },
  });

  try {
    await login(page);
    const name = `Lead sem SDR E2E ${randomUUID().slice(0, 8)}`;
    const response = await browserRequest(page).post("/api/leads/manual", {
      data: {
        idempotencyKey: randomUUID(),
        lead: {
          fullName: name,
          phone: uniquePhone(name),
          sourceKey: "website",
          priorityBandCode: "P1",
        },
      },
    });
    expect(response.status()).toBe(201);
    const body = await response.json() as {
      result: { leadId: string; operationalOwner: { type: string; memberId: string | null; queueId: string | null } };
    };
    expect(body.result.operationalOwner).toMatchObject({ type: "QUEUE", memberId: null });
    expect(body.result.operationalOwner.queueId).not.toBeNull();

    const lead = await database.lead.findUniqueOrThrow({
      where: { id: body.result.leadId },
      include: {
        queue: { select: { isGeneral: true, name: true } },
        tasks: { where: { kind: "IMMEDIATE_CALL" }, select: { title: true, dueAt: true } },
        slaCycles: { select: { receivedAt: true, assignedAt: true } },
        assignments: { select: { type: true } },
      },
    });
    expect(lead.queue).toMatchObject({ isGeneral: true, name: "Fila Geral" });
    expect(lead.tasks).toHaveLength(1);
    expect(lead.tasks[0]?.title).toBe("Ligar agora");
    expect(lead.slaCycles).toHaveLength(1);
    expect(lead.slaCycles[0]?.assignedAt).toEqual(lead.slaCycles[0]?.receivedAt);
    expect(lead.assignments[0]?.type).toBe("GENERAL_QUEUE_FALLBACK");
    await expect(database.auditLog.count({
      where: { workspaceId: workspace.id, entityType: "Lead", entityId: lead.id, action: "lead.intake.created" },
    })).resolves.toBe(1);
  } finally {
    await Promise.all(sdrs.map((member) => database.workspaceMember.update({
      where: { id: member.id },
      data: {
        leadReceivingPausedAt: member.leadReceivingPausedAt,
        leadReceivingPauseReason: member.leadReceivingPauseReason,
        leadReceivingPausedByActorId: member.leadReceivingPausedByActorId,
      },
    })));
  }
});
