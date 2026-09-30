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

test("gestor consulta métricas, estados explícitos e drilldown", async ({ page }) => {
  await login(page, "gestor@demo.politizai.local");
  await page.goto("/metricas-receita?preset=MONTH");
  await expect(page.getByRole("heading", { name: "Métricas de receita", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Movimentação do MRR" })).toBeVisible();
  await page.getByRole("link", { name: /MRR ativo final/ }).click();
  await expect(page.getByRole("heading", { name: "MRR ativo final" })).toBeVisible();
  await page.getByRole("link", { name: "Retenção" }).click();
  await expect(page.getByRole("heading", { name: "Coortes de ativação" })).toBeVisible();
});

test("escopo próprio suprime custo agregado e a página não causa overflow", async ({ page }) => {
  await login(page, "sdr1@demo.politizai.local");
  await page.goto("/metricas-receita?preset=MONTH&section=quality");
  await expect(page.getByText("Dados agregados suprimidos pelo escopo.")).toBeVisible();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});
