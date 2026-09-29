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

test("gestor cria contrato local e vê o histórico operacional", async ({ page }) => {
  await login(page, DEMO_USERS[1]!.email);
  await page.goto("/contratos");
  await expect(page.getByRole("heading", { name: "Contratos comerciais", level: 1 })).toBeVisible();
  const creation = page.getByText("Novo contrato a partir de oportunidade elegível");
  await creation.click();
  const opportunity = page.getByLabel("Oportunidade");
  if (await opportunity.locator("option").count() > 1) {
    await opportunity.selectOption({ index: 1 });
    await page.getByLabel("Template").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Criar rascunho" }).click();
    await expect(page.getByRole("status")).toContainText("snapshot da oportunidade");
    await expect(page.getByText(/CTR-\d{4}-\d{6}/).first()).toBeVisible();
  } else {
    await expect(page.getByText("Nenhuma oportunidade com conta, contato e oferta")).toBeVisible();
  }
});

test("contratos respeita leitura do visualizador e não cria overflow", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/contratos");
    await expect(page.getByRole("heading", { name: "Contratos comerciais", level: 1 })).toBeVisible();
    await expect(page.getByText("Novo contrato a partir de oportunidade elegível")).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`contracts-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});
