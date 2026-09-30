import { expect, test } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

test("operação integrada expõe módulos e Copilot em desktop e mobile", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha", { exact: true }).fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const path of ["/financeiro", "/financeiro?section=dre", "/aquisicao/midia", "/onboarding"]) {
      await page.goto(path);
      const title = path.startsWith("/financeiro") ? "Financeiro" : path === "/aquisicao/midia" ? "Mídia paga e performance" : "Handoff e onboarding";
      await expect(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
      await expect(page.locator("main[aria-busy=true]")).toHaveCount(0);
      await expect(page.getByText("Algo deu errado", { exact: true })).toHaveCount(0);
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(size.scroll).toBeLessThanOrEqual(size.width);
    }
    await page.getByRole("button", { name: "Copilot", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Chat do Copilot" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Chat do Copilot" })).toHaveCSS("transform", "none");
    const drawer = await page.getByRole("complementary", { name: "Chat do Copilot" }).boundingBox();
    expect(drawer!.x).toBeGreaterThanOrEqual(0);
    expect(drawer!.x + drawer!.width).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByLabel("Pergunte ao Copilot")).toBeVisible();
    if (viewport.width === 1440) {
      await page.getByLabel("Pergunte ao Copilot").fill("Como estão o caixa, as despesas e o MRR?");
      const response = page.waitForResponse((item) => item.url().includes("/api/ai/copilot") && item.request().method() === "POST");
      await page.getByRole("button", { name: "Enviar pergunta", exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(page.getByRole("complementary", { name: "Chat do Copilot" }).getByText(/Recebido|Recebimentos|Caixa|caixa/).last()).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`edge-os-${viewport.width}.png`), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Fechar Copilot", exact: true }).click();
  }
  expect(errors).toEqual([]);
});
