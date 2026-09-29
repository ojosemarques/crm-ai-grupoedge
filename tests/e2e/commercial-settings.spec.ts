import { expect, test } from "@playwright/test";

import { DEMO_SEED_PASSWORD, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("administrador revisa impacto antes de criar produto", async ({ page }) => {
  await login(page, "admin@demo.politizai.local");
  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Configurações comerciais" })).toBeVisible();
  await expect(page.getByText("SLA imediato — 0 minutos", { exact: true })).toBeVisible();
  const products = page.getByRole("region", { name: "Produtos" });
  const sku = `E2E-${Date.now()}`;
  await products.getByLabel("SKU").fill(sku);
  await products.getByLabel("Nome").fill("Produto criado no E2E");
  await products.getByLabel("Preço de lista (R$)").fill("123,45");
  await products.getByRole("button", { name: "Revisar criação" }).click();
  await expect(page.getByRole("heading", { name: "Criar produto" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar alteração" }).click();
  await expect(page.getByRole("status")).toContainText("salva e auditada");
  await expect(products.getByLabel("Editar item").getByRole("option", { name: "Produto criado no E2E" })).toBeAttached();
});

test("SDR não acessa configurações por URL direta", async ({ page }) => {
  await login(page, "sdr1@demo.politizai.local");
  await page.goto("/configuracoes");
  await expect(page).toHaveURL(/\/acesso-negado$/);
  await expect(page.getByRole("heading", { name: "Você não tem permissão para esta ação" })).toBeVisible();
});
