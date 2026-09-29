import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("administrador cria e abre uma conta canônica", async ({ page }) => {
  await login(page, "admin@demo.politizai.local");
  await page.goto("/contas");
  await expect(page.getByRole("heading", { name: "Contas", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Nova conta" }).click();
  const name = `Conta E2E ${Date.now()}`;
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByLabel("Domínio").fill(`e2e-${Date.now()}.local`);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("status")).toContainText("Conta criada com auditoria");
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("row").filter({ hasText: name }).getByRole("link", { name: "Abrir 360" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jornada de receita" })).toBeVisible();
  await expect(page.getByText("Nenhum responsável funcional vigente.")).toBeVisible();
});

test("visualizador consulta contas, mas não vê criação", async ({ page }) => {
  await login(page, "viewer@demo.politizai.local");
  await page.goto("/contas");
  await expect(page.getByRole("heading", { name: "Contas", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova conta" })).toHaveCount(0);
});
