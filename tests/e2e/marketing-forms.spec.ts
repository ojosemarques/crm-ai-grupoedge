import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

async function expectNoOverflow(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, label).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ fullPage: true, path: testInfo.outputPath(`${name}.png`) });
}

test("gestor publica, recebe lead e consulta a resposta do formulário", async ({ context, page }, testInfo) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  const watch = (target: Page) => {
    target.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    target.on("pageerror", (error) => browserErrors.push(error.message));
  };
  watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await login(page);
  await page.goto("/formularios");
  await expect(page.getByRole("heading", { name: "Formulários", level: 1 })).toBeVisible();

  const suffix = Date.now().toString(36);
  const formName = `QA Formulários ${suffix}`;
  const slug = `qa-formularios-${suffix}`;
  await page.getByRole("button", { name: "Novo formulário" }).click();
  const dialog = page.getByRole("dialog", { name: "Comece pelo nome e endereço" });
  await dialog.getByLabel("Nome").fill(formName);
  await dialog.locator("input").nth(1).fill(slug);
  await dialog.getByRole("button", { name: "Criar e editar" }).click();
  await expect(page).toHaveURL(/\/formularios\/[0-9a-f-]+$/);
  await expect(page.getByRole("navigation", { name: "Seções do formulário" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Prévia do formulário" })).toBeVisible();
  await page.getByRole("button", { name: "Estilo" }).click();
  await page.getByLabel("Botão").fill("#0ea5e9");
  await expect(page.getByRole("region", { name: "Prévia do formulário" }).getByRole("button", { name: /Avançar/ })).toHaveCSS("background-color", "rgb(14, 165, 233)");
  await capture(page, testInfo, "marketing-form-builder-desktop");

  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status")).toHaveText("Nova versão publicada.");
  await page.getByRole("button", { name: "Compartilhar" }).click();
  await expect(page.getByRole("img", { name: `QR Code para ${formName}` })).toBeVisible();
  await expect(page.getByText(/QR Code é marca registrada/)).toBeVisible();

  const publicPage = await context.newPage();
  watch(publicPage);
  await publicPage.emulateMedia({ reducedMotion: "reduce" });
  await publicPage.setViewportSize({ width: 1024, height: 768 });
  await publicPage.goto(`/f/${slug}?utm_source=e2e&utm_medium=qa&utm_campaign=marketing-forms`);
  await expect(publicPage.getByRole("heading", { name: /nome completo/i })).toBeVisible();
  await expect(publicPage.getByRole("button", { name: /Avançar/ })).toHaveCSS("background-color", "rgb(14, 165, 233)");
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await publicPage.setViewportSize(viewport);
    await expectNoOverflow(publicPage, `formulário público ${viewport.width}px`);
    await capture(publicPage, testInfo, `marketing-form-public-${viewport.width}`);
  }
  await publicPage.getByRole("textbox").fill("Pessoa QA Formulários");
  await publicPage.getByRole("textbox").press("Enter");
  await expect(publicPage.getByRole("heading", { name: /telefone/i })).toBeVisible();
  await publicPage.getByRole("button", { name: "Pergunta anterior" }).click();
  await expect(publicPage.getByRole("textbox")).toHaveValue("Pessoa QA Formulários");
  await publicPage.getByRole("textbox").press("Enter");
  await expect(publicPage.getByRole("heading", { name: /telefone/i })).toBeVisible();
  await publicPage.getByRole("textbox").fill(`+55119${suffix.slice(-8).padStart(8, "7").replace(/[^0-9]/g, "7")}`);
  await publicPage.getByRole("button", { name: /Enviar/ }).click();
  await expect(publicPage.getByRole("heading", { name: "Obrigado!" })).toBeVisible();

  await page.getByRole("button", { name: "Respostas" }).click();
  await expect(page.getByText("1 resposta", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Pessoa QA Formulários" })).toBeVisible();
  const responseTrigger = page.getByRole("button", { name: "Ver resposta" });
  await responseTrigger.click();
  await expect(page.getByRole("dialog", { name: "Resposta v1" })).toContainText("e2e");
  await expect(page.getByRole("dialog", { name: "Resposta v1" })).toContainText("Pessoa QA Formulários");
  await expect(page.getByRole("button", { name: "Fechar" })).toBeFocused();
  await page.getByRole("button", { name: "Fechar" }).click();
  await expect(responseTrigger).toBeFocused();

  await page.getByRole("button", { name: "Estatísticas" }).click();
  await expect(page.getByText("Visualizações únicas").locator("..").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("Taxa de conclusão").locator("..")).toContainText("100%");
  await expect(page.getByText("Sem respostas fechadas.")).toBeVisible();
  await capture(page, testInfo, "marketing-form-statistics-desktop");

  expect(browserErrors.filter((message) => !message.includes("Content Security Policy"))).toEqual([]);
});
