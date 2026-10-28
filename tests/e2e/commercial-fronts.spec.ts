import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

test("três visões, modo fixo, filtros e histórico operacional", async ({ page }) => {
  await login(page);
  for (const [path, title] of [["/dashboard", "Visão Geral"], ["/dashboard/anuncios", "Visão Geral — Anúncios"], ["/dashboard/prospeccao", "Visão Geral — Prospecção Ativa"]] as const) {
    await page.goto(`${path}?preset=CUSTOM&fromDate=2000-01-01&toDate=2000-01-02`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Visões dos indicadores" }).getByRole("link")).toHaveCount(3);
  }
  await page.goto("/dashboard/anuncios?mode=PROSPECTING&preset=LAST_7_DAYS");
  await expect(page.getByRole("heading", { name: "Visão Geral — Anúncios", exact: true })).toBeVisible();
  const cards = page.getByRole("region", { name: "Contribuição das frentes comerciais" });
  await cards.getByRole("link", { name: /Entradas comerciais/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/evidencias\?.*mode=ADVERTISING/);
  await expect(page.getByRole("heading", { name: "Entradas comerciais", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Voltar ao mesmo recorte" }).click();
  await expect(page).toHaveURL(/\/dashboard\/anuncios\?/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.goto("/anuncios?view=activities");
  await expect(page.getByRole("heading", { name: "Histórico de eventos", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atividades de Anúncios", exact: true })).toBeVisible();
  await page.goto("/email-agente?view=activities");
  await expect(page.getByRole("heading", { name: "Histórico de eventos", exact: true })).toBeVisible();
});

test("outra sessão atualiza Anúncios automaticamente e replay não cria nova entrada", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/anuncios?view=stock");
  const second = await browser.newPage();
  try {
    await login(second);
    const options = await browserRequest(second).get("/api/leads/entry-options");
    expect(options.ok()).toBe(true);
    const payload = await options.json() as { options: { pipelines: { id: string; name: string }[] } };
    const pipelineId = payload.options.pipelines.find((pipeline) => pipeline.name === "Anúncios")?.id;
    expect(pipelineId).toBeTruthy();
    await page.goto("/dashboard/anuncios?preset=TODAY");
    await page.bringToFront();
    const entries = page.getByRole("region", { name: "Contribuição das frentes comerciais" }).getByRole("link", { name: /Entradas comerciais/ });
    const before = Number((await entries.locator("strong").innerText()).replace(/\D/g, ""));
    const input = { idempotencyKey: `fronts-e2e:${randomUUID()}`, pipelineId, lead: { fullName: "Contato sintético de atualização", phone: `+55119${Date.now().toString().slice(-8)}`, sourceKey: "manual", priorityBandCode: "P1" } };
    const response = await browserRequest(second).post("/api/leads/manual", { data: input });
    expect(response.ok()).toBe(true);
    await expect(entries.locator("strong")).toHaveText((before + 1).toLocaleString("pt-BR"), { timeout: 25_000 });
    const replay = await browserRequest(second).post("/api/leads/manual", { data: input });
    expect(replay.ok()).toBe(true);
    const replayPayload = await replay.json() as { result: { idempotentReplay: boolean } };
    expect(replayPayload.result.idempotentReplay).toBe(true);
    await expect(page).toHaveURL(/\/dashboard\/anuncios\?preset=TODAY/);
    await entries.click();
    await expect(page.getByRole("heading", { name: "Entradas comerciais", exact: true })).toBeVisible();
    await expect(page.getByText("Histórico do lead", { exact: true }).first()).toBeVisible();
  } finally { await second.close(); }
});
