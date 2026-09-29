import { expect, test, type Page } from "@playwright/test";
import { DEMO_SEED_PASSWORD, DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("gestor consulta jornada, modelos e executa cálculo local", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/aquisicao");
  await expect(page.getByRole("heading", { name: "Aquisição e atribuição", level: 1 })).toBeVisible();
  await expect(page.getByText(/nenhuma mídia externa conectada/i)).toBeVisible();
  await expect(page.getByText("Primeiro toque")).toBeVisible();
  await page.getByRole("button", { name: "Calcular" }).first().click();
  await expect(page.getByRole("status")).toContainText(/calculado com rastreabilidade/i);
});

test("visualizador lê a jornada sem poder executar", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/aquisicao");
  await expect(page.getByRole("heading", { name: "Aquisição e atribuição", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Calcular" })).toHaveCount(0);
});

test("gestor pré-visualiza e confirma performance local sem conexão externa", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/aquisicao/midia");
  await expect(page.getByRole("heading", { name: "Mídia paga e performance", level: 1 })).toBeVisible();
  await expect(page.getByText(/nenhuma plataforma externa está conectada/i)).toBeVisible();
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  await expect(page.getByRole("status")).toContainText(/1 válidas e 0 rejeitadas/i);
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("status")).toContainText(/fatos confirmados/i);
});
