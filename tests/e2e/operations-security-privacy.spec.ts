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

test("gestor consulta SLOs, avalia alertas e navega por segurança, privacidade e resiliência", async ({ page }) => {
  await login(page, DEMO_USERS[1].email);
  await page.goto("/operacoes");
  await expect(page.getByRole("heading", { name: "Observabilidade, segurança e resiliência", level: 1 })).toBeVisible();
  await expect(page.getByText(/Sem egress, notificações externas ou exclusão automática/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Objetivos de serviço" })).toBeVisible();
  await page.getByRole("button", { name: "Avaliar alertas" }).click();
  await expect(page.getByRole("status")).toContainText("Regras avaliadas");
  await page.getByRole("tab", { name: "Segurança" }).click();
  await expect(page.getByRole("heading", { name: "Integridade da auditoria" })).toBeVisible();
  await page.getByRole("tab", { name: "Privacidade e LGPD" }).click();
  await expect(page.getByRole("heading", { name: "Solicitações de titulares" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inventário e finalidade" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Executar checkpoint seguro" })).toBeVisible();
  await page.getByRole("tab", { name: "Resiliência" }).click();
  await expect(page.getByRole("heading", { name: "Catálogo de criticidade e recuperação" })).toBeVisible();
  await expect(page.getByText("Nenhum teste destrutivo usa public")).toBeVisible();
  const readiness = await page.request.get("/api/ready");
  expect(readiness.status()).toBe(200);
  await expect(readiness.json()).resolves.toMatchObject({ service: "politizai-crm", ready: true });
});

test("visualizador não contorna RBAC por URL", async ({ page }) => {
  await login(page, DEMO_USERS.at(-1)!.email);
  await page.goto("/operacoes");
  await expect(page).toHaveURL(/acesso-negado/);
});

test("console operacional permanece utilizável no mobile e por teclado", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, DEMO_USERS[0].email);
  await page.goto("/operacoes");
  await expect(page.getByRole("heading", { name: "Observabilidade, segurança e resiliência", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.getByRole("tab", { name: "Segurança" }).focus();
  await expect(page.getByRole("tab", { name: "Segurança" })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("operations-390x844.png"), fullPage: true });
  const response = await page.request.get("/");
  expect(response.headers()["content-security-policy"]).toContain("object-src 'none'");
});
