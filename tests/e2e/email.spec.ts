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

test("administrador opera o canal de e-mail somente no sink local", async ({ page }) => {
  await login(page, DEMO_USERS[0].email);
  await page.goto("/integracoes/email");
  await expect(page.getByRole("heading", { name: "E-mail", level: 1 })).toBeVisible();
  await expect(page.getByText("Canal local, ativação externa adiada", { exact: true })).toBeVisible();
  await expect(page.getByText("Desativado", { exact: true })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByLabel("Remetente fictício").fill("e2e.crm45@example.invalid");
  await page.getByLabel("Assunto").fill("Entrada E2E CRM-45");
  await page.getByLabel("Texto simples").fill("Mensagem recebida exclusivamente no sink local.");
  await page.getByRole("button", { name: "Receber no sink local" }).click();
  await expect(page.getByRole("status")).toContainText("E-mail recebido no sink local");
  await page.getByRole("link", { name: "Abrir e-mails" }).click();
  await expect(page).toHaveURL(/\/inbox\?channels=EMAIL/);
  await page.getByRole("button").filter({ hasText: "Mensagem recebida exclusivamente no sink local." }).click();
  await expect(page.getByRole("article", { name: "Detalhe da conversa" }).getByText("Mensagem recebida exclusivamente no sink local.", { exact: true })).toBeVisible();
});

test("e-mail preserva RBAC e não cria overflow em desktop ou mobile", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/integracoes/email");
  await expect(page).toHaveURL(/\/acesso-negado$/);
  await page.context().clearCookies();
  await login(page, DEMO_USERS[0].email);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/integracoes/email");
    await expect(page.getByRole("heading", { name: "E-mail", level: 1 })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`email-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});
