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

test("formata e valida WhatsApp brasileiro no formulário público", async ({ context, page }) => {
  await login(page);
  await page.goto("/formularios");

  const suffix = Date.now().toString(36);
  const slug = `qa-whatsapp-${suffix}`;
  await page.getByRole("button", { name: "Novo formulário" }).click();
  const dialog = page.getByRole("dialog", { name: "Comece pelo nome e endereço" });
  await dialog.getByLabel("Nome").fill(`QA WhatsApp ${suffix}`);
  await dialog.locator("input").nth(1).fill(slug);
  await dialog.getByRole("button", { name: "Criar e editar" }).click();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status")).toHaveText("Nova versão publicada.");

  const publicPage = await context.newPage();
  await publicPage.goto(`/f/${slug}`);
  await publicPage.getByRole("textbox").fill("Pessoa QA WhatsApp");
  await publicPage.getByRole("textbox").press("Enter");

  const phone = publicPage.getByRole("textbox");
  await phone.fill("6235796723");
  await publicPage.getByRole("button", { name: /Enviar/ }).click();
  await expect(publicPage.locator("#question-error")).toContainText("Informe um WhatsApp com DDD e 11 dígitos");

  await phone.fill("629857967231234");
  await expect(phone).toHaveValue("(62)98579-6723");
  await expect(phone).toHaveAttribute("maxlength", "14");
});
