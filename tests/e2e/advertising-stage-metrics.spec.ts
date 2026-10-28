import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { getDatabaseClient } from "@/shared/core/database/client";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";

test.afterAll(() => getDatabaseClient().$disconnect());
test("movimentações no pipeline atualizam a Agenda e o Tempo Real de Anúncios sem recarregar a TV", async ({ page, context }) => {
  test.setTimeout(120_000);
  if (!new URL(process.env.DATABASE_URL!).searchParams.get("schema")?.startsWith("politizai_test_")) throw new Error("Ephemeral schema required");
  const db = getDatabaseClient();
  const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const system = await db.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "system" } });
  await ensureAdvertisingPipeline(db, workspace.id, system.id);
  const pipeline = await db.pipeline.findFirstOrThrow({ where: { workspaceId: workspace.id, name: "Anúncios" }, include: { stages: true } });
  const seller = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, role: { key: "closer" }, status: "ACTIVE" } });
  const title = `Fluxo de métricas ${randomUUID().slice(0, 8)}`;
  const intake = await createLeadIntakeService({ database: db, authorization: createAuthorizationService({ database: db }), now: () => new Date() }).intake({
    channel: "MANUAL", idempotencyKey: randomUUID(), fullName: title, phone: `+55119${String(parseInt(randomUUID().slice(0, 8), 16) % 100000000).padStart(8, "0")}`,
    sourceKey: "manual", pipelineId: pipeline.id, priorityBandCode: "P3", rawPayload: { test: "stage-metrics" },
  }, { workspaceId: workspace.id, actorId: system.id, actorKey: "system", actorType: "SYSTEM" });
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await enterDemoCompany(page);
  const saved = await browserRequest(page).post("/api/meetings", { data: { leadId: intake.leadId, closerId: seller.id, title, startsAtLocal: "2020-02-09T09:30", durationMinutes: 30 } });
  expect(saved.status()).toBe(201);
  const meeting = await db.meeting.findFirstOrThrow({ where: { leadId: intake.leadId } });
  const tv = await context.newPage();
  try {
    await tv.goto("/tempo-real");
    await tv.getByRole("button", { name: "Pausar apresentação", exact: true }).click();
    await tv.getByRole("button", { name: "Anúncios", exact: true }).click();
    const count = tv.getByRole("article", { name: "Reuniões feitas", exact: true }).locator(":scope > strong");
    const before = Number(await count.innerText());
    for (const [code, delta] of [["MEETING_NO_SHOW", 0], ["MEETING_COMPLETED", 1], ["PROPOSAL", 1], ["MEETING_COMPLETED", 1]] as const) {
      await page.goto(`/anuncios?q=${encodeURIComponent(title)}`);
      await page.getByRole("button", { name: `Alterar etapa de ${title}`, exact: true }).click();
      await page.getByRole("combobox", { name: "Etapa de destino", exact: true }).selectOption(pipeline.stages.find(stage => stage.leadStageCode === code)!.id);
      await page.getByRole("button", { name: "Confirmar transição", exact: true }).click();
      await expect(page.getByText(`${title} foi movido para`, { exact: false })).toBeVisible();
      await tv.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(count).toHaveText(String(before + delta));
    }
    expect(await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).toMatchObject({ status: "COMPLETED", revision: 3 });
    const held = await db.commercialMetricFact.aggregate({ where: { leadId: intake.leadId, eventType: "MEETING_COMPLETED" }, _sum: { quantity: true } });
    expect(held._sum.quantity).toBe(1);
  } finally { await tv.close(); }
});
