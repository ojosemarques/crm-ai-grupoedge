import { expect, test, type Page } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function expectNoHorizontalOverflow(page: Page, route: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `overflow horizontal em ${route}`).toBeLessThanOrEqual(dimensions.clientWidth);
}

test("expõe a cadeia operacional de entrega, CS e Farmer", async ({ page }) => {
  await login(page);

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Handoff e onboarding", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicadores de onboarding" })).toBeVisible();
  await expect(page.getByText("Passagens comerciais", { exact: true })).toBeVisible();
  await expect(page.getByText("Onboardings ativos", { exact: false })).toBeVisible();

  await page.goto("/customer-success");
  await expect(page.getByRole("heading", { name: "Customer Success", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicadores da carteira" })).toBeVisible();
  await expect(page.getByText("Saúde do cliente", { exact: true }).first()).toBeVisible();

  await page.goto("/farmer");
  await expect(page.getByRole("heading", { name: "Farmer", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicadores Farmer" })).toBeVisible();
  await expect(page.getByText("Taxa de renovação", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ver histórico" }).first().click();
  await expect(page.getByText("Histórico e evidências", { exact: true })).toBeVisible();
});

test("mantém as três jornadas pós-venda utilizáveis em viewport móvel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  for (const [route, heading] of [
    ["/onboarding", "Handoff e onboarding"],
    ["/customer-success", "Customer Success"],
    ["/farmer", "Farmer"],
  ] as const) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/\/(login|acesso-negado)/);
    await expectNoHorizontalOverflow(page, route);
  }
});

test("protege as APIs pós-venda sem sessão", async ({ request }) => {
  for (const route of ["/api/onboarding", "/api/customer-success", "/api/farmer"]) {
    const response = await request.get(route);
    const body = await response.json();
    expect(response.status(), route).toBe(401);
    expect(body.error).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  }
});
