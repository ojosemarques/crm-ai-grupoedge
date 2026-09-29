import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("administrador inspeciona as 12 regras, filtra runs e altera status com confirmação", async ({ page }) => {
  await login(page, "admin@demo.politizai.local");
  await page.goto("/automacoes");

  await expect(page.getByRole("heading", { name: "Automações locais" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(12);
  const cadence = page.locator("article").filter({ hasText: "6. Não atendeu" });
  await expect(cadence).toContainText("D0, D1, D3, D7, D14, D21 e D30");
  await cadence.getByText("Ver gatilho, condições e ações").click();
  await expect(cadence).toContainText("CALL_UNANSWERED");

  page.once("dialog", (dialog) => dialog.accept());
  await cadence.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByRole("status")).toContainText("Regra pausada e auditada");
  await expect(cadence).toContainText("Pausada");

  page.once("dialog", (dialog) => dialog.accept());
  await cadence.getByRole("button", { name: "Ativar" }).click();
  await expect(page.getByRole("status")).toContainText("Regra ativada e auditada");

  await page.getByLabel("Status").selectOption("FAILED");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/status=FAILED/);
  await expect(page.getByRole("cell", { name: "Falha", exact: true }).first()).toBeVisible();
  await expect(page.getByText("Falha controlada para inspeção local.").first()).toBeVisible();
});

test("gestor consulta automações sem poder alterar regras", async ({ page }) => {
  await login(page, "gestor@demo.politizai.local");
  await page.goto("/automacoes");

  await expect(page.getByRole("heading", { name: "Histórico de execuções" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(12);
  await expect(page.getByRole("button", { name: /Pausar|Ativar/ })).toHaveCount(0);
});

test("usuário sem automations.read é bloqueado e ainda acessa a própria central", async ({ page }) => {
  await login(page, "viewer@demo.politizai.local");
  await page.goto("/automacoes");
  await expect(page).toHaveURL(/\/acesso-negado$/);

  await page.goto("/notificacoes?status=UNREAD");
  await expect(page.getByRole("heading", { name: "Minhas notificações" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nenhuma notificação neste recorte" })).toBeVisible();
});
