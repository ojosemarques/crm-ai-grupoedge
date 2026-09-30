import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test, type Page } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

test("administrador enfileira telefonia somente no simulador local", async ({ page }) => {
  await login(page, DEMO_USERS[0].email);
  await page.goto("/leads");
  await page.getByRole("link", { name: /Abrir cartão do lead/ }).first().click();
  await page.getByRole("link", { name: "Abrir telefonia local" }).click();

  await expect(page.getByRole("heading", { name: "Telefonia", level: 1 })).toBeVisible();
  await expect(page.getByText("Sandbox determinístico, sem PSTN", { exact: true })).toBeVisible();
  await expect(page.getByText("Egress externo").locator("xpath=following-sibling::*")).toHaveText("Bloqueado");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByLabel("ID do lead")).not.toHaveValue("");

  await page.getByLabel("Cenário determinístico").selectOption("BUSY");
  await page.getByRole("button", { name: "Simular ligação" }).click();
  await expect(page.getByRole("status")).toContainText("Nenhum provider externo foi acionado");
  await expect(page.getByRole("table")).toContainText("Na fila");
});

test("telefonia mantém mutação indisponível ao visualizador e não cria overflow", async ({ page }, testInfo) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/integracoes/telefonia");
  await expect(page.getByRole("button", { name: "Simular ligação" })).toBeDisabled();

  await page.context().clearCookies();
  await login(page, DEMO_USERS[0].email);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/integracoes/telefonia");
    await expect(page.getByRole("heading", { name: "Telefonia", level: 1 })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`telephony-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
});
