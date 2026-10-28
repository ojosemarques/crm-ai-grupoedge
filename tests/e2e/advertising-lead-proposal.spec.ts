import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { DEMO_SEED_PASSWORD } from "@/modules/settings/application/demo-seed-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { enterDemoCompany } from "./helpers/company-hub";

test.afterAll(async () => getDatabaseClient().$disconnect());

test("vendedor move para Proposta e registra os dados enviados na ficha de Anúncios", async ({ page }, testInfo) => {
  if (!new URL(process.env.DATABASE_URL!).searchParams.get("schema")?.startsWith("politizai_test_")) throw new Error("Ephemeral schema required");
  const database = getDatabaseClient();
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const system = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "system" } });
  const seller = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: "closer1@demo.politizai.local" } } });
  await ensureAdvertisingPipeline(database, workspace.id, system.id);
  const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId: workspace.id, name: "Anúncios" } });
  const result = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => new Date() }).intake({
    channel: "MANUAL", idempotencyKey: randomUUID(), fullName: `Proposta E2E ${randomUUID().slice(0, 8)}`,
    phone: `+55119${String(Date.now()).slice(-8)}`, sourceKey: "manual", pipelineId: pipeline.id, priorityBandCode: "P2", rawPayload: { test: true },
  }, { workspaceId: workspace.id, actorId: system.id, actorKey: system.key, actorType: "SYSTEM" });
  if (result.outcome === "REJECTED") throw new Error(result.code);
  await database.lead.update({ where: { id: result.leadId }, data: { ownerMemberId: seller.id } });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("closer1@demo.politizai.local");
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await enterDemoCompany(page);
  await page.goto(`/leads/${result.leadId}/historico`);
  const destination = page.getByRole("combobox", { name: "Etapa de destino", exact: true });
  await expect(destination.getByRole("option", { name: "Proposta", exact: true })).toHaveJSProperty("disabled", false);
  await expect(destination.getByRole("option", { name: /^Cliente/ })).toHaveJSProperty("disabled", true);
  await destination.selectOption({ label: "Proposta" });
  await page.getByRole("button", { name: "Alterar etapa", exact: true }).click();
  const proposal = page.locator("#proposta-enviada");
  await expect(proposal).toBeVisible();
  await proposal.getByLabel("Nome da proposta", { exact: true }).fill("Plano de atendimento Politizai");
  await proposal.getByLabel("Valor da proposta (R$)", { exact: true }).fill("3500.50");
  await proposal.getByLabel("Condições de pagamento", { exact: true }).fill("Entrada de 50% e saldo em 30 dias");
  await proposal.getByLabel("Detalhes da proposta", { exact: true }).fill("Gestão de comunicação e atendimento do mandato.");
  await proposal.getByRole("button", { name: "Registrar proposta enviada", exact: true }).click();
  await expect(proposal.getByRole("status")).toContainText("Proposta enviada registrada");
  await page.reload();
  await expect(page.locator("#alterar-etapa")).toContainText("Atual: Proposta");
  await page.locator("summary").filter({ hasText: /^Timeline/ }).click();
  await expect(page.getByText("Proposta enviada: Plano de atendimento Politizai", { exact: true })).toBeVisible();
  await expect(page.getByText(/Valor: R\$\s*3\.500,50/)).toBeVisible();
  await expect(database.activity.count({ where: { workspaceId: workspace.id, leadId: result.leadId, type: "PROPOSAL", result: "SENT" } })).resolves.toBe(1);
  await expect(database.opportunity.count({ where: { workspaceId: workspace.id, leadId: result.leadId } })).resolves.toBe(0);
  await page.screenshot({ path: testInfo.outputPath("proposta-na-ficha.png"), fullPage: true });
});
