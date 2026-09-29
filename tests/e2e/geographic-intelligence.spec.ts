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

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { className: element.className.toString().slice(0, 80), right: Math.round(box.right), tag: element.tagName };
      })
      .filter((element) => element.right > clientWidth + 1)
      .slice(0, 8);
    return { clientWidth, overflow, scrollWidth: document.documentElement.scrollWidth };
  });
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.overflow)).toBeLessThanOrEqual(dimensions.clientWidth);
}

test("gestor executa backfill conservador e consulta mapa offline reconciliado", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await login(page, DEMO_USERS[1].email);
  await page.goto("/inteligencia-geografica");
  await expect(page.getByRole("heading", { name: "Inteligência geográfica", level: 1 })).toBeVisible();
  await expect(page.getByText(/sem tiles, geocoder ou envio de dados/i)).toBeVisible();
  await page.getByRole("button", { name: "Prévia do backfill" }).click();
  await expect(page.getByRole("status")).toContainText(/Prévia:/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Aplicar backfill" }).click();
  await expect(page.getByRole("status")).toContainText(/Backfill:/);
  await expect(page.getByRole("group", { name: /Mapa esquemático do Brasil/ })).toBeVisible();
  await page.getByRole("button", { name: /^SP:/ }).click();
  await expect(page.getByRole("heading", { name: "SP" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir leads da região" })).toHaveAttribute("href", /state=SP/);
  await expect(page.getByText(/CPL, CAC e ROAS: indisponíveis/i)).toBeVisible();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Inteligência geográfica", level: 1 })).toBeVisible();
    await expect(page.getByText(/Mapa territorial/)).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`geografia-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
});

test("visualizador consulta agregados sem controles administrativos", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/inteligencia-geografica");
  await expect(page.getByRole("heading", { name: "Inteligência geográfica", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aplicar backfill" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publicar nova versão" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Inativar" })).toHaveCount(0);
});
