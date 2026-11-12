import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { getDatabaseClient } from "@/shared/core/database/client";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await enterDemoCompany(page);
}

test.afterAll(async () => getDatabaseClient().$disconnect());

for (const surface of ["agenda", "tarefa"] as const) {
  test(`vendedor registra qualificação, resumo e destino pela ${surface}`, async ({ page }, testInfo) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { get: () => false }));
    if (!new URL(process.env.DATABASE_URL!).searchParams.get("schema")?.startsWith("politizai_test_")) throw new Error("Ephemeral schema required");
    const db = getDatabaseClient();
    const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
    const actor = await db.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "system" } });
    const seller = await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, role: { key: "closer" }, status: "ACTIVE" }, include: { user: true } });
    await ensureAdvertisingPipeline(db, workspace.id, actor.id);
    const pipeline = await db.pipeline.findFirstOrThrow({ where: { workspaceId: workspace.id, name: "Anúncios" }, include: { stages: true } });
    const title = `Resultado ${surface} ${randomUUID().slice(0, 8)}`;
    const result = await createLeadIntakeService({ database: db, authorization: createAuthorizationService({ database: db }), now: () => new Date() }).intake({
      channel: "MANUAL", idempotencyKey: randomUUID(), fullName: title,
      phone: `+55119${String(parseInt(randomUUID().slice(0, 8), 16) % 100_000_000).padStart(8, "0")}`,
      sourceKey: "manual", pipelineId: pipeline.id, initialStageId: pipeline.stages.find((stage) => stage.leadStageCode === "NEW")!.id,
      priorityBandCode: "P3", rawPayload: { test: "meeting-outcome" },
    }, { workspaceId: workspace.id, actorId: actor.id, actorKey: "system", actorType: "SYSTEM" });
    if (result.outcome === "REJECTED") throw new Error(result.code);
    await login(page, DEMO_USERS[1].email);
    const booked = await browserRequest(page).post("/api/meetings", { data: { leadId: result.leadId, closerId: seller.id, title, startsAtLocal: "2020-02-09T09:30", durationMinutes: 30 } });
    expect(booked.status(), JSON.stringify(await booked.json())).toBe(201);
    const meeting = await db.meeting.findFirstOrThrow({ where: { workspaceId: workspace.id, leadId: result.leadId } });
    await login(page, seller.user.email);
    const boardUrl = `/anuncios?q=${encodeURIComponent(title)}`;
    if (surface === "agenda") {
      await page.goto(`/agenda?view=day&date=2020-02-09&meetingId=${meeting.id}`);
      await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
    } else {
      await page.goto(boardUrl);
      await page.getByRole("region", { name: "Etapa Reunião marcada", exact: true }).locator("article").filter({ hasText: title }).click();
      const task = page.getByRole("dialog", { name: "Ficha completa do lead" }).locator("li").filter({ has: page.getByText(`Reunião: ${title}`, { exact: true }) });
      await task.locator("summary").click();
      await expect(task.getByRole("button", { name: "Concluir tarefa", exact: true })).toHaveCount(0);
      await task.getByRole("button", { name: "Registrar resultado da reunião", exact: true }).click();
    }
    await page.getByRole("button", { name: "Compareceu", exact: true }).click();
    const qualification = page.getByRole("combobox", { name: "Qualificação", exact: true });
    await expect(qualification).toHaveAttribute("required", "");
    await expect(qualification.locator("option")).toHaveText(["Selecione a qualificação", "Tier A · Bom", "Tier B · Médio", "Tier C · Ruim"]);
    const tier = surface === "agenda" ? "TIER_A" : "TIER_C";
    const tierLabel = surface === "agenda" ? "Tier A · Bom" : "Tier C · Ruim";
    const summary = "Diagnóstico realizado. Cliente quer avaliar a proposta comercial.";
    await qualification.selectOption(tier);
    await page.getByLabel("Resumo da reunião", { exact: true }).fill(summary);
    const destination = page.getByRole("combobox", { name: "Para onde mover o lead?", exact: true });
    await expect(destination).toHaveAttribute("required", "");
    await destination.selectOption(surface === "agenda" ? "PROPOSAL" : "MEETING_COMPLETED");
    await page.getByLabel("Próxima ação", { exact: true }).fill("Retomar conversa com o cliente");
    await page.getByLabel("Prazo da próxima ação", { exact: true }).fill("2040-02-10T10:00");
    await page.screenshot({ path: testInfo.outputPath(`resultado-${surface}.png`), fullPage: true });
    await page.getByRole("button", { name: "Confirmar ação", exact: true }).click();
    await expect.poll(() => db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).toMatchObject({
      status: "COMPLETED",
      qualification: tier,
      outcome: summary,
    });
    if (surface === "agenda") {
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog.getByText(tierLabel, { exact: true })).toBeVisible();
      await page.reload();
      await expect(dialog.getByText(tierLabel, { exact: true })).toBeVisible();
    } else {
      const sheet = page.getByRole("dialog", { name: "Ficha completa do lead" });
      await expect(sheet.getByText(tierLabel, { exact: true })).toBeVisible();
      await sheet.getByRole("tab", { name: "Atividades", exact: true }).click();
      const task = sheet.locator("li").filter({ has: page.getByText(`Reunião: ${title}`, { exact: true }) });
      await expect(task.getByText(tierLabel, { exact: true })).toBeVisible();
    }
    expect(await db.lead.findUniqueOrThrow({ where: { id: result.leadId }, include: { currentStage: true } })).toMatchObject({ currentStage: { leadStageCode: surface === "agenda" ? "PROPOSAL" : "MEETING_COMPLETED" } });
    expect(await db.task.findFirstOrThrow({ where: { meetingId: meeting.id, kind: "MEETING" } })).toMatchObject({ status: "COMPLETED", result: summary });
    if (surface === "agenda") {
      await page.goto(boardUrl);
    } else {
      await page.getByRole("button", { name: "Fechar ficha e voltar ao pipeline", exact: true }).click();
    }
    const stage = surface === "agenda" ? "Proposta" : "Reunião feita";
    await expect(page.getByRole("region", { name: `Etapa ${stage}`, exact: true }).locator("article").filter({ hasText: title })).toBeVisible();
    await expect(page.getByRole("region", { name: "Etapa Reunião marcada", exact: true }).locator("article").filter({ hasText: title })).toHaveCount(0);
  });
}
