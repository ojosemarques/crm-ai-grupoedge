import { expect, test } from "@playwright/test";

import { enterDemoCompany } from "./helpers/company-hub";
import {
  DEMO_SEED_PASSWORD,
  DEMO_USERS,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await enterDemoCompany(page);
  await expect(page).toHaveURL(/\/$/);
}

test("gestor configura metas diárias por pessoa e vendedor acompanha o progresso", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/meu-dia");

  await page.getByRole("button", { name: "Configurar metas por pessoa" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /Metas de/ })).toBeVisible();
  await dialog.getByLabel("Pessoa").selectOption({ label: DEMO_USERS[2].displayName });
  await dialog.getByLabel("Ligações por dia").fill("50");
  await dialog.getByLabel("Mensagens por dia").fill("40");
  await dialog.getByLabel("Contatos efetivos").fill("10");
  await dialog.getByLabel("Qualificações").fill("5");
  await dialog.getByLabel("Reuniões marcadas").fill("3");
  await dialog.getByLabel("Propostas").fill("2");
  await dialog.getByLabel("Valor de vendas esperado (R$)").fill("25000.00");
  await dialog.getByRole("button", { name: "Salvar metas diárias" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByLabel("Visualizar fila por SDR").selectOption({ label: DEMO_USERS[2].displayName });
  await expect(page).toHaveURL(new RegExp(`memberId=`));
  await expect(page.getByText(/de 7 metas atingidas/)).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Ligações" })).toContainText("/ 50");
  await expect(page.locator("article").filter({ hasText: "Mensagens" })).toContainText("/ 40");
  await expect(page.locator("article").filter({ hasText: "Valor vendido" })).toContainText("R$ 25.000,00");

  const logout = await page.request.post("/api/auth/logout", {
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(logout.status()).toBe(200);
  await login(page, DEMO_USERS[2].email);
  await page.goto("/meu-dia");
  await expect(page.getByRole("button", { name: "Configurar metas por pessoa" })).toHaveCount(0);
  await expect(page.getByText(/de 7 metas atingidas/)).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "Ligações" })).toContainText("/ 50");
});
