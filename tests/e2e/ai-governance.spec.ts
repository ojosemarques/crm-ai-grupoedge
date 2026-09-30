import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

test("gestor consulta governança e executa avaliação local sem provider externo", async ({ page }) => {
  await login(page, "gestor@demo.politizai.local");
  await page.goto("/governanca-ia");
  await expect(page.getByRole("heading", { name: "Governança de IA", level: 1 })).toBeVisible();
  await expect(page.getByText("Mock determinístico ativo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registro canônico de casos de uso" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprovar" })).toHaveCount(0);
  await page.getByRole("button", { name: "Avaliar" }).first().click();
  await expect(page.getByText("Governança atualizada e auditada.")).toBeVisible();
});

test("administrador vê controles e a página não cria overflow em mobile", async ({ page }) => {
  await login(page, "admin@demo.politizai.local");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/governanca-ia");
  await expect(page.getByRole("heading", { name: "Governança de IA", level: 1 })).toBeVisible();
  await expect(page.getByText("Local e seguro")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("visualizador não contorna governança por URL direta", async ({ page }) => {
  await login(page, "viewer@demo.politizai.local");
  await page.goto("/governanca-ia");
  await expect(page).toHaveURL(/\/acesso-negado$/);
});
