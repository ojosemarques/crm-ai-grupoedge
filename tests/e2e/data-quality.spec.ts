import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("administrador executa diagnóstico e varredura determinística", async ({ page }) => {
  await login(page, DEMO_USERS[0].email);
  await page.goto("/qualidade-dados");
  await expect(page.getByRole("heading", { name: "Qualidade de dados", level: 1 })).toBeVisible();
  await expect(page.getByText(/sem IA decisora ou correção silenciosa/i)).toBeVisible();
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await expect(page.getByRole("status")).toContainText(/sem criar ocorrências/i);
  await page.getByRole("button", { name: "Executar varredura" }).click();
  await expect(page.getByRole("status")).toContainText(/evidências foram persistidas/i);
  await expect(page.getByRole("heading", { name: "Fila de ocorrências" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Possíveis duplicidades" })).toBeVisible();
});

test("visualizador consulta evidências sem controles de mutação", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/qualidade-dados");
  await expect(page.getByRole("heading", { name: "Qualidade de dados", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Executar varredura" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aplicar merge" })).toHaveCount(0);
});

test("qualidade permanece acessível e sem overflow no mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO_USERS[0].email);
  await page.goto("/qualidade-dados");
  await expect(page.getByRole("heading", { name: "Qualidade de dados", level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
});
