import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";

const VIEWPORTS = [
  { height: 900, label: "1440x900", width: 1440 },
  { height: 800, label: "1280x800", width: 1280 },
  { height: 768, label: "1024x768", width: 1024 },
  { height: 844, label: "390x844", width: 390 },
] as const;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(DEMO_USERS[1].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function expectNoOverflow(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, label).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ animations: "disabled", fullPage: false, path: testInfo.outputPath(`${name}.png`) });
}

test("filtros de Leads preservam densidade e acessibilidade nas quatro resoluções", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await login(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/leads?priorities=P1&sla=CRITICAL", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Encontre o lead certo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remover filtro P1" })).toBeVisible();
    await expect(page.locator("select[multiple]")).toHaveCount(0);
    await expectNoOverflow(page, `lista ${viewport.label}`);
    await capture(page, testInfo, `design-04-${viewport.label}`);
  }
});

test("dialogs restauram foco e expõem todos os grupos avançados", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.goto("/leads");

  const advancedTrigger = page.getByRole("button", { name: /^Mais filtros/ });
  await advancedTrigger.click();
  const drawer = page.getByRole("dialog", { name: "Refine sua lista" });
  for (const group of ["Responsabilidade", "Funil", "Aquisição", "Perfil", "Atividade", "Encerramento", "Pontuação"]) {
    await expect(drawer.getByRole("heading", { name: group })).toBeVisible();
  }
  await capture(page, testInfo, "design-04-drawer-desktop");
  await page.keyboard.press("Escape");
  await expect(advancedTrigger).toBeFocused();

  const priorityTrigger = page.getByRole("button", { name: "Prioridade: Todos" });
  await priorityTrigger.click();
  const priorityDialog = page.getByRole("dialog", { name: "Filtrar por prioridade" });
  await expect(priorityDialog.getByRole("checkbox")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(priorityTrigger).toBeFocused();
});
