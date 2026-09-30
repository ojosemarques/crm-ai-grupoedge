import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS, } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

test("administrador opera a fundação WhatsApp somente no simulador local", async ({ page }) => {
  await login(page, DEMO_USERS[0].email);
  await page.goto("/integracoes/whatsapp");
  await expect(page.getByRole("heading", { name: "WhatsApp", level: 1 })).toBeVisible();
  await expect(page.getByText("Ativação externa bloqueada", { exact: true })).toBeVisible();
  await expect(page.getByText("Revisão de política pendente", { exact: true })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText("Desativado", { exact: true })).toBeVisible();
  await page.getByLabel("Telefone").fill("+55 11 97777-4401");
  await page.getByLabel("Mensagem").fill("Mensagem E2E local da CRM-44.");
  await page.getByRole("button", { name: "Registrar entrada local" }).click();
  await expect(page.getByRole("status")).toContainText("Entrada WhatsApp registrada localmente");
  await page.getByRole("link", { name: "Abrir conversas" }).click();
  await expect(page).toHaveURL(/\/inbox\?channels=WHATSAPP/);
  await expect(page.getByRole("article", { name: "Detalhe da conversa" }).getByText("Mensagem E2E local da CRM-44.", { exact: true })).toBeVisible();
});

test("WhatsApp preserva RBAC e não cria overflow em desktop e mobile", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/integracoes/whatsapp");
  await expect(page).toHaveURL(/\/acesso-negado$/);

  await page.context().clearCookies();
  await login(page, DEMO_USERS[0].email);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/integracoes/whatsapp");
    await expect(page.getByRole("heading", { name: "WhatsApp", level: 1 })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`whatsapp-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});
