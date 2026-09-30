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

async function expectOperationalPage(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/(login|acesso-negado)$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, route).toBeLessThanOrEqual(dimensions.clientWidth);
}

test("administrador percorre a superfície operacional completa", async ({ page }) => {
  await login(page, DEMO_USERS[0]!.email);
  for (const route of [
    "/dashboard",
    "/meu-dia",
    "/leads",
    "/pipeline",
    "/agenda",
    "/oportunidades",
    "/contratos",
    "/onboarding",
    "/customer-success",
    "/customer-service",
    "/farmer",
    "/metas",
    "/forecast",
    "/operacoes?tab=observability",
    "/auditoria",
  ]) {
    await expectOperationalPage(page, route);
  }
});

test("SDR e closer mantêm escopo por URL", async ({ page }) => {
  await login(page, DEMO_USERS.find(({ roleKey }) => roleKey === "sdr")!.email);
  await expectOperationalPage(page, "/meu-dia");
  await expectOperationalPage(page, "/leads");
  await page.goto("/administracao");
  await expect(page).toHaveURL(/\/acesso-negado$/);

  await page.context().clearCookies();
  await login(page, DEMO_USERS.find(({ roleKey }) => roleKey === "closer")!.email);
  await expectOperationalPage(page, "/agenda");
  await expectOperationalPage(page, "/oportunidades");
  await expectOperationalPage(page, "/forecast");
});

test("sessão, teclado, nomes acessíveis e mobile permanecem operáveis", async ({ page }) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/operacoes");
  await expect(page).toHaveURL(/\/acesso-negado$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectOperationalPage(page, "/dashboard");
  const unnamedControls = await page.locator("button:visible, input:visible, select:visible, textarea:visible, a[href]:visible").evaluateAll((nodes) =>
    nodes.filter((node) => {
      const element = node as HTMLElement;
      if (element.getAttribute("aria-hidden") === "true") return false;
      const text = element.innerText?.trim();
      const label =
        element.getAttribute("aria-label") ??
        element.getAttribute("aria-labelledby") ??
        element.getAttribute("title") ??
        element.querySelector("img[alt]")?.getAttribute("alt");
      if (text || label) return false;
      if (element instanceof HTMLInputElement && element.labels?.length) return false;
      if (element instanceof HTMLSelectElement && element.labels?.length) return false;
      if (element instanceof HTMLTextAreaElement && element.labels?.length) return false;
      return true;
    }).length,
  );
  expect(unnamedControls).toBe(0);

  const logout = await page.request.post("/api/auth/logout", {
    headers: { Origin: "http://127.0.0.1:3102" },
  });
  expect(logout.status()).toBe(200);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
