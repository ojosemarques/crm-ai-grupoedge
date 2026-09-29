import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  DEMO_SEED_PASSWORD,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Workspace").fill(DEMO_WORKSPACE_SLUG);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(DEMO_SEED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

function uniquePhone(): string {
  const hex = createHash("sha256").update(randomUUID()).digest("hex");
  const suffix = (BigInt(`0x${hex.slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

test("gestor detecta, filtra, reconhece e resolve violação histórica", async ({ page }) => {
  await login(page, "gestor@demo.politizai.local");
  await page.goto("/leads/entrada");
  await page.getByLabel("Nome", { exact: true }).fill("Lead auditoria E2E");
  await page.getByLabel("Telefone", { exact: true }).fill(uniquePhone());
  await page.getByRole("button", { name: "Cadastrar lead" }).click();
  await expect(page.getByText("Entrada processada", { exact: true })).toBeVisible();

  await page.goto("/auditoria");
  await expect(page.getByRole("heading", { name: "Auditoria e saúde do processo" })).toBeVisible();
  await expect(page.getByText("Exportação permanece desabilitada", { exact: false })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Atualizar achados" }).click();
  await expect(page.getByRole("status")).toContainText("Varredura concluída");

  const health = page.locator('section[aria-labelledby="health-heading"]');
  await health.getByLabel("Violação").selectOption("SLA_VIOLATED");
  await health.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/violationType=SLA_VIOLATED/);
  const finding = health.locator("article").filter({ hasText: "SLA imediato violado" }).first();
  await expect(finding).toBeVisible();
  await finding.getByText("Ver evidência concreta").click();
  await expect(finding).toContainText('"policyMinutes": 0');

  page.once("dialog", (dialog) => dialog.accept());
  await finding.getByRole("button", { name: "Reconhecer" }).click();
  await expect(page.getByRole("status")).toContainText("Achado reconhecido e auditado");

  const acknowledged = health.locator("article").filter({ hasText: "SLA imediato violado" }).first();
  await acknowledged.getByLabel("Motivo da resolução").fill("Violação histórica revisada pelo gestor no E2E.");
  page.once("dialog", (dialog) => dialog.accept());
  await acknowledged.getByRole("button", { name: "Revalidar e resolver" }).click();
  await expect(page.getByRole("status")).toContainText("Achado resolvido sem apagar o fato original");

  const audit = page.locator('section[aria-labelledby="audit-heading"]');
  await audit.locator('select[name="auditAction"]').selectOption("process_health.violation.resolved");
  await audit.getByRole("button", { name: "Filtrar" }).click();
  await expect(audit.locator("tbody code").filter({ hasText: "process_health.violation.resolved" }).first()).toBeVisible();
  await audit.getByText("Ver anterior, posterior e detalhes").first().click();
  await expect(audit).toContainText("Violação histórica revisada pelo gestor no E2E.");
});

test("visualizador não acessa auditoria por URL nem mutação direta", async ({ page }) => {
  await login(page, "viewer@demo.politizai.local");
  await page.goto("/auditoria");
  await expect(page).toHaveURL(/\/acesso-negado$/);

  const denied = await page.evaluate(async () => {
    const response = await fetch("/api/audit/process-health", { method: "POST" });
    return { status: response.status, body: await response.json() };
  });
  expect(denied.status).toBe(403);
  expect(denied.body.error.message).toBe("Você não tem permissão para realizar esta ação.");
});
