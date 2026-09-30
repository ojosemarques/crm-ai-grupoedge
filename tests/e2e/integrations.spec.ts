import { enterDemoCompany } from "./helpers/company-hub";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS, } from "@/modules/settings/application/demo-seed-service";
async function login(page: Page, email: string) { await page.goto("/login"); await page.getByLabel("E-mail").fill(email); await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD); await page.getByRole("button", { name: "Entrar" }).click(); await enterDemoCompany(page); await expect(page).toHaveURL(/\/$/); }
test("gestor consulta e valida o adaptador apenas local", async ({ page }) => { await login(page, DEMO_USERS[1].email); await page.goto("/integracoes"); await expect(page.getByRole("heading", { name: "Integrações", level: 1 })).toBeVisible(); await expect(page.getByRole("link", { name: "Configurar Meta Ads" })).toBeVisible(); const localAdapter = page.locator("section").filter({ has: page.getByRole("heading", { name: "Adaptador local determinístico" }) }); await localAdapter.getByRole("button", { name: "Testar localmente" }).click(); await expect(page.getByText(/sem egress externo/i)).toBeVisible(); });
test("administrador configura Meta Ads sem expor nem exigir segredo na interface", async ({ page }) => { await login(page, DEMO_USERS[0].email); await page.goto("/integracoes/meta-ads"); await expect(page.getByRole("heading", { name: "Meta Ads", level: 1 })).toBeVisible(); await expect(page.getByText(/aguardando configuração segura/i)).toBeVisible(); await expect(page.getByLabel(/token/i)).toHaveCount(0); await page.getByRole("button", { name: "Salvar configuração" }).click(); await expect(page.getByRole("status")).toContainText(/aguardando a referência server-side/i); await expect(page.getByText("Aguardando credenciais", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Testar conexão" }).click(); await expect(page.getByRole("status")).toContainText(/token Meta ainda não está disponível/i); });
test("visualizador não acessa integrações", async ({ page }) => { await login(page, DEMO_USERS.at(-1)!.email); await page.goto("/integracoes"); await expect(page).toHaveURL(/\/acesso-negado$/); });
test("visualizador não acessa Meta Ads por URL direta", async ({ page }) => { await login(page, DEMO_USERS.at(-1)!.email); await page.goto("/integracoes/meta-ads"); await expect(page).toHaveURL(/\/acesso-negado$/); });
test("administrador configura Google Ads sem campo de segredo ou egress", async ({ page }) => {
  await login(page, DEMO_USERS[0].email);
  await page.goto("/integracoes/google-ads");
  await expect(page.getByRole("heading", { name: "Google Ads", level: 1 })).toBeVisible();
  await expect(page.getByText("Validação externa adiada", { exact: true }).first()).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /client secret|refresh token|chave privada|developer token/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByRole("status")).toContainText(/validação externa permanece adiada/i);
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByRole("status")).toContainText(/referências server-side/i);
});
test("visualizador não acessa Google Ads por URL direta", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/integracoes/google-ads");
  await expect(page).toHaveURL(/\/acesso-negado$/);
});
