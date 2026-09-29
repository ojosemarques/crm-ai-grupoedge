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

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test("gestor opera o inbox local com responsabilidade, SLA e histórico canônico", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumo do inbox" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Detalhe da conversa" })).toBeVisible();
  await expect(page.getByText("Simulação local").first()).toBeVisible();
  await page.getByRole("tab", { name: "Não lidas", exact: true }).click();
  await expect(page).toHaveURL(/view=UNREAD/);
  await page.getByRole("button", { name: "Simular entrada" }).click();
  await page.getByLabel("Telefone").fill("+55 11 99000-0439");
  await page.getByLabel("Mensagem").fill("Entrada E2E local e sem provider externo.");
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await expect(page.getByText("Contato não identificado").first()).toBeVisible();
  await expect(page.getByText(/Fila Geral/).first()).toBeVisible();
});

test("inbox preserva RBAC e não cria overflow nos viewports principais", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simular entrada" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Avaliar e enfileirar" })).toHaveCount(0);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Resumo do inbox" })).toBeVisible();
    await expectNoPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`inbox-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});
