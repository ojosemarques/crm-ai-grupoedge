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

test("smoke de aceite percorre os fluxos centrais com dados persistidos", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  for (const route of ["/", "/dashboard", "/meu-dia", "/leads", "/pipeline", "/agenda", "/oportunidades", "/operacoes?tab=resilience"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/(login|acesso-negado)/);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toBeVisible();
  }
  const readiness = await page.request.get("/api/ready");
  expect(readiness.status()).toBe(200);
  await expect(readiness.json()).resolves.toMatchObject({ ready: true, service: "politizai-crm" });
});

test("RBAC impede acesso direto do visualizador à console operacional", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/operacoes");
  await expect(page).toHaveURL(/\/acesso-negado/);
});

test("fluxos prioritários não criam overflow no viewport móvel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO_USERS[0].email);
  for (const route of ["/", "/dashboard", "/meu-dia", "/leads"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status", { name: /Carregando/ })).toHaveCount(0);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, route).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});
