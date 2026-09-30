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

test("gestor consulta composição, comparação e publica corte reproduzível", async ({ page }) => {
  await login(page, "gestor@demo.politizai.local");
  await page.goto("/forecast");
  await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evolução entre cortes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "O que mudou" })).toBeVisible();
  await expect(page.getByText(/Cobertura (completa|parcial)/, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publicar corte" }).click();
  await expect(page.getByText("Novo corte imutável publicado.")).toBeVisible();
});

test("visualizador lê o forecast sem mutações e sem overflow em desktop e mobile", async ({ page }, testInfo) => {
  await login(page, "viewer@demo.politizai.local");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/forecast");
    await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar corte" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enviar forecast" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Composição e revisão" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`forecast-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});

test("closer vê apenas a própria composição e registra leitura humana", async ({ page }) => {
  await login(page, "closer1@demo.politizai.local");
  await page.goto("/forecast");
  await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Minha submissão" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publicar corte" })).toHaveCount(0);
  const options = page.locator('fieldset input[type="checkbox"]');
  await expect(options.first()).toBeVisible();
  await options.first().check();
  await page.getByLabel("Valor declarado em centavos").fill("350000");
  await page.getByLabel("Motivo da correção, se já houver revisão").fill("Revisão E2E da leitura individual.");
  await page.getByRole("button", { name: "Enviar forecast" }).click();
  await expect(page.getByText("Leitura registrada como nova revisão, sem alterar oportunidades.")).toBeVisible();
});
