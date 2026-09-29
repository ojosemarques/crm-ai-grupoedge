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

test("Farmer mostra métricas, fila priorizada e evidências persistidas", async ({ page }) => {
  await login(page, DEMO_USERS[0]!.email);
  await page.goto("/farmer");
  await expect(page.getByRole("heading", { name: "Farmer", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicadores Farmer" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Filtros Farmer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver histórico" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Ver histórico" }).first().click();
  await expect(page.getByText(/Timeline \(\d+\)/)).toBeVisible();
});

test("visualizador não recebe mutações e Farmer não transborda em desktop ou mobile", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/farmer");
    await expect(page.getByRole("heading", { name: "Farmer", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar renovação" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirmar churn" })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`farmer-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});
