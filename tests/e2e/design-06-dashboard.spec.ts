import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: import("@playwright/test").Page, email: string = DEMO_USERS[1].email) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

test("dashboard executivo compara períodos, expõe gráficos e mantém drilldown", async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await login(page);
  await page.goto("/dashboard?preset=MONTH");

  await expect(page.getByRole("heading", { name: "Dashboard comercial" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Contexto comparativo do dashboard" })).toContainText("Período atual");
  await expect(page.getByRole("region", { name: "Contexto comparativo do dashboard" })).toContainText("Comparado com");
  await expect(page.getByRole("heading", { name: "Indicadores acionáveis" })).toBeVisible();
  await expect(page.locator("article[data-interpretation]")).toHaveCount(4);

  const evolution = page.getByRole("heading", { name: "Da entrada à venda" }).locator("xpath=ancestor::section[1]");
  await expect(evolution.getByRole("img", { name: /Gráfico de Leads recebidos/ })).toBeVisible();
  await expect(evolution.getByText(/Atual ·/).first()).toBeVisible();
  await expect(evolution.getByText(/Anterior ·/).first()).toBeVisible();
  await evolution.getByRole("button", { name: "Vendas", exact: true }).click();
  await expect(evolution.getByRole("img", { name: /Gráfico de Vendas/ })).toBeVisible();
  await expect(evolution.getByRole("button", { name: "Vendas", exact: true })).toHaveAttribute("aria-pressed", "true");

  const revenue = page.getByRole("heading", { name: "Resultado ao longo do tempo" }).locator("xpath=ancestor::section[1]");
  await expect(revenue.getByRole("img", { name: /Gráfico de Receita/ })).toBeVisible();
  await revenue.getByText("Ver dados em tabela").click();
  await expect(revenue.getByRole("table")).toBeVisible();

  const chart = evolution.locator(".recharts-wrapper");
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  if (box) await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await expect(evolution.locator(".recharts-tooltip-wrapper")).toBeAttached();

  await expect(page.getByRole("heading", { name: "Funil comercial" })).toBeVisible();
  await expect(page.getByLabel("Desfechos do funil")).toContainText("Ganho");
  await expect(page.getByLabel("Desfechos do funil")).toContainText("Perdido");
  await expect(page.getByLabel("Desfechos do funil")).toContainText("Desqualificado");
  await expect(page.getByRole("heading", { name: "SLA humano" })).toBeVisible();
  await expect(page.getByText("Até 60 segundos", { exact: true })).toBeVisible();
  await expect(page.getByText("Até 180 segundos", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Precisa de atenção" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Automações com erro/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversão por origem" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Performance operacional" })).toBeVisible();

  const revenueCard = page.locator("article").filter({ hasText: "Receita" }).first();
  await revenueCard.getByRole("link", { name: /Receita: abrir registros/ }).click();
  await expect(page).toHaveURL(/view=comparison.current.revenue/);
  await expect(page.getByRole("heading", { name: /Receita · período atual/ })).toBeVisible();
  expect(consoleErrors.filter((message) => /hydration|uncaught|recharts/i.test(message))).toEqual([]);
});

test("dashboard apresenta vazio honesto, escopo próprio e não cria overflow", async ({ page }) => {
  await login(page, DEMO_USERS[2].email);
  await page.goto("/dashboard?preset=CUSTOM&fromDate=2000-01-01&toDate=2000-01-02");
  await expect(page.getByText(/Visão executiva · Meus registros/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nenhum dado no período" })).toBeVisible();
  await expect(page.getByText("Sem eventos nesta série")).toHaveCount(2);
  await expect(page.locator("article[data-interpretation]")).toHaveCount(4);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard?preset=CUSTOM&fromDate=2000-01-01&toDate=2000-01-02");
    await expect(page.getByRole("heading", { name: "Dashboard comercial" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, `overflow em ${viewport.width}x${viewport.height}`).toBe(false);
  }
});
