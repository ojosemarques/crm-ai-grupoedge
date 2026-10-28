import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { getDatabaseClient } from "@/shared/core/database/client";
import { hashPassword } from "@/modules/auth/domain/password";
import { DEMO_SEED_PASSWORD } from "@/modules/settings/application/demo-seed-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { enterDemoCompany } from "./helpers/company-hub";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

test.afterAll(async () => getDatabaseClient().$disconnect());

test("Carlos vê todos os leads de Anúncios e entrega o card ao vendedor que recebe a reunião", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  if (!new URL(process.env.DATABASE_URL!).searchParams.get("schema")?.startsWith("politizai_test_")) throw new Error("Ephemeral schema required");
  const db = getDatabaseClient();
  const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const system = await db.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "system" } });
  const role = await db.role.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "closer" } });
  const user = await db.user.create({ data: { email: "carloshenrique@politizai.com", normalizedEmail: "carloshenrique@politizai.com", displayName: "Carlos Henrique" } });
  await db.localCredential.create({ data: { userId: user.id, passwordHash: await hashPassword(DEMO_SEED_PASSWORD) } });
  const carlos = await db.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, roleId: role.id, status: "ACTIVE", createdByActorId: system.id, updatedByActorId: system.id } });
  await db.actor.create({ data: { workspaceId: workspace.id, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: user.displayName } });
  await ensureAdvertisingPipeline(db, workspace.id, system.id);
  const pipeline = await db.pipeline.findFirstOrThrow({ where: { workspaceId: workspace.id, name: "Anúncios" }, include: { stages: true } });
  const seller = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, roleId: role.id, id: { not: carlos.id }, status: "ACTIVE" }, include: { user: true } });
  const prefix = `Handoff E2E ${randomUUID().slice(0, 8)}`;
  const leads: string[] = [];
  const intake = createLeadIntakeService({ database: db, authorization: createAuthorizationService({ database: db }), now: () => new Date() });
  for (const channel of ["FORM", "AD"] as const) {
    const result = await intake.intake({ channel, idempotencyKey: randomUUID(), fullName: `${prefix} ${channel}`, phone: `+55119${String(parseInt(randomUUID().slice(0, 8), 16) % 100_000_000).padStart(8, "0")}`,
      sourceKey: "manual", pipelineId: pipeline.id, initialStageId: pipeline.stages.find((stage) => stage.leadStageCode === "NEW")!.id, priorityBandCode: "P3", rawPayload: { test: "carlos-handoff" } },
    { workspaceId: workspace.id, actorId: system.id, actorType: "SYSTEM", actorKey: system.key });
    if (result.outcome === "REJECTED") throw new Error(result.code);
    await db.lead.update({ where: { id: result.leadId }, data: { ownerMemberId: seller.id, queueId: null } });
    leads.push(result.leadId);
  }
  // The target lead starts with another owner so the transfer is observable.
  const admin = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, role: { key: "administrator" } } });
  await db.lead.update({ where: { id: leads[0]! }, data: { ownerMemberId: admin.id } });
  await login(page, user.email);
  await page.goto(`/anuncios?q=${encodeURIComponent(prefix)}`);
  await expect(page.locator("article").filter({ hasText: prefix })).toHaveCount(2);
  await page.locator("article").filter({ hasText: `${prefix} FORM` }).click();
  const profile = page.getByRole("dialog");
  await profile.getByRole("tab", { name: "Reuniões", exact: true }).click();
  const panel = profile.getByRole("tabpanel", { name: "Reuniões" });
  await panel.getByLabel("Closer").selectOption(seller.id);
  await panel.getByLabel("Título", { exact: true }).fill("Diagnóstico agendado pelo Carlos");
  await panel.getByLabel("Data e horário", { exact: true }).fill("2035-06-11T09:30");
  await panel.getByRole("button", { name: "Agendar reunião", exact: true }).click();
  await expect(panel.getByText("Diagnóstico agendado pelo Carlos", { exact: true }).first()).toBeVisible();
  expect((await db.lead.findUniqueOrThrow({ where: { id: leads[0]! } })).ownerMemberId).toBe(seller.id);
  await profile.getByRole("tab", { name: "Resumo", exact: true }).click();
  await profile.screenshot({ path: testInfo.outputPath("carlos-assigned-lead.png") });
  await login(page, seller.user.email);
  await page.goto(`/anuncios?q=${encodeURIComponent(prefix)}`);
  await page.locator("article").filter({ hasText: `${prefix} FORM` }).click();
  const sellerProfile = page.getByRole("dialog");
  await sellerProfile.getByRole("tab", { name: "Qualificação", exact: true }).click();
  await expect(sellerProfile.getByLabel("Qualificação do lead")).toBeEnabled();
  await sellerProfile.getByLabel("Qualificação do lead").fill("Vendedor recebeu o card e continuará o atendimento.");
  await sellerProfile.getByRole("button", { name: "Salvar qualificação", exact: true }).click();
  await expect(sellerProfile.getByText("Qualificação salva.", { exact: true })).toBeVisible();
  await sellerProfile.screenshot({ path: testInfo.outputPath("seller-editable-lead.png") });
});
