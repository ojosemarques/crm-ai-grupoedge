import { expect, test, type Page } from "@playwright/test";

import { enterDemoCompany } from "./helpers/company-hub";
import { browserRequest } from "./support/browser-request";
import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

async function loginAsManager(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[1]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

test("gestor opera placar privado e bearer público revogável", async ({ context, page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsManager(page);
  await page.goto("/tempo-real");
  await expect(page.getByRole("heading", { name: "TEMPO REAL" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Slide 1 de 2" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("tempo-real-geral-1920x1080.png"), fullPage: true });
  await page.getByRole("button", { name: "Mostrar slide 2" }).click();
  await expect(page.getByRole("heading", { name: "Ranking de atividade" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("tempo-real-ranking-1920x1080.png"), fullPage: true });

  const request = browserRequest(page);
  const rotateResponse = await request.post("/api/tempo-real", { data: { action: "ROTATE" } });
  expect(rotateResponse.ok()).toBe(true);
  const rotated = await rotateResponse.json() as { result: { shareUrl: string } };
  const fragment = new URL(rotated.result.shareUrl).hash;
  expect(fragment).toMatch(/^#[A-Za-z0-9_-]{43}$/);

  const publicPage = await context.newPage();
  await publicPage.setViewportSize({ width: 1366, height: 768 });
  await publicPage.goto(`/tempo-real-publico${fragment}`);
  await expect(publicPage.getByRole("heading", { name: "TEMPO REAL" })).toBeVisible();
  await expect(publicPage.locator(".app-shell")).toHaveCount(0);
  expect(await publicPage.evaluate(() => window.location.hash.length)).toBe(44);
  await publicPage.waitForTimeout(500);
  await publicPage.screenshot({ path: testInfo.outputPath("tempo-real-publico-1366x768.png"), fullPage: true });

  const revokeResponse = await request.post("/api/tempo-real", { data: { action: "REVOKE" } });
  expect(revokeResponse.ok()).toBe(true);
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { name: "Placar indisponível" })).toBeVisible();
});
