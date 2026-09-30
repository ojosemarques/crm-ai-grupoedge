import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

test("as superfícies das quatro jornadas permanecem acessíveis em sequência", async ({ page }) => {
  await login(page);
  const routes = [
    ["/leads", "Leads"], ["/pipeline", "Pré-vendas"], ["/contratos", "Contratos comerciais"],
    ["/onboarding", "Handoff e onboarding"], ["/farmer", "Farmer"], ["/campanhas", "Campanhas de envio"],
    ["/inbox", "Atendimento"], ["/agentes", "Construtor de agentes"], ["/pagamentos", "Cobranças e pagamentos"],
  ] as const;
  for (const [route, heading] of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/\/(login|acesso-negado)/);
  }
});

test("jornadas críticas não criam overflow na web móvel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const route of ["/onboarding", "/farmer", "/campanhas", "/inbox", "/agentes", "/pagamentos"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth, route).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});
