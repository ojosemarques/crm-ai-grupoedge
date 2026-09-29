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

test("administrador consulta metas e cria rascunho no editor guiado", async ({ page }) => {
  await login(page, DEMO_USERS[0]!.email);
  await page.goto("/metas");
  await expect(page.getByRole("heading", { name: "Metas e quotas", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atingimento", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Nova meta" }).click();
  await expect(page.getByRole("heading", { name: "Novo plano em rascunho" })).toBeVisible();
  await page.getByLabel("Chave estável").fill("meta-e2e");
  await page.getByLabel("Nome").fill("Meta E2E");
  await page.getByLabel("Início").fill("2026-09-01");
  await page.getByLabel("Fim").fill("2026-09-30");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Rascunho criado. Revise antes de publicar.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meta E2E · v1" })).toBeVisible();
});

test("visualizador lê metas sem mutação e sem overflow em desktop e mobile", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto("/metas");
    await expect(page.getByRole("heading", { name: "Metas e quotas", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nova meta" })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`goals-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});
