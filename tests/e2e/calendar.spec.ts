import { enterDemoCompany } from "./helpers/company-hub";
import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { PrismaClient } from "@/generated/prisma/client";
import { signLocalCalendarCallback } from "@/modules/integrations/domain/calendar-contracts";
import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

test("administrador consulta e enfileira calendário somente no sandbox local", async ({ page }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL é obrigatória no E2E de calendário.");
  const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString) });
  const meeting = await database.meeting.findFirstOrThrow({ where: { deletedAt: null }, orderBy: [{ startsAt: "asc" }, { id: "asc" }] });
  await database.$disconnect();
  const meetingDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(meeting.startsAt);
  await login(page, DEMO_USERS[0].email);
  await page.goto(`/agenda?view=day&date=${meetingDate}`);
  const calendarLink = page.getByRole("link", { name: "Calendário" }).first();
  await expect(calendarLink).toBeVisible();
  await calendarLink.click();

  await expect(page.getByRole("heading", { name: "Calendário", level: 1 })).toBeVisible();
  await expect(page.getByText("Sandbox local ativo", { exact: true })).toBeVisible();
  await expect(page.getByText("Egress externo").locator("xpath=following-sibling::*")).toHaveText("Bloqueado");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByLabel("ID da reunião")).not.toHaveValue("");
  await page.getByRole("button", { name: "Sincronizar localmente" }).click();
  await expect(page.getByRole("status")).toContainText("Nenhum calendário externo foi acionado");
});

test("visualizador mantém calendário somente leitura e a página não cria overflow", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/integracoes/calendario");
  await expect(page.getByRole("heading", { name: "Calendário", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sincronizar localmente" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Pausar sandbox|Retomar sandbox/ })).toHaveCount(0);

  await page.context().clearCookies();
  await login(page, DEMO_USERS[0].email);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/integracoes/calendario");
    await expect(page.getByRole("heading", { name: "Calendário", level: 1 })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`calendar-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});

test("@local-only callback assinado é aceito uma vez sem egress externo", async ({ request }) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL é obrigatória no E2E de calendário.");
  const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString) });
  try {
    const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE_SLUG } });
    const lead = await database.lead.findFirstOrThrow({ where: { workspaceId: workspace.id, deletedAt: null, currentStage: { leadStageCode: "QUALIFIED" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const closer = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, status: "ACTIVE", deletedAt: null, teamMemberships: { some: { function: "CLOSER", deletedAt: null } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const eventId = `crm47:e2e:${randomUUID()}`;
    const body = Buffer.from(JSON.stringify({
      eventId,
      nonce: `crm47:nonce:${randomUUID()}`,
      operation: "CREATE",
      externalEventId: `crm47:external:${randomUUID()}`,
      externalVersion: 1,
      occurredAt: new Date().toISOString(),
      leadId: lead.id,
      closerId: closer.id,
      title: "Reunião recebida pelo calendário local",
      startsAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      endsAt: new Date(Date.now() + 10 * 24 * 60 * 60_000 + 30 * 60_000).toISOString(),
      timeZone: "America/Sao_Paulo",
      origin: "LOCAL_SANDBOX",
      externalEgress: false,
    }));
    const timestamp = String(Date.now());
    const headers = {
      "content-type": "application/json",
      "x-politizai-workspace-id": workspace.id,
      "x-politizai-calendar-timestamp": timestamp,
      "x-politizai-calendar-signature": signLocalCalendarCallback(workspace.id, timestamp, body),
    };
    const first = await request.post("/api/local/calendar/callback", { headers, data: body });
    expect(first.status()).toBe(202);
    await expect(first.json()).resolves.toMatchObject({ result: { status: "ACCEPTED", externalEgress: false } });
    const duplicate = await request.post("/api/local/calendar/callback", { headers, data: body });
    expect(duplicate.status()).toBe(202);
    await expect(duplicate.json()).resolves.toMatchObject({ result: { status: "DUPLICATE", externalEgress: false } });
  } finally {
    await database.$disconnect();
  }
});
