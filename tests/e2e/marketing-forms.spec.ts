import { enterDemoCompany } from "./helpers/company-hub";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

for (const mode of ["direto", "iframe", "restrito"] as const) {
  const embedded = mode !== "direto";
  const restricted = mode === "restrito";
  test(`formulário salva e abre WhatsApp ${mode}`, async ({ context, page, baseURL }) => {
    test.setTimeout(45_000);
    await login(page);
    await page.goto("/formularios");
    const suffix = `${Date.now().toString(36)}-${mode}`;
    const slug = `qa-whatsapp-${suffix}`;
    await page.getByRole("button", { name: "Novo formulário" }).click();
    const dialog = page.getByRole("dialog", { name: "Comece pelo nome e endereço" });
    await dialog.getByLabel("Nome").fill(`QA WhatsApp ${suffix}`);
    await dialog.locator("input").nth(1).fill(slug);
    await dialog.getByRole("button", { name: "Criar e editar" }).click();
    await page.getByRole("button", { name: "Opções", exact: true }).click();
    await page.getByRole("combobox", { name: "Redirecionamento", exact: true }).selectOption("WHATSAPP");
    await page.getByLabel("Telefone E.164").fill("+5562982514665");
    await page.getByLabel("Mensagem WhatsApp").fill("Opa, quero saber mais sobre a politizaí");
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Nova versão publicada.");

    const publicPage = await context.newPage();
    await context.route("https://wa.me/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Destino WhatsApp</h1>" }));
    const publicUrl = `${baseURL}/f/${slug}`;
    const wrapper = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(`<iframe title="Forms Mandato" src="${publicUrl}" ${restricted ? 'sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"' : ""} style="width:100%;height:800px"></iframe>`);
    });
    try {
      if (embedded) {
        await new Promise<void>(resolve => wrapper.listen(0, "127.0.0.1", resolve));
        await publicPage.goto(`http://127.0.0.1:${(wrapper.address() as AddressInfo).port}/mandato-embed-test`);
      } else {
        await publicPage.goto(publicUrl);
      }
      const form = embedded ? publicPage.frameLocator('iframe[title="Forms Mandato"]') : publicPage;
      await form.getByRole("textbox").fill(`Pessoa QA WhatsApp ${suffix}`);
      await form.getByRole("button", { name: /Avançar/ }).click();
      await form.getByRole("textbox").fill("(62)99876-5432");
      // A proteção pública exige pelo menos 800 ms de preenchimento.
      await publicPage.waitForTimeout(850);
      const submitted = publicPage.waitForResponse(response => response.url().endsWith(`/api/public/forms/${slug}/submit`));
      await form.getByRole("button", { name: /Enviar/ }).click();
      const response = await submitted;
      expect(response.status()).toBe(201);
      const result = (await response.json()).result;
      expect(result.outcome).toBe("ACCEPTED");
      const destination = new URL(result.redirect.url);
      expect(destination.origin + destination.pathname).toBe("https://wa.me/5562982514665");
      expect(destination.searchParams.get("text")).toBe("Opa, quero saber mais sobre a politizaí");
      if (restricted) {
        await expect(form.getByRole("status")).toHaveText("Cadastro salvo. Use o botão abaixo para abrir o WhatsApp.");
        const popup = context.waitForEvent("page");
        await form.getByRole("link", { name: "Abrir WhatsApp", exact: true }).click();
        const destinationPage = await popup;
        await expect(destinationPage).toHaveURL(result.redirect.url);
        await expect(destinationPage.getByRole("heading", { name: "Destino WhatsApp" })).toBeVisible();
      } else {
        await expect(publicPage).toHaveURL(result.redirect.url);
        await expect(publicPage.getByRole("heading", { name: "Destino WhatsApp" })).toBeVisible();
      }
      await page.getByRole("button", { name: "Respostas", exact: true }).click();
      await expect(page.getByRole("cell", { name: `Pessoa QA WhatsApp ${suffix}`, exact: true })).toBeVisible();
    } finally {
      if (wrapper.listening) await new Promise<void>((resolve, reject) => wrapper.close(error => error ? reject(error) : resolve()));
    }
  });
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
