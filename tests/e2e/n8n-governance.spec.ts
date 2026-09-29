import { expect, test, type Page } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("administrador cria identidade efêmera e encontra o catálogo governado", async ({ page }) => {
  await login(page, DEMO_USERS[0].email);
  await page.goto("/integracoes/n8n");

  await expect(page.getByRole("heading", { name: "Extensibilidade n8n", level: 1 })).toBeVisible();
  await expect(page.getByText("Sandbox local — n8n não conectado", { exact: true })).toBeVisible();
  await expect(page.getByText(/não há n8n instalado, URL pública, credencial real, egress ou acesso ao banco/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Catálogo curto de receitas" })).toBeVisible();
  await expect(page.getByText("Lead atribuído", { exact: true })).toBeVisible();
  await expect(page.getByText("Exige confirmação humana", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Criar identidade local" }).click();
  await expect(page.getByRole("heading", { name: "Credencial exibida uma única vez" })).toBeVisible();
  await expect(page.locator("code")).toContainText(/^n8n_local_/);
  await expect(page.getByRole("status")).toContainText(/operação local concluída e auditada/i);
});

test("gestor consulta e revisa, mas não recebe controles administrativos", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/integracoes/n8n");

  await expect(page.getByText("Sandbox local — n8n não conectado", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Criar identidade local" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Propostas aguardando decisão" })).toBeVisible();
});

test("visualizador é negado por URL e a página administrativa não vaza", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/integracoes/n8n");
  await expect(page).toHaveURL(/\/acesso-negado$/);
  await expect(page.getByText("Sandbox local — n8n não conectado", { exact: true })).toHaveCount(0);
});

test("sandbox mantém a página sem overflow horizontal em viewport móvel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO_USERS[0].email);
  await page.goto("/integracoes/n8n");
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
});
