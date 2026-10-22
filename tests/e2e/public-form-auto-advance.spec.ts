import { expect, test, type Page } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";

import { enterDemoCompany } from "./helpers/company-hub";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0]!.email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
}

test("escolha única avança automaticamente, exceto na última pergunta", async ({ context, page }) => {
  await login(page);
  await page.goto("/formularios");

  const suffix = Date.now().toString(36);
  const formName = `QA Auto avanço ${suffix}`;
  const slug = `qa-auto-avanco-${suffix}`;
  await page.getByRole("button", { name: "Novo formulário" }).click();
  const dialog = page.getByRole("dialog", { name: "Comece pelo nome e endereço" });
  await dialog.getByLabel("Nome").fill(formName);
  await dialog.locator("input").nth(1).fill(slug);
  await dialog.getByRole("button", { name: "Criar e editar" }).click();

  const addQuestion = page.getByLabel("Adicionar tipo de pergunta");
  await addQuestion.selectOption("SINGLE_CHOICE");
  let settings = page.getByText("Configurar pergunta", { exact: true }).locator("..").locator("..");
  await settings.getByLabel("Pergunta").fill("Escolha intermediária");
  await settings.getByRole("button", { name: "Mover para cima" }).click();
  await addQuestion.selectOption("SINGLE_CHOICE");
  settings = page.getByText("Configurar pergunta", { exact: true }).locator("..").locator("..");
  await settings.getByLabel("Pergunta").fill("Escolha final");

  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status")).toHaveText("Nova versão publicada.");

  const publicPage = await context.newPage();
  await publicPage.goto(`/f/${slug}`);
  await publicPage.getByRole("textbox").fill("Pessoa QA Auto avanço");
  await publicPage.getByRole("textbox").press("Enter");
  await expect(publicPage.getByRole("heading", { name: "Escolha intermediária" })).toBeVisible();

  await publicPage.getByRole("radio", { name: "Opção 1" }).click();
  await expect(publicPage.getByRole("heading", { name: /telefone/i })).toBeVisible();
  await publicPage.getByRole("button", { name: "Pergunta anterior" }).click();
  await expect(publicPage.getByRole("heading", { name: "Escolha intermediária" })).toBeVisible();
  await publicPage.getByRole("radio", { name: "Opção 1" }).click();
  await expect(publicPage.getByRole("heading", { name: /telefone/i })).toBeVisible();

  await publicPage.getByRole("textbox").fill("+5511999999999");
  await publicPage.getByRole("textbox").press("Enter");
  await expect(publicPage.getByRole("heading", { name: "Escolha final" })).toBeVisible();
  await publicPage.getByRole("radio", { name: "Opção 1" }).click();
  await expect(publicPage.getByRole("heading", { name: "Escolha final" })).toBeVisible();
  await expect(publicPage.getByRole("button", { name: /Enviar/ })).toBeVisible();
});
