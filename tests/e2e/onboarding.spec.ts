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

test("administrador acessa handoff e onboarding sem inferir ativação", async ({ page }) => {
  await login(page, DEMO_USERS[0]!.email);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Handoff e onboarding", level: 1 })).toBeVisible();
  await expect(page.getByText("Ganho, envio e aceite são fatos diferentes")).toBeVisible();
  await expect(page.getByText(/Nenhum handoff registrado|Passagem comercial/).first()).toBeVisible();
});

test("onboarding respeita leitura do visualizador e não cria overflow", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Handoff e onboarding", level: 1 })).toBeVisible();
    await expect(page.getByText("Criar handoff comercial")).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({
      path: testInfo.outputPath(`onboarding-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
});
