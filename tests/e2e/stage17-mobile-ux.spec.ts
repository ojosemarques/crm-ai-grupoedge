import { expect, test, type Page } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function expectNoPageOverflow(page: Page, route: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `overflow horizontal em ${route}`).toBeLessThanOrEqual(dimensions.clientWidth);
}

test("jornadas críticas permanecem operáveis na web móvel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const dock = page.getByRole("navigation", { name: "Atalhos operacionais" });
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("link", { name: "Meu dia" })).toBeVisible();
  await expect(dock.getByRole("link", { name: "Funil" })).toBeVisible();
  await expect(dock.getByRole("link", { name: "Inbox" })).toBeVisible();
  await expect(dock.getByRole("link", { name: "Atividades" })).toBeVisible();
  await expect(dock.getByRole("link", { name: "Painel" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notificações" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Buscar/ })).toBeVisible();

  for (const route of ["/meu-dia", "/pipeline", "/inbox", "/atividades", "/agentes", "/dashboard"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/(login|acesso-negado)/);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toBeVisible();
    await expectNoPageOverflow(page, route);
  }
});

test("360 abre ligação governada e agendamento com lead selecionado", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/contas");
  await page
    .getByRole("row")
    .filter({ hasText: "Gestão Pública do Vale" })
    .getByRole("link", { name: "Ver conta →" })
    .click();

  const call = page.getByRole("link", { name: /Ligar para contato de .* com histórico/ });
  const schedule = page.getByRole("link", { name: /Agendar reunião com/ });
  await expect(call).toBeVisible();
  await expect(schedule).toBeVisible();

  await schedule.click();
  await expect(page).toHaveURL(/\/agenda\?leadId=/);
  await expect(page.getByRole("dialog", { name: "Agendar reunião" })).toBeVisible();
  await expect(page.getByLabel("Lead qualificado")).not.toHaveValue("");
});
