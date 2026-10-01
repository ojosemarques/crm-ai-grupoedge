import { expect, test } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_USERS } from "@/modules/settings/application/demo-seed-service";
import { enterDemoCompany } from "./helpers/company-hub";

test("administrador configura uma cadência por modelo sem campos técnicos", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(DEMO_USERS[0].email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);

  await page.goto("/configuracoes");
  await page.getByLabel("Modelo pronto").selectOption("NO_REPLY");
  await expect(page.getByText("Retomadas espaçadas sem pressionar o contato.")).toBeVisible();
  await expect(page.getByText("Etapa 4")).toBeVisible();
  await expect(page.getByLabel("O lead responder")).toBeChecked();
  await expect(page.getByLabel("Uma reunião for marcada")).toBeChecked();
  await expect(page.getByLabel("Responsável").first()).toContainText("Responsável atual do lead");
  await expect(page.getByLabel("Mover para a etapa").first()).toContainText("Não mover automaticamente");
  await expect(page.getByPlaceholder("Texto que aparecerá para o vendedor. Use {nome} para personalizar.").first()).toHaveValue(/Retomando nosso contato/);
});
