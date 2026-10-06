import { expect, test, type Page } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

import { enterDemoCompany } from "./helpers/company-hub";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

test("administrador consulta a Prospecção Ativa com os gates externos fechados", async ({ page }, testInfo) => {
  await loginAsAdmin(page);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/email-agente");

    await expect(page.getByRole("heading", { name: "Prospecção Ativa", level: 1 })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Áreas da Prospecção Ativa" });
    await expect(navigation.getByRole("link")).toHaveCount(4);
    await expect(navigation.getByRole("link", { name: "Pipeline", exact: true })).toHaveAttribute("data-active", "true");
    await expect(page.getByRole("region", { name: "Quadro do pipeline" })).toBeVisible();
    for (const removedLabel of ["Visão geral", "E-mails", "Configurações"]) {
      await expect(navigation.getByRole("link", { name: removedLabel, exact: true })).toHaveCount(0);
    }

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.screenshot({
      path: testInfo.outputPath(`active-prospecting-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
});
