import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_PASSWORD } from "@/modules/settings/application/demo-seed-service";
import { enterDemoCompany } from "./helpers/company-hub";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await enterDemoCompany(page);
}
test("admin configura planos e vendedor acessa só seu OTE pelo menu, inclusive no celular", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "admin@demo.politizai.local");
  await page.goto("/ote/configuracao?month=2026-10");
  await page.getByRole("combobox", { name: "Pessoa", exact: true }).selectOption({ label: "Closer 1 de demonstração" });
  await page.getByLabel("Fixo mensal (R$)").fill("3700");
  await page.getByLabel("Meta NEW ACV (R$)").fill("60000");
  await page.getByLabel("Bônus a 100% (R$)").fill("1200");
  await page.getByRole("button", { name: "Salvar plano" }).click();
  await expect(page.getByRole("status")).toContainText("Registro salvo");
  await page.getByRole("combobox", { name: "Pessoa", exact: true }).selectOption({ label: "Closer 2 de demonstração" });
  await page.getByLabel("Fixo mensal (R$)").fill("2500");
  await page.getByLabel("Meta NEW ACV (R$)").fill("35000");
  await page.getByLabel("Bônus a 100% (R$)").fill("700");
  await page.getByRole("button", { name: "Salvar plano" }).click();
  await expect(page.getByRole("status")).toContainText("Registro salvo");
  await page.context().clearCookies();
  await login(page, "closer1@demo.politizai.local");
  await page.getByRole("button", { name: "Abrir menu do usuário" }).click();
  await page.getByRole("link", { name: "OTE (salário e comissão)" }).click();
  await expect(page.getByRole("heading", { name: "OTE (salário e comissão)", exact: true })).toBeVisible();
  await page.goto("/ote?month=2026-10");
  await expect(page.getByRole("heading", { name: "Seu OTE a 100% da meta" })).toBeVisible();
  await expect(page.locator("main")).toContainText(/8\.500,00/);
  await expect(page.locator("main")).not.toContainText(/5\.300,00|2\.500,00/);
  await expect(page.getByRole("link", { name: "Administrar remuneração" })).toHaveCount(0);
  await page.getByLabel("NEW ACV vendido (R$)").fill("90000");
  await expect(page.locator('main [aria-live="polite"]')).toContainText(/11\.200,00/);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ote?month=2026-10");
    await expect(page.getByRole("heading", { name: "Seu OTE a 100% da meta" })).toBeVisible();
    if (width === 390) {
      await page.locator('button[aria-controls="menu-principal"]').click();
      await page.getByRole("button", { name: "Abrir menu do usuário" }).click();
      await page.getByRole("link", { name: "OTE (salário e comissão)" }).click();
      await expect(page.locator("#menu-principal")).toHaveAttribute("aria-hidden", "true");
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`ote-${width}.png`), fullPage: true, animations: "disabled" });
  }
  const other = await page.request.get("/api/ote?month=2026-10&memberId=other");
  expect(other.status()).toBe(400);
  const mutation = await page.request.post("/api/ote/admin", { data: { action: "SAVE_PLAN" } });
  expect(mutation.status()).toBe(403);
  await page.goto("/ote/configuracao");
  await expect(page).toHaveURL(/\/acesso-negado$/);
  expect(errors).toEqual([]);
});
